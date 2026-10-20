import { Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import { notFound, unprocessable } from '../utils/errors';
import { outstanding, refundedInFull, refundedSoFar } from '../utils/refund';
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
        recordedByName: user.fullName,
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
      actor: user,
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
  if (!payment.paidAt) throw unprocessable('NOT_PAID_YET', 'รายการนี้ยังไม่ได้จ่าย');

  // Clawbacks accumulate. The flag used to be set by a partial refund too, so
  // the next call hit ALREADY_REFUNDED and the rest of the money could never be
  // recorded as returned: the claim stayed PAID for good, kept consuming its
  // owner's yearly entitlement, and the fund still counted money that had come
  // back. That collides with ประกาศ ข้อ ๕(๖), which requires repayment
  // "ตามจำนวนที่ได้รับ" - the whole of it. Found on 14 ต.ค. 2569 by clawing back
  // 100 of 1,500 and then trying to claw back the remaining 1,400.
  //
  // isRefunded therefore means FULLY refunded, which is what flips the status.
  if (refundedInFull(payment)) {
    throw unprocessable('ALREADY_REFUNDED', 'รายการนี้เรียกเงินคืนครบจำนวนแล้ว');
  }
  if (input.refundAmount > outstanding(payment)) {
    throw unprocessable(
      'REFUND_ABOVE_PAID',
      `จำนวนเงินที่เรียกคืนต้องไม่เกินยอดที่ยังไม่ได้คืน (${outstanding(payment).toLocaleString('th-TH')} บาท)`,
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, payment.requestId, payment.request.status);

    // Read again inside the lock. The guards above ran outside the transaction,
    // so two clerks clicking at once would both have passed them and the second
    // write would have overwritten the first - the same race lockRequest was
    // introduced for everywhere else (CLAUDE.md ข้อ 9).
    const current = await tx.payment.findUnique({
      where: { id: paymentId },
      select: { amount: true, refundAmount: true },
    });
    if (!current) throw notFound('ไม่พบรายการจ่ายที่ระบุ');
    if (refundedInFull(current)) {
      throw unprocessable('ALREADY_REFUNDED', 'รายการนี้เรียกเงินคืนครบจำนวนแล้ว');
    }
    if (input.refundAmount > outstanding(current)) {
      throw unprocessable(
        'REFUND_ABOVE_PAID',
        `จำนวนเงินที่เรียกคืนต้องไม่เกินยอดที่ยังไม่ได้คืน (${outstanding(current).toLocaleString('th-TH')} บาท)`,
      );
    }

    const refundedTotal = refundedSoFar(current) + input.refundAmount;
    const isFullRefund = refundedTotal >= Number(current.amount);

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        isRefunded: isFullRefund,
        refundAmount: new Prisma.Decimal(refundedTotal),
        refundReason: input.refundReason,
        refundedAt: new Date(),
      },
    });

    const result = await tx.request.update({
      where: { id: payment.requestId },
      data: isFullRefund ? { status: RequestStatus.REFUNDED } : {},
    });

    // Logged either way: a partial refund does not change the status, but it is
    // still a money movement the audit trail has to show. The running total
    // goes in the note because payments.refund_reason holds only the latest
    // reason, so these rows are the only record of each separate clawback.
    await writeStatusLog(tx, {
      requestId: payment.requestId,
      fromStatus: payment.request.status,
      toStatus: isFullRefund ? RequestStatus.REFUNDED : payment.request.status,
      actor: user,
      note:
        `เรียกเงินคืน ${input.refundAmount.toLocaleString('th-TH')} บาท ` +
        `(คืนแล้วรวม ${refundedTotal.toLocaleString('th-TH')} จาก ${Number(current.amount).toLocaleString('th-TH')} บาท)` +
        (isFullRefund ? '' : ' คำขอยังคงสถานะจ่ายแล้ว') +
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
