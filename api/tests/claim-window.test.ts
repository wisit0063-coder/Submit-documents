import test from 'node:test';
import assert from 'node:assert/strict';
import { entitlementYearOf, isWithinClaimWindow } from '../src/config/workflow';
import { calendarMonthOf } from '../src/utils/datetime';

// Dates are written as UTC instants but judged in Bangkok time, so each one
// below is given a mid-morning UTC hour that lands on the same day locally.
const bkk = (iso: string) => new Date(`${iso}T03:00:00Z`);

test('an article is normally claimed in its own publication year', () => {
  assert.equal(isWithinClaimWindow(bkk('2026-03-15'), bkk('2026-04-02')), true);
  assert.equal(isWithinClaimWindow(bkk('2026-03-15'), bkk('2026-12-31')), true);
});

test('a claim filed a year late is refused', () => {
  // The rule this project shipped with: a 2024 article must not be claimable in
  // 2026. Only December publications get any slack at all.
  assert.equal(isWithinClaimWindow(bkk('2024-06-01'), bkk('2026-01-10')), false);
  assert.equal(isWithinClaimWindow(bkk('2026-03-15'), bkk('2027-01-10')), false);
});

test('a December article may still be filed until 31 January', () => {
  assert.equal(isWithinClaimWindow(bkk('2026-12-31'), bkk('2027-01-01')), true);
  assert.equal(isWithinClaimWindow(bkk('2026-12-01'), bkk('2027-01-31')), true);
});

test('the grace window closes on 1 February', () => {
  assert.equal(isWithinClaimWindow(bkk('2026-12-31'), bkk('2027-02-01')), false);
});

test('the grace window is December only - November gets no slack', () => {
  assert.equal(isWithinClaimWindow(bkk('2026-11-30'), bkk('2027-01-05')), false);
  assert.equal(isWithinClaimWindow(bkk('2026-11-30'), bkk('2026-12-31')), true);
});

test('the grace window does not stretch across two years', () => {
  assert.equal(isWithinClaimWindow(bkk('2025-12-15'), bkk('2027-01-10')), false);
});

test('a late December claim spends a slot of the year it was filed in', () => {
  // The mentor's worked example (3 Oct 2026): two articles already claimed in
  // 2026, a third published 31 Dec 2026 and filed in January 2027. The third
  // one counts against 2027, leaving two slots for 2027 - it does not become a
  // fourth claim on 2026.
  const published = bkk('2026-12-31');
  const filed = bkk('2027-01-20');

  assert.equal(isWithinClaimWindow(published, filed), true);
  assert.equal(entitlementYearOf(filed), 2027);
  assert.notEqual(entitlementYearOf(filed), 2026);
});

test('the entitlement year follows the filing date, never the publication date', () => {
  assert.equal(entitlementYearOf(bkk('2026-04-02')), 2026);
  assert.equal(entitlementYearOf(bkk('2027-01-02')), 2027);
  // 31 Dec 2026 18:00 UTC is already 1 Jan 2027 in Bangkok.
  assert.equal(entitlementYearOf(new Date('2026-12-31T18:00:00Z')), 2027);
});

test('months are read in Bangkok time', () => {
  assert.equal(calendarMonthOf(bkk('2026-12-15')), 12);
  assert.equal(calendarMonthOf(new Date('2026-12-31T18:00:00Z')), 1);
});
