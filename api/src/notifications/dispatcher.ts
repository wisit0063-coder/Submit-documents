import { prisma } from '../config/prisma';
import { STATUS_LABELS_TH, stepByStatus } from '../config/workflow';
import type { NotificationChannel, NotificationMessage } from './channel';
import { emailChannel } from './email.channel';
import { logChannel } from './log.channel';
import { webPushChannel } from './webpush.channel';
import { ownerPush, reviewerPush } from './push-policy';
import type { RequestStatus } from '@prisma/client';

/**
 * Register additional channels here (LINE Messaging API, SMS, in-app).
 * Order does not matter: every enabled channel receives every message.
 */
const channels: NotificationChannel[] = [emailChannel, logChannel, webPushChannel];

/**
 * Notifications never block or fail the caller: a dead SMTP server must not
 * roll back an approval that already committed.
 */
export async function dispatch(messages: NotificationMessage[]): Promise<void> {
  const active = channels.filter((channel) => channel.isEnabled());
  await Promise.all(
    messages.flatMap((message) =>
      active.map(async (channel) => {
        try {
          await channel.send(message);
        } catch (error) {
          console.error(`[notify:${channel.name}] failed`, error instanceof Error ? error.message : error);
        }
      }),
    ),
  );
}

interface StatusChangeContext {
  requestId: bigint;
  requestNo: string;
  articleTitle: string;
  ownerId: bigint;
  facultyId: bigint;
  toStatus: RequestStatus;
  actorName: string;
  note?: string | null;
}

async function recipientOf(userId: bigint, includeInactive = false) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, lineUserId: true, isActive: true },
  });
  if (!user) return null;
  return user.isActive || includeInactive ? user : null;
}

/**
 * Everyone who needs to know about a status change: the requester, plus whoever
 * owns the next step. Faculty-scoped steps only notify that faculty.
 */
async function nextStepHandlers(toStatus: RequestStatus, facultyId: bigint) {
  const step = stepByStatus(toStatus);
  if (!step) return [];

  const userRoles = await prisma.userRole.findMany({
    where: {
      role: { code: step.roleCode },
      ...(step.facultyScoped ? { OR: [{ facultyId }, { facultyId: null }] } : {}),
    },
    select: { user: { select: { id: true, email: true, lineUserId: true, isActive: true } } },
  });

  return userRoles.map((ur) => ur.user).filter((user) => user.isActive);
}

/** Call only after the surrounding transaction has committed. */
export async function notifyStatusChange(context: StatusChangeContext): Promise<void> {
  const statusLabel = STATUS_LABELS_TH[context.toStatus];
  const link = `/requests/${context.requestId}`;
  const messages: NotificationMessage[] = [];

  const owner = await recipientOf(context.ownerId);
  if (owner) {
    messages.push({
      userId: owner.id,
      email: owner.email,
      lineUserId: owner.lineUserId,
      subject: `[${context.requestNo}] สถานะคำขอเปลี่ยนเป็น "${statusLabel}"`,
      body: [
        `คำขอเลขที่ ${context.requestNo}`,
        `บทความ: ${context.articleTitle}`,
        `สถานะปัจจุบัน: ${statusLabel}`,
        `ดำเนินการโดย: ${context.actorName}`,
        context.note ? `หมายเหตุ: ${context.note}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      link,
      // Only approved, returned and not approved: the events that ask something
      // of the claimant or settle the matter (push-policy.ts).
      push: ownerPush(context.toStatus, context, context.note) ?? undefined,
    });
  }

  const handlers = await nextStepHandlers(context.toStatus, context.facultyId);
  const stepLabel = stepByStatus(context.toStatus)?.labelTh ?? statusLabel;
  for (const handler of handlers) {
    if (handler.id === context.ownerId) continue; // already notified as requester
    messages.push({
      userId: handler.id,
      email: handler.email,
      lineUserId: handler.lineUserId,
      subject: `[${context.requestNo}] มีคำขอรอการพิจารณาของท่าน`,
      body: [
        `คำขอเลขที่ ${context.requestNo} เข้าสู่ขั้นตอน "${statusLabel}"`,
        `บทความ: ${context.articleTitle}`,
        'กรุณาเข้าระบบเพื่อพิจารณา',
      ].join('\n'),
      link,
      push: reviewerPush(context, stepLabel),
    });
  }

  await dispatch(messages);
}

export async function notifyPlain(
  userId: bigint,
  subject: string,
  body: string,
  link?: string,
  options: { includeInactive?: boolean } = {},
): Promise<void> {
  // A rejected applicant is still inactive, but must still hear why.
  const user = await recipientOf(userId, options.includeInactive ?? false);
  if (!user) return;
  await dispatch([
    { userId: user.id, email: user.email, lineUserId: user.lineUserId, subject, body, link },
  ]);
}

/** Every active holder of a role, university-wide. Used for new sign-ups. */
export async function notifyRole(
  roleCode: string,
  subject: string,
  body: string,
  link?: string,
): Promise<void> {
  const holders = await prisma.userRole.findMany({
    where: { role: { code: roleCode }, user: { isActive: true } },
    select: { user: { select: { id: true, email: true, lineUserId: true } } },
  });

  // One person can hold the role under several faculty scopes: send once.
  const seen = new Set<bigint>();
  const messages: NotificationMessage[] = [];
  for (const { user } of holders) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    messages.push({ userId: user.id, email: user.email, lineUserId: user.lineUserId, subject, body, link });
  }
  await dispatch(messages);
}
