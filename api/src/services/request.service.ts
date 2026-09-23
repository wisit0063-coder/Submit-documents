import { ApprovalDecision, Prisma, RequestStatus } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import {
  CANCELLABLE_STATUSES,
  EDITABLE_STATUSES,
  FIRST_STEP,
  IN_FLIGHT_STATUSES,
  stepByOrder,
} from '../config/workflow';
import { calendarYearOf, toDateOnly } from '../utils/datetime';
import { badRequest, forbidden, notFound, unprocessable } from '../utils/errors';
import { getQuota, validateForSubmit } from './validation.service';
import { getActiveBudgetYear } from './budget.service';
import { notifyStatusChange } from '../notifications/dispatcher';
import type {
  CreateRequestInput,
  ListRequestsQuery,
  UpdateRequestInput,
} from '../validators/request.schema';

const requestInclude = {
  owner: {
    select: {
      id: true,
      prefix: true,
      firstName: true,
      lastName: true,
      email: true,
      academicPosition: true,
      phoneMobile: true,
      phoneInternal: true,
      department: {
        select: { id: true, nameTh: true, faculty: { select: { id: true, nameTh: true } } },
      },
    },
  },
  faculty: { select: { id: true, code: true, nameTh: true } },
  journalTier: true,
  budgetYear: { select: { id: true, year: true } },
  attachments: {
    orderBy: { createdAt: 'asc' },
    include: { verifier: { select: { id: true, firstName: true, lastName: true } } },
  },
  approvals: {
    orderBy: { stepOrder: 'asc' },
    include: {
      approver: {
        select: { id: true, prefix: true, firstName: true, lastName: true, academicPosition: true },
      },
    },
  },
  payment: true,
} satisfies Prisma.RequestInclude;

export type RequestDetail = Prisma.RequestGetPayload<{ include: typeof requestInclude }>;

/** Running number per fiscal year: RQ-2569-0001. */
async function nextRequestNo(budgetYear: number, client: Tx): Promise<string> {
  const prefix = `RQ-${budgetYear}-`;
  const latest = await client.request.findFirst({
    where: { requestNo: { startsWith: prefix } },
    orderBy: { requestNo: 'desc' },
    select: { requestNo: true },
  });
  const lastSeq = latest ? Number.parseInt(latest.requestNo.slice(prefix.length), 10) : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

export async function writeStatusLog(
  client: Tx,
  params: {
    requestId: bigint;
    fromStatus: RequestStatus | null;
    toStatus: RequestStatus;
    actorId: bigint | null;
    note?: string | null;
    ipAddress?: string | null;
  },
): Promise<void> {
  await client.requestStatusLog.create({
    data: {
      requestId: params.requestId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      actorId: params.actorId,
      note: params.note ?? null,
      ipAddress: params.ipAddress ?? null,
    },
  });
}

/**
 * Who may open a request: the owner, an admin, finance, or anyone holding a role
 * that appears in the approval chain. Faculty-scoped roles only reach requests
 * belonging to the faculty they are scoped to.
 */
export function canViewRequest(
  user: AuthUser,
  request: { userId: bigint; facultyId: bigint },
): boolean {
  if (request.userId === user.id) return true;
  if (user.roles.includes('ADMIN') || user.roles.includes('FINANCE')) return true;

  const scopedRoles = ['FACULTY_QA', 'DEAN'];
  for (const scope of user.roleScopes) {
    if (scope.roleCode === 'RESEARCHER') continue;
    if (scopedRoles.includes(scope.roleCode)) {
      if (scope.facultyId === null || scope.facultyId === request.facultyId) return true;
      continue;
    }
    // RDI_OFFICER, ACADEMIC_OFFICE and APPROVER work university-wide.
    if (['RDI_OFFICER', 'ACADEMIC_OFFICE', 'APPROVER'].includes(scope.roleCode)) return true;
  }
  return false;
}

/**
 * Whether the caller may open a request in full, as opposed to merely seeing it
 * listed. Unit colleagues get the listing but not the detail - see
 * `summariseForPeers`.
 */
function canOpenInFull(user: AuthUser, request: { userId: bigint; facultyId: bigint }): boolean {
  return canViewRequest(user, request);
}

/**
 * Strips a peer's claim down to what a colleague may know about it.
 *
 * Someone in the same unit sees that the claim exists and where it has got to,
 * which is what stops two people filing the same article and lets a unit follow
 * its own paperwork. What they must not see is the money: `amountApproved` in
 * particular can be lower than requested, and that is between the claimant, the
 * approver and finance.
 *
 * The detail, timeline, attachment and PDF endpoints all gate on
 * canViewRequest, which still refuses a peer outright, so this only has to
 * handle the list.
 */
function summariseForPeers<T extends { userId: bigint; facultyId: bigint }>(
  user: AuthUser,
  rows: T[],
): (T & { viewScope: 'OWNER' | 'FULL' | 'SUMMARY' })[] {
  return rows.map((row) => {
    if (row.userId === user.id) return { ...row, viewScope: 'OWNER' as const };
    if (canOpenInFull(user, row)) return { ...row, viewScope: 'FULL' as const };
    return {
      ...row,
      amountRequested: null,
      amountApproved: null,
      sequenceInYear: null,
      viewScope: 'SUMMARY' as const,
    };
  });
}

/**
 * Role-based filter for GET /requests. The client never sends a user_id -
 * visibility is derived from the roles of the caller alone.
 */
function visibilityFilter(user: AuthUser): Prisma.RequestWhereInput {
  if (user.roles.includes('ADMIN') || user.roles.includes('FINANCE')) return {};

  const or: Prisma.RequestWhereInput[] = [{ userId: user.id }];

  // Anyone may see the claims filed by their own unit, drafts excluded: an
  // unsubmitted draft is private work, the same rule the faculty reviewers get.
  // The rows come back stripped of money by summariseForPeers.
  if (user.facultyId !== null) {
    or.push({ facultyId: user.facultyId, status: { not: RequestStatus.DRAFT } });
  }

  const facultyScoped = user.roleScopes.filter(
    (scope) => scope.roleCode === 'FACULTY_QA' || scope.roleCode === 'DEAN',
  );
  const scopedFacultyIds = facultyScoped
    .map((scope) => scope.facultyId)
    .filter((id): id is bigint => id !== null);

  if (facultyScoped.some((scope) => scope.facultyId === null)) {
    // Role granted without a faculty scope: treat as university-wide.
    or.push({ status: { not: RequestStatus.DRAFT } });
  } else if (scopedFacultyIds.length > 0) {
    or.push({ facultyId: { in: scopedFacultyIds }, status: { not: RequestStatus.DRAFT } });
  }

  if (user.roles.some((role) => ['RDI_OFFICER', 'ACADEMIC_OFFICE', 'APPROVER'].includes(role))) {
    or.push({ status: { not: RequestStatus.DRAFT } });
  }

  return { OR: or };
}

export async function listRequests(user: AuthUser, query: ListRequestsQuery) {
  const where: Prisma.RequestWhereInput = { AND: [visibilityFilter(user)] };
  const and = where.AND as Prisma.RequestWhereInput[];

  if (query.status) {
    const statuses = query.status
      .split(',')
      .map((value) => value.trim())
      .filter((value): value is RequestStatus => value in RequestStatus);
    if (statuses.length > 0) and.push({ status: { in: statuses } });
  }
  if (query.year) and.push({ calendarYear: query.year });
  if (query.facultyId) and.push({ facultyId: BigInt(query.facultyId) });
  if (query.q) {
    and.push({
      OR: [
        // Case-insensitive on purpose: Postgres would otherwise only match the
        // exact casing the requester typed when the row was created.
        { requestNo: { contains: query.q, mode: 'insensitive' } },
        { articleTitle: { contains: query.q, mode: 'insensitive' } },
        { journalName: { contains: query.q, mode: 'insensitive' } },
        { doi: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

  const [total, items] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        owner: { select: { id: true, prefix: true, firstName: true, lastName: true } },
        faculty: { select: { id: true, nameTh: true } },
        journalTier: { select: { id: true, code: true, nameTh: true } },
      },
    }),
  ]);

  return {
    items: summariseForPeers(user, items),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getRequestDetail(user: AuthUser, id: bigint): Promise<RequestDetail> {
  const request = await prisma.request.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');
  if (!canViewRequest(user, request)) throw forbidden('คุณไม่มีสิทธิ์เข้าถึงคำขอนี้');
  return request;
}

export async function getTimeline(user: AuthUser, id: bigint) {
  const request = await prisma.request.findUnique({
    where: { id },
    select: { id: true, userId: true, facultyId: true },
  });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');
  if (!canViewRequest(user, request)) throw forbidden('คุณไม่มีสิทธิ์เข้าถึงคำขอนี้');

  return prisma.requestStatusLog.findMany({
    where: { requestId: id },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { id: true, prefix: true, firstName: true, lastName: true } } },
  });
}

async function resolveTierAmount(
  journalTierId: bigint,
  fromConference: boolean,
  client: Tx = prisma,
) {
  const tier = await client.journalTier.findUnique({ where: { id: journalTierId } });
  if (!tier) throw badRequest('INVALID_JOURNAL_TIER', 'ไม่พบประเภทวารสารที่เลือก');
  if (!tier.isActive) {
    throw unprocessable('INACTIVE_JOURNAL_TIER', `ฐานข้อมูล ${tier.nameTh} ปิดรับการเบิกแล้ว`);
  }
  return { tier, amount: fromConference ? tier.rateConference : tier.rateNormal };
}

export async function previewAmount(journalTierId: bigint, fromConference: boolean) {
  const { tier, amount } = await resolveTierAmount(journalTierId, fromConference);
  return {
    journalTierId: tier.id,
    tierName: tier.nameTh,
    databaseName: tier.databaseName,
    fromConference,
    amount,
    announcementRef: tier.announcementRef,
  };
}

export async function createRequest(user: AuthUser, input: CreateRequestInput) {
  if (!user.roles.includes('RESEARCHER')) {
    throw forbidden('เฉพาะผู้มีบทบาทผู้ขอรับค่าตอบแทนเท่านั้นที่สร้างคำขอได้');
  }

  // A self-registered researcher may have no department yet (section 13.6): they
  // pick one here, and requests.department_id is NOT NULL, so it is required.
  const departmentId = input.departmentId ? BigInt(input.departmentId) : user.departmentId;
  if (!departmentId) {
    throw badRequest('DEPARTMENT_REQUIRED', 'กรุณาเลือกสาขาวิชาต้นสังกัดในแบบฟอร์ม');
  }

  const department = await prisma.department.findUnique({ where: { id: departmentId } });
  if (!department) throw badRequest('INVALID_DEPARTMENT', 'ไม่พบสาขาวิชาที่ระบุ');

  // The request snapshots the department's faculty, which must be the unit the
  // person actually belongs to.
  if (user.facultyId !== null && department.facultyId !== user.facultyId) {
    throw unprocessable(
      'DEPARTMENT_FACULTY_MISMATCH',
      'สาขาวิชาที่เลือกไม่อยู่ในหน่วยงาน/สังกัดของท่าน',
    );
  }

  const budgetYear = await getActiveBudgetYear();
  if (!budgetYear) {
    throw unprocessable('NO_ACTIVE_BUDGET_YEAR', 'ยังไม่ได้ตั้งวงเงินปีงบประมาณปัจจุบัน');
  }

  const { amount } = await resolveTierAmount(BigInt(input.journalTierId), input.fromConference);
  const publishedAt = toDateOnly(input.publishedAt);

  return prisma.$transaction(async (tx) => {
    const request = await tx.request.create({
      data: {
        requestNo: await nextRequestNo(budgetYear.year, tx),
        userId: user.id,
        // Faculty and department are snapshots taken when the request is filed:
        // if the person transfers later, this request must still name the
        // faculty that handled it.
        facultyId: department.facultyId,
        departmentId: department.id,
        articleTitle: input.articleTitle,
        journalName: input.journalName,
        volume: input.volume || null,
        issue: input.issue || null,
        pages: input.pages || null,
        issn: input.issn || null,
        doi: input.doi || null,
        articleUrl: input.articleUrl || null,
        publishedAt,
        journalTierId: BigInt(input.journalTierId),
        fromConference: input.fromConference,
        amountRequested: amount,
        calendarYear: calendarYearOf(publishedAt),
        budgetYearId: budgetYear.id,
        certNotOnStudyLeave: input.certNotOnStudyLeave,
        certNotThesisPart: input.certNotThesisPart,
        certNotDuplicate: input.certNotDuplicate,
        status: RequestStatus.DRAFT,
        currentStep: 0,
      },
    });

    await writeStatusLog(tx, {
      requestId: request.id,
      fromStatus: null,
      toStatus: RequestStatus.DRAFT,
      actorId: user.id,
      note: 'สร้างคำขอฉบับร่าง',
    });

    return request;
  });
}

export async function updateRequest(user: AuthUser, id: bigint, input: UpdateRequestInput) {
  const request = await prisma.request.findUnique({ where: { id } });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');
  if (request.userId !== user.id) throw forbidden('แก้ไขได้เฉพาะคำขอของตนเอง');
  if (!EDITABLE_STATUSES.includes(request.status)) {
    throw unprocessable('NOT_EDITABLE', 'แก้ไขได้เฉพาะคำขอสถานะร่างหรือถูกตีกลับเท่านั้น');
  }

  const data: Prisma.RequestUpdateInput = {};

  if (input.journalTierId !== undefined || input.fromConference !== undefined) {
    const tierId = input.journalTierId ? BigInt(input.journalTierId) : request.journalTierId;
    const fromConference = input.fromConference ?? request.fromConference;
    const { amount } = await resolveTierAmount(tierId, fromConference);
    data.journalTier = { connect: { id: tierId } };
    data.fromConference = fromConference;
    data.amountRequested = amount;
  }

  if (input.articleTitle !== undefined) data.articleTitle = input.articleTitle;
  if (input.journalName !== undefined) data.journalName = input.journalName;
  if (input.volume !== undefined) data.volume = input.volume || null;
  if (input.issue !== undefined) data.issue = input.issue || null;
  if (input.pages !== undefined) data.pages = input.pages || null;
  if (input.issn !== undefined) data.issn = input.issn || null;
  if (input.doi !== undefined) data.doi = input.doi || null;
  if (input.articleUrl !== undefined) data.articleUrl = input.articleUrl || null;
  if (input.publishedAt !== undefined) {
    const publishedAt = toDateOnly(input.publishedAt);
    data.publishedAt = publishedAt;
    data.calendarYear = calendarYearOf(publishedAt);
  }
  if (input.certNotOnStudyLeave !== undefined) data.certNotOnStudyLeave = input.certNotOnStudyLeave;
  if (input.certNotThesisPart !== undefined) data.certNotThesisPart = input.certNotThesisPart;
  if (input.certNotDuplicate !== undefined) data.certNotDuplicate = input.certNotDuplicate;

  return prisma.request.update({ where: { id }, data });
}

export async function getMyQuota(user: AuthUser, calendarYear?: number) {
  const year = calendarYear ?? calendarYearOf(new Date());
  const quota = await getQuota(user.id, year);
  const requests = await prisma.request.findMany({
    where: {
      userId: user.id,
      calendarYear: year,
      status: { in: [...IN_FLIGHT_STATUSES, RequestStatus.APPROVED, RequestStatus.PAID] },
    },
    select: {
      id: true,
      requestNo: true,
      articleTitle: true,
      status: true,
      amountRequested: true,
      amountApproved: true,
      sequenceInYear: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return { ...quota, requests };
}

/** Dry run of the submit gate so the form can show problems before submitting. */
export async function checkSubmit(user: AuthUser, id: bigint, isFirstAuthor: boolean) {
  const request = await prisma.request.findUnique({
    where: { id },
    include: { attachments: true, journalTier: true },
  });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');
  if (request.userId !== user.id) throw forbidden('ตรวจสอบได้เฉพาะคำขอของตนเอง');

  const issues = await validateForSubmit(request, { isFirstAuthor });
  return { valid: issues.length === 0, issues };
}

export async function submitRequest(
  user: AuthUser,
  id: bigint,
  isFirstAuthor: boolean,
  ipAddress: string | null,
) {
  const existing = await prisma.request.findUnique({
    where: { id },
    include: { attachments: true, journalTier: true },
  });
  if (!existing) throw notFound('ไม่พบคำขอที่ระบุ');
  if (existing.userId !== user.id) throw forbidden('ส่งได้เฉพาะคำขอของตนเอง');
  if (existing.status !== RequestStatus.DRAFT) {
    throw unprocessable('NOT_SUBMITTABLE', 'ส่งได้เฉพาะคำขอสถานะร่างเท่านั้น');
  }

  const issues = await validateForSubmit(existing, { isFirstAuthor });
  if (issues.length > 0) {
    throw unprocessable(issues[0]!.code, issues[0]!.message, { issues });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.request.update({
      where: { id },
      data: {
        status: FIRST_STEP.status,
        currentStep: FIRST_STEP.order,
        submittedAt: new Date(),
      },
    });

    // Open the first approval row. Later steps create their own row when the
    // request reaches them, so request_approvals mirrors the real trail.
    await tx.requestApproval.upsert({
      where: { requestId_stepOrder: { requestId: id, stepOrder: FIRST_STEP.order } },
      create: {
        requestId: id,
        stepOrder: FIRST_STEP.order,
        stepCode: FIRST_STEP.stepCode,
        decision: ApprovalDecision.PENDING,
      },
      update: { decision: ApprovalDecision.PENDING },
    });

    await writeStatusLog(tx, {
      requestId: id,
      fromStatus: RequestStatus.DRAFT,
      toStatus: FIRST_STEP.status,
      actorId: user.id,
      note: 'ยื่นคำขอ พร้อมรับรองว่าเป็นผู้เขียนชื่อแรก (First author)',
      ipAddress,
    });

    return request;
  });

  await notifyStatusChange({
    requestId: updated.id,
    requestNo: updated.requestNo,
    articleTitle: updated.articleTitle,
    ownerId: updated.userId,
    facultyId: updated.facultyId,
    toStatus: updated.status,
    actorName: user.fullName,
  });

  return updated;
}

/**
 * Workflow rule 1: a returned request goes back to the step that returned it,
 * never to the start. currentStep keeps pointing at that step while the request
 * sits in RETURNED, so resubmitting only has to restore that status.
 */
export async function resubmitRequest(
  user: AuthUser,
  id: bigint,
  isFirstAuthor: boolean,
  ipAddress: string | null,
) {
  const existing = await prisma.request.findUnique({
    where: { id },
    include: { attachments: true, journalTier: true },
  });
  if (!existing) throw notFound('ไม่พบคำขอที่ระบุ');
  if (existing.userId !== user.id) throw forbidden('ส่งได้เฉพาะคำขอของตนเอง');
  if (existing.status !== RequestStatus.RETURNED) {
    throw unprocessable('NOT_RETURNED', 'ใช้ได้เฉพาะคำขอที่ถูกตีกลับเท่านั้น');
  }

  const targetStep = stepByOrder(existing.currentStep) ?? FIRST_STEP;

  const issues = await validateForSubmit(existing, { isFirstAuthor });
  if (issues.length > 0) {
    throw unprocessable(issues[0]!.code, issues[0]!.message, { issues });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.request.update({
      where: { id },
      data: { status: targetStep.status, currentStep: targetStep.order },
    });

    await tx.requestApproval.upsert({
      where: { requestId_stepOrder: { requestId: id, stepOrder: targetStep.order } },
      create: {
        requestId: id,
        stepOrder: targetStep.order,
        stepCode: targetStep.stepCode,
        decision: ApprovalDecision.PENDING,
      },
      update: { decision: ApprovalDecision.PENDING, approverId: null, signedAt: null },
    });

    await writeStatusLog(tx, {
      requestId: id,
      fromStatus: RequestStatus.RETURNED,
      toStatus: targetStep.status,
      actorId: user.id,
      note: `ส่งคำขอที่แก้ไขแล้วกลับเข้าขั้นตอน "${targetStep.labelTh}"`,
      ipAddress,
    });

    return request;
  });

  await notifyStatusChange({
    requestId: updated.id,
    requestNo: updated.requestNo,
    articleTitle: updated.articleTitle,
    ownerId: updated.userId,
    facultyId: updated.facultyId,
    toStatus: updated.status,
    actorName: user.fullName,
  });

  return updated;
}

export async function cancelRequest(user: AuthUser, id: bigint, ipAddress: string | null) {
  const request = await prisma.request.findUnique({ where: { id } });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');
  if (request.userId !== user.id) throw forbidden('ยกเลิกได้เฉพาะคำขอของตนเอง');
  if (!CANCELLABLE_STATUSES.includes(request.status)) {
    throw unprocessable(
      'NOT_CANCELLABLE',
      'ยกเลิกได้ก่อนเรื่องเข้าสู่ขั้นอนุมัติเท่านั้น หากต้องการยกเลิกกรุณาติดต่อสถาบันวิจัยฯ',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.request.update({
      where: { id },
      data: { status: RequestStatus.CANCELLED, closedAt: new Date() },
    });
    await writeStatusLog(tx, {
      requestId: id,
      fromStatus: request.status,
      toStatus: RequestStatus.CANCELLED,
      actorId: user.id,
      note: 'ผู้ขอยกเลิกคำขอ',
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
    toStatus: RequestStatus.CANCELLED,
    actorName: user.fullName,
  });

  return updated;
}

export { requestInclude };
