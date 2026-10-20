import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStatus } from '@prisma/client';
import {
  clip,
  OWNER_PUSH_STATUSES,
  ownerPush,
  reminderPush,
  reviewerPush,
} from '../src/notifications/push-policy';
import { isAllowedPushEndpoint } from '../src/notifications/push-endpoint';
import { subscribePushSchema } from '../src/validators/push.schema';

/**
 * Popup notifications (Web Push), added 19 ต.ค. 2569 on the owner's decisions:
 * the claimant hears only approved / returned / not approved, reviewers hear
 * when a claim arrives and when it has waited too long (CLAUDE.md ข้อ 10).
 */

const claim = { requestNo: 'RQ-2570-0007', articleTitle: 'การพัฒนาระบบเบิกจ่ายค่าตอบแทนการตีพิมพ์' };

// ------------------------------------------------------------ who hears what

test('the claimant hears about exactly four outcomes', () => {
  assert.deepEqual(
    [...OWNER_PUSH_STATUSES].sort(),
    [
      RequestStatus.APPROVED,
      RequestStatus.REJECTED,
      RequestStatus.RETURNED,
      RequestStatus.REVOKED,
    ].sort(),
  );
});

test('a revoked approval tells the claimant why, and never the amount', () => {
  const popup = ownerPush(RequestStatus.REVOKED, claim, 'ผู้ขอลาออกก่อนเบิกเงิน');
  assert.ok(popup);
  assert.match(popup.title, /ยกเลิกหลังอนุมัติ/);
  assert.match(popup.body, /ผู้ขอลาออกก่อนเบิกเงิน/);
  assert.doesNotMatch(`${popup.title}${popup.body}`, /บาท|\d{1,3},\d{3}/);
});

test('every step in between stays quiet for the claimant', () => {
  for (const status of Object.values(RequestStatus)) {
    if (OWNER_PUSH_STATUSES.includes(status)) continue;
    assert.equal(ownerPush(status, claim), null, `${status} ไม่ควรเด้งป๊อปอัปให้ผู้ขอ`);
  }
});

/**
 * Approval is where the process ends (ข้อ 5). Recording the payment is optional
 * and nobody has been given it (ข้อ 18.3), so a popup tied to PAID would never
 * reach anyone.
 */
test('the success popup fires on approval, not on the optional payment record', () => {
  assert.notEqual(ownerPush(RequestStatus.APPROVED, claim), null);
  assert.equal(ownerPush(RequestStatus.PAID, claim), null);
});

test('a returned or rejected claim carries the reviewer’s reason', () => {
  const returned = ownerPush(RequestStatus.RETURNED, claim, 'แนบหนังสือตอบรับไม่ครบ');
  assert.ok(returned?.body.includes('แนบหนังสือตอบรับไม่ครบ'));
  const rejected = ownerPush(RequestStatus.REJECTED, claim, 'วารสารไม่อยู่ในฐานข้อมูลที่กำหนด');
  assert.ok(rejected?.body.includes('วารสารไม่อยู่ในฐานข้อมูลที่กำหนด'));
});

/** A popup can land on a shared screen; the amount is one click away. */
test('no popup mentions money', () => {
  const all = [
    ownerPush(RequestStatus.APPROVED, claim),
    ownerPush(RequestStatus.RETURNED, claim, 'x'),
    ownerPush(RequestStatus.REJECTED, claim, 'x'),
    reviewerPush(claim, 'คณบดีเห็นชอบ'),
    reminderPush(claim, 6),
  ];
  for (const popup of all) {
    assert.ok(popup);
    assert.doesNotMatch(`${popup.title} ${popup.body}`, /บาท|\d{1,3},\d{3}/);
  }
});

test('a reminder replaces the arrival popup for the same claim instead of stacking', () => {
  assert.equal(reviewerPush(claim, 'คณบดีเห็นชอบ').tag, reminderPush(claim, 6).tag);
});

/** The push service's Topic header allows URL-safe base64 only, at most 32. */
test('every tag is a valid push topic', () => {
  for (const popup of [
    ownerPush(RequestStatus.APPROVED, claim)!,
    reviewerPush(claim, 'x'),
    reminderPush(claim, 6),
  ]) {
    assert.match(popup.tag, /^[A-Za-z0-9_-]{1,32}$/);
  }
});

test('long titles are clipped, not left to overflow the popup', () => {
  const long = 'ก'.repeat(400);
  assert.equal(clip(long, 90).length, 90);
  assert.ok(clip(long, 90).endsWith('…'));
  assert.equal(clip('สั้น', 90), 'สั้น');
});

// -------------------------------------------------- where the server may send

/**
 * The endpoint is a URL the server will later request. Without an allowlist a
 * signed-in user could aim it at the database container or a metadata address
 * and have the API call it every time a claim moves.
 */
test('real browser push services are accepted', () => {
  for (const url of [
    'https://fcm.googleapis.com/fcm/send/abc123:APA91b',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGh1b2k',
    'https://wns2-sg2p.notify.windows.com/w/?token=BQYAAA',
  ]) {
    assert.equal(isAllowedPushEndpoint(url), true, url);
  }
});

test('anything that is not a push service is refused', () => {
  for (const url of [
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://db:5432/', // the database container
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://localhost/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/fcm/send/abc', // lookalike suffix
    'https://evil.example/fcm.googleapis.com/abc', // host in the path
    'https://evilfcm.googleapis.com/abc', // not a real subdomain
    'https://fcm.googleapis.com:8443/fcm/send/abc', // odd port
    'https://user:pass@fcm.googleapis.com/fcm/send/abc', // credentials
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(2000)}`,
  ]) {
    assert.equal(isAllowedPushEndpoint(url), false, url);
  }
});

test('a subscription must come with both browser keys and nothing else', () => {
  const good = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    expirationTime: null,
    keys: {
      p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
      auth: 'tBHItJI5svbpez7KI4CCXg',
    },
  };
  assert.equal(subscribePushSchema.safeParse(good).success, true);
  assert.equal(subscribePushSchema.safeParse({ ...good, keys: { p256dh: good.keys.p256dh } }).success, false);
  assert.equal(subscribePushSchema.safeParse({ ...good, userId: '1' }).success, false);
  assert.equal(
    subscribePushSchema.safeParse({ ...good, endpoint: 'https://db:5432/' }).success,
    false,
  );
});
