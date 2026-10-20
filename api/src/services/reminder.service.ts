import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { IN_FLIGHT_STATUSES, STATUS_LABELS_TH, stepByStatus } from '../config/workflow';
import { businessDaysBetween } from '../utils/datetime';
import { dispatch } from '../notifications/dispatcher';
import type { NotificationMessage } from '../notifications/channel';
import { reminderPush } from '../notifications/push-policy';

/**
 * Called once a day by cPanel cron (POST /api/cron/reminders with X-Cron-Token).
 *
 * There is no setInterval and no worker process anywhere in this codebase:
 * Passenger may stop and restart the app between requests, so any in-process
 * timer would fire unpredictably or not at all.
 */
export async function sendStaleReminders() {
  const threshold = env.reminderAfterBusinessDays;
  const now = new Date();

  const stale = await prisma.request.findMany({
    where: { status: { in: IN_FLIGHT_STATUSES } },
    include: {
      owner: { select: { id: true, email: true, lineUserId: true, isActive: true } },
      faculty: { select: { id: true, nameTh: true } },
    },
  });

  const messages: NotificationMessage[] = [];
  const reminded: { requestNo: string; status: string; waitingDays: number }[] = [];

  for (const request of stale) {
    const waiting = businessDaysBetween(request.updatedAt, now);
    if (waiting < threshold) continue;

    const step = stepByStatus(request.status);
    const statusLabel = STATUS_LABELS_TH[request.status];
    reminded.push({ requestNo: request.requestNo, status: request.status, waitingDays: waiting });

    // The requester always hears about their own stalled paperwork.
    if (request.owner.isActive) {
      messages.push({
        userId: request.owner.id,
        email: request.owner.email,
        lineUserId: request.owner.lineUserId,
        subject: `[${request.requestNo}] คำขอค้างอยู่ที่ขั้น "${statusLabel}" มา ${waiting} วันทำการ`,
        body: [
          `คำขอเลขที่ ${request.requestNo}`,
          `บทความ: ${request.articleTitle}`,
          `ค้างอยู่ที่ขั้นตอน: ${statusLabel}`,
          `ระยะเวลาที่ค้าง: ${waiting} วันทำการ`,
        ].join('\n'),
        link: `/requests/${request.id}`,
      });
    }

    if (!step) continue;

    const handlers = await prisma.userRole.findMany({
      where: {
        role: { code: step.roleCode },
        ...(step.facultyScoped ? { OR: [{ facultyId: request.facultyId }, { facultyId: null }] } : {}),
      },
      select: { user: { select: { id: true, email: true, lineUserId: true, isActive: true } } },
    });

    for (const { user } of handlers) {
      if (!user.isActive || user.id === request.userId) continue;
      messages.push({
        userId: user.id,
        email: user.email,
        lineUserId: user.lineUserId,
        subject: `[เตือน] คำขอ ${request.requestNo} รอการพิจารณาของท่าน ${waiting} วันทำการ`,
        body: [
          `คำขอเลขที่ ${request.requestNo} (${request.faculty.nameTh})`,
          `บทความ: ${request.articleTitle}`,
          `รออยู่ที่ขั้นตอน: ${step.labelTh}`,
          `ระยะเวลาที่ค้าง: ${waiting} วันทำการ`,
          'กรุณาเข้าระบบเพื่อพิจารณา',
        ].join('\n'),
        link: `/requests/${request.id}`,
        // Reviewers only. The claimant's reminder above stays email-only: the
        // owner limited the claimant's popups to approved, returned and not
        // approved (push-policy.ts), and a stalled claim asks nothing of them.
        push: reminderPush(request, waiting),
      });
    }
  }

  await dispatch(messages);

  return {
    checked: stale.length,
    reminded: reminded.length,
    messagesSent: messages.length,
    thresholdBusinessDays: threshold,
    items: reminded,
  };
}
