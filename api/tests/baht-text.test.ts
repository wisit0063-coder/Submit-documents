import test from 'node:test';
import assert from 'node:assert/strict';
import { bahtText } from '../src/utils/baht-text';

test('the rates in the announcement read correctly', () => {
  // Every amount a claimant can actually be paid, from journal_tiers.
  assert.equal(bahtText(1500), 'หนึ่งพันห้าร้อยบาทถ้วน');
  assert.equal(bahtText(3000), 'สามพันบาทถ้วน');
  assert.equal(bahtText(5000), 'ห้าพันบาทถ้วน');
  assert.equal(bahtText(7000), 'เจ็ดพันบาทถ้วน');
  assert.equal(bahtText(8000), 'แปดพันบาทถ้วน');
  assert.equal(bahtText(10000), 'หนึ่งหมื่นบาทถ้วน');
  assert.equal(bahtText(12000), 'หนึ่งหมื่นสองพันบาทถ้วน');
  assert.equal(bahtText(15000), 'หนึ่งหมื่นห้าพันบาทถ้วน');
  assert.equal(bahtText(18000), 'หนึ่งหมื่นแปดพันบาทถ้วน');
  assert.equal(bahtText(20000), 'สองหมื่นบาทถ้วน');
  assert.equal(bahtText(30000), 'สามหมื่นบาทถ้วน');
});

test('a tens digit of one is bare สิบ, and of two is ยี่สิบ', () => {
  assert.equal(bahtText(10), 'สิบบาทถ้วน');
  assert.equal(bahtText(11), 'สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(12), 'สิบสองบาทถ้วน');
  assert.equal(bahtText(20), 'ยี่สิบบาทถ้วน');
  assert.equal(bahtText(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahtText(22), 'ยี่สิบสองบาทถ้วน');
});

test('a trailing one is เอ็ด only when something precedes it', () => {
  assert.equal(bahtText(1), 'หนึ่งบาทถ้วน');
  assert.equal(bahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
  assert.equal(bahtText(1001), 'หนึ่งพันเอ็ดบาทถ้วน');
  assert.equal(bahtText(1000001), 'หนึ่งล้านเอ็ดบาทถ้วน');
});

test('zeros inside a number are skipped, not spoken', () => {
  assert.equal(bahtText(0), 'ศูนย์บาทถ้วน');
  assert.equal(bahtText(105), 'หนึ่งร้อยห้าบาทถ้วน');
  assert.equal(bahtText(10050), 'หนึ่งหมื่นห้าสิบบาทถ้วน');
});

test('millions repeat the ล้าน scale, including empty groups', () => {
  assert.equal(bahtText(1000000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(bahtText(1500000), 'หนึ่งล้านห้าแสนบาทถ้วน');
  // The whole research fund for a year, which is the largest figure the system
  // ever prints in words.
  assert.equal(bahtText(1000000000), 'หนึ่งพันล้านบาทถ้วน');
});

test('satang are read, and only a whole amount says ถ้วน', () => {
  assert.equal(bahtText(1.5), 'หนึ่งบาทห้าสิบสตางค์');
  assert.equal(bahtText(3000.25), 'สามพันบาทยี่สิบห้าสตางค์');
  assert.equal(bahtText(0.75), 'เจ็ดสิบห้าสตางค์');
  assert.equal(bahtText(0.01), 'หนึ่งสตางค์');
  assert.equal(bahtText(3000.21), 'สามพันบาทยี่สิบเอ็ดสตางค์');
});

test('the amount is rounded before it is read, not after', () => {
  // Decimal(12,2) keeps two places, but an amount arriving as a float must not
  // read as a different number from the digits printed beside it.
  assert.equal(bahtText(0.005), 'หนึ่งสตางค์');
  assert.equal(bahtText(2.994), 'สองบาทเก้าสิบเก้าสตางค์');
});

test('an amount arriving as a string from Decimal reads the same', () => {
  assert.equal(bahtText('3000.00'), bahtText(3000));
  assert.equal(bahtText('18000'), 'หนึ่งหมื่นแปดพันบาทถ้วน');
});

test('a refund written as a negative is marked, never read as a payment', () => {
  assert.equal(bahtText(-3000), 'ลบสามพันบาทถ้วน');
});

test('a value that is not a number is refused, not printed as NaN', () => {
  assert.throws(() => bahtText('ไม่ใช่ตัวเลข'), /จำนวนเงินไม่ถูกต้อง/);
});
