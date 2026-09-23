import { Prisma, RequestStatus } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { notFound, unprocessable } from '../utils/errors';

export interface BudgetSummary {
  year: number;
  budgetYearId: string;
  total: number;
  reserved: number;
  paid: number;
  available: number;
}

/**
 * Three separate figures, never one lump sum (CLAUDE.md section 7).
 *
 *   reserved = approved but not yet paid  -> committed the moment APPROVER signs
 *   paid     = money that actually left, net of refunds
 *   available = total - reserved - paid
 *
 * Without the reserved bucket, the window between approval and transfer would
 * show money that is already spoken for and invite over-approval.
 */
export async function getBudgetSummary(
  budgetYearId?: bigint,
  client: Tx = prisma,
): Promise<BudgetSummary> {
  const budgetYear = budgetYearId
    ? await client.budgetYear.findUnique({ where: { id: budgetYearId } })
    : await client.budgetYear.findFirst({ where: { isActive: true }, orderBy: { year: 'desc' } });

  if (!budgetYear) {
    throw notFound('ยังไม่ได้ตั้งวงเงินปีงบประมาณ');
  }

  const reservedAgg = await client.request.aggregate({
    where: { budgetYearId: budgetYear.id, status: RequestStatus.APPROVED },
    _sum: { amountApproved: true },
  });

  const paidAgg = await client.payment.aggregate({
    where: { budgetYearId: budgetYear.id, paidAt: { not: null } },
    _sum: { amount: true, refundAmount: true },
  });

  const total = Number(budgetYear.totalAmount);
  const reserved = Number(reservedAgg._sum.amountApproved ?? 0);
  const paidGross = Number(paidAgg._sum.amount ?? 0);
  const refunded = Number(paidAgg._sum.refundAmount ?? 0);
  const paid = paidGross - refunded;

  return {
    year: budgetYear.year,
    budgetYearId: budgetYear.id.toString(),
    total,
    reserved,
    paid,
    available: total - reserved - paid,
  };
}

/**
 * Re-checked inside the final-approve transaction. If the remaining balance is
 * short the whole transaction rolls back, so two approvers racing on the last
 * of the budget cannot both succeed.
 *
 * The fiscal-year row is locked first. Without the lock, two transactions could
 * both read the same balance, both find it sufficient and both commit, taking
 * the fund over its limit - read-committed isolation does not stop that on its own.
 */
export async function assertBudgetAvailable(
  budgetYearId: bigint,
  amount: Prisma.Decimal | number,
  client: Tx,
): Promise<BudgetSummary> {
  await client.$queryRaw`SELECT id FROM budget_years WHERE id = ${budgetYearId} FOR UPDATE`;

  const summary = await getBudgetSummary(budgetYearId, client);
  if (Number(amount) > summary.available) {
    throw unprocessable(
      'BUDGET_EXCEEDED',
      `วงเงินคงเหลือไม่พอ คงเหลือ ${summary.available.toLocaleString('th-TH')} บาท ` +
        `แต่ต้องการอนุมัติ ${Number(amount).toLocaleString('th-TH')} บาท`,
    );
  }
  return summary;
}

export async function getActiveBudgetYear(client: Tx = prisma) {
  return client.budgetYear.findFirst({ where: { isActive: true }, orderBy: { year: 'desc' } });
}

export async function listBudgetYears() {
  const years = await prisma.budgetYear.findMany({ orderBy: { year: 'desc' } });
  return Promise.all(
    years.map(async (year) => {
      const summary = await getBudgetSummary(year.id);
      return { ...year, ...summary };
    }),
  );
}

export async function createBudgetYear(input: {
  year: number;
  totalAmount: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    // Only one active fiscal year at a time, otherwise new requests would not
    // know which pot they draw from.
    if (input.isActive) {
      await tx.budgetYear.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    return tx.budgetYear.create({
      data: {
        year: input.year,
        totalAmount: new Prisma.Decimal(input.totalAmount),
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        isActive: input.isActive,
        note: input.note ?? null,
      },
    });
  });
}

export async function updateBudgetYear(
  id: bigint,
  input: Partial<{
    year: number;
    totalAmount: number;
    startDate: string;
    endDate: string;
    isActive: boolean;
    note: string | null;
  }>,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.budgetYear.findUnique({ where: { id } });
    if (!existing) throw notFound('ไม่พบปีงบประมาณที่ระบุ');

    if (input.totalAmount !== undefined) {
      const summary = await getBudgetSummary(id, tx);
      const committed = summary.reserved + summary.paid;
      if (input.totalAmount < committed) {
        throw unprocessable(
          'BUDGET_BELOW_COMMITTED',
          `ตั้งวงเงินต่ำกว่ายอดที่ผูกพันแล้วไม่ได้ ยอดผูกพันปัจจุบัน ${committed.toLocaleString('th-TH')} บาท`,
        );
      }
    }

    if (input.isActive) {
      await tx.budgetYear.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }

    return tx.budgetYear.update({
      where: { id },
      data: {
        ...(input.year !== undefined ? { year: input.year } : {}),
        ...(input.totalAmount !== undefined
          ? { totalAmount: new Prisma.Decimal(input.totalAmount) }
          : {}),
        ...(input.startDate ? { startDate: new Date(input.startDate) } : {}),
        ...(input.endDate ? { endDate: new Date(input.endDate) } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    });
  });
}
