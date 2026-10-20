import { ApprovalStepCode, RequestStatus } from '@prisma/client';

import { calendarMonthOf, calendarYearOf } from '../utils/datetime';

/**
 * Single source of truth for the approval chain, mirroring section 5 of CLAUDE.md:
 *
 *   FACULTY_REVIEW -> DEAN_REVIEW -> RDI_REVIEW -> ACADEMIC_OFFICE_REVIEW
 *   -> PENDING_APPROVAL -> APPROVED -> PAID
 *
 * Every guard in the approval endpoints is derived from this table, so the chain
 * is changed here and nowhere else.
 */
export interface WorkflowStep {
  order: number;
  stepCode: ApprovalStepCode;
  /** Status a request carries while it is waiting on this step. */
  status: RequestStatus;
  /** Role code allowed to act on this step. */
  roleCode: string;
  /** Status the request moves to when this step approves. */
  nextStatus: RequestStatus;
  labelTh: string;
  /** Reviewer must belong to the same faculty as request.faculty_id. */
  facultyScoped: boolean;
  /** Step may send the request back to the requester. */
  canReturn: boolean;
}

export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    order: 1,
    stepCode: ApprovalStepCode.FACULTY_QA,
    status: RequestStatus.FACULTY_REVIEW,
    roleCode: 'FACULTY_QA',
    nextStatus: RequestStatus.DEAN_REVIEW,
    labelTh: 'ตรวจสอบระดับคณะ (ประกันคุณภาพ)',
    facultyScoped: true,
    canReturn: true,
  },
  {
    order: 2,
    stepCode: ApprovalStepCode.DEAN,
    status: RequestStatus.DEAN_REVIEW,
    roleCode: 'DEAN',
    nextStatus: RequestStatus.RDI_REVIEW,
    labelTh: 'คณบดีเห็นชอบ',
    facultyScoped: true,
    canReturn: true,
  },
  {
    order: 3,
    stepCode: ApprovalStepCode.RDI,
    status: RequestStatus.RDI_REVIEW,
    roleCode: 'RDI_OFFICER',
    nextStatus: RequestStatus.ACADEMIC_OFFICE_REVIEW,
    labelTh: 'สถาบันวิจัยและพัฒนาตรวจสอบหลักฐาน',
    facultyScoped: false,
    canReturn: true,
  },
  {
    order: 4,
    stepCode: ApprovalStepCode.ACADEMIC_OFFICE,
    status: RequestStatus.ACADEMIC_OFFICE_REVIEW,
    roleCode: 'ACADEMIC_OFFICE',
    nextStatus: RequestStatus.PENDING_APPROVAL,
    labelTh: 'สำนักส่งเสริมวิชาการฯ ให้ความเห็น',
    facultyScoped: false,
    canReturn: true,
  },
  {
    order: 5,
    stepCode: ApprovalStepCode.APPROVER,
    status: RequestStatus.PENDING_APPROVAL,
    roleCode: 'APPROVER',
    nextStatus: RequestStatus.APPROVED,
    labelTh: 'รองอธิการบดีฝ่ายวิชาการ วิจัย และนวัตกรรม อนุมัติ',
    facultyScoped: false,
    canReturn: true,
  },
] as const;

/** Committee review sits beside the chain: RDI can divert to it and it returns to RDI. */
export const COMMITTEE_STEP: WorkflowStep = {
  order: 99,
  stepCode: ApprovalStepCode.COMMITTEE,
  status: RequestStatus.COMMITTEE_REVIEW,
  roleCode: 'RDI_OFFICER',
  nextStatus: RequestStatus.ACADEMIC_OFFICE_REVIEW,
  labelTh: 'คณะกรรมการบริหารจัดการงานวิจัยพิจารณา',
  facultyScoped: false,
  canReturn: true,
};

export const FIRST_STEP = WORKFLOW_STEPS[0]!;

export function stepByStatus(status: RequestStatus): WorkflowStep | undefined {
  if (status === RequestStatus.COMMITTEE_REVIEW) return COMMITTEE_STEP;
  return WORKFLOW_STEPS.find((step) => step.status === status);
}

/**
 * Looks a step up by its stored code. Used where a row in request_approvals is
 * turned back into something a reader understands - the printed memo prints the
 * Thai label, never the enum code.
 */
export function stepByCode(stepCode: ApprovalStepCode): WorkflowStep | undefined {
  if (stepCode === COMMITTEE_STEP.stepCode) return COMMITTEE_STEP;
  return WORKFLOW_STEPS.find((step) => step.stepCode === stepCode);
}

export function stepByOrder(order: number): WorkflowStep | undefined {
  if (order === COMMITTEE_STEP.order) return COMMITTEE_STEP;
  return WORKFLOW_STEPS.find((step) => step.order === order);
}

export function stepByRole(roleCode: string): WorkflowStep[] {
  return WORKFLOW_STEPS.filter((step) => step.roleCode === roleCode);
}

/** Statuses a request can sit in while it is still moving through review. */
export const IN_FLIGHT_STATUSES: RequestStatus[] = [
  RequestStatus.FACULTY_REVIEW,
  RequestStatus.DEAN_REVIEW,
  RequestStatus.RDI_REVIEW,
  RequestStatus.ACADEMIC_OFFICE_REVIEW,
  RequestStatus.COMMITTEE_REVIEW,
  RequestStatus.PENDING_APPROVAL,
  RequestStatus.RETURNED,
];

/**
 * Statuses that consume one of the three yearly entitlements (ประกาศ 2131/2566 ข้อ 3),
 * and that count as money actually granted in the reports.
 *
 * REFUNDED is deliberately absent. The entitlement tracks compensation actually
 * received, and a full clawback leaves the claimant with nothing - the same net
 * result as a rejection, which section 8 of CLAUDE.md already says must not burn
 * a slot. The article itself stays blocked; see DUPLICATE_BLOCKING_STATUSES.
 */
export const ENTITLEMENT_STATUSES: RequestStatus[] = [
  RequestStatus.APPROVED,
  RequestStatus.PAID,
];

/**
 * Statuses that make an article un-claimable again (ประกาศ 2131/2566 ข้อ 4).
 *
 * Wider than the entitlement set on purpose: an article whose payment was clawed
 * back must not simply be filed again the next day, or the refund would mean
 * nothing. Wider still at submit time - see ACTIVE_CLAIM_STATUSES.
 */
export const DUPLICATE_BLOCKING_STATUSES: RequestStatus[] = [
  RequestStatus.APPROVED,
  RequestStatus.PAID,
  RequestStatus.REFUNDED,
];

/**
 * Every request that still has a claim on an article: settled, or on its way
 * through review. Used by the submit gate, so the same article cannot be filed
 * twice and walked through the chain in parallel - both copies would pass a
 * settled-only check and both could be approved.
 */
export const ACTIVE_CLAIM_STATUSES: RequestStatus[] = [
  ...DUPLICATE_BLOCKING_STATUSES,
  ...IN_FLIGHT_STATUSES,
];

/** Requester may still edit in these statuses. */
export const EDITABLE_STATUSES: RequestStatus[] = [RequestStatus.DRAFT, RequestStatus.RETURNED];

/**
 * Rule 5: the requester may cancel only before the request reaches final approval.
 */
export const CANCELLABLE_STATUSES: RequestStatus[] = [
  RequestStatus.DRAFT,
  RequestStatus.FACULTY_REVIEW,
  RequestStatus.DEAN_REVIEW,
  RequestStatus.RDI_REVIEW,
  RequestStatus.ACADEMIC_OFFICE_REVIEW,
  RequestStatus.COMMITTEE_REVIEW,
  RequestStatus.RETURNED,
];

export const STATUS_LABELS_TH: Record<RequestStatus, string> = {
  DRAFT: 'ร่าง',
  FACULTY_REVIEW: 'รอคณะตรวจสอบ',
  DEAN_REVIEW: 'รอคณบดีเห็นชอบ',
  RDI_REVIEW: 'รอสถาบันวิจัยตรวจสอบ',
  RETURNED: 'ตีกลับให้แก้ไข',
  ACADEMIC_OFFICE_REVIEW: 'รอสำนักส่งเสริมวิชาการฯ',
  COMMITTEE_REVIEW: 'รอคณะกรรมการบริหารจัดการงานวิจัย',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  // The system never moves money. This step only records that the bursar paid,
  // so the label says so rather than implying the system did it.
  PAID: 'บันทึกการเบิกจ่ายแล้ว',
  CANCELLED: 'ยกเลิก',
  REFUNDED: 'เรียกเงินคืน',
};

export const ROLE_LABELS_TH: Record<string, string> = {
  RESEARCHER: 'ผู้ขอรับค่าตอบแทน',
  FACULTY_QA: 'เจ้าหน้าที่ประกันคุณภาพระดับคณะ',
  DEAN: 'คณบดี',
  RDI_OFFICER: 'เจ้าหน้าที่สถาบันวิจัยและพัฒนา',
  ACADEMIC_OFFICE: 'ผู้อำนวยการสำนักส่งเสริมวิชาการฯ',
  APPROVER: 'รองอธิการบดีฝ่ายวิชาการ วิจัย และนวัตกรรม',
  FINANCE: 'งานการเงิน / กองคลัง',
  ADMIN: 'ผู้ดูแลระบบ',
};

/** Maximum reimbursable articles per calendar year (ประกาศ 2131/2566 ข้อ 3). */
export const MAX_ARTICLES_PER_CALENDAR_YEAR = 3;

/**
 * Rule 8 and its grace window (confirmed by the owner's mentor, 3 Oct 2026).
 *
 * An article is normally claimed in the calendar year it was published in. The
 * quota is counted per calendar year rather than per fiscal year because that is
 * how journals date their issues: the last issue of a year is dated December and
 * the volume closes on 31 December.
 *
 * That same practice is what makes the deadline unfair at the edge - an article
 * dated December leaves only days to file - so a December article may still be
 * filed until 31 January of the following year. A claim filed in that window
 * draws on the NEW year's three slots, not on the year of publication:
 *
 *   2 articles claimed in 2026, a third published 31 Dec 2026 and filed in
 *   January 2027 -> that third one spends a 2027 slot, leaving 2 for 2027.
 *
 * Which is why the entitlement year is the year the claim is FILED in, never the
 * year of publication. Those two differ only inside the grace window.
 */
const GRACE_PUBLISH_MONTH = 12;
const GRACE_DEADLINE_MONTH = 1;

/** The calendar year whose three slots a claim filed at `filedAt` draws on. */
export function entitlementYearOf(filedAt: Date): number {
  return calendarYearOf(filedAt);
}

/** Rule 8: may an article published at `publishedAt` be filed at `filedAt`? */
export function isWithinClaimWindow(publishedAt: Date, filedAt: Date): boolean {
  const publishedYear = calendarYearOf(publishedAt);
  const filedYear = calendarYearOf(filedAt);

  if (filedYear === publishedYear) return true;

  return (
    filedYear === publishedYear + 1 &&
    calendarMonthOf(publishedAt) === GRACE_PUBLISH_MONTH &&
    calendarMonthOf(filedAt) === GRACE_DEADLINE_MONTH
  );
}

/**
 * ค.ศ. 2023 = พ.ศ. 2566, the year ประกาศ 2131/2566 took effect. Nothing
 * published before it can be claimed under these rules, so nothing older has
 * any business being typed into the form either. The same floor is used by the
 * year filter on the web (web/src/lib/years.ts).
 */
export const FIRST_CLAIMABLE_YEAR = 2023;

/**
 * Is this a publication date a person could plausibly be filing for?
 *
 * Only a sanity bound on what gets stored - the rule that decides whether a
 * claim may be FILED is isWithinClaimWindow above, and this must never
 * contradict it. The ceiling is next year, not this year, for two reasons: a
 * journal may date its December issue to the coming year, and an article
 * published in December is filed in January of the following year under the
 * grace window the office granted (CLAUDE.md ข้อ 6). Filing that January claim
 * asks about a publication year one BELOW the current year, so the window
 * stays open either way.
 *
 * Added 18 ต.ค. 2569 after a draft was saved with a publication date in 2099,
 * which the submit gate refused but which sat in the table with calendar_year
 * 2099 and showed up nowhere anyone could find it.
 */
export function isPlausiblePublicationYear(publishedAt: Date, now: Date = new Date()): boolean {
  const year = calendarYearOf(publishedAt);
  return year >= FIRST_CLAIMABLE_YEAR && year <= calendarYearOf(now) + 1;
}

export const REQUIRED_DOC_TYPES = [
  'ACCEPTANCE_LETTER',
  'ARTICLE_COPY',
  'DATABASE_PROOF',
] as const;

/**
 * The posts a claim passes through, in the order it meets them.
 *
 * Accounts for these belong to the post rather than to the person holding it:
 * terms end about every four years and the account is handed on, because the
 * claims waiting at a step are found by role and unit, so replacing the account
 * would strand them (CLAUDE.md ข้อ 19). This list is what the handover screen
 * is built from, so a change to the chain above reaches it without edits here.
 */
export interface PositionRole {
  order: number;
  roleCode: string;
  /** The step label as it reads on the form and in the progress bar. */
  labelTh: string;
  /** Authority limited to one unit, so every unit has its own holder. */
  facultyScoped: boolean;
  /** Claims in this status are waiting on this post. Null means no queue. */
  waitingStatus: RequestStatus | null;
}

export const POSITION_ROLES: readonly PositionRole[] = [
  ...WORKFLOW_STEPS.map((step) => ({
    order: step.order,
    roleCode: step.roleCode,
    labelTh: step.labelTh,
    facultyScoped: step.facultyScoped,
    waitingStatus: step.status,
  })),
  {
    // Last because it comes after the chain ends, and marked as optional
    // because nobody is required to record a payment (ข้อ 18.3) - but the
    // account still signs for refunds under ประกาศ ข้อ ๕(๖), so it is handed on
    // the same way.
    order: WORKFLOW_STEPS.length + 1,
    roleCode: 'FINANCE',
    labelTh: 'บันทึกผลการเบิกจ่าย (ไม่ใช่ขั้นบังคับ)',
    facultyScoped: false,
    waitingStatus: null,
  },
];

/** Role codes that make an account a position account, for guarding handover. */
export const POSITION_ROLE_CODES: readonly string[] = POSITION_ROLES.map((role) => role.roleCode);

export function isPositionRole(roleCode: string): boolean {
  return POSITION_ROLE_CODES.includes(roleCode);
}
