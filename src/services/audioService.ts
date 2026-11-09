import * as Speech from 'expo-speech';
import { Platform } from 'react-native';
import {
  RadioDramaEngine,
  SceneId,
  detectScenes,
  normalizeForTts,
  LineResult,
} from '../core/nexus_translator_core';
import { NexusDatabase } from '../storage/db';

export interface AudioPlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentLineIndex: number;
  totalLines: number;
  currentScene?: SceneId;
  speed: number;
}

export type PlaybackStateListener = (state: AudioPlaybackState) => void;

class AudioService {
  private dramaEngine: RadioDramaEngine | null = null;
  private currentLines: LineResult[] = [];
  private currentLineIdx = 0;
  private isPlaying = false;
  private isPaused = false;
  private currentScene?: SceneId;
  private listeners = new Set<PlaybackStateListener>();
  private ttsSpeed = 1.0;
  private ttsPitch = 1.0;
  private radioDramaEnabled = true;

  constructor() {
    this.initDramaEngine();
  }

  private initDramaEngine() {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.dramaEngine = new RadioDramaEngine({
            masterVolume: 0.4,
            duckLevel: 0.4,
          });
        }
      } catch (e) {
        console.warn('RadioDramaEngine init skipped:', e);
      }
    }
  }

  addListener(listener: PlaybackStateListener) {
    this.listeners.add(listener);
    this.notify();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state: AudioPlaybackState = {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      currentLineIndex: this.currentLineIdx,
      totalLines: this.currentLines.length,
      currentScene: this.currentScene,
      speed: this.ttsSpeed,
    };
    for (const l of this.listeners) {
      try {
        l(state);
      } catch (e) {
        console.error('Error in audio state listener:', e);
      }
    }
  }

  async setRadioDramaEnabled(enabled: boolean) {
    this.radioDramaEnabled = enabled;
    if (!enabled && this.dramaEngine) {
      this.dramaEngine.reset();
    }
  }

  setVolume(volume: number) {
    if (this.dramaEngine) {
      this.dramaEngine.setMasterVolume(Math.max(0, Math.min(1, volume)));
    }
  }

  async testScene(sceneId: SceneId) {
    if (this.dramaEngine) {
      await this.dramaEngine.unlock();
      this.currentScene = sceneId;
      // Synthesize ambient by feeding scene dummy text
      const sceneSamples: Record<SceneId, string> = {
        RAIN: 'สายฝนตกโปรยปราย ชุ่มฉ่ำ',
        STORM: 'พายุคลั่ง ฟ้าผ่า ฟ้าร้อง คะนอง',
        FOREST: 'ป่าทึบ ดงดิบ ต้นไม้ เสียงแมลง',
        CAVE: 'ถ้ำลึก ดาร์ก เย็นยะเยือก ก้องกังวาน',
        BATTLE: 'ดาบ กระบี่ ปะทะ สังหาร ฟาดฟัน',
        FIRE: 'เปลวเพลิง ไฟไหม้ ลุกโชน มอดไหม้',
        NIGHT: 'ราตรีกาล ค่ำคืน ดึกสงัด ใต้แสงจันทร์',
        CROWD: 'ฝูงชน ตลาดพลุกพล่าน เสียงจอแจ คนคับคั่ง',
        BREAKTHROUGH: 'พลังวิญญาณ ทะลวงด่าน บรรลุ สำเร็จ',
        TENSION: 'อันตราย ไอสังหาร กดดัน วิกฤต ตึงเครียด',
        SADNESS: 'น้ำตา หยาดน้ำตา เศร้าโศก อาลัย อาลัยรัก',
      };
      this.dramaEngine.onParagraph(sceneSamples[sceneId] || '');
      this.notify();
    }
  }

  stopScene() {
    if (this.dramaEngine) {
      this.dramaEngine.reset();
      this.currentScene = undefined;
      this.notify();
    }
  }

  async playLines(lines: LineResult[], startFromIndex = 0) {
    await this.stop();

    const settings = await NexusDatabase.getSettings();
    this.ttsSpeed = settings.ttsSpeed || 1.0;
    this.ttsPitch = settings.ttsPitch || 1.0;
    this.radioDramaEnabled = settings.enableRadioDrama ?? true;

    this.currentLines = lines.filter(l => l.translated && l.translated.trim().length > 0);
    if (this.currentLines.length === 0) return;

    this.currentLineIdx = Math.max(0, Math.min(startFromIndex, this.currentLines.length - 1));
    this.isPlaying = true;
    this.isPaused = false;

    // Unlock Web Audio on user gesture
    if (this.dramaEngine && this.radioDramaEnabled) {
      try {
        await this.dramaEngine.unlock();
      } catch (e) {
        console.warn('Audio unlock warning:', e);
      }
    }

    this.notify();
    await this.speakNextLine();
  }

  private async speakNextLine() {
    if (!this.isPlaying || this.isPaused) return;

    if (this.currentLineIdx >= this.currentLines.length) {
      await this.stop();
      return;
    }

    const line = this.currentLines[this.currentLineIdx];
    const rawTranslated = line.translated || '';
    const textToSpeak = normalizeForTts(rawTranslated);

    // Procedural sound detection and ducking
    if (this.radioDramaEnabled && this.dramaEngine) {
      const activeScenes = this.dramaEngine.onParagraph(rawTranslated);
      if (activeScenes.length > 0) {
        this.currentScene = activeScenes[0];
      }
      this.dramaEngine.setSpeaking(true);
    }

    this.notify();

    Speech.speak(textToSpeak, {
      language: 'th-TH',
      rate: this.ttsSpeed,
      pitch: this.ttsPitch,
      onDone: () => {
        if (this.dramaEngine) {
          this.dramaEngine.setSpeaking(false);
        }
        if (this.isPlaying && !this.isPaused) {
          this.currentLineIdx++;
          this.speakNextLine();
        }
      },
      onError: (err) => {
        console.warn('Speech error on line:', err);
        if (this.dramaEngine) {
          this.dramaEngine.setSpeaking(false);
        }
        if (this.isPlaying && !this.isPaused) {
          this.currentLineIdx++;
          this.speakNextLine();
        }
      },
    });
  }

  pause() {
    this.isPaused = true;
    Speech.pause();
    if (this.dramaEngine) {
      this.dramaEngine.setSpeaking(false);
    }
    this.notify();
  }

  async resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.isPlaying = true;
      Speech.resume();
      if (this.dramaEngine) {
        this.dramaEngine.setSpeaking(true);
      }
      this.notify();
    } else if (!this.isPlaying && this.currentLines.length > 0) {
      this.isPlaying = true;
      this.isPaused = false;
      await this.speakNextLine();
    }
  }

  async stop() {
    this.isPlaying = false;
    this.isPaused = false;
    Speech.stop();
    if (this.dramaEngine) {
      this.dramaEngine.setSpeaking(false);
      this.dramaEngine.reset();
    }
    this.currentScene = undefined;
    this.notify();
  }

  async seekToLine(index: number) {
    const wasPlaying = this.isPlaying && !this.isPaused;
    Speech.stop();
    this.currentLineIdx = Math.max(0, Math.min(index, this.currentLines.length - 1));
    this.notify();
    if (wasPlaying) {
      await this.speakNextLine();
    }
  }

  setSpeed(rate: number) {
    this.ttsSpeed = rate;
    this.notify();
  }
}

export const audioService = new AudioService();
