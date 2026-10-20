import test from 'node:test';
import assert from 'node:assert/strict';
import { outstanding, refundedInFull, refundedSoFar } from '../src/utils/refund';

/**
 * The bug these cover: a partial clawback used to set payments.is_refunded, so
 * the next call was refused as ALREADY_REFUNDED and the rest of the money could
 * never be recorded as returned. The claim stayed PAID for good, kept consuming
 * its owner's yearly entitlement, and the fund still counted money that had
 * come back - against ประกาศ ข้อ ๕(๖), which requires repayment of the whole
 * amount received.
 *
 * Found on 14 ต.ค. 2569 by paying 1,500, clawing back 100, then trying to claw
 * back the remaining 1,400 and getting 422.
 */

/** Money arrives from Prisma as Decimal, which stringifies rather than equals. */
const decimal = (n: number) => ({ toString: () => String(n), valueOf: () => n });

test('nothing clawed back yet leaves the whole payment outstanding', () => {
  const fresh = { amount: 1500, refundAmount: null };
  assert.equal(refundedSoFar(fresh), 0);
  assert.equal(outstanding(fresh), 1500);
  assert.equal(refundedInFull(fresh), false);
});

test('a partial clawback leaves the rest claimable', () => {
  const partial = { amount: 1500, refundAmount: 100 };
  assert.equal(refundedSoFar(partial), 100);
  assert.equal(outstanding(partial), 1400);
  assert.equal(refundedInFull(partial), false, 'คืน 100 จาก 1,500 ยังไม่ครบ');
});

test('the rest of a partially clawed-back payment can still be taken in full', () => {
  // The exact sequence that used to fail: 100 first, then the remaining 1,400.
  const afterFirst = { amount: 1500, refundAmount: 100 };
  const second = outstanding(afterFirst);
  assert.equal(second, 1400);

  const afterSecond = { amount: 1500, refundAmount: refundedSoFar(afterFirst) + second };
  assert.equal(refundedSoFar(afterSecond), 1500);
  assert.equal(outstanding(afterSecond), 0);
  assert.equal(refundedInFull(afterSecond), true, 'คืนครบแล้วต้องพลิกเป็น REFUNDED');
});

test('many small clawbacks add up to the whole amount', () => {
  let refunded = 0;
  for (const slice of [500, 500, 400, 100]) {
    const row = { amount: 1500, refundAmount: refunded };
    assert.ok(slice <= outstanding(row), `คืน ${slice} ต้องไม่เกินยอดค้าง ${outstanding(row)}`);
    refunded += slice;
  }
  assert.equal(refundedInFull({ amount: 1500, refundAmount: refunded }), true);
});

test('a clawback of the whole amount at once is final', () => {
  const full = { amount: 1500, refundAmount: 1500 };
  assert.equal(outstanding(full), 0);
  assert.equal(refundedInFull(full), true);
});

test('over-refunding never reports negative money left', () => {
  // The service refuses this, but the arithmetic must not go below zero either.
  const over = { amount: 1500, refundAmount: 2000 };
  assert.equal(outstanding(over), 0);
  assert.equal(refundedInFull(over), true);
});

test('Decimal values from the database are read as numbers', () => {
  const row = { amount: decimal(3000), refundAmount: decimal(1000) };
  assert.equal(refundedSoFar(row), 1000);
  assert.equal(outstanding(row), 2000);
  assert.equal(refundedInFull(row), false);
});

test('a missing or unreadable refund column counts as nothing refunded', () => {
  assert.equal(refundedSoFar({ amount: 1500 }), 0);
  assert.equal(refundedSoFar({ amount: 1500, refundAmount: undefined }), 0);
  assert.equal(refundedSoFar({ amount: 1500, refundAmount: 'ไม่ใช่ตัวเลข' }), 0);
  assert.equal(outstanding({ amount: 1500, refundAmount: 'ไม่ใช่ตัวเลข' }), 1500);
});

test('a payment of zero has nothing to claw back', () => {
  assert.equal(outstanding({ amount: 0, refundAmount: null }), 0);
  assert.equal(refundedInFull({ amount: 0, refundAmount: null }), true);
});
