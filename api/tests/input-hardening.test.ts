import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseForCompare, stripInvisible } from '../src/utils/text';
import { FIRST_CLAIMABLE_YEAR, isPlausiblePublicationYear } from '../src/config/workflow';
import { createRequestSchema, listRequestsSchema } from '../src/validators/request.schema';

/**
 * Covers the four decisions taken on 18 ต.ค. 2569 after an abuse pass fed the
 * running system everything a form should refuse.
 */

// --------------------------------------------------------------- stored text

test('invisible characters are stripped on the way into the database', () => {
  assert.equal(stripInvisible('ระบบ​เบิกจ่าย'), 'ระบบเบิกจ่าย');
  assert.equal(stripInvisible('ชื่อ‮กลับทิศ'), 'ชื่อกลับทิศ');
  assert.equal(stripInvisible('﻿หัวข้อ'), 'หัวข้อ');
  assert.equal(stripInvisible('คำ­แยก'), 'คำแยก');
});

test('a non-breaking space becomes an ordinary space, and the ends are trimmed', () => {
  assert.equal(stripInvisible('  ระบบ เบิกจ่าย  '), 'ระบบ เบิกจ่าย');
});

test('storage keeps the author’s spacing and case; only comparison folds them', () => {
  const written = 'The  Thai   Journal';
  assert.equal(stripInvisible(written), written, 'ช่องว่างซ้ำภายในเป็นการเขียนของผู้แต่ง ห้ามยุบ');
  assert.equal(normaliseForCompare(written), 'the thai journal');
});

test('cleaning runs before the length rules, not after', () => {
  // Ten visible characters plus padding that disappears: must still be rejected
  // rather than passing the minimum and then shrinking below it in storage.
  const parsed = createRequestSchema.safeParse({
    articleTitle: 'สั้นมาก​​​',
    journalName: 'วารสารทดสอบ',
    publishedAt: new Date().toISOString(),
    journalTierId: '1',
  });
  assert.equal(parsed.success, false);
});

test('a title carrying invisible characters is stored clean', () => {
  const parsed = createRequestSchema.safeParse({
    articleTitle: 'การพัฒนาระบบ​เบิกจ่ายค่าตอบแทนการตีพิมพ์',
    journalName: 'วารสาร‮ทดสอบ',
    publishedAt: new Date().toISOString(),
    journalTierId: '1',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.articleTitle.includes('​'), false);
    assert.equal(parsed.data.journalName.includes('‮'), false);
  }
});

// --------------------------------------------------------- publication year

test('a publication year centuries away is refused', () => {
  assert.equal(isPlausiblePublicationYear(new Date('2099-12-31T00:00:00Z')), false);
  assert.equal(isPlausiblePublicationYear(new Date('1800-01-01T00:00:00Z')), false);
});

test('the floor is the year the announcement took effect', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  assert.equal(isPlausiblePublicationYear(new Date(`${FIRST_CLAIMABLE_YEAR}-01-01T00:00:00Z`), now), true);
  assert.equal(
    isPlausiblePublicationYear(new Date(`${FIRST_CLAIMABLE_YEAR - 1}-12-31T00:00:00Z`), now),
    false,
  );
});

/**
 * The bound must never contradict the grace window the office granted: an
 * article the journal dates December 2569 is filed in January 2570 and draws on
 * 2570's entitlement (CLAUDE.md ข้อ 6, confirmed by the office in writing).
 * Filing in January asks about a publication year one BELOW the current year,
 * so the window stays open - but a bound set to "this year only" would have
 * closed it, which is exactly the mistake this test exists to catch.
 */
test('an article published in December can still be filed the following January', () => {
  const filedInJanuary = new Date('2027-01-15T00:00:00Z'); // ม.ค. 2570
  const publishedInDecember = new Date('2026-12-31T00:00:00Z'); // ธ.ค. 2569
  assert.equal(isPlausiblePublicationYear(publishedInDecember, filedInJanuary), true);
});

test('a journal dating its issue to next year is still accepted', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  assert.equal(isPlausiblePublicationYear(new Date('2027-01-01T00:00:00Z'), now), true);
  assert.equal(isPlausiblePublicationYear(new Date('2028-01-01T00:00:00Z'), now), false);
});

// ------------------------------------------------------------ status filter

test('an unknown status filter is refused instead of being ignored', () => {
  const parsed = listRequestsSchema.safeParse({ status: 'ไม่มีสถานะนี้' });
  assert.equal(parsed.success, false, 'เคยตอบ 200 แล้วคืนทุกแถว ทำให้ดูเหมือนไม่ได้กรอง');
});

test('a real status still filters, and no status at all is still allowed', () => {
  assert.equal(listRequestsSchema.safeParse({ status: 'APPROVED' }).success, true);
  assert.equal(listRequestsSchema.safeParse({}).success, true);
});
