import AsyncStorage from '@react-native-async-storage/async-storage';
import { Genre, GlossaryCategory, Gender, RelationshipType, LineResult } from '../core/nexus_translator_core';

export interface Novel {
  id: string;
  title: string;
  author: string;
  genre: Genre;
  description: string;
  chapterCount: number;
  sourceUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Chapter {
  id: string;
  novelId: string;
  chapterIndex: number;
  title: string;
  sourceRaw: string;
  translatedText?: string;
  lines?: LineResult[];
  status: 'PENDING' | 'TRANSLATING' | 'COMPLETED' | 'ERROR';
  progress: number;
  error?: string;
  translatedAt?: number;
}

export interface GlossaryItem {
  id: string;
  novelId: string;
  source: string;
  target: string;
  category: GlossaryCategory;
  pinyin?: string;
  notes?: string;
  gender?: Gender;
  confidence: number;
  locked: boolean;
}

export interface RelationshipItem {
  id: string;
  novelId: string;
  fromTermId: string;
  toTermId: string;
  fromName: string;
  toName: string;
  relationshipType: RelationshipType;
  callingPronoun: string; // e.g. "ศิษย์น้อง", "เจ้า", "ท่านพี่"
  selfPronoun: string;    // e.g. "ศิษย์พี่", "ข้า"
  notes?: string;
}

export interface AppSettings {
  geminiKeys: string[];
  groqKey: string;
  geminiModel: string;
  groqModel: string;
  ttsSpeed: number;
  ttsPitch: number;
  enableRadioDrama: boolean;
  radioDramaVolume: number;
  readerTheme: 'dark' | 'light' | 'sepia' | 'oled';
  readerFontSize: number;
  readerLineHeight: number;
  displayMode: 'thai_only' | 'bilingual' | 'chinese_only';
}

const STORAGE_KEYS = {
  NOVELS: '@nexus_novels',
  CHAPTERS_PREFIX: '@nexus_chapters_',
  GLOSSARY_PREFIX: '@nexus_glossary_',
  RELATIONSHIPS_PREFIX: '@nexus_relationships_',
  SETTINGS: '@nexus_settings',
  INITIALIZED: '@nexus_initialized_v1',
};

export const defaultSettings: AppSettings = {
  geminiKeys: ['', '', ''],
  groqKey: '',
  geminiModel: 'gemini-2.5-flash',
  groqModel: 'qwen/qwen3.8-27b',
  ttsSpeed: 1.0,
  ttsPitch: 1.0,
  enableRadioDrama: true,
  radioDramaVolume: 0.5,
  readerTheme: 'dark',
  readerFontSize: 18,
  readerLineHeight: 1.8,
  displayMode: 'thai_only',
};

// Database helper class
export class NexusDatabase {
  // Settings
  static async getSettings(): Promise<AppSettings> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);
      if (data) {
        const parsed = JSON.parse(data);
        // Automatically migrate deprecated or overloaded models to stable gemini-2.5-flash
        if (
          parsed.geminiModel === 'gemini-3.8-flash' ||
          parsed.geminiModel === 'gemini-2.0-flash' ||
          parsed.geminiModel === 'gemini-1.5-flash' ||
          !parsed.geminiModel
        ) {
          parsed.geminiModel = 'gemini-2.5-flash';
        }
        return { ...defaultSettings, ...parsed };
      }
    } catch (e) {
      console.warn('Failed to load settings:', e);
    }
    return defaultSettings;
  }

  static async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated = { ...current, ...settings };
    await AsyncStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    return updated;
  }

  // Novels
  static async getNovels(): Promise<Novel[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.NOVELS);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to load novels:', e);
    }
    return [];
  }

  static async getNovel(id: string): Promise<Novel | null> {
    const novels = await this.getNovels();
    return novels.find(n => n.id === id) || null;
  }

  static async saveNovel(novel: Novel): Promise<void> {
    const novels = await this.getNovels();
    const idx = novels.findIndex(n => n.id === novel.id);
    if (idx >= 0) {
      novels[idx] = { ...novel, updatedAt: Date.now() };
    } else {
      novels.push({ ...novel, createdAt: Date.now(), updatedAt: Date.now() });
    }
    await AsyncStorage.setItem(STORAGE_KEYS.NOVELS, JSON.stringify(novels));
  }

  static async deleteNovel(id: string): Promise<void> {
    const novels = await this.getNovels();
    const filtered = novels.filter(n => n.id !== id);
    await AsyncStorage.setItem(STORAGE_KEYS.NOVELS, JSON.stringify(filtered));
    await AsyncStorage.removeItem(`${STORAGE_KEYS.CHAPTERS_PREFIX}${id}`);
    await AsyncStorage.removeItem(`${STORAGE_KEYS.GLOSSARY_PREFIX}${id}`);
    await AsyncStorage.removeItem(`${STORAGE_KEYS.RELATIONSHIPS_PREFIX}${id}`);
  }

  // Chapters
  static async getChapters(novelId: string): Promise<Chapter[]> {
    try {
      const data = await AsyncStorage.getItem(`${STORAGE_KEYS.CHAPTERS_PREFIX}${novelId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn(`Failed to load chapters for novel ${novelId}:`, e);
    }
    return [];
  }

  static async getChapter(novelId: string, chapterId: string): Promise<Chapter | null> {
    const chapters = await this.getChapters(novelId);
    return chapters.find(c => c.id === chapterId) || null;
  }

  static async saveChapter(novelId: string, chapter: Chapter): Promise<void> {
    const chapters = await this.getChapters(novelId);
    const idx = chapters.findIndex(c => c.id === chapter.id);
    if (idx >= 0) {
      chapters[idx] = chapter;
    } else {
      chapters.push(chapter);
    }
    chapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
    await AsyncStorage.setItem(`${STORAGE_KEYS.CHAPTERS_PREFIX}${novelId}`, JSON.stringify(chapters));

    // Update chapter count on novel
    const novel = await this.getNovel(novelId);
    if (novel) {
      novel.chapterCount = chapters.length;
      await this.saveNovel(novel);
    }
  }

  static async saveChapters(novelId: string, newChapters: Chapter[]): Promise<void> {
    await AsyncStorage.setItem(`${STORAGE_KEYS.CHAPTERS_PREFIX}${novelId}`, JSON.stringify(newChapters));
    const novel = await this.getNovel(novelId);
    if (novel) {
      novel.chapterCount = newChapters.length;
      await this.saveNovel(novel);
    }
  }

  // Glossary
  static async getGlossary(novelId: string): Promise<GlossaryItem[]> {
    try {
      const data = await AsyncStorage.getItem(`${STORAGE_KEYS.GLOSSARY_PREFIX}${novelId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn(`Failed to load glossary for novel ${novelId}:`, e);
    }
    return [];
  }

  static async saveGlossaryItem(item: GlossaryItem): Promise<void> {
    const list = await this.getGlossary(item.novelId);
    const idx = list.findIndex(g => g.id === item.id);
    if (idx >= 0) {
      list[idx] = item;
    } else {
      list.push(item);
    }
    await AsyncStorage.setItem(`${STORAGE_KEYS.GLOSSARY_PREFIX}${item.novelId}`, JSON.stringify(list));
  }

  static async deleteGlossaryItem(novelId: string, itemId: string): Promise<void> {
    const list = await this.getGlossary(novelId);
    const filtered = list.filter(g => g.id !== itemId);
    await AsyncStorage.setItem(`${STORAGE_KEYS.GLOSSARY_PREFIX}${novelId}`, JSON.stringify(filtered));
  }

  static async saveGlossary(novelId: string, items: GlossaryItem[]): Promise<void> {
    await AsyncStorage.setItem(`${STORAGE_KEYS.GLOSSARY_PREFIX}${novelId}`, JSON.stringify(items));
  }

  // Relationships
  static async getRelationships(novelId: string): Promise<RelationshipItem[]> {
    try {
      const data = await AsyncStorage.getItem(`${STORAGE_KEYS.RELATIONSHIPS_PREFIX}${novelId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.warn(`Failed to load relationships for novel ${novelId}:`, e);
    }
    return [];
  }

  static async saveRelationship(rel: RelationshipItem): Promise<void> {
    const list = await this.getRelationships(rel.novelId);
    const idx = list.findIndex(r => r.id === rel.id);
    if (idx >= 0) {
      list[idx] = rel;
    } else {
      list.push(rel);
    }
    await AsyncStorage.setItem(`${STORAGE_KEYS.RELATIONSHIPS_PREFIX}${rel.novelId}`, JSON.stringify(list));
  }

  static async deleteRelationship(novelId: string, relId: string): Promise<void> {
    const list = await this.getRelationships(novelId);
    const filtered = list.filter(r => r.id !== relId);
    await AsyncStorage.setItem(`${STORAGE_KEYS.RELATIONSHIPS_PREFIX}${novelId}`, JSON.stringify(filtered));
  }

  // Initialize Sample Demo Novel if database is empty
  static async initializeSampleDataIfEmpty(): Promise<void> {
    const initFlag = await AsyncStorage.getItem(STORAGE_KEYS.INITIALIZED);
    if (initFlag) return;

    const sampleNovelId = 'novel_sample_01';
    const sampleNovel: Novel = {
      id: sampleNovelId,
      title: 'สยบฟ้าล่าสวรรค์ (Heaven Defying God)',
      author: 'เฟิงหลิงเทียนเซี่ย (风凌天下)',
      genre: 'XIANXIA',
      description: 'เรื่องราวของเซียวอวิ๋น เด็กหนุ่มผู้ถือกำเนิดในตระกูลตกอับ ทว่ามีดวงวิญญาณกระบี่บรรพกาลหลับใหลอยู่ในร่าง การเดินทางสู่จุดสูงสุดแห่งเก้าชั้นฟ้าเพื่อทวงคืนศักดิ์ศรีจึงเริ่มต้นขึ้น!',
      chapterCount: 2,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const sampleGlossary: GlossaryItem[] = [
      {
        id: 'term_1',
        novelId: sampleNovelId,
        source: '萧云',
        target: 'เซียวอวิ๋น',
        category: 'CHARACTER',
        pinyin: 'Xiao Yun',
        notes: 'ตัวเอก ชายหนุ่มผู้ถือครองกระบี่หงส์เหิน',
        gender: 'MALE',
        confidence: 1.0,
        locked: true,
      },
      {
        id: 'term_2',
        novelId: sampleNovelId,
        source: '林清月',
        target: 'หลินชิงเยวี่ย',
        category: 'CHARACTER',
        pinyin: 'Lin Qingyue',
        notes: 'ศิษย์น้องหญิงผู้สง่างามแห่งสำนักกระบี่หยกขาว',
        gender: 'FEMALE',
        confidence: 1.0,
        locked: true,
      },
      {
        id: 'term_3',
        novelId: sampleNovelId,
        source: '青云门',
        target: 'สำนักชิงอวิ๋น',
        category: 'PLACE',
        pinyin: 'Qingyun Men',
        notes: 'หนึ่งในสี่สำนักกระบี่ผู้ยิ่งใหญ่แห่งแดนบูรพา',
        confidence: 1.0,
        locked: true,
      },
      {
        id: 'term_4',
        novelId: sampleNovelId,
        source: '九霄御剑诀',
        target: 'เคล็ดวิชาเก้าสวรรค์บัญชาการกระบี่',
        category: 'TECHNIQUE',
        pinyin: 'Jiu Xiao Yu Jian Jue',
        notes: 'วิชากระบี่ระดับปฐพี',
        confidence: 1.0,
        locked: true,
      },
      {
        id: 'term_5',
        novelId: sampleNovelId,
        source: '筑基境',
        target: 'ขอบเขตสร้างรากฐาน',
        category: 'CULTIVATION',
        pinyin: 'Zhu Ji Jing',
        notes: 'ระดับการบำเพ็ญเพียรขั้นที่สอง',
        confidence: 1.0,
        locked: true,
      },
    ];

    const sampleRelationships: RelationshipItem[] = [
      {
        id: 'rel_1',
        novelId: sampleNovelId,
        fromTermId: 'term_1',
        toTermId: 'term_2',
        fromName: 'เซียวอวิ๋น',
        toName: 'หลินชิงเยวี่ย',
        relationshipType: 'LOVER',
        callingPronoun: 'ศิษย์น้องชิงเยวี่ย',
        selfPronoun: 'ข้า',
        notes: 'คนรักและเพื่อนร่วมสำนัก',
      },
    ];

    const sampleChapter1Source = `第一章：剑出青云

夜幕笼罩着青云山脉，暴风雨夹杂着雷霆在苍穹中肆虐咆哮。
狂风呼啸，大雨倾盆，雷电如狂龙般撕裂漆黑的天空。
少年萧云站在悬崖边缘，青衫被冰冷的雨水浸透，但他的目光却如鹰隼般锐利。
在他体内，沉睡已久的太古剑魂正在微微颤鸣，散发出一缕凛冽至极的杀气。
“三年了……”萧云低语，声音在呼啸的雷雨声中格外清晰。
“所有人都以为我灵根尽碎，沦为一个废人。”
突然，身后密林中传来急促而冰冷的脚步声。七道黑衣杀手的身影如鬼魅般穿透雨幕，将他团团包围！
为首的黑衣人拔出泛着寒芒的血影魔刀，冷声笑道：“萧云，明年的今天，就是你的忌日！”
空气瞬间凝固，杀意滔天！
就在此时，萧云嘴角勾起一抹冰冷的笑意，手掌缓缓按在了腰间的古旧铁剑上。
九霄御剑诀，第一式——风雷破！`;

    const sampleChapter1Translated = `บทที่ 1: กระบี่ทะยานสู่ชิงอวิ๋น

ราตรีมืดมิดเข้าปกคลุมเทือกเขาชิงอวิ๋น พายุฝนคะนองโหมกระหน่ำพร้อมเสียงอัสนีบาตคำรามก้องสะท้านฟ้า
ลมพายุพัดหวีดหวิว สายฝนเทกระหน่ำลงมาไม่ขาดสาย สายฟ้าแลบแปลบปลาบดั่งมังกรคลั่งฉีกกระชากม่านฟ้าราตรี
เด็กหนุ่มเซียวอวิ๋นยืนตระหง่านอยู่ริมหน้าผา เสื้อคลุมสีครามเปียกโชกไปด้วยสายฝนอันเย็นเฉียบ ทว่าสายตาของเขากลับคมกริบดุจพญาอินทรี
ภายในกายของเขา ดวงวิญญาณกระบี่บรรพกาลที่หลับใหลมาเนิ่นนานกำลังสั่นสะท้านเบาๆ แผ่รังสีสังหารอันเยียบเย็นไร้ขอบเขตออกมา
"สามปีแล้ว..." เซียวอวิ๋นพึมพำ น้ำเสียงของเขาแจ่มชัดท่ามกลางพายุฝนฟ้าคะนองที่กึกก้อง
"ทุกคนต่างคิดว่ารากวิญญาณของข้าแตกสลาย กลายเป็นคนไร้ค่าไปแล้ว"
ทันใดนั้น เสียงฝีเท้าอันเร่งร้อนและเย็นเยียบพลันดังขึ้นจากป่าทึบด้านหลัง เงาดำของมือสังหารเจ็ดคนทะยานฝ่าม่านฝนประดุจภูตผี เข้าล้อมกรอบเขาไว้ทุกทิศทาง!
หัวหน้าชายชุดดำชักดาบมารโลหิตที่เปล่งประกายเย็นยะเยือกออกมา พร้อมหัวเราะเสียงเย็น "เซียวอวิ๋น วันนี้ของปีหน้า ก็คือวันครบรอบวันตายของเจ้า!"
บรรยากาศพลันแข็งค้างลงในชั่วพริบตา ไอสังหารทะลักท่วมท้น!
ทว่าในวินาทีนั้นเอง มุมปากของเซียวอวิ๋นกลับยกยิ้มเย็นชา ฝ่ามือค่อยๆ ทาบลงบนด้ามกระบี่เหล็กโบราณข้างเอว
เคล็ดวิชาเก้าสวรรค์บัญชาการกระบี่ กระบวนท่าที่หนึ่ง——วายุอัสนีทลาย!`;

    const sampleChapter1Lines: LineResult[] = [
      { index: 1, kind: 'STORY', source: '第一章：剑出青云', translated: 'บทที่ 1: กระบี่ทะยานสู่ชิงอวิ๋น', issues: [], repaired: false },
      { index: 2, kind: 'STORY', source: '夜幕笼罩着青云山脉，暴风雨夹杂着雷霆在苍穹中肆虐咆哮。', translated: 'ราตรีมืดมิดเข้าปกคลุมเทือกเขาชิงอวิ๋น พายุฝนคะนองโหมกระหน่ำพร้อมเสียงอัสนีบาตคำรามก้องสะท้านฟ้า', issues: [], repaired: false },
      { index: 3, kind: 'STORY', source: '狂风呼啸，大雨倾盆，雷电如狂龙般撕裂漆黑的天空。', translated: 'ลมพายุพัดหวีดหวิว สายฝนเทกระหน่ำลงมาไม่ขาดสาย สายฟ้าแลบแปลบปลาบดั่งมังกรคลั่งฉีกกระชากม่านฟ้าราตรี', issues: [], repaired: false },
      { index: 4, kind: 'STORY', source: '少年萧云站在悬崖边缘，青衫被冰冷的雨水浸透，但他的目光却如鹰隼般锐利。', translated: 'เด็กหนุ่มเซียวอวิ๋นยืนตระหง่านอยู่ริมหน้าผา เสื้อคลุมสีครามเปียกโชกไปด้วยสายฝนอันเย็นเฉียบ ทว่าสายตาของเขากลับคมกริบดุจพญาอินทรี', issues: [], repaired: false },
      { index: 5, kind: 'STORY', source: '在他体内，沉睡已久的太古剑魂正在微微颤鸣，散发出一缕凛冽至极的杀气。', translated: 'ภายในกายของเขา ดวงวิญญาณกระบี่บรรพกาลที่หลับใหลมาเนิ่นนานกำลังสั่นสะท้านเบาๆ แผ่รังสีสังหารอันเยียบเย็นไร้ขอบเขตออกมา', issues: [], repaired: false },
      { index: 6, kind: 'STORY', source: '“三年了……”萧云低语，声音在呼啸的雷雨声中格外清晰。', translated: '"สามปีแล้ว..." เซียวอวิ๋นพึมพำ น้ำเสียงของเขาแจ่มชัดท่ามกลางพายุฝนฟ้าคะนองที่กึกก้อง', issues: [], repaired: false },
      { index: 7, kind: 'STORY', source: '“所有人都以为我灵根尽碎，沦为一个废人。”', translated: '"ทุกคนต่างคิดว่ารากวิญญาณของข้าแตกสลาย กลายเป็นคนไร้ค่าไปแล้ว"', issues: [], repaired: false },
      { index: 8, kind: 'STORY', source: '突然，身后密林中传来急促而冰冷的脚步声。七道黑衣杀手的身影如鬼魅般穿透雨幕，将他团团包围！', translated: 'ทันใดนั้น เสียงฝีเท้าอันเร่งร้อนและเย็นเยียบพลันดังขึ้นจากป่าทึบด้านหลัง เงาดำของมือสังหารเจ็ดคนทะยานฝ่าม่านฝนประดุจภูตผี เข้าล้อมกรอบเขาไว้ทุกทิศทาง!', issues: [], repaired: false },
      { index: 9, kind: 'STORY', source: '为首的黑衣人拔出泛着寒芒的血影魔刀，冷声笑道：“萧云，明年的今天，就是你的忌日！”', translated: 'หัวหน้าชายชุดดำชักดาบมารโลหิตที่เปล่งประกายเย็นยะเยือกออกมา พร้อมหัวเราะเสียงเย็น "เซียวอวิ๋น วันนี้ของปีหน้า ก็คือวันครบรอบวันตายของเจ้า!"', issues: [], repaired: false },
      { index: 10, kind: 'STORY', source: '空气瞬间凝固，杀意滔天！', translated: 'บรรยากาศพลันแข็งค้างลงในชั่วพริบตา ไอสังหารทะลักท่วมท้น!', issues: [], repaired: false },
      { index: 11, kind: 'STORY', source: '就在此时，萧云嘴角勾起一抹冰冷的笑意，手掌缓缓按在了腰间的古旧铁剑上。', translated: 'ทว่าในวินาทีนั้นเอง มุมปากของเซียวอวิ๋นกลับยกยิ้มเย็นชา ฝ่ามือค่อยๆ ทาบลงบนด้ามกระบี่เหล็กโบราณข้างเอว', issues: [], repaired: false },
      { index: 12, kind: 'STORY', source: '九霄御剑诀，第一式——风雷破！', translated: 'เคล็ดวิชาเก้าสวรรค์บัญชาการกระบี่ กระบวนท่าที่หนึ่ง——วายุอัสนีทลาย!', issues: [], repaired: false },
    ];

    const sampleChapter2Source = `第二章：一剑封喉

轰隆！
雷霆撕裂云层，炽白的光芒照亮了整座山巅。
七柄淬毒的魔刀撕裂雨幕，带着凄厉刺耳的破空之声，直指萧云周身要害！
这七人皆是筑基境三重的死士，出手狠辣决绝，没有半分拖泥带水。
然而，面对凌厉至极的围杀，萧云的身形竟如清风般缥缈，脚踏七星步，刹那间化作道道残影！
铮——！
一声清越的剑鸣如龙吟九霄，响彻群峰！
铁剑出鞘三寸，天地间的雨滴在这一瞬仿佛静止。
一道璀璨如烈阳的冰冷剑芒横扫而出，快到了肉眼无法企及的极致！
扑通！扑通！
眨眼之间，冲在最前面的三名黑衣人甚至没看清萧云是如何出手的，咽喉处已然绽开一道猩红的血线，重重栽倒在泥泞中！
剩余的四人瞳孔剧烈收缩，脸色惨白如纸：“怎么可能……你不是不能修炼吗？！”
萧云眼神漠然，剑锋滴血不沾：“死人，不需要知道答案。”`;

    const sampleChapters: Chapter[] = [
      {
        id: 'chap_sample_01',
        novelId: sampleNovelId,
        chapterIndex: 1,
        title: 'บทที่ 1: กระบี่ทะยานสู่ชิงอวิ๋น (แปลแล้ว)',
        sourceRaw: sampleChapter1Source,
        translatedText: sampleChapter1Translated,
        lines: sampleChapter1Lines,
        status: 'COMPLETED',
        progress: 100,
        translatedAt: Date.now(),
      },
      {
        id: 'chap_sample_02',
        novelId: sampleNovelId,
        chapterIndex: 2,
        title: 'บทที่ 2: หนึ่งกระบี่ปลิดวิญญาณ (ต้นฉบับภาษาจีน - พร้อมกดแปล)',
        sourceRaw: sampleChapter2Source,
        status: 'PENDING',
        progress: 0,
      },
    ];

    await this.saveNovel(sampleNovel);
    await this.saveChapters(sampleNovelId, sampleChapters);
    await this.saveGlossary(sampleNovelId, sampleGlossary);
    for (const rel of sampleRelationships) {
      await this.saveRelationship(rel);
    }
    await AsyncStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
  }
}
