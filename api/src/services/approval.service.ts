import { ApprovalDecision, Prisma, RequestStatus } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import {
  COMMITTEE_STEP,
  DUPLICATE_BLOCKING_STATUSES,
  ENTITLEMENT_STATUSES,
  MAX_ARTICLES_PER_CALENDAR_YEAR,
  WORKFLOW_STEPS,
  stepByStatus,
  type WorkflowStep,
} from '../config/workflow';
import { forbidden, notFound, unprocessable } from '../utils/errors';
import { businessDaysBetween } from '../utils/datetime';
import { assertBudgetAvailable } from './budget.service';
import { findDuplicateArticle } from './validation.service';
import { lockRequest, writeStatusLog } from './request.service';
import { notifyStatusChange } from '../notifications/dispatcher';

/**
 * The four guards from api-endpoints.md section 4, enforced in one place so no
 * approval endpoint can forget one of them.
 *
 *   1. the acting user holds the role that owns the current step
 *   2. the request status matches that step
 *   3. nobody approves a request they filed themselves
 *   4. FACULTY_QA and DEAN must belong to the faculty on the request
 */
export async function assertCanActOnStep(
  user: AuthUser,
  requestId: bigint,
  expectedStepCodes?: string[],
): Promise<{ request: Prisma.RequestGetPayload<Record<string, never>>; step: WorkflowStep }> {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');

  // Guard 2: status must correspond to a live review step.
  const step = stepByStatus(request.status);
  if (!step) {
    throw unprocessable(
      'INVALID_STATE',
      `คำขอนี้อยู่ในสถานะที่ไม่สามารถพิจารณาได้ (${request.status})`,
    );
  }

  if (expectedStepCodes && !expectedStepCodes.includes(step.stepCode)) {
    throw unprocessable('WRONG_STEP', 'คำขอนี้ไม่ได้อยู่ในขั้นตอนที่คุณกำลังดำเนินการ');
  }

  // Guard 3: never approve your own request, at any step.
  if (request.userId === user.id) {
    throw forbidden('ไม่สามารถพิจารณาคำขอของตนเองได้');
  }

  // Guard 1: role must own this step.
  if (!user.roles.includes(step.roleCode)) {
    throw forbidden(`ขั้นตอนนี้สงวนไว้สำหรับ ${step.labelTh}`);
  }

  // Guard 4: faculty-scoped steps stay inside their faculty.
  if (step.facultyScoped) {
    const scopes = user.roleScopes.filter((scope) => scope.roleCode === step.roleCode);
    const universityWide = scopes.some((scope) => scope.facultyId === null);
    const inFaculty = scopes.some((scope) => scope.facultyId === request.facultyId);
    if (!universityWide && !inFaculty) {
      throw forbidden('พิจารณาได้เฉพาะคำขอของคณะที่ท่านสังกัดเท่านั้น');
    }
  }

  return { request, step };
}

/**
 * Writes the signature row for one step.
 *
 * Takes the whole actor rather than an id so the signer's name and position are
 * snapshotted in the same statement as the signature itself (section 19.1): an
 * id alone would let a later rename rewrite who signed.
 */
async function recordApproval(
  tx: Tx,
  params: {
    requestId: bigint;
    step: WorkflowStep;
    actor: AuthUser;
    decision: ApprovalDecision;
    comment?: string | null;
    missingDocuments?: string | null;
    amountApproved?: Prisma.Decimal | number | null;
  },
) {
  const data = {
    approverId: params.actor.id,
    approverName: params.actor.fullName,
    approverPosition: params.actor.academicPosition,
    decision: params.decision,
    comment: params.comment ?? null,
    missingDocuments: params.missingDocuments ?? null,
    amountApproved:
      params.amountApproved === null || params.amountApproved === undefined
        ? null
        : new Prisma.Decimal(params.amountApproved),
    signedAt: new Date(),
  };

  await tx.requestApproval.upsert({
    where: { requestId_stepOrder: { requestId: params.requestId, stepOrder: params.step.order } },
    create: {
      requestId: params.requestId,
      stepOrder: params.step.order,
      stepCode: params.step.stepCode,
      ...data,
    },
    update: data,
  });
}

/** Approve the current step and move the request to the next one. */
export async function approveStep(
  user: AuthUser,
  requestId: bigint,
  input: { comment?: string; qaIndicatorYear?: number },
  ipAddress: string | null,
) {
  const { request, step } = await assertCanActOnStep(user, requestId);

  if (step.stepCode === 'APPROVER') {
    throw unprocessable(
      'USE_FINAL_APPROVE',
      'ขั้นอนุมัติต้องระบุจำนวนเงิน กรุณาใช้เมนูอนุมัติและระบุยอดเงิน',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId, request.status);
    await recordApproval(tx, {
      requestId,
      step,
      actor: user,
      decision: ApprovalDecision.APPROVED,
      comment: input.comment ?? null,
    });

    const nextStep = stepByStatus(step.nextStatus);
    if (nextStep) {
      await tx.requestApproval.upsert({
        where: { requestId_stepOrder: { requestId, stepOrder: nextStep.order } },
        create: {
          requestId,
          stepOrder: nextStep.order,
          stepCode: nextStep.stepCode,
          decision: ApprovalDecision.PENDING,
        },
        update: {},
      });
    }

    const result = await tx.request.update({
      where: { id: requestId },
      data: {
        status: step.nextStatus,
        currentStep: nextStep?.order ?? step.order,
        ...(input.qaIndicatorYear ? { qaIndicatorYear: input.qaIndicatorYear } : {}),
      },
    });

    await writeStatusLog(tx, {
      requestId,
      fromStatus: request.status,
      toStatus: step.nextStatus,
      actor: user,
      note: input.comment ?? `ผ่านขั้นตอน ${step.labelTh}`,
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
    toStatus: updated.status,
    actorName: user.fullName,
    note: input.comment,
  });

  return updated;
}

/**
 * Return the request to the requester for correction. currentStep is left on the
 * returning step so resubmit comes straight back here instead of restarting the
 * whole chain.
 */
export async function returnStep(
  user: AuthUser,
  requestId: bigint,
  input: { missingDocuments: string; comment?: string },
  ipAddress: string | null,
) {
  const { request, step } = await assertCanActOnStep(user, requestId);
  if (!step.canReturn) throw forbidden('ขั้นตอนนี้ไม่สามารถตีกลับได้');

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId, request.status);
    await recordApproval(tx, {
      requestId,
      step,
      actor: user,
      decision: ApprovalDecision.RETURNED,
      comment: input.comment ?? null,
      missingDocuments: input.missingDocuments,
    });

    const result = await tx.request.update({
      where: { id: requestId },
      data: { status: RequestStatus.RETURNED, currentStep: step.order },
    });

    await writeStatusLog(tx, {
      requestId,
      fromStatus: request.status,
      toStatus: RequestStatus.RETURNED,
      actor: user,
      note: `ตีกลับจากขั้น ${step.labelTh}: ${input.missingDocuments}`,
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
    toStatus: RequestStatus.RETURNED,
    actorName: user.fullName,
    note: input.missingDocuments,
  });

  return updated;
}

/** Final rejection. Only APPROVER may close a request this way. */
export async function rejectRequest(
  user: AuthUser,
  requestId: bigint,
  comment: string,
  ipAddress: string | null,
) {
  const { request, step } = await assertCanActOnStep(user, requestId, ['APPROVER']);

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId, request.status);
    await recordApproval(tx, {
      requestId,
      step,
      actor: user,
      decision: ApprovalDecision.REJECTED,
      comment,
    });

    const result = await tx.request.update({
      where: { id: requestId },
      data: { status: RequestStatus.REJECTED, closedAt: new Date() },
    });

    await writeStatusLog(tx, {
      requestId,
      fromStatus: request.status,
      toStatus: RequestStatus.REJECTED,
      actor: user,
      note: comment,
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
    toStatus: RequestStatus.REJECTED,
    actorName: user.fullName,
    note: comment,
  });

  return updated;
}

/**
 * Transaction 1 of 2 (api-endpoints.md): write the approval row, set the status
 * and approved amount, allocate the sequence number, write the log, and re-check
 * the remaining balance. If the budget is short, everything rolls back.
 *
 * The approved amount may legitimately be lower than the amount requested - the
 * announcement says "not exceeding" - which is why the two are separate columns.
 */
export async function finalApprove(
  user: AuthUser,
  requestId: bigint,
  input: { amountApproved: number; comment?: string },
  ipAddress: string | null,
) {
  const { request, step } = await assertCanActOnStep(user, requestId, ['APPROVER']);

  if (input.amountApproved > Number(request.amountRequested)) {
    throw unprocessable(
      'AMOUNT_ABOVE_REQUESTED',
      'จำนวนเงินที่อนุมัติต้องไม่เกินจำนวนที่ขอตามอัตราในประกาศ',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId, request.status);
    // Re-read the balance inside the transaction: two approvers working at the
    // same time must not both spend the last of the budget.
    await assertBudgetAvailable(request.budgetYearId, input.amountApproved, tx);

    // Rules 3 and 4 are checked again here, not only at submit. Between the two
    // moments another of this person's requests may have been approved, or the
    // same article approved on a different request - the submit gate cannot see
    // a future it has not happened yet.
    // Counted on the entitlement year stamped at submission, not on the year
    // the article was published: a December article filed in the January grace
    // window draws on the new year's slots (config/workflow.ts). Legacy rows
    // filed before the column existed fall back to the publication year, which
    // was the same thing under the old rule.
    const entitlementYear = request.entitlementYear ?? request.calendarYear;

    const alreadyUsed = await tx.request.count({
      where: {
        userId: request.userId,
        entitlementYear,
        status: { in: ENTITLEMENT_STATUSES },
      },
    });
    if (alreadyUsed >= MAX_ARTICLES_PER_CALENDAR_YEAR) {
      throw unprocessable(
        'QUOTA_EXCEEDED',
        `ผู้ขอใช้สิทธิ์ปี ${entitlementYear} ครบ ${MAX_ARTICLES_PER_CALENDAR_YEAR} เรื่องแล้ว ` +
          'จึงอนุมัติคำขอนี้เพิ่มไม่ได้',
      );
    }

    const duplicate = await findDuplicateArticle(request, DUPLICATE_BLOCKING_STATUSES, tx);
    if (duplicate) {
      throw unprocessable(
        'DUPLICATE_ARTICLE',
        `บทความนี้ได้รับค่าตอบแทนไปแล้วในคำขอเลขที่ ${duplicate.requestNo} จึงอนุมัติซ้ำไม่ได้`,
      );
    }

    await recordApproval(tx, {
      requestId,
      step,
      actor: user,
      decision: ApprovalDecision.APPROVED,
      comment: input.comment ?? null,
      amountApproved: input.amountApproved,
    });

    // The entitlement sequence is allocated at approval, not at submission, so a
    // rejected request never burns one of the three yearly slots.
    //
    // Taken from the highest number already handed out rather than from a count
    // of live ones: a refunded request keeps the number printed on its paperwork
    // even though it no longer consumes a slot, and counting would hand the same
    // number to the next approval.
    const highest = await tx.request.aggregate({
      where: { userId: request.userId, entitlementYear },
      _max: { sequenceInYear: true },
    });

    const result = await tx.request.update({
      where: { id: requestId },
      data: {
        status: RequestStatus.APPROVED,
        amountApproved: new Prisma.Decimal(input.amountApproved),
        sequenceInYear: (highest._max.sequenceInYear ?? 0) + 1,
        approvedAt: new Date(),
      },
    });

    await writeStatusLog(tx, {
      requestId,
      fromStatus: request.status,
      toStatus: RequestStatus.APPROVED,
      actor: user,
      note:
        `อนุมัติจำนวน ${input.amountApproved.toLocaleString('th-TH')} บาท` +
        (input.comment ? ` - ${input.comment}` : ''),
      ipAddress,
    });

    return result;
  });

  // Notifications are sent only after the transaction has committed.
  await notifyStatusChange({
    requestId: updated.id,
    requestNo: updated.requestNo,
    articleTitle: updated.articleTitle,
    ownerId: updated.userId,
    facultyId: updated.facultyId,
    toStatus: RequestStatus.APPROVED,
    actorName: user.fullName,
    note: `จำนวนเงินที่อนุมัติ ${input.amountApproved.toLocaleString('th-TH')} บาท`,
  });

  return updated;
}

/** RDI may divert a borderline case to the research committee. */
export async function sendToCommittee(
  user: AuthUser,
  requestId: bigint,
  comment: string,
  ipAddress: string | null,
) {
  const { request, step } = await assertCanActOnStep(user, requestId, ['RDI']);

  const updated = await prisma.$transaction(async (tx) => {
    await lockRequest(tx, requestId, request.status);
    await recordApproval(tx, {
      requestId,
      step,
      actor: user,
      decision: ApprovalDecision.APPROVED,
      comment: `ส่งเข้าคณะกรรมการ: ${comment}`,
    });

    await tx.requestApproval.upsert({
      where: { requestId_stepOrder: { requestId, stepOrder: COMMITTEE_STEP.order } },
      create: {
        requestId,
        stepOrder: COMMITTEE_STEP.order,
        stepCode: COMMITTEE_STEP.stepCode,
        decision: ApprovalDecision.PENDING,
      },
      update: { decision: ApprovalDecision.PENDING },
    });

    const result = await tx.request.update({
      where: { id: requestId },
      data: { status: RequestStatus.COMMITTEE_REVIEW, currentStep: COMMITTEE_STEP.order },
    });

    await writeStatusLog(tx, {
      requestId,
      fromStatus: request.status,
      toStatus: RequestStatus.COMMITTEE_REVIEW,
      actor: user,
      note: comment,
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
    toStatus: RequestStatus.COMMITTEE_REVIEW,
    actorName: user.fullName,
    note: comment,
  });

  return updated;
}

export async function setQaIndicatorYear(
  user: AuthUser,
  requestId: bigint,
  qaIndicatorYear: number,
) {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) throw notFound('ไม่พบคำขอที่ระบุ');

  // A draft is the owner's private working copy and no reviewer has seen it yet,
  // so there is nothing to record an indicator year against.
  if (request.status === RequestStatus.DRAFT) {
    throw unprocessable(
      'REQUEST_NOT_SUBMITTED',
      'บันทึกปีตัวชี้วัดได้เฉพาะคำขอที่ยื่นแล้วเท่านั้น',
    );
  }

  // The route admits FACULTY_QA and ADMIN. ADMIN used to pass the route and then
  // be refused here on every request, because only FACULTY_QA scopes were read.
  const scopes = user.roleScopes.filter((scope) => scope.roleCode === 'FACULTY_QA');
  const allowed =
    user.roles.includes('ADMIN') ||
    scopes.some((scope) => scope.facultyId === null) ||
    scopes.some((scope) => scope.facultyId === request.facultyId);
  if (!allowed) throw forbidden('บันทึกได้เฉพาะคำขอของคณะที่ท่านรับผิดชอบ');

  return prisma.request.update({ where: { id: requestId }, data: { qaIndicatorYear } });
}

/**
 * The work queue of the caller: every request currently sitting on a step that
 * one of their roles owns, oldest first, with the number of business days it has
 * been waiting so the ones about to breach the 5-day reminder float to the top.
 */
export async function getInbox(user: AuthUser) {
  const where = inboxFilter(user);
  if (!where) return [];

  const requests = await prisma.request.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    include: {
      owner: { select: { id: true, prefix: true, firstName: true, lastName: true } },
      faculty: { select: { id: true, nameTh: true } },
      journalTier: { select: { id: true, code: true, nameTh: true } },
    },
  });

  const now = new Date();
  return requests.map((request) => ({
    ...request,
    waitingBusinessDays: businessDaysBetween(request.updatedAt, now),
    stepLabel: stepByStatus(request.status)?.labelTh ?? '',
  }));
}

export async function getInboxCount(user: AuthUser): Promise<number> {
  const where = inboxFilter(user);
  if (!where) return 0;
  return prisma.request.count({ where });
}

function inboxFilter(user: AuthUser): Prisma.RequestWhereInput | null {
  const clauses: Prisma.RequestWhereInput[] = [];

  for (const scope of user.roleScopes) {
    const steps = [...stepsForRole(scope.roleCode)];
    for (const step of steps) {
      clauses.push({
        status: step.status,
        // Guard 3 again, at query level: own requests never appear in the queue.
        userId: { not: user.id },
        ...(step.facultyScoped && scope.facultyId !== null
          ? { facultyId: scope.facultyId }
          : {}),
      });
    }
  }

  if (clauses.length === 0) return null;
  return { OR: clauses };
}

function stepsForRole(roleCode: string): WorkflowStep[] {
  return [...WORKFLOW_STEPS, COMMITTEE_STEP].filter((step) => step.roleCode === roleCode);
}
