import { Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import { notFound, unprocessable } from '../utils/errors';
import { lockRequest, writeStatusLog } from './request.service';
import { notifyStatusChange, notifyPlain } from '../notifications/dispatcher';

/**
 * Transaction 2 of 2 (api-endpoints.md): create the payment row, flip the status
 * to PAID and write the log, all or nothing. The notification goes out only once
 * the transaction has committed.
 */
export async function recordPayment(
  user: AuthUser,
  requestId: bigint,
  input: { voucherNo?: string; paidAt: string; note?: string | null },
  ipAddress: string | null,
) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { payment: true },
  });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');

  if (request.status !== RequestStatus.APPROVED) {
    throw unprocessable('NOT_PAYABLE', 'บันทึกจ่ายได้เฉพาะคำขอที่อนุมัติแล้วเท่านั้น');
  }
  if (request.payment) {
    throw unprocessable('ALREADY_PAID', 'คำขอนี้บันทึกการจ่ายไปแล้ว');
  }
  if (!request.amountApproved) {
    throw unprocessable('NO_APPROVED_AMOUNT', 'คำขอนี้ยังไม่มีจำนวนเงินที่อนุมัติ');
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, request.id, RequestStatus.APPROVED);

    await tx.payment.create({
      data: {
        requestId: request.id,
        budgetYearId: request.budgetYearId,
        voucherNo: input.voucherNo?.trim() ? input.voucherNo.trim() : null,
        amount: request.amountApproved as Prisma.Decimal,
        paidAt: new Date(input.paidAt),
        recordedBy: user.id,
        note: input.note ?? null,
      },
    });

    const result = await tx.request.update({
      where: { id: request.id },
      data: { status: RequestStatus.PAID, closedAt: new Date() },
    });

    await writeStatusLog(tx, {
      requestId: request.id,
      fromStatus: RequestStatus.APPROVED,
      toStatus: RequestStatus.PAID,
      actorId: user.id,
      note: input.voucherNo?.trim()
        ? `บันทึกการเบิกจ่ายตามฎีกาเลขที่ ${input.voucherNo.trim()}`
        : 'บันทึกการเบิกจ่าย ยังไม่ได้ระบุเลขที่ฎีกา',
      ipAddress,
    });

    return result;
  });

  await notifyStatusChange({
    requestId: updated.id,
    requestNo: updated.requestNo,
    articleTitle: updated.articleTitle,
    ownerId: updated.userId,
    facultyId: updated.facultyId,
    toStatus: RequestStatus.PAID,
    actorName: user.fullName,
    note: input.voucherNo?.trim()
      ? `เลขที่ฎีกา ${input.voucherNo.trim()}`
      : 'ยังไม่ได้ระบุเลขที่ฎีกา',
  });

  return updated;
}

/**
 * Rule 10 of the announcement: money paid to someone who turns out not to
 * qualify has to come back. The payment row keeps the original amount and
 * records the refund beside it, so the audit trail shows both movements.
 */
export async function refundPayment(
  user: AuthUser,
  paymentId: bigint,
  input: { refundAmount: number; refundReason: string },
  ipAddress: string | null,
) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { request: true },
  });
  if (!payment) throw notFound('ไม่พบรายการจ่ายที่ระบุ');
  if (payment.isRefunded) throw unprocessable('ALREADY_REFUNDED', 'รายการนี้เรียกเงินคืนไปแล้ว');
  if (!payment.paidAt) throw unprocessable('NOT_PAID_YET', 'รายการนี้ยังไม่ได้จ่าย');
  if (input.refundAmount > Number(payment.amount)) {
    throw unprocessable('REFUND_ABOVE_PAID', 'จำนวนเงินที่เรียกคืนต้องไม่เกินจำนวนที่จ่ายไป');
  }

  // Only a full clawback undoes the reimbursement. A partial one - an overpaid
  // rate corrected by a few hundred baht - leaves the claimant with money in
  // hand, so the request stays PAID and keeps consuming its yearly entitlement.
  const isFullRefund = input.refundAmount >= Number(payment.amount);

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, payment.requestId, payment.request.status);

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        isRefunded: true,
        refundAmount: new Prisma.Decimal(input.refundAmount),
        refundReason: input.refundReason,
        refundedAt: new Date(),
      },
    });

    const result = await tx.request.update({
      where: { id: payment.requestId },
      data: isFullRefund ? { status: RequestStatus.REFUNDED } : {},
    });

    // Logged either way: a partial refund does not change the status, but it is
    // still a money movement the audit trail has to show.
    await writeStatusLog(tx, {
      requestId: payment.requestId,
      fromStatus: payment.request.status,
      toStatus: isFullRefund ? RequestStatus.REFUNDED : payment.request.status,
      actorId: user.id,
      note:
        `เรียกเงินคืน ${input.refundAmount.toLocaleString('th-TH')} บาท` +
        (isFullRefund ? '' : ' (บางส่วน คำขอยังคงสถานะจ่ายแล้ว)') +
        `: ${input.refundReason}`,
      ipAddress,
    });

    return result;
  });

  await notifyPlain(
    updated.userId,
    `[${updated.requestNo}] แจ้งเรียกเงินคืนค่าตอบแทนการตีพิมพ์`,
    [
      `คำขอเลขที่ ${updated.requestNo}`,
      `จำนวนเงินที่เรียกคืน ${input.refundAmount.toLocaleString('th-TH')} บาท`,
      `เหตุผล: ${input.refundReason}`,
      'กรุณาติดต่องานการเงินเพื่อดำเนินการคืนเงิน',
    ].join('\n'),
    `/requests/${updated.id}`,
  );

  return updated;
}

/** Finance queue: approved-but-unpaid first, then the payment history. */
export async function listPayments(filter: { status?: 'pending' | 'paid'; year?: number }) {
  const pending =
    filter.status === 'paid'
      ? []
      : await prisma.request.findMany({
          where: {
            status: RequestStatus.APPROVED,
            ...(filter.year ? { calendarYear: filter.year } : {}),
          },
          orderBy: { approvedAt: 'asc' },
          include: {
            owner: { select: { id: true, prefix: true, firstName: true, lastName: true } },
            faculty: { select: { id: true, nameTh: true } },
            budgetYear: { select: { id: true, year: true } },
          },
        });

  const paid =
    filter.status === 'pending'
      ? []
      : await prisma.payment.findMany({
          where: filter.year ? { request: { calendarYear: filter.year } } : {},
          orderBy: { paidAt: 'desc' },
          take: 200,
          include: {
            request: {
              select: {
                id: true,
                requestNo: true,
                articleTitle: true,
                status: true,
                calendarYear: true,
                owner: { select: { id: true, prefix: true, firstName: true, lastName: true } },
                faculty: { select: { id: true, nameTh: true } },
              },
            },
            recorder: { select: { id: true, firstName: true, lastName: true } },
          },
        });

  return { pending, paid };
}
