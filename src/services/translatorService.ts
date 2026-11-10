import {
  NexusTranslationEngine,
  FailoverClient,
  createGeminiEndpoint,
  createGroqEndpoint,
  LLMEndpoint,
  ChapterInput,
  GlossaryTerm,
  CharacterProfile,
  CharacterRelationship,
  NexusProgress,
  ChapterResult,
} from '../core/nexus_translator_core';
import { NexusDatabase, Chapter, Novel, GlossaryItem, RelationshipItem, AppSettings } from '../storage/db';

export type TranslationProgressCallback = (progress: {
  chapterId: string;
  phase: string;
  percentage: number;
  batch?: number;
  totalBatches?: number;
}) => void;

class TranslatorService {
  private activeJobs = new Map<string, AbortController>();
  private progressListeners = new Set<TranslationProgressCallback>();

  addProgressListener(listener: TranslationProgressCallback) {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  private notifyProgress(info: {
    chapterId: string;
    phase: string;
    percentage: number;
    batch?: number;
    totalBatches?: number;
  }) {
    for (const listener of this.progressListeners) {
      try {
        listener(info);
      } catch (e) {
        console.error('Error in progress listener:', e);
      }
    }
  }

  cancelTranslation(chapterId: string) {
    const controller = this.activeJobs.get(chapterId);
    if (controller) {
      controller.abort();
      this.activeJobs.delete(chapterId);
    }
  }

  isTranslating(chapterId: string): boolean {
    return this.activeJobs.has(chapterId);
  }

  private buildEndpoints(settings: AppSettings): LLMEndpoint[] {
    const endpoints: LLMEndpoint[] = [];

    // Add Gemini keys (1 to 3) with trimming and quote removal
    const geminiKeys = (settings.geminiKeys || [])
      .map(k => (k || '').trim().replace(/^["']|["']$/g, ''))
      .filter(k => k.length > 0);

    const geminiModel = settings.geminiModel || 'gemini-2.5-flash';

    geminiKeys.forEach((key, index) => {
      endpoints.push(
        createGeminiEndpoint(key, {
          label: `gemini-key-${index + 1}`,
          model: geminiModel,
        })
      );
    });

    // Add Groq key as high-speed failover
    const groqKey = (settings.groqKey || '').trim().replace(/^["']|["']$/g, '');
    if (groqKey.length > 0) {
      endpoints.push(
        createGroqEndpoint(groqKey, {
          label: 'groq-qwen-failover',
          model: settings.groqModel || 'qwen/qwen3.8-27b',
        })
      );
    }

    return endpoints;
  }

  async translateChapter(
    novelId: string,
    chapterId: string
  ): Promise<ChapterResult> {
    const novel = await NexusDatabase.getNovel(novelId);
    if (!novel) throw new Error(`Novel not found: ${novelId}`);

    const chapter = await NexusDatabase.getChapter(novelId, chapterId);
    if (!chapter) throw new Error(`Chapter not found: ${chapterId}`);

    const settings = await NexusDatabase.getSettings();
    const endpoints = this.buildEndpoints(settings);

    if (endpoints.length === 0) {
      throw new Error('กรุณาระบุ Gemini API Key หรือ Groq API Key ในหน้าการตั้งค่า (Settings) ก่อนเริ่มแปล');
    }

    const glossary = await NexusDatabase.getGlossary(novelId);
    const relationships = await NexusDatabase.getRelationships(novelId);

    // Transform glossary to core GlossaryTerm
    const coreTerms: GlossaryTerm[] = glossary.map(g => ({
      sourceTerm: g.source,
      translatedTerm: g.target,
      category: g.category,
      confidence: g.confidence,
    }));

    // Transform character profiles
    const characters: CharacterProfile[] = glossary
      .filter(g => g.category === 'CHARACTER')
      .map(g => ({
        sourceName: g.source,
        thaiName: g.target,
        gender: g.gender || 'UNKNOWN',
        note: g.notes,
      }));

    // Transform relationships
    const coreRels: CharacterRelationship[] = relationships.map(r => ({
      from: r.fromName,
      to: r.toName,
      type: r.relationshipType,
      activeFromChapter: 1,
    }));

    const chapterInput: ChapterInput = {
      novelId,
      chapterNumber: chapter.chapterIndex,
      sourceText: chapter.sourceRaw,
      genre: novel.genre,
      glossary: coreTerms,
      characters,
      relationships: coreRels,
    };

    const abortController = new AbortController();
    this.activeJobs.set(chapterId, abortController);

    chapter.status = 'TRANSLATING';
    chapter.progress = 5;
    chapter.error = undefined;
    await NexusDatabase.saveChapter(novelId, chapter);

    try {
      const failoverClient = new FailoverClient(endpoints);

      const engine = new NexusTranslationEngine({
        client: failoverClient,
        numberThreshold: 100,
        onProgress: (p: NexusProgress) => {
          let pct = 10;
          if (p.phase === 'classify') pct = 15;
          else if (p.phase === 'translate' && p.batch && p.totalBatches) {
            pct = Math.round(15 + (p.batch / p.totalBatches) * 65);
          } else if (p.phase === 'repair') {
            pct = 85;
          } else if (p.phase === 'done') {
            pct = 100;
          }

          chapter.progress = pct;
          this.notifyProgress({
            chapterId,
            phase: p.phase,
            percentage: pct,
            batch: p.batch,
            totalBatches: p.totalBatches,
          });
        },
      });

      const result = await engine.translateChapter(chapterInput, abortController.signal);

      // Successful translation
      chapter.status = 'COMPLETED';
      chapter.progress = 100;
      chapter.translatedText = result.translatedText;
      chapter.lines = result.lines;
      chapter.translatedAt = Date.now();
      chapter.error = undefined;
      await NexusDatabase.saveChapter(novelId, chapter);

      return result;
    } catch (err: any) {
      if (abortController.signal.aborted) {
        chapter.status = 'PENDING';
        chapter.progress = 0;
        chapter.error = 'การแปลถูกยกเลิก';
      } else {
        chapter.status = 'ERROR';
        chapter.error = err.message || 'เกิดข้อผิดพลาดในการแปล';
      }
      await NexusDatabase.saveChapter(novelId, chapter);
      throw err;
    } finally {
      this.activeJobs.delete(chapterId);
    }
  }

  async translateAllPending(novelId: string): Promise<void> {
    const chapters = await NexusDatabase.getChapters(novelId);
    const pendingChapters = chapters.filter(c => c.status !== 'COMPLETED');
    for (const chap of pendingChapters) {
      await this.translateChapter(novelId, chap.id);
    }
  }
}

export const translatorService = new TranslatorService();
