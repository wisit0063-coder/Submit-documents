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
  | 'REFUNDED';

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
  volume: string | null;
  issue: string | null;
  pages: string | null;
  issn: string | null;
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
}

export interface BudgetYear extends BudgetSummary {
  id: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  note: string | null;
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
