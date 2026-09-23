import test from 'node:test';
import assert from 'node:assert/strict';
import {
  businessDaysBetween,
  calendarYearOf,
  fiscalYearOf,
  formatThaiDate,
  toDateOnly,
} from '../src/utils/datetime';

test('calendar year is read in Bangkok time, not UTC', () => {
  // 31 Dec 2025 18:00 UTC is already 1 Jan 2026 in Bangkok - the article counts
  // towards the new year, which is what the three-per-year rule is measured on.
  assert.equal(calendarYearOf(new Date('2025-12-31T18:00:00Z')), 2026);
  assert.equal(calendarYearOf(new Date('2025-12-31T10:00:00Z')), 2025);
});

test('fiscal year runs 1 October to 30 September, in พ.ศ.', () => {
  // 30 Sep 2025 (Bangkok) is still fiscal 2568; 1 Oct 2025 starts fiscal 2569.
  assert.equal(fiscalYearOf(new Date('2025-09-30T12:00:00Z')), 2568);
  assert.equal(fiscalYearOf(new Date('2025-10-01T03:00:00Z')), 2569);
  assert.equal(fiscalYearOf(new Date('2026-09-29T12:00:00Z')), 2569);
});

test('business days skip weekends', () => {
  // Mon 1 Sep 2025 -> Fri 5 Sep 2025 is four business days.
  assert.equal(
    businessDaysBetween(new Date('2025-09-01T02:00:00Z'), new Date('2025-09-05T02:00:00Z')),
    4,
  );
  // Fri -> Mon crosses a weekend and counts as one.
  assert.equal(
    businessDaysBetween(new Date('2025-09-05T02:00:00Z'), new Date('2025-09-08T02:00:00Z')),
    1,
  );
  // Fri -> Sun counts nothing: the desk was closed the whole time.
  assert.equal(
    businessDaysBetween(new Date('2025-09-05T02:00:00Z'), new Date('2025-09-07T02:00:00Z')),
    0,
  );
});

test('the five-day reminder threshold lands on the right day', () => {
  // Submitted Mon 1 Sep, still untouched on Mon 8 Sep = 5 business days.
  const submitted = new Date('2025-09-01T02:00:00Z');
  assert.equal(businessDaysBetween(submitted, new Date('2025-09-08T02:00:00Z')), 5);
  assert.equal(businessDaysBetween(submitted, new Date('2025-09-05T02:00:00Z')), 4);
});

test('business days are never negative', () => {
  assert.equal(
    businessDaysBetween(new Date('2025-09-10T00:00:00Z'), new Date('2025-09-01T00:00:00Z')),
    0,
  );
});

test('dates are formatted in Thai with the Buddhist era', () => {
  assert.equal(formatThaiDate(new Date('2025-09-12T05:00:00Z')), '12 กันยายน 2568');
});

test('date-only values are anchored at UTC midnight for @db.Date columns', () => {
  const value = toDateOnly('2025-09-12T17:30:00Z');
  assert.equal(value.toISOString(), '2025-09-12T00:00:00.000Z');
});
