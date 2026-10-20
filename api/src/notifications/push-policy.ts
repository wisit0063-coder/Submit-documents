import { RequestStatus } from '@prisma/client';

/**
 * Who gets a popup, and what it says (CLAUDE.md ข้อ 10, decided 19 ต.ค. 2569).
 *
 * Popups are deliberately fewer than emails. A claimant used to hear about every
 * step - six to eight messages per claim - and almost none asked anything of
 * them. The owner's rule is that a popup goes out only when someone has to do
 * something, or when the matter is settled:
 *
 *   claimant  -> approved (go and file the paperwork), returned (go and fix it),
 *                not approved (stop waiting)
 *   reviewer  -> a claim has arrived at your step, and again when it has waited
 *                there too long
 *
 * Email keeps its old, wider behaviour and stays switched off until the
 * university grants SMTP access. Whether to narrow it to match is a decision for
 * the day it is switched on, not something to slip in here.
 *
 * This file touches no database, so the rule can be tested on its own.
 */

/** What a channel needs to draw one popup. The link travels on the message. */
export interface PushContent {
  title: string;
  body: string;
  /**
   * Popups sharing a tag replace each other instead of piling up, so a claim
   * that moves twice while the laptop is shut leaves one popup, not two.
   */
  tag: string;
}

/**
 * Statuses the claimant is told about. APPROVED and not PAID: approval is where
 * the process ends and the claimant prints the memo, while recording the payment
 * is an optional step nobody has been given (ข้อ 18.3). Tying the popup to PAID
 * would mean the claimant never hears that their money was approved.
 */
export const OWNER_PUSH_STATUSES: readonly RequestStatus[] = [
  RequestStatus.APPROVED,
  RequestStatus.RETURNED,
  RequestStatus.REJECTED,
];

/** Popups show two or three lines; anything longer is cut by the OS anyway. */
const TITLE_MAX = 70;
const LINE_MAX = 90;

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

interface ClaimRef {
  requestNo: string;
  articleTitle: string;
}

/**
 * The claimant's popup for a status change, or null when this change is not one
 * they are told about. The amount is left out on purpose: a popup can appear on
 * a shared screen or a locked phone, and the claim is one click away.
 */
export function ownerPush(
  status: RequestStatus,
  claim: ClaimRef,
  note?: string | null,
): PushContent | null {
  const article = clip(claim.articleTitle, LINE_MAX);
  const reason = note ? clip(`เหตุผล: ${note}`, LINE_MAX) : null;
  const tag = `claim-${claim.requestNo}`;

  switch (status) {
    case RequestStatus.APPROVED:
      return {
        title: clip(`คำขอ ${claim.requestNo} ได้รับอนุมัติแล้ว`, TITLE_MAX),
        body: [article, 'พิมพ์เอกสารเพื่อนำไปตั้งเบิกได้แล้ว'].join('\n'),
        tag,
      };
    case RequestStatus.RETURNED:
      return {
        title: clip(`คำขอ ${claim.requestNo} ถูกตีกลับให้แก้ไข`, TITLE_MAX),
        body: [article, reason ?? 'กรุณาเข้าระบบเพื่อดูรายละเอียด'].join('\n'),
        tag,
      };
    case RequestStatus.REJECTED:
      return {
        title: clip(`คำขอ ${claim.requestNo} ไม่ได้รับการอนุมัติ`, TITLE_MAX),
        body: [article, reason ?? 'กรุณาเข้าระบบเพื่อดูรายละเอียด'].join('\n'),
        tag,
      };
    default:
      return null;
  }
}

/** A reviewer's popup when a claim arrives at their step. */
export function reviewerPush(claim: ClaimRef, stepLabel: string): PushContent {
  return {
    title: 'มีเอกสารรอให้ท่านตรวจสอบ',
    body: [clip(`${claim.requestNo} · ${stepLabel}`, LINE_MAX), clip(claim.articleTitle, LINE_MAX)].join(
      '\n',
    ),
    tag: `review-${claim.requestNo}`,
  };
}

/** A reviewer's popup when a claim has waited at their step too long. */
export function reminderPush(claim: ClaimRef, waitingDays: number): PushContent {
  return {
    title: clip(`เอกสารรอท่านพิจารณามา ${waitingDays} วันทำการแล้ว`, TITLE_MAX),
    body: [claim.requestNo, clip(claim.articleTitle, LINE_MAX)].join('\n'),
    // Same tag as the arrival popup, so the reminder replaces it rather than
    // stacking a second popup about the same claim.
    tag: `review-${claim.requestNo}`,
  };
}
