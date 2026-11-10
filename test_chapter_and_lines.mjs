import assert from 'node:assert';
import {
  CHAPTER_HEADER_REGEX,
  isChapterHeaderLine,
  splitNovelIntoChapters,
  partitionChapterIfOversized,
  MAX_SAFE_CHAPTER_LINES
} from './src/core/chapterSplitter.ts';
import {
  lineTag,
  formatLines,
  parseLines,
  buildTranslatePrompt,
  buildRepairPrompt
} from './src/core/nexus_translator_core.ts';

console.log('--- 1. Testing CHAPTER_HEADER_REGEX & isChapterHeaderLine ---');

const headerCases = [
  // Pure numbers with whitespace / punctuation
  '001 标题',
  '01 标题',
  '1 标题',
  '001、标题',
  '1、标题',
  '001. 标题',
  '1. 标题',
  '001: 标题',
  '001：标题',
  '001 - 标题',
  '1 - 标题',
  // Brackets around numbers
  '【001】',
  '[001]',
  '(001)',
  '（001）',
  '【1】',
  '[1]',
  '(1)',
  '（1）',
  '001',
  '1',
  '001 闪婚当天！',

  // Brackets and prefixes with 第X章
  '【第1章】',
  '[第1章]',
  '(第1章)',
  '（第1章）',
  '正文 第1章',
  'VIP 第1章',
  '☆、第1章',
  '第1章：',
  '第1章-',
  '第1章 社恐的我，被迫闪婚了个国民女神',
  '第100章 完结篇',
  '第一百二十章 神秘来客',
  '第001章 初遇',

  // Volumes
  '卷一',
  '卷1 风起云涌',
  '第一卷',

  // Thai and English
  'Chapter 1: The Beginning',
  'Ch. 1',
  'Ch. 01',
  'ตอนที่ 1: จุดเริ่มต้น',
  'บทที่ 1 บทนำเรื่อง',
  'ตอน 1',
  'บท 1',

  // Special markers
  '楔子',
  '序章',
  '序言',
  '引子',
  '前言',
  '尾声',
  '番外',
  '番外篇',
  '后记',
  '感言',
  '完本感言',
  '上架感言'
];

for (const header of headerCases) {
  assert.strictEqual(
    CHAPTER_HEADER_REGEX.test(header),
    true,
    `CHAPTER_HEADER_REGEX should match: "${header}"`
  );
  assert.strictEqual(
    isChapterHeaderLine(header),
    true,
    `isChapterHeaderLine should accept: "${header}"`
  );
}
console.log(`✓ All ${headerCases.length} header variations successfully matched!`);

console.log('--- 2. Testing False Positives Prevention ---');
const narrativeCases = [
  '2024年是一个特别的年份，大家都记得很清楚。',
  '100个人走了过来，没有任何声响。',
  '1.3%的增长率让大家很惊讶。',
  '他叹了口气说：“这不可能。”',
  '这只是普通的一行叙述文字，包含很多字。',
  '100 个人冲了上去！',
  '3 天后',
  '10 年后',
  '5 分钟后',
  '1 秒后',
  '100 米外',
  '007号特工走了过来！',
  '01:00了他还没睡',
  '01:00:00',
  '前言不搭后语，不知道他在说什么。',
  '前言不搭后语',
  '100 个人走了过来，大家都笑了。'
];

for (const line of narrativeCases) {
  assert.strictEqual(
    isChapterHeaderLine(line),
    false,
    `Narrative line should NOT be treated as header: "${line}"`
  );
}
console.log(`✓ Narrative false-positive protection verified!`);

console.log('--- 3. Testing splitNovelIntoChapters with Web Novel Text ---');
const sampleNovelText = `
书名：社恐的我，被迫闪婚了个国民女神
作者：爱吃西瓜

这是本书的简介和背景介绍。
主角穿越到了平行世界。

001 闪婚当天
第一章的内容第一行。
第一章的内容第二行。
第一章的内容第三行。

002 国民女神的秘密
第二章的内容第一行。
第二章的内容第二行。

003 婚后日常
第三章的内容第一行。
第三章的内容第二行。
`;

const splitResults = splitNovelIntoChapters(sampleNovelText, '社恐的我，被迫闪婚了个国民女神');
console.log('Split count:', splitResults.length);
splitResults.forEach((c, i) => console.log(`  [${i + 1}] ${c.title}`));

assert.strictEqual(splitResults.length, 4, 'Should have Prologue + 3 chapters');
assert.ok(splitResults[0].title.includes('Prologue') || splitResults[0].title.includes('书名') || splitResults[0].title.includes('บทนำ'));
assert.ok(splitResults[1].title.includes('001'));
assert.ok(splitResults[2].title.includes('002'));
assert.ok(splitResults[3].title.includes('003'));
console.log('✓ Chapter splitting with pure number headers (001, 002, 003) verified!');

console.log('--- 4. Testing Monolithic Text Auto-Chunking ---');
const monolithicLines = [];
for (let i = 1; i <= 650; i++) {
  monolithicLines.push(`บรรทัดที่ ${i} ของเนื้อหานิยายแบบไม่มีชื่อตอน`);
  if (i % 240 === 0) {
    monolithicLines.push(''); // natural paragraph break
  }
}
const monolithicText = monolithicLines.join('\n');
const chunked = splitNovelIntoChapters(monolithicText, 'นิยายขนาดยาว', 300);
console.log(`Monolithic 650 lines split into ${chunked.length} chapters.`);
chunked.forEach((c, i) => {
  const lineCount = c.content.split('\n').length;
  console.log(`  Chapter ${i + 1}: ${c.title} (${lineCount} lines)`);
  assert.ok(lineCount <= 300, `Chapter ${i + 1} must not exceed 300 lines`);
});
assert.ok(chunked.length >= 3, 'Should be chunked into at least 3 parts');
console.log('✓ Monolithic text auto-chunking verified!');

console.log('--- 5. Testing Oversized Chapter Partitioning (> 300 lines) ---');
const oversizedChapterLines = ['第1章 超长章节测试'];
for (let i = 1; i <= 750; i++) {
  oversizedChapterLines.push(`เนื้อหาบรรทัดที่ ${i}`);
  if (i % 240 === 0) oversizedChapterLines.push('');
}
const singleOversizedChapterText = oversizedChapterLines.join('\n');
const partitioned = splitNovelIntoChapters(singleOversizedChapterText, 'ทดสอบ', 300);
console.log(`Oversized chapter split into ${partitioned.length} sub-parts:`);
partitioned.forEach((c, i) => {
  const lineCount = c.content.split('\n').length;
  console.log(`  Subpart ${i + 1}: ${c.title} (${lineCount} lines)`);
  assert.ok(lineCount <= 300, `Subpart ${i + 1} must not exceed 300 lines`);
  assert.ok(c.title.includes('ตอนย่อย') || c.title.includes('第1章'));
});
assert.ok(partitioned.length >= 3, '750 lines should be partitioned into at least 3 parts');

// Test partitioning a specific chapter without headers inside
const rawChap2Lines = [];
for (let i = 1; i <= 650; i++) rawChap2Lines.push(`บทสนทนาบรรทัดที่ ${i}`);
const rawChap2Text = rawChap2Lines.join('\n');
const chap2Subsplits = splitNovelIntoChapters(rawChap2Text, 'ตอนที่ 2: การพบกัน', 300);
assert.ok(chap2Subsplits.length >= 3);
assert.ok(chap2Subsplits[0].title.startsWith('ตอนที่ 2: การพบกัน (ตอนย่อย 1)'), `Title should preserve chapter identity, got: ${chap2Subsplits[0].title}`);

// Test re-partitioning doesn't create recursive suffixes
const repartitioned = partitionChapterIfOversized(chap2Subsplits[0], 100, 80);
assert.ok(!repartitioned[0].title.includes('(ตอนย่อย 1) (ตอนย่อย 1)'), 'Should not create recursive suffixes');

console.log('✓ Oversized chapter automatic partitioning verified!');

console.log('--- 5.1 Testing Large Table of Contents (TOC) Filtering ---');
const tocLines = ['《社恐的我，被迫闪婚了个国民女神》', '作者：饭桌C位', '', '目录：'];
for (let i = 1; i <= 50; i++) {
  tocLines.push(`第${i}章 目录项${i}`);
}
tocLines.push('');
// Real chapters with substantive content
for (let i = 1; i <= 3; i++) {
  tocLines.push(`第${i}章 目录项${i}`);
  for (let l = 1; l <= 50; l++) tocLines.push(`เนื้อหาจริงของตอนที่ ${i} บรรทัดที่ ${l}`);
  tocLines.push('');
}
const tocBookText = tocLines.join('\n');
const tocResults = splitNovelIntoChapters(tocBookText, '社恐的我，被迫闪婚了个国民女神', 300);
// Should only contain Prologue/Preamble + 3 Real Chapters (TOC stubs filtered out)
assert.strictEqual(tocResults.length, 4, `Should filter out 50 TOC stubs, got ${tocResults.length} chapters`);
assert.ok(tocResults[1].title.includes('第1章'));
assert.ok(tocResults[2].title.includes('第2章'));
assert.ok(tocResults[3].title.includes('第3章'));
console.log('✓ Large Table of Contents filtering verified!');

console.log('--- 6. Testing Protocol Dynamic Padding & parseLines (> 9999 lines) ---');
// lineTag with width 5
const tag1 = lineTag(1, 5);
const tag10001 = lineTag(10001, 5);
assert.strictEqual(tag1, 'LINE_00001');
assert.strictEqual(tag10001, 'LINE_10001');

// formatLines
const formatted = formatLines([
  { index: 1, source: '你好' },
  { index: 12500, source: '再见' }
], 5);
assert.ok(formatted.includes('<LINE_00001>你好</LINE_00001>'));
assert.ok(formatted.includes('<LINE_12500>再见</LINE_12500>'));

// parseLines parsing > 9999 lines
const mockLlmResponse = `
<think>Thinking process...</think>
<LINE_00001>สวัสดี</LINE_00001>
<LINE_12500>ลาก่อน</LINE_12500>
`;
const parsed = parseLines(mockLlmResponse);
assert.strictEqual(parsed.lines.get(1), 'สวัสดี');
assert.strictEqual(parsed.lines.get(12500), 'ลาก่อน');

// Loose parsing with > 9999 lines
const mockLooseResponse = `
<LINE_00001>สวัสดีแบบไม่มีแท็กปิด
<LINE_12500>ลาก่อนแบบไม่มีแท็กปิด
`;
const parsedLoose = parseLines(mockLooseResponse);
assert.strictEqual(parsedLoose.lines.get(1), 'สวัสดีแบบไม่มีแท็กปิด');
assert.strictEqual(parsedLoose.lines.get(12500), 'ลาก่อนแบบไม่มีแท็กปิด');

// buildTranslatePrompt & buildRepairPrompt with padWidth
const translatePrompt = buildTranslatePrompt(
  [{ index: 10001, source: '原文' }],
  'บริบทก่อนหน้า',
  5
);
assert.ok(translatePrompt.includes('<LINE_10001>原文</LINE_10001>'));

const repairPrompt = buildRepairPrompt(
  [{ index: 10001, source: '原文', failed: null, issues: [] }],
  5
);
assert.ok(repairPrompt.includes('<SOURCE_10001>原文</SOURCE_10001>'));

console.log('✓ Dynamic padding & > 9999 line support in core verified!');

console.log('\n========================================');
console.log('🎉 ALL COMPREHENSIVE TESTS PASSED 100%!');
console.log('========================================');


console.log('--- 7. Testing 10,000+ Lines Novel with 1、 2、 3、 Format ---');
const bigNovel = [];
for (let chapNum = 1; chapNum <= 20; chapNum++) {
  bigNovel.push(`${chapNum}、第${chapNum}章 社恐的我，被迫闪婚了个国民女神`);
  for (let l = 1; l <= 550; l++) {
    bigNovel.push(`บรรทัดที่ ${l} ของตอนที่ ${chapNum}`);
  }
}
// Total lines: 20 * 551 = 11,020 lines!
const bigNovelText = bigNovel.join('\n');
console.log(`Created test novel of ${bigNovel.length} lines.`);

const bigResults = splitNovelIntoChapters(bigNovelText, '社恐的我，被迫闪婚了个国民女神', 300);
console.log(`11,020 lines split into ${bigResults.length} chapters.`);

let maxChapterLinesFound = 0;
for (const chap of bigResults) {
  const lineCount = chap.content.split('\n').length;
  if (lineCount > maxChapterLinesFound) maxChapterLinesFound = lineCount;
  assert.ok(
    lineCount <= 300,
    `No chapter must exceed 300 lines! Found ${lineCount} in ${chap.title}`
  );
}
console.log(`Max chapter lines found across all ${bigResults.length} chapters: ${maxChapterLinesFound} lines (cap <= 300).`);
assert.ok(maxChapterLinesFound <= 300);
console.log('✓ 10,000+ lines web novel with 1、 format successfully split and capped!');
