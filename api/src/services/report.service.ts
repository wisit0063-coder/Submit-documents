import ExcelJS from 'exceljs';
import { Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import { ENTITLEMENT_STATUSES, STATUS_LABELS_TH, stepByStatus } from '../config/workflow';
import { businessDaysBetween, formatThaiDate } from '../utils/datetime';

interface ReportFilter {
  year?: number;
  budgetYearId?: string;
  facultyId?: string;
  status?: string;
}

/** A numeric id from the query string, or undefined - never a BigInt SyntaxError. */
function optionalId(value: string | undefined): bigint | undefined {
  return value && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function baseWhere(filter: ReportFilter) {
  const budgetYearId = optionalId(filter.budgetYearId);
  const facultyId = optionalId(filter.facultyId);
  // A status the caller asked for, but never DRAFT: an unsubmitted form is not
  // a claim, and every other part of the system keeps other people's drafts out
  // of sight. Counting them made a faculty appear in the report, and a row in
  // the Excel export, because somebody had started typing.
  const asked =
    filter.status && filter.status in RequestStatus
      ? (filter.status as RequestStatus)
      : undefined;
  return {
    ...(filter.year ? { calendarYear: filter.year } : {}),
    ...(budgetYearId ? { budgetYearId } : {}),
    ...(facultyId ? { facultyId } : {}),
    ...(asked && asked !== RequestStatus.DRAFT
      ? { status: asked }
      : { status: { not: RequestStatus.DRAFT } }),
  };
}

/**
 * Which faculties a caller may see aggregate numbers for. `null` means every
 * faculty; an array - possibly empty - means only those.
 *
 * A DEAN or FACULTY_QA bound to a faculty sees that faculty alone, the same
 * scope the dashboard and the request list already give them, so opening a
 * report cannot show more than the rest of the app does. RDI_OFFICER is
 * university-wide because ประกาศ 2131/2566 ข้อ 9(1) makes that office the owner
 * of the whole process.
 */
export function reportFacultyScope(user: AuthUser): bigint[] | null {
  const universityWide = ['ADMIN', 'FINANCE', 'APPROVER', 'RDI_OFFICER', 'ACADEMIC_OFFICE'];
  if (user.roles.some((role) => universityWide.includes(role))) return null;

  const scopes = user.roleScopes.filter(
    (scope) => scope.roleCode === 'FACULTY_QA' || scope.roleCode === 'DEAN',
  );
  // Granted without a faculty: covers every faculty, matching the inbox rule.
  if (scopes.some((scope) => scope.facultyId === null)) return null;
  return scopes.map((scope) => scope.facultyId).filter((id): id is bigint => id !== null);
}

/** Count and money per faculty, split into requested, approved and paid. */
export async function reportByFaculty(filter: ReportFilter, allowed: bigint[] | null = null) {
  // The faculty filter narrows the list of faculties to report on. It used to
  // be applied inside the per-faculty query, where `facultyId: faculty.id`
  // overwrote it - so picking a faculty still listed every faculty.
  const onlyFaculty = optionalId(filter.facultyId);
  // Asking for a faculty outside the caller's scope returns nothing rather than
  // quietly widening to the faculties they are allowed to see.
  if (allowed && onlyFaculty !== undefined && !allowed.includes(onlyFaculty)) return [];

  const faculties = await prisma.faculty.findMany({
    where: {
      isActive: true,
      ...(onlyFaculty !== undefined ? { id: onlyFaculty } : allowed ? { id: { in: allowed } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });

  const rows = await Promise.all(
    faculties.map(async (faculty) => {
      const where = { ...baseWhere(filter), facultyId: faculty.id };

      const [total, approvedAgg, paidAgg, requestedAgg] = await Promise.all([
        prisma.request.count({ where }),
        prisma.request.aggregate({
          where: { ...where, status: { in: ENTITLEMENT_STATUSES } },
          _sum: { amountApproved: true },
          _count: true,
        }),
        prisma.payment.aggregate({
          where: { request: where, paidAt: { not: null } },
          _sum: { amount: true, refundAmount: true },
          _count: true,
        }),
        prisma.request.aggregate({ where, _sum: { amountRequested: true } }),
      ]);

      return {
        facultyId: faculty.id.toString(),
        facultyName: faculty.nameTh,
        totalRequests: total,
        approvedCount: approvedAgg._count,
        paidCount: paidAgg._count,
        amountRequested: Number(requestedAgg._sum.amountRequested ?? 0),
        amountApproved: Number(approvedAgg._sum.amountApproved ?? 0),
        amountPaid:
          Number(paidAgg._sum.amount ?? 0) - Number(paidAgg._sum.refundAmount ?? 0),
      };
    }),
  );

  return rows.filter((row) => row.totalRequests > 0);
}

/** Distribution across journal databases - which tiers the money actually goes to. */
export async function reportByTier(filter: ReportFilter) {
  const tiers = await prisma.journalTier.findMany({ orderBy: { sortOrder: 'asc' } });

  const rows = await Promise.all(
    tiers.map(async (tier) => {
      const where = { ...baseWhere(filter), journalTierId: tier.id };
      const [count, agg] = await Promise.all([
        prisma.request.count({ where }),
        prisma.request.aggregate({
          where: { ...where, status: { in: ENTITLEMENT_STATUSES } },
          _sum: { amountApproved: true },
          _count: true,
        }),
      ]);

      return {
        tierId: tier.id.toString(),
        code: tier.code,
        tierName: tier.nameTh,
        databaseName: tier.databaseName,
        isActive: tier.isActive,
        totalRequests: count,
        approvedCount: agg._count,
        amountApproved: Number(agg._sum.amountApproved ?? 0),
      };
    }),
  );

  return rows.filter((row) => row.totalRequests > 0);
}

/**
 * Average business days spent at each step, derived from the status log. This is
 * the bottleneck report: it shows which desk the paperwork sits on.
 */
export async function reportProcessingTime(filter: ReportFilter) {
  const requests = await prisma.request.findMany({
    where: { ...baseWhere(filter), submittedAt: { not: null } },
    select: {
      id: true,
      statusLogs: { orderBy: { createdAt: 'asc' }, select: { toStatus: true, createdAt: true } },
    },
  });

  const buckets = new Map<RequestStatus, number[]>();
  let totalDurations: number[] = [];

  for (const request of requests) {
    const logs = request.statusLogs;
    for (let index = 0; index < logs.length - 1; index += 1) {
      const current = logs[index]!;
      const next = logs[index + 1]!;
      const days = businessDaysBetween(current.createdAt, next.createdAt);
      const list = buckets.get(current.toStatus) ?? [];
      list.push(days);
      buckets.set(current.toStatus, list);
    }
    const first = logs[0];
    const last = logs[logs.length - 1];
    if (first && last && logs.length > 1) {
      totalDurations.push(businessDaysBetween(first.createdAt, last.createdAt));
    }
  }

  const average = (values: number[]) =>
    values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  const steps = [...buckets.entries()]
    .filter(([status]) => Boolean(stepByStatus(status)))
    .map(([status, values]) => ({
      status,
      stepLabel: stepByStatus(status)?.labelTh ?? STATUS_LABELS_TH[status],
      samples: values.length,
      averageBusinessDays: average(values),
      maxBusinessDays: values.length ? Math.max(...values) : 0,
    }))
    .sort((a, b) => b.averageBusinessDays - a.averageBusinessDays);

  return {
    steps,
    overallAverageBusinessDays: average(totalDurations),
    sampleSize: requests.length,
  };
}

/** Published-article counts per faculty and year for the QA indicator returns. */
export async function reportQaIndicator(filter: ReportFilter, allowed: bigint[] | null = null) {
  const requests = await prisma.request.findMany({
    // AND rather than one spread object: the scope must sit beside the caller's
    // own facultyId filter, not overwrite it.
    where: {
      AND: [
        baseWhere(filter),
        { status: { in: ENTITLEMENT_STATUSES } },
        ...(allowed ? [{ facultyId: { in: allowed } }] : []),
      ],
    },
    select: {
      qaIndicatorYear: true,
      calendarYear: true,
      faculty: { select: { id: true, nameTh: true } },
      journalTier: { select: { code: true, nameTh: true, databaseName: true } },
    },
  });

  const grouped = new Map<string, { facultyName: string; year: number; count: number; byDatabase: Record<string, number> }>();

  for (const request of requests) {
    // The QA year may differ from the calendar year: faculties sometimes count a
    // December article in the following indicator round.
    const year = request.qaIndicatorYear ?? request.calendarYear;
    const key = `${request.faculty.id}-${year}`;
    const entry = grouped.get(key) ?? {
      facultyName: request.faculty.nameTh,
      year,
      count: 0,
      byDatabase: {},
    };
    entry.count += 1;
    const db = request.journalTier.databaseName;
    entry.byDatabase[db] = (entry.byDatabase[db] ?? 0) + 1;
    grouped.set(key, entry);
  }

  return [...grouped.values()].sort((a, b) => b.year - a.year || a.facultyName.localeCompare(b.facultyName, 'th'));
}

/** Flat export for the finance office. exceljs is pure JS - no native build. */
export async function exportExcel(
  filter: ReportFilter,
  allowed: bigint[] | null = null,
): Promise<ExcelJS.Buffer> {
  const onlyFaculty = optionalId(filter.facultyId);
  // Faculty QA may download this, and QA is bound to its own faculty: asking
  // for another one returns nothing rather than quietly widening back to the
  // faculties the caller does happen to be allowed to see. Same rule as
  // reportByFaculty.
  if (allowed && onlyFaculty !== undefined && !allowed.includes(onlyFaculty)) {
    allowed = [];
  }

  const requests = await prisma.request.findMany({
    where: {
      AND: [baseWhere(filter), ...(allowed ? [{ facultyId: { in: allowed } }] : [])],
    },
    orderBy: { requestNo: 'asc' },
    include: {
      // staffTrack rides along so the export can answer "how much went to
      // support staff" - both tracks may claim (ประกาศ 2131/2566 ข้อ 1 does not
      // restrict the claimant to academic staff).
      owner: { select: { prefix: true, firstName: true, lastName: true, staffTrack: true } },
      faculty: { select: { nameTh: true } },
      journalTier: { select: { nameTh: true, databaseName: true } },
      payment: true,
    },
  });

  const staffTrackLabels: Record<string, string> = {
    ACADEMIC: 'ฝ่ายวิชาการ',
    SUPPORT: 'ฝ่ายสนับสนุน',
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CPRU Publishing Fee System';
  const sheet = workbook.addWorksheet('รายการคำขอ');

  sheet.columns = [
    { header: 'เลขที่คำขอ', key: 'requestNo', width: 16 },
    { header: 'ผู้ขอ', key: 'owner', width: 28 },
    { header: 'สายงาน/ฝ่าย', key: 'staffTrack', width: 14 },
    { header: 'คณะ', key: 'faculty', width: 28 },
    { header: 'ชื่อบทความ', key: 'title', width: 60 },
    { header: 'วารสาร', key: 'journal', width: 36 },
    { header: 'ฐานข้อมูล', key: 'tier', width: 18 },
    { header: 'วันที่ตีพิมพ์', key: 'publishedAt', width: 16 },
    { header: 'ปีปฏิทินที่ตีพิมพ์', key: 'calendarYear', width: 16 },
    { header: 'ปีที่ใช้สิทธิ์ (ปีที่ยื่น)', key: 'entitlementYear', width: 18 },
    { header: 'ปีตัวชี้วัด QA (พ.ศ.)', key: 'qaIndicatorYear', width: 18 },
    { header: 'ยอดที่ขอ', key: 'requested', width: 14 },
    { header: 'ยอดที่อนุมัติ', key: 'approved', width: 14 },
    { header: 'สถานะ', key: 'status', width: 20 },
    { header: 'เลขที่ฎีกา', key: 'voucher', width: 16 },
    { header: 'วันที่จ่าย', key: 'paidAt', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const request of requests) {
    sheet.addRow({
      requestNo: request.requestNo,
      owner: `${request.owner.prefix ?? ''}${request.owner.firstName} ${request.owner.lastName}`,
      staffTrack: request.owner.staffTrack ? staffTrackLabels[request.owner.staffTrack] : '',
      faculty: request.faculty.nameTh,
      title: request.articleTitle,
      journal: request.journalName,
      tier: request.journalTier.nameTh,
      publishedAt: formatThaiDate(request.publishedAt),
      calendarYear: request.calendarYear,
      entitlementYear: request.entitlementYear ?? '',
      qaIndicatorYear: request.qaIndicatorYear ?? '',
      requested: Number(request.amountRequested),
      approved: request.amountApproved ? Number(request.amountApproved) : null,
      status: STATUS_LABELS_TH[request.status],
      voucher: request.payment?.voucherNo ?? '',
      paidAt: request.payment?.paidAt ? formatThaiDate(request.payment.paidAt) : '',
    });
  }

  sheet.getColumn('requested').numFmt = '#,##0.00';
  sheet.getColumn('approved').numFmt = '#,##0.00';

  return workbook.xlsx.writeBuffer();
}

/**
 * What the landing dashboard counts, matching what the caller may open in full.
 *
 *   university-wide roles        -> every request
 *   FACULTY_QA / DEAN            -> their own, plus their faculty's submitted ones
 *   plain RESEARCHER             -> their own only
 *
 * A plain researcher does not get their unit's claims here even though the list
 * shows them as summaries: the dashboard sums approved amounts by month, and
 * that money is exactly what the peer summary hides.
 */
function dashboardScope(user: AuthUser): { where: Prisma.RequestWhereInput; label: DashboardScope } {
  const universityWide = ['ADMIN', 'FINANCE', 'APPROVER', 'RDI_OFFICER', 'ACADEMIC_OFFICE'];
  if (user.roles.some((role) => universityWide.includes(role))) {
    // Someone else's draft is private work until it is filed, which is the rule
    // every other branch here applies. Counting them university-wide put a
    // "ฉบับร่าง" figure on an executive's dashboard built from forms nobody had
    // submitted, while a dean - closer to the claimant - was shown none.
    return {
      where: { OR: [{ userId: user.id }, { status: { not: RequestStatus.DRAFT } }] },
      label: 'UNIVERSITY',
    };
  }

  const reviewerScopes = user.roleScopes.filter(
    (scope) => scope.roleCode === 'FACULTY_QA' || scope.roleCode === 'DEAN',
  );
  // A reviewer role granted without a faculty covers every faculty, the same
  // rule the inbox and the request list apply.
  if (reviewerScopes.some((scope) => scope.facultyId === null)) {
    return {
      where: { OR: [{ userId: user.id }, { status: { not: RequestStatus.DRAFT } }] },
      label: 'UNIVERSITY',
    };
  }
  const facultyIds = reviewerScopes
    .map((scope) => scope.facultyId)
    .filter((id): id is bigint => id !== null);
  if (facultyIds.length > 0) {
    return {
      where: {
        OR: [
          { userId: user.id },
          { facultyId: { in: facultyIds }, status: { not: RequestStatus.DRAFT } },
        ],
      },
      label: 'FACULTY',
    };
  }

  return { where: { userId: user.id }, label: 'OWN' };
}

export type DashboardScope = 'UNIVERSITY' | 'FACULTY' | 'OWN';

/** Numbers for the landing dashboard, scoped to what the caller may see. */
export async function dashboardSummary(user: AuthUser) {
  const { where: scope, label } = dashboardScope(user);

  const [byStatus, budgetYear] = await Promise.all([
    prisma.request.groupBy({ by: ['status'], where: scope, _count: true }),
    prisma.budgetYear.findFirst({ where: { isActive: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const status of Object.values(RequestStatus)) counts[status] = 0;
  for (const row of byStatus) counts[row.status] = row._count;

  const monthly = await prisma.request.findMany({
    where: { ...scope, submittedAt: { not: null } },
    select: { submittedAt: true, amountApproved: true, status: true },
    orderBy: { submittedAt: 'asc' },
    take: 500,
  });

  const byMonth = new Map<string, { month: string; count: number; amount: number }>();
  for (const row of monthly) {
    if (!row.submittedAt) continue;
    const key = `${row.submittedAt.getUTCFullYear()}-${String(row.submittedAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const entry = byMonth.get(key) ?? { month: key, count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += Number(row.amountApproved ?? 0);
    byMonth.set(key, entry);
  }

  return {
    // Tells the page whose numbers these are, so a dean is not shown
    // faculty-wide totals under a heading that says "my requests".
    scope: label,
    counts,
    activeBudgetYear: budgetYear?.year ?? null,
    monthly: [...byMonth.values()].slice(-12),
  };
}
