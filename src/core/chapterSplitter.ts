/**
 * NEXUS Translator - Robust Chapter Splitter
 * Intelligently parses Chinese and English web-novel text files into clean chapters.
 */

export interface SplitChapter {
  title: string;
  content: string;
}

// Regex matching chapter headers at line start (with optional whitespace)
// Matches:
// - 第X章, 第 X 章, 第001章, 第一章, 第一百二十章
// - 第X回, 第X节, 第X集, 第X卷, 第X部, 第X篇, 第X话, 第X話
// - 卷一, 卷1, 第一卷
// - Chapter 1, Chapter 01, Chapter 12: Title
// - 楔子, 序章, 序言, 引子, 前言, 尾声, 番外, 后记
// - บทที่ 1, ตอนที่ 1, บท 1, ตอน 1
const CHAPTER_HEADER_REGEX = /^[ \t\u3000\uFEFF]*(?:(?:第\s*[0-9一二三四五六七八九十百千万零]+\s*[章回节集卷部篇话話])|(?:卷\s*[0-9一二三四五六七八九十百]+)|(?:Chapter\s*[0-9]+)|(?:[楔序]子|序[章言]|前言|尾声|番外|后记)|(?:(?:บท|ตอน)(?:ที่)?\s*[0-9]+))/i;

/**
 * Splits raw novel text into ordered chapters.
 * Guarantees no text loss (preamble before Chapter 1 is captured as Prologue).
 */
export function splitNovelIntoChapters(
  rawText: string,
  novelTitle: string = 'นิยาย',
  maxLinesPerChunkIfNoHeaders: number = 100
): SplitChapter[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Normalize newlines and full-width spaces
  const normalized = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const chapterStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (CHAPTER_HEADER_REGEX.test(line)) {
      chapterStarts.push(i);
    }
  }

  // Case A: No recognized chapter headers found
  if (chapterStarts.length === 0) {
    // If text is short, keep as 1 chapter
    if (lines.length <= maxLinesPerChunkIfNoHeaders) {
      const firstLine = lines.find(l => l.trim().length > 0)?.trim() || novelTitle;
      const title = firstLine.length <= 40 ? firstLine : `ตอนที่ 1: ${novelTitle}`;
      return [{ title, content: normalized }];
    }

    // If text is very long, safely split into chunks of ~maxLinesPerChunkIfNoHeaders lines
    const chunks: SplitChapter[] = [];
    let currentLines: string[] = [];
    let chunkIndex = 1;

    for (let i = 0; i < lines.length; i++) {
      currentLines.push(lines[i]);
      if (currentLines.length >= maxLinesPerChunkIfNoHeaders && i < lines.length - 1) {
        chunks.push({
          title: `ตอนที่ ${chunkIndex} (ช่วงที่ ${chunkIndex})`,
          content: currentLines.join('\n').trim(),
        });
        currentLines = [];
        chunkIndex++;
      }
    }

    if (currentLines.length > 0) {
      chunks.push({
        title: `ตอนที่ ${chunkIndex} (ช่วงที่ ${chunkIndex})`,
        content: currentLines.join('\n').trim(),
      });
    }

    return chunks;
  }

  // Case B: Chapter headers found
  const results: SplitChapter[] = [];

  // 1. Capture any preamble / synopsis / prologue before the first matched chapter
  if (chapterStarts[0] > 0) {
    const preambleLines = lines.slice(0, chapterStarts[0]);
    const preambleText = preambleLines.join('\n').trim();
    if (preambleText.length > 0) {
      const firstNonEmpty = preambleLines.find(l => l.trim().length > 0)?.trim() || 'บทนำ';
      const title = firstNonEmpty.length <= 40 ? firstNonEmpty : 'บทนำ (Prologue / แนะนำเรื่อง)';
      results.push({
        title,
        content: preambleText,
      });
    }
  }

  // 2. Capture each chapter
  for (let idx = 0; idx < chapterStarts.length; idx++) {
    const startLine = chapterStarts[idx];
    const endLine = idx + 1 < chapterStarts.length ? chapterStarts[idx + 1] : lines.length;
    const chapLines = lines.slice(startLine, endLine);
    const nonEmptyLines = chapLines.filter(l => l.trim().length > 0);

    // If this chapter section only contains the header line (TOC stub) and later chapters have content, skip TOC stub
    if (nonEmptyLines.length <= 1 && idx + 1 < chapterStarts.length) {
      const hasSubstantiveLater = chapterStarts.some((s, i) => {
        if (i <= idx) return false;
        const e = i + 1 < chapterStarts.length ? chapterStarts[i + 1] : lines.length;
        return lines.slice(s, e).filter(l => l.trim().length > 0).length > 2;
      });
      if (hasSubstantiveLater) {
        continue;
      }
    }

    const chapText = chapLines.join('\n').trim();
    const headerLine = lines[startLine].trim();
    // Clean title (cap at 60 chars)
    const title = headerLine.length <= 60 ? headerLine : `ตอนที่ ${results.length + 1}: ${headerLine.slice(0, 50)}...`;

    results.push({
      title,
      content: chapText,
    });
  }

  return results;
}
