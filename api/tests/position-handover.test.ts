import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionStale } from '../src/utils/session';
import { POSITION_ROLES, POSITION_ROLE_CODES, WORKFLOW_STEPS } from '../src/config/workflow';
import { handoverPositionSchema, resetPositionPasswordSchema } from '../src/validators/position.schema';

/**
 * Handing a position account to its next holder (CLAUDE.md ข้อ 19), added
 * 19 ต.ค. 2569. These are the parts that can be checked without a database.
 */

// ----------------------------------------------------------- open sessions

/**
 * The hole this closes: authenticate() reloaded the account on every request
 * but only refused inactive ones, so setting a new password left sessions
 * already open working for the rest of their 8 hours. Handing the account to a
 * new director therefore left the previous one able to approve claims for the
 * afternoon, and a password here stands in for a signature (ข้อ 18).
 */
test('a session signed before the password was set is refused', () => {
  const changedAt = new Date('2026-10-19T09:00:00.000Z');
  const issuedAt = Math.floor(new Date('2026-10-19T08:30:00.000Z').getTime() / 1000);
  assert.equal(isSessionStale(issuedAt, changedAt), true);
});

test('a session signed after the password was set is kept', () => {
  const changedAt = new Date('2026-10-19T09:00:00.000Z');
  const issuedAt = Math.floor(new Date('2026-10-19T09:00:05.000Z').getTime() / 1000);
  assert.equal(isSessionStale(issuedAt, changedAt), false);
});

/**
 * iat is whole seconds while the column carries milliseconds, so a token minted
 * in the same second as the change looks up to 999ms older than it. Refusing on
 * that would turn away the very token handed back by the login that follows a
 * password change - the new holder locked out of the credential just set for
 * them. Treating the same second as current is what avoids it.
 */
test('a session signed in the same second as the change is not treated as stale', () => {
  const changedAt = new Date('2026-10-19T09:00:00.750Z');
  const issuedAt = Math.floor(new Date('2026-10-19T09:00:00.000Z').getTime() / 1000);
  assert.equal(isSessionStale(issuedAt, changedAt), false);
});

test('an account whose password predates the column keeps its sessions', () => {
  assert.equal(isSessionStale(1_760_000_000, null), false);
  assert.equal(isSessionStale(1_760_000_000, undefined), false);
});

test('a token with no issue time cannot be shown to be current, so it is refused', () => {
  assert.equal(isSessionStale(undefined, new Date('2026-10-19T09:00:00.000Z')), true);
  // ...but only once there is something to compare against.
  assert.equal(isSessionStale(undefined, null), false);
});

// --------------------------------------------------------------- the posts

test('the screen lists every signing step, in the order a claim meets them', () => {
  const orders = POSITION_ROLES.map((role) => role.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'ต้องเรียงตามลำดับขั้น');
  for (const step of WORKFLOW_STEPS) {
    assert.ok(
      POSITION_ROLES.some((role) => role.roleCode === step.roleCode),
      `ขั้น ${step.roleCode} หายไปจากหน้าส่งมอบตำแหน่ง`,
    );
  }
});

/**
 * The mentor drew the line on 20 ต.ค. 2569: the system is the research
 * office's and ends at approval; กองคลัง works from the printed paper. The
 * screen lists the signing chain and nothing after it.
 */
test('the list is exactly the signing chain, with no finance post after it', () => {
  assert.equal(POSITION_ROLES.length, WORKFLOW_STEPS.length);
  assert.equal(POSITION_ROLE_CODES.includes('FINANCE'), false, 'กองคลังไม่ได้ใช้งานระบบนี้');
  for (const role of POSITION_ROLES) {
    assert.notEqual(role.waitingStatus, null, `${role.roleCode} ต้องมีคิวงานของตัวเอง`);
  }
});

/**
 * ADMIN is deliberately absent: this endpoint can set another account's
 * password, so letting it reach administrators would let one take over another
 * one's account, and letting it reach a plain claimant would make it a
 * general-purpose password reset for anybody.
 */
test('neither ADMIN nor RESEARCHER counts as a position account', () => {
  assert.equal(POSITION_ROLE_CODES.includes('ADMIN'), false);
  assert.equal(POSITION_ROLE_CODES.includes('RESEARCHER'), false);
});

test('only the two unit-level steps are scoped to a unit', () => {
  const scoped = POSITION_ROLES.filter((role) => role.facultyScoped).map((role) => role.roleCode);
  assert.deepEqual(scoped, ['FACULTY_QA', 'DEAN']);
});

// ------------------------------------------------------------- the request

test('a handover states a reason, the same floor as a change to the fund ceiling', () => {
  const holder = { prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' };
  assert.equal(handoverPositionSchema.safeParse({ ...holder, reason: 'ย้าย' }).success, false);
  assert.equal(
    handoverPositionSchema.safeParse({ ...holder, reason: 'ผอ. คนเดิมเกษียณ 30 ก.ย. 2569' })
      .success,
    true,
  );
  assert.equal(resetPositionPasswordSchema.safeParse({ reason: '' }).success, false);
});

/** The password is generated server side; a caller must not be able to pick it. */
test('a caller cannot send a password, a role or an active flag', () => {
  const base = {
    prefix: 'นาย',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    reason: 'ส่งมอบตำแหน่งตามคำสั่งแต่งตั้ง',
  };
  for (const extra of [{ password: 'Abcd1234' }, { roles: [] }, { isActive: true }]) {
    assert.equal(handoverPositionSchema.safeParse({ ...base, ...extra }).success, false);
  }
});

/** Names reach the memo and the receipt voucher, so they are cleaned (ข้อ 22.3). */
test('invisible characters are stripped from the new holder name', () => {
  const parsed = handoverPositionSchema.safeParse({
    prefix: 'นาย',
    firstName: 'สมชาย​',
    lastName: '‮ใจดี',
    reason: 'ส่งมอบตำแหน่งตามคำสั่งแต่งตั้ง',
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.firstName, 'สมชาย');
    assert.equal(parsed.data.lastName, 'ใจดี');
  }
});
