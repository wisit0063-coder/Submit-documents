import { ApprovalStepCode, RequestStatus } from '@prisma/client';

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
    labelTh: 'รองอธิการบดีฝ่ายวิจัยฯ อนุมัติ',
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
  PAID: 'จ่ายแล้ว',
  CANCELLED: 'ยกเลิก',
  REFUNDED: 'เรียกเงินคืน',
};

export const ROLE_LABELS_TH: Record<string, string> = {
  RESEARCHER: 'ผู้ขอรับค่าตอบแทน',
  FACULTY_QA: 'เจ้าหน้าที่ประกันคุณภาพระดับคณะ',
  DEAN: 'คณบดี',
  RDI_OFFICER: 'เจ้าหน้าที่สถาบันวิจัยและพัฒนา',
  ACADEMIC_OFFICE: 'ผู้อำนวยการสำนักส่งเสริมวิชาการฯ',
  APPROVER: 'รองอธิการบดีฝ่ายวิจัยฯ',
  FINANCE: 'งานการเงิน / กองคลัง',
  ADMIN: 'ผู้ดูแลระบบ',
};

/** Maximum reimbursable articles per calendar year (ประกาศ 2131/2566 ข้อ 3). */
export const MAX_ARTICLES_PER_CALENDAR_YEAR = 3;

export const REQUIRED_DOC_TYPES = [
  'ACCEPTANCE_LETTER',
  'ARTICLE_COPY',
  'DATABASE_PROOF',
] as const;
