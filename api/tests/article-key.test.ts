import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseArticleText, sameArticleNaming } from '../src/utils/article-key';

/**
 * The hole these cover: findDuplicateArticle keyed only on DOI, or on ISSN plus
 * title. Both columns are nullable and no rule at submit demands either, so a
 * filing carrying neither met no key at all and the same article could be
 * reimbursed twice - against rule 4 of ประกาศ 2131/2566.
 *
 * Proved on the running system on 14 ต.ค. 2569: two filings identical in title,
 * journal, volume, issue and pages, differing only in who filed them, were both
 * accepted; the same pair sharing a DOI was refused with DUPLICATE_ARTICLE.
 */

const filing = (articleTitle: string, journalName: string) => ({ articleTitle, journalName });

const TITLE = 'การพัฒนาระบบเบิกจ่ายค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ';
const JOURNAL = 'วารสารวิชาการมหาวิทยาลัยราชภัฏชัยภูมิ';

test('the same article filed twice is recognised with no DOI and no ISSN', () => {
  assert.equal(sameArticleNaming(filing(TITLE, JOURNAL), filing(TITLE, JOURNAL)), true);
});

test('spacing and letter case are not differences', () => {
  assert.equal(
    sameArticleNaming(
      filing(`  ${TITLE}  `, JOURNAL),
      filing(TITLE.replace(/ /g, '   '), JOURNAL),
    ),
    true,
  );
  assert.equal(
    sameArticleNaming(filing('Deep Learning For Thai OCR', 'IEEE Access'), filing('deep learning for thai ocr', 'ieee access')),
    true,
  );
});

test('the same title in a different journal is a different article', () => {
  assert.equal(
    sameArticleNaming(filing(TITLE, JOURNAL), filing(TITLE, 'วารสารวิจัยมหาวิทยาลัยขอนแก่น')),
    false,
    'ชื่อเรื่องซ้ำแต่ต่างวารสาร ต้องไม่ถือว่าเป็นบทความเดียวกัน',
  );
});

test('a different article in the same journal is not blocked', () => {
  assert.equal(
    sameArticleNaming(filing(TITLE, JOURNAL), filing('การประเมินความพึงพอใจของผู้ใช้ระบบสารสนเทศ', JOURNAL)),
    false,
  );
});

test('a title that merely contains the other is not the same article', () => {
  // Substring matching would block a legitimate follow-up paper.
  assert.equal(
    sameArticleNaming(filing(TITLE, JOURNAL), filing(`${TITLE} ระยะที่ 2`, JOURNAL)),
    false,
  );
});

test('the normaliser collapses whitespace and case without touching Thai text', () => {
  assert.equal(normaliseArticleText('  ระบบ   เบิกจ่าย \n ค่าตอบแทน '), 'ระบบ เบิกจ่าย ค่าตอบแทน');
  assert.equal(normaliseArticleText('TCI Tier 1'), 'tci tier 1');
  assert.equal(normaliseArticleText(''), '');
});

/**
 * Characters nobody can see used to be enough to walk past every rule that
 * compares text. Proved on the running system on 18 ต.ค. 2569: the same
 * article filed twice, the second time with one U+200B inserted into the
 * title, was accepted both times. The same trick defeats the
 * predatory-journal list, which shares this normaliser.
 */
test('a zero-width space in the middle of a title is not a difference', () => {
  const clean = 'การพัฒนาระบบเบิกจ่ายค่าตอบแทน';
  const sneaky = 'การพัฒนาระบบ​เบิกจ่ายค่าตอบแทน';
  assert.equal(normaliseArticleText(sneaky), normaliseArticleText(clean));
  assert.equal(
    sameArticleNaming(filing(sneaky, JOURNAL), filing(clean, JOURNAL)),
    true,
    'ชื่อเรื่องเดียวกันที่แทรกอักขระล่องหน ต้องยังถือว่าเป็นบทความเดียวกัน',
  );
});

test('every invisible character that can be typed into a title is ignored', () => {
  const expected = normaliseArticleText('Deep Learning for Thai OCR');
  for (const [name, ch] of [
    ['zero width space', '​'],
    ['zero width non-joiner', '‌'],
    ['zero width joiner', '‍'],
    ['left-to-right mark', '‎'],
    ['right-to-left override', '‮'],
    ['word joiner', '⁠'],
    ['byte order mark', '﻿'],
    ['soft hyphen', '­'],
  ]) {
    assert.equal(
      normaliseArticleText(`Deep Lear${ch}ning for Thai OCR`),
      expected,
      `${name} ต้องไม่ทำให้ข้อความต่างกัน`,
    );
  }
});

test('a non-breaking space counts as a space, not as a different character', () => {
  assert.equal(normaliseArticleText('ระบบ เบิกจ่าย'), normaliseArticleText('ระบบ เบิกจ่าย'));
});

test('composed and decomposed accents are the same text', () => {
  // "é" written as one character, and as "e" plus a combining accent.
  assert.equal(normaliseArticleText('Café Review'), normaliseArticleText('Café Review'));
});

test('stripping invisible characters does not merge genuinely different titles', () => {
  assert.equal(
    sameArticleNaming(filing('ระบบ ก', JOURNAL), filing('ระบบ ข', JOURNAL)),
    false,
  );
});
