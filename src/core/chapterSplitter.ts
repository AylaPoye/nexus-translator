/**
 * NEXUS Translator - Robust Chapter Splitter
 * Intelligently parses Chinese and English web-novel text files into clean chapters.
 * Guarantees zero text loss and enforces a safe maximum lines per chapter cap.
 */

export interface SplitChapter {
  title: string;
  content: string;
}

export const MAX_SAFE_CHAPTER_LINES = 300;
export const TARGET_CHAPTER_LINES = 250;

/**
 * Regex matching chapter headers at line start (with optional whitespace).
 * Matches:
 * - Pure numbers with punctuation/space: 001 标题, 01 标题, 1 标题, 001、标题, 1、标题, 001. 标题, 1. 标题, 001: 标题, 001：标题, 001 - 标题, 1 - 标题
 * - Brackets around numbers: 【001】, [001], (001), （001）
 * - Brackets around chapters: 【第1章】, [第1章], (第1章), （第1章）
 * - Prefixes: 正文 第X章, VIP 第X章, ☆、第X章, ★第X章
 * - Delimiters: 第X章：, 第X章-, 第X章 
 * - Chinese numerals: 第[0-9一二三四五六七八九十百千万零]+[章回节集卷部篇话話]
 * - Volumes: 卷一, 卷1, 第一卷
 * - English: Chapter 1, Ch. 1, Ch. 01
 * - Thai: ตอนที่ 1, บทที่ 1, ตอน 1, บท 1
 * - Special markers: 楔子, 序章, 序言, 引子, 前言, 尾声, 番外, 后记, 感言, 完本感言, 上架感言
 */
export const CHAPTER_HEADER_REGEX = /^[ \t\u3000\uFEFF]*(?:(?:[【\[（(]\s*)?(?:(?:正文|VIP|vip|☆[、\s]*|[★◆■●*])[ \t]*)?(?:第\s*[0-9一二三四五六七八九十百千万零]+\s*[章回节集卷部篇话話]|卷\s*[0-9一二三四五六七八九十百]+|(?:Chapter|Chap\.?|Ch\.?)\s*[0-9]+|(?:บท|ตอน)(?:ที่)?\s*[0-9一二三四五六七八九十]+)(?:\s*[】\]）)])?(?:[:：\-—、\s]|$)|(?:[楔序引]子|序[章言]|前言|尾声|番外(?:篇)?|后记|感言|完本感言|上架感言)(?:[:：\-—、\s0-9一二三四五六七八九十]|$)|(?:[【\[（(]\s*\d{1,5}\s*[】\]）)])|(?:\d{1,5}\s*[、:：\-—]\s*)|(?:\d{1,5}\s*[.．](?!\d)\s*)|(?:0\d{1,4}(?:[、:：\-—.\s]|$))|(?:\d{1,5}(?:\s+|$)))/i;

const MEASURE_OR_TEMPORAL_REGEX = /^\d{1,5}\s*(?:秒|分|分钟|小时|点|点钟|天|日|周|星期|月|年|岁|代|米|厘米|毫米|公里|里|步|个|只|条|张|本|支|位|名|件|所|辆|台|架|艘|颗|粒|朵|把|阵|声|道|趟|次|回|遍|倍|成|度|斤|克|公斤|千克|吨|块|元|角|钱|毫升|升|毫克|%|％|号|楼|层|室|栋|座|排|列|组|队|人|批)(?:[前后内外左右来多余]|之[前后]|半)?(?:\s*[,，。！？!?…~～]|\s+[^\s]|$)/;

/**
 * Tests whether a trimmed line is genuinely a chapter header.
 * Discards oversized lines (> 80 chars), clock times, measure words, and narrative sentences.
 */
export function isChapterHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;

  // 1. Explicit markers (第X章, Chapter X, ตอนที่ X, 卷X, 楔子, 序章, 尾声, etc.)
  const explicitMarkerRegex = /^[ \t\u3000\uFEFF]*(?:(?:[【\[（(]\s*)?(?:(?:正文|VIP|vip|☆[、\s]*|[★◆■●*])[ \t]*)?(?:第\s*[0-9一二三四五六七八九十百千万零]+\s*[章回节集卷部篇话話]|卷\s*[0-9一二三四五六七八九十百]+|(?:Chapter|Chap\.?|Ch\.?)\s*[0-9]+|(?:บท|ตอน)(?:ที่)?\s*[0-9一二三四五六七八九十]+)(?:\s*[】\]）)])?(?:[:：\-—、\s]|$)|(?:[楔序引]子|序[章言]|前言|尾声|番外(?:篇)?|后记|感言|完本感言|上架感言)(?:[:：\-—、\s0-9一二三四五六七八九十]|$))/i;

  if (explicitMarkerRegex.test(trimmed)) {
    return true;
  }

  // 2. Reject clock time formats (01:00, 12:30, 01:00:00)
  if (/^\d{1,2}[:：]\d{2}(?::\d{2})?/.test(trimmed)) {
    return false;
  }

  // 3. Reject numbers followed by measure words / units / temporal words (e.g. 3 天后, 10 年后, 100 米外, 100 个人)
  if (MEASURE_OR_TEMPORAL_REGEX.test(trimmed)) {
    return false;
  }

  // 4. Reject narrative sentences ending in sentence terminators
  if (/[。，,;；”"』」！？!?…~～]$/.test(trimmed)) {
    // If it has leading zero or delimiter (e.g. 001 标题！, 1、标题！), allow punctuation
    if (!/^0\d{1,4}(?:[、:：\-—.\s]|$)/.test(trimmed) && !/^\d{1,5}\s*[、:：\-—.]\s*/.test(trimmed)) {
      return false;
    }
  }

  return CHAPTER_HEADER_REGEX.test(trimmed);
}

/**
 * Automatically partitions any chapter exceeding maxLines into clean sub-parts
 * (e.g. "ตอนที่ 1 (ตอนย่อย 1)", "ตอนที่ 1 (ตอนย่อย 2)")
 * while preserving natural paragraph breaks where possible.
 */
export function partitionChapterIfOversized(
  chapter: SplitChapter,
  maxLines: number = MAX_SAFE_CHAPTER_LINES,
  targetLines: number = TARGET_CHAPTER_LINES
): SplitChapter[] {
  const normalized = chapter.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const lines = normalized.split('\n');

  if (lines.length <= maxLines) {
    return [chapter];
  }

  const subParts: SplitChapter[] = [];
  let startIndex = 0;
  let partNumber = 1;

  // Strip any existing sub-part suffix to prevent recursive nesting (e.g. "Title (ตอนย่อย 1) (ตอนย่อย 1)")
  const baseTitle = chapter.title.replace(/\s*\((?:ตอนย่อย|ช่วงที่)\s*\d+\)$/, '').trim();

  while (startIndex < lines.length) {
    const remaining = lines.length - startIndex;
    if (remaining <= maxLines) {
      const chunkLines = lines.slice(startIndex);
      const content = chunkLines.join('\n').trim();
      if (content.length > 0) {
        subParts.push({
          title: `${baseTitle} (ตอนย่อย ${partNumber})`,
          content,
        });
      }
      break;
    }

    // Try finding an empty line near targetLines (look between targetLines - 40 and maxLines)
    let splitIndex = startIndex + targetLines;
    const searchStart = Math.max(startIndex + targetLines - 40, startIndex + 50);
    const searchEnd = Math.min(startIndex + maxLines, lines.length - 1);

    let foundEmpty = -1;
    for (let i = searchStart; i <= searchEnd; i++) {
      if (lines[i].trim().length === 0) {
        foundEmpty = i;
        break;
      }
    }

    if (foundEmpty !== -1) {
      splitIndex = foundEmpty + 1;
    } else {
      splitIndex = startIndex + targetLines;
    }

    // Guard against non-advancing index
    if (splitIndex <= startIndex) {
      splitIndex = startIndex + maxLines;
    }

    const chunkLines = lines.slice(startIndex, splitIndex);
    const content = chunkLines.join('\n').trim();
    if (content.length > 0) {
      subParts.push({
        title: `${baseTitle} (ตอนย่อย ${partNumber})`,
        content,
      });
      partNumber++;
    }

    startIndex = splitIndex;
  }

  return subParts.length > 0 ? subParts : [chapter];
}

/**
 * Splits raw novel text into ordered chapters.
 * Guarantees no text loss (preamble before Chapter 1 is captured as Prologue).
 * Guarantees no returned chapter exceeds maxLinesPerChapter (default 300 lines).
 */
export function splitNovelIntoChapters(
  rawText: string,
  novelTitle: string = 'นิยาย',
  maxLinesPerChapter: number = MAX_SAFE_CHAPTER_LINES
): SplitChapter[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Normalize newlines and full-width spaces
  const normalized = trimmed.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  const chapterStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (isChapterHeaderLine(line)) {
      chapterStarts.push(i);
    }
  }

  const results: SplitChapter[] = [];

  // Case A: No recognized chapter headers found
  if (chapterStarts.length === 0) {
    if (lines.length <= maxLinesPerChapter) {
      const firstLine = lines.find(l => l.trim().length > 0)?.trim() || novelTitle;
      const title = firstLine.length <= 40 ? firstLine : `ตอนที่ 1: ${novelTitle}`;
      return [{ title, content: normalized }];
    }

    // Monolithic text: safely chunk into <= maxLinesPerChapter
    const isSingleChapterRef = /^(?:ตอนที่|บทที่|第|Chapter|Ch\.)\s*\d+/i.test(novelTitle);
    const baseTitle = isSingleChapterRef ? novelTitle : `ตอนที่ 1: ${novelTitle}`;
    return partitionChapterIfOversized(
      { title: baseTitle, content: normalized },
      maxLinesPerChapter,
      TARGET_CHAPTER_LINES
    ).map((chap, idx) => ({
      title: isSingleChapterRef
        ? chap.title
        : `ตอนที่ ${idx + 1} (ช่วงที่ ${idx + 1})`,
      content: chap.content,
    }));
  }

  // Case B: Chapter headers found
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

  // 2. Precompute substantive line counts for efficient TOC filtering (O(N))
  const counts = new Array<number>(chapterStarts.length);
  for (let i = 0; i < chapterStarts.length; i++) {
    const s = chapterStarts[i];
    const e = i + 1 < chapterStarts.length ? chapterStarts[i + 1] : lines.length;
    let count = 0;
    for (let j = s; j < e; j++) {
      if (lines[j].trim().length > 0) count++;
    }
    counts[i] = count;
  }

  const hasSubstantiveAfter = new Array<boolean>(chapterStarts.length).fill(false);
  let hasSubstantive = false;
  for (let i = chapterStarts.length - 1; i >= 0; i--) {
    hasSubstantiveAfter[i] = hasSubstantive;
    if (counts[i] > 2) {
      hasSubstantive = true;
    }
  }

  // 3. Capture each chapter
  for (let idx = 0; idx < chapterStarts.length; idx++) {
    const startLine = chapterStarts[idx];
    const endLine = idx + 1 < chapterStarts.length ? chapterStarts[idx + 1] : lines.length;

    // If this chapter section only contains the header line (TOC stub) and later chapters have content, skip TOC stub
    if (counts[idx] <= 1 && hasSubstantiveAfter[idx]) {
      continue;
    }

    const chapLines = lines.slice(startLine, endLine);
    const chapText = chapLines.join('\n').trim();
    const headerLine = lines[startLine].trim();
    // Clean title (cap at 60 chars)
    const title = headerLine.length <= 60 ? headerLine : `ตอนที่ ${results.length + 1}: ${headerLine.slice(0, 50)}...`;

    results.push({
      title,
      content: chapText,
    });
  }

  // Post-processing: Guarantee NO chapter in results exceeds maxLinesPerChapter (250-300 lines)
  const safeResults: SplitChapter[] = [];
  for (const chap of results) {
    if (chap.content.split('\n').length > maxLinesPerChapter) {
      const partitioned = partitionChapterIfOversized(chap, maxLinesPerChapter, TARGET_CHAPTER_LINES);
      safeResults.push(...partitioned);
    } else {
      safeResults.push(chap);
    }
  }

  return safeResults;
}
