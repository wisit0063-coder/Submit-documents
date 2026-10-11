import { BudgetYearAction, Prisma, RequestStatus } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { notFound, unprocessable } from '../utils/errors';
import { fiscalYearOf } from '../utils/datetime';

export interface BudgetSummary {
  year: number;
  budgetYearId: string;
  total: number;
  reserved: number;
  paid: number;
  available: number;
  /** The fiscal year today falls in, by the 1 Oct - 30 Sep rule. */
  fiscalYearNow: number;
  /**
   * True when the year that is open for business is not the one today belongs
   * to. Nothing breaks when it happens - which is the problem. Claims are
   * still accepted, numbered from the open year, and charged to a ceiling that
   * closed months ago, with no error anywhere. It happened for real on
   * 11 Oct 2026, eleven days into 2570 with only 2569 on file.
   */
  isStale: boolean;
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

  const fiscalYearNow = fiscalYearOf(new Date());
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
    fiscalYearNow,
    // Only the open year can be out of date: a closed year is meant to be in
    // the past, and listing one must not raise an alarm.
    isStale: budgetYear.isActive && budgetYear.year !== fiscalYearNow,
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

/**
 * A fund year that is open for business needs money in it.
 *
 * Nothing stopped a ceiling of 0 on the active year, and the effect is not
 * obvious from the form: claims can still be filed, but every final approval
 * fails with BUDGET_EXCEEDED, so the whole fund silently stops paying out. A
 * year still waiting for its allocation can sit at 0 as long as it is closed.
 */
function assertActiveYearHasMoney(isActive: boolean, totalAmount: number) {
  if (isActive && totalAmount <= 0) {
    throw unprocessable(
      'ZERO_ACTIVE_BUDGET',
      'ปีงบประมาณที่เปิดใช้งานต้องมีวงเงินมากกว่า 0 บาท ' +
        'ถ้าตั้งเป็น 0 จะอนุมัติคำขอไม่ได้เลยทั้งระบบ (วงเงินคงเหลือไม่พอทุกครั้ง)',
    );
  }
}

/** Who did it, as the log has to remember them. */
export interface BudgetActor {
  id: bigint;
  name: string;
  ipAddress?: string | null;
}

export async function createBudgetYear(
  input: {
    year: number;
    totalAmount: number;
    startDate: string;
    endDate: string;
    isActive: boolean;
    note?: string | null;
  },
  actor: BudgetActor,
) {
  assertActiveYearHasMoney(input.isActive, input.totalAmount);

  return prisma.$transaction(async (tx) => {
    // Only one active fiscal year at a time, otherwise new requests would not
    // know which pot they draw from.
    if (input.isActive) {
      await tx.budgetYear.updateMany({ where: { isActive: true }, data: { isActive: false } });
    }
    const created = await tx.budgetYear.create({
      data: {
        year: input.year,
        totalAmount: new Prisma.Decimal(input.totalAmount),
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        isActive: input.isActive,
        note: input.note ?? null,
      },
    });

    // Written inside the same transaction as the figure itself: a ceiling that
    // exists without a line saying who set it is exactly the gap this closes.
    await tx.budgetYearLog.create({
      data: {
        budgetYearId: created.id,
        action: BudgetYearAction.CREATE,
        actorId: actor.id,
        actorName: actor.name,
        previousAmount: null,
        newAmount: created.totalAmount,
        previousIsActive: null,
        newIsActive: created.isActive,
        reason: input.note ?? null,
        ipAddress: actor.ipAddress ?? null,
      },
    });

    return created;
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
    reason: string;
  }>,
  actor: BudgetActor,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.budgetYear.findUnique({ where: { id } });
    if (!existing) throw notFound('ไม่พบปีงบประมาณที่ระบุ');

    const amountChanged =
      input.totalAmount !== undefined &&
      !new Prisma.Decimal(input.totalAmount).equals(existing.totalAmount);

    assertActiveYearHasMoney(
      input.isActive ?? existing.isActive,
      input.totalAmount ?? Number(existing.totalAmount),
    );

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

    // A reason is only demanded when the money itself moves. Fixing a typo in
    // the note, or opening a year, does not need one.
    if (amountChanged && (input.reason ?? '').trim().length < 5) {
      throw unprocessable(
        'REASON_REQUIRED',
        'การแก้วงเงินต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร เพื่อบันทึกไว้ในประวัติ',
      );
    }

    if (input.isActive) {
      await tx.budgetYear.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }

    const updated = await tx.budgetYear.update({
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

    const activeChanged =
      input.isActive !== undefined && input.isActive !== existing.isActive;

    // Dates, the year number and the note alone leave no log line: the history
    // is there for the money and for which pot is open, and filling it with
    // every keystroke would bury those.
    if (amountChanged || activeChanged) {
      await tx.budgetYearLog.create({
        data: {
          budgetYearId: id,
          action: BudgetYearAction.UPDATE,
          actorId: actor.id,
          actorName: actor.name,
          previousAmount: amountChanged ? existing.totalAmount : null,
          newAmount: amountChanged ? updated.totalAmount : null,
          previousIsActive: activeChanged ? existing.isActive : null,
          newIsActive: activeChanged ? updated.isActive : null,
          reason: input.reason?.trim() || null,
          ipAddress: actor.ipAddress ?? null,
        },
      });
    }

    return updated;
  });
}

/** The change history of one fund year, newest first. */
export async function listBudgetYearLogs(budgetYearId: bigint) {
  return prisma.budgetYearLog.findMany({
    where: { budgetYearId },
    orderBy: { createdAt: 'desc' },
  });
}
