export type RequestStatus =
  | 'DRAFT'
  | 'FACULTY_REVIEW'
  | 'DEAN_REVIEW'
  | 'RDI_REVIEW'
  | 'RETURNED'
  | 'ACADEMIC_OFFICE_REVIEW'
  | 'COMMITTEE_REVIEW'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAID'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REVOKED';

export type RoleCode =
  | 'RESEARCHER'
  | 'FACULTY_QA'
  | 'DEAN'
  | 'RDI_OFFICER'
  | 'ACADEMIC_OFFICE'
  | 'APPROVER'
  | 'FINANCE'
  | 'ADMIN';

export type DocType = 'ACCEPTANCE_LETTER' | 'ARTICLE_COPY' | 'DATABASE_PROOF' | 'ADDITIONAL';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  departmentId: string | null;
  facultyId: string | null;
  mustChangePassword: boolean;
  roles: RoleCode[];
  roleScopes: { roleCode: RoleCode; facultyId: string | null }[];
}

export interface Quota {
  calendarYear: number;
  limit: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface Faculty {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
}

export interface Department {
  id: string;
  facultyId: string;
  code: string;
  nameTh: string;
}

export interface JournalTier {
  id: string;
  code: string;
  nameTh: string;
  databaseName: string;
  quartile: string | null;
  rateNormal: number;
  rateConference: number;
  announcementRef: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface PersonRef {
  id: string;
  prefix?: string | null;
  firstName: string;
  lastName: string;
  academicPosition?: string | null;
  email?: string;
  phoneMobile?: string | null;
  phoneInternal?: string | null;
  department?: { id: string; nameTh: string; faculty: { id: string; nameTh: string } } | null;
}

export interface Attachment {
  id: string;
  requestId: string;
  docType: DocType;
  fileName: string;
  mimeType: string;
  fileSize: number;
  isVerified: boolean;
  verifiedAt: string | null;
  verifier?: PersonRef | null;
  createdAt: string;
}

export interface Approval {
  id: string;
  stepOrder: number;
  stepCode: string;
  decision: 'PENDING' | 'APPROVED' | 'RETURNED' | 'REJECTED';
  comment: string | null;
  missingDocuments: string | null;
  amountApproved: number | null;
  signedAt: string | null;
  approver: PersonRef | null;
  /**
   * Name and position as they stood when the step was signed. Prefer these over
   * `approver`, which is the account as it stands today: an account gets renamed
   * and a position account changes hands, and neither may rewrite a signature
   * (CLAUDE.md section 19.1). Null on a pending step and on rows written before
   * the snapshot existed.
   */
  approverName: string | null;
  approverPosition: string | null;
}

export interface Payment {
  id: string;
  requestId: string;
  voucherNo: string | null;
  amount: number;
  paidAt: string | null;
  isRefunded: boolean;
  refundAmount: number | null;
  refundReason: string | null;
  refundedAt: string | null;
  note: string | null;
}

/**
 * How much of a listed request the current user may see.
 *
 * SUMMARY is a colleague's claim from the same unit: it appears in the list so
 * the unit can follow its own paperwork, but the amounts arrive as null and the
 * detail page refuses to open it.
 */
export type ViewScope = 'OWNER' | 'FULL' | 'SUMMARY';

export interface RequestSummary {
  id: string;
  requestNo: string;
  articleTitle: string;
  journalName: string;
  status: RequestStatus;
  calendarYear: number;
  // The year the claim was filed, which is the year its entitlement is counted
  // against - not calendarYear, which is the year the article was published.
  // The two differ for a December article filed in the January grace window.
  entitlementYear: number | null;
  viewScope?: ViewScope;
  amountRequested: number | null;
  amountApproved: number | null;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  sequenceInYear: number | null;
  owner: PersonRef;
  faculty: { id: string; nameTh: string };
  journalTier: { id: string; code: string; nameTh: string };
  waitingBusinessDays?: number;
  stepLabel?: string;
}

export interface RequestDetail extends RequestSummary {
  // The detail endpoint only answers for requests the caller may open in full,
  // so the amount is never redacted here.
  amountRequested: number;
  userId: string;
  facultyId: string;
  departmentId: string;
  /**
   * The department name as it stood when the request was filed - a snapshot,
   * like facultyId. The owner account may carry none, because the field is free
   * text at registration and only an admin links a departments row later.
   */
  departmentName: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  issn: string | null;
  /** e-ISSN. The receipt voucher prints it beside the printed ISSN. */
  issnElectronic: string | null;
  /** Coverage as the journal prints it, e.g. "พฤษภาคม-สิงหาคม 2569". Display only. */
  issuePeriod: string | null;
  doi: string | null;
  articleUrl: string | null;
  fromConference: boolean;
  currentStep: number;
  qaIndicatorYear: number | null;
  certNotOnStudyLeave: boolean;
  certNotThesisPart: boolean;
  certNotDuplicate: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  journalTier: JournalTier;
  budgetYear: { id: string; year: number };
  attachments: Attachment[];
  approvals: Approval[];
  payment: Payment | null;
}

export interface TimelineEntry {
  id: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus;
  note: string | null;
  createdAt: string;
  actor: PersonRef | null;
}

export interface BudgetSummary {
  year: number;
  budgetYearId: string;
  total: number;
  reserved: number;
  paid: number;
  available: number;
  // The fiscal year today falls in (1 Oct - 30 Sep), worked out by the server
  // so it does not depend on the clock of whoever opened the page.
  fiscalYearNow: number;
  // The open year is not the year today belongs to - new claims are being
  // numbered and charged against the wrong one, silently.
  isStale: boolean;
}

export interface BudgetYear extends BudgetSummary {
  id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note: string | null;
}

/** One line of the change history of a fund year, newest first. */
export interface BudgetYearLog {
  id: string;
  action: 'CREATE' | 'UPDATE';
  // The name as it stood when the change was made, not the account's name now.
  actorName: string;
  previousAmount: number | null;
  newAmount: number | null;
  previousIsActive: boolean | null;
  newIsActive: boolean | null;
  reason: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type StaffTrack = 'ACADEMIC' | 'SUPPORT';
export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A self-registered account as the admin review screen sees it. */
export interface Registration {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneMobile: string | null;
  staffTrack: StaffTrack | null;
  registrationStatus: RegistrationStatus;
  registrationNote: string | null;
  registrationReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  faculty: { id: string; code: string; nameTh: string } | null;
  /** Typed by the applicant, not a departments row. */
  departmentName: string | null;
  department: { id: string; nameTh: string } | null;
  registrationReviewer: PersonRef | null;
}

export interface ReviewerGap {
  facultyId: string;
  facultyName: string;
  missingFacultyQa: boolean;
  missingDean: boolean;
}

export interface UserRow {
  id: string;
  username: string;
  email: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  academicPosition: string | null;
  phoneMobile: string | null;
  phoneInternal: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  staffTrack: StaffTrack | null;
  registrationStatus: RegistrationStatus | null;
  departmentName: string | null;
  faculty: { id: string; nameTh: string } | null;
  department: { id: string; nameTh: string; faculty: { id: string; nameTh: string } } | null;
  userRoles: { id: string; facultyId: string | null; role: { id: string; code: RoleCode; nameTh: string } }[];
}

// --- บัญชีประจำตำแหน่ง (CLAUDE.md ข้อ 19) -------------------------------

/** One holder of one signing post, as GET /positions returns them. */
export interface PositionHolder {
  id: string;
  username: string;
  email: string;
  prefix: string | null;
  firstName: string;
  lastName: string;
  holderName: string;
  academicPosition: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  lastHandoverAt: string | null;
  facultyIds: (string | null)[];
  facultyNames: string[];
  /** Also files claims of its own, so its history would follow the post. */
  holdsResearcher: boolean;
  /** Claims it has actually filed; drafts do not count. */
  ownClaims: number;
  /** Holds ADMIN too, so handover refuses it and the buttons are hidden. */
  isAdminAccount: boolean;
  /** Claims waiting on this holder right now; null where the step has no queue. */
  waitingCount: number | null;
}

export interface PositionStep {
  order: number;
  roleCode: RoleCode;
  labelTh: string;
  facultyScoped: boolean;
  waitingCount: number | null;
  holders: PositionHolder[];
  /** Holders who can still sign. Zero means the step is stalled. */
  activeHolders: number;
  /** Units with nobody to sign for them: claims filed there stop for good. */
  unitsWithoutHolder: { id: string; nameTh: string }[];
}

export type PositionAccountAction = 'HANDOVER' | 'PASSWORD_RESET';

export interface PositionHandoverLog {
  id: string;
  action: PositionAccountAction;
  actorName: string;
  previousHolder: string;
  newHolder: string;
  previousPosition: string | null;
  newPosition: string | null;
  rolesSnapshot: string;
  reason: string;
  ipAddress: string | null;
  createdAt: string;
}

/** Both handover calls answer with the one-time password, once. */
export interface PositionHandoverResult {
  account: { id: string; username: string; holderName?: string };
  tempPassword: string;
}
