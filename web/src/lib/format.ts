import type { RequestStatus, RoleCode, DocType } from '@/types';

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** Dates arrive as UTC ISO strings and are shown in Bangkok time, Buddhist era. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return `${local.getUTCDate()} ${THAI_MONTHS_SHORT[local.getUTCMonth()]} ${local.getUTCFullYear() + 543}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '-';
  const local = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  return `${formatDate(value)} ${time} น.`;
}

/** Value for a native <input type="date">, which expects yyyy-mm-dd. */
export function toDateInput(value: string | null | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

export function formatMoney(value: number | null | undefined, withUnit = true): string {
  if (value === null || value === undefined) return '-';
  const formatted = value.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withUnit ? `${formatted} บาท` : formatted;
}

export function formatCompactMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} ล้าน`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toLocaleString('th-TH');
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The name to print against a signature: the snapshot taken when the step was
 * signed, and only for rows older than that column the account as it stands now
 * (CLAUDE.md section 19.1). Never compose this from the account directly - a
 * rename, or a position account changing hands, would rewrite who signed.
 */
export function signerName(approval: {
  approverName?: string | null;
  approver?: { prefix?: string | null; firstName: string; lastName: string } | null;
}): string {
  return approval.approverName?.trim() || personName(approval.approver);
}

export function personName(person: {
  prefix?: string | null;
  firstName: string;
  lastName: string;
} | null | undefined): string {
  if (!person) return '-';
  return `${person.prefix ?? ''}${person.firstName} ${person.lastName}`.trim();
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: 'ร่าง',
  FACULTY_REVIEW: 'รอคณะตรวจสอบ',
  DEAN_REVIEW: 'รอคณบดีเห็นชอบ',
  RDI_REVIEW: 'รอสถาบันวิจัยตรวจสอบ',
  RETURNED: 'ตีกลับให้แก้ไข',
  ACADEMIC_OFFICE_REVIEW: 'รอสำนักส่งเสริมวิชาการฯ',
  COMMITTEE_REVIEW: 'รอคณะกรรมการ',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ไม่อนุมัติ',
  PAID: 'บันทึกการเบิกจ่ายแล้ว',
  CANCELLED: 'ยกเลิก',
  REFUNDED: 'เรียกเงินคืน',
};

/** Colour carries meaning here, so each status also keeps its text label. */
export const STATUS_TONE: Record<RequestStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  FACULTY_REVIEW: 'bg-sky-50 text-sky-700 ring-sky-200',
  DEAN_REVIEW: 'bg-sky-50 text-sky-700 ring-sky-200',
  RDI_REVIEW: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  RETURNED: 'bg-amber-50 text-amber-800 ring-amber-200',
  ACADEMIC_OFFICE_REVIEW: 'bg-violet-50 text-violet-700 ring-violet-200',
  COMMITTEE_REVIEW: 'bg-purple-50 text-purple-700 ring-purple-200',
  PENDING_APPROVAL: 'bg-blue-50 text-blue-700 ring-blue-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
  PAID: 'bg-teal-50 text-teal-800 ring-teal-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  REFUNDED: 'bg-orange-50 text-orange-800 ring-orange-200',
};

export const ROLE_LABELS: Record<RoleCode, string> = {
  RESEARCHER: 'ผู้ขอรับค่าตอบแทน',
  FACULTY_QA: 'ประกันคุณภาพคณะ',
  DEAN: 'คณบดี',
  RDI_OFFICER: 'เจ้าหน้าที่สถาบันวิจัยฯ',
  ACADEMIC_OFFICE: 'สำนักส่งเสริมวิชาการฯ',
  APPROVER: 'รองอธิการบดีฝ่ายวิชาการ วิจัย และนวัตกรรม',
  FINANCE: 'การเงิน',
  ADMIN: 'ผู้ดูแลระบบ',
};

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  ACCEPTANCE_LETTER: 'หนังสือตอบรับการตีพิมพ์',
  ARTICLE_COPY: 'สำเนาบทความฉบับเต็ม',
  DATABASE_PROOF: 'หลักฐานแสดงฐานข้อมูลวารสาร',
  ADDITIONAL: 'เอกสารเพิ่มเติม',
};

export const REQUIRED_DOC_TYPES: DocType[] = [
  'ACCEPTANCE_LETTER',
  'ARTICLE_COPY',
  'DATABASE_PROOF',
];

/** The happy path, used to draw the progress rail on the detail page. */
export const WORKFLOW_ORDER: RequestStatus[] = [
  'DRAFT',
  'FACULTY_REVIEW',
  'DEAN_REVIEW',
  'RDI_REVIEW',
  'ACADEMIC_OFFICE_REVIEW',
  'PENDING_APPROVAL',
  'APPROVED',
  'PAID',
];

export const STEP_LABELS: Record<string, string> = {
  FACULTY_QA: 'ตรวจสอบระดับคณะ',
  DEAN: 'คณบดีเห็นชอบ',
  RDI: 'สถาบันวิจัยตรวจหลักฐาน',
  ACADEMIC_OFFICE: 'สำนักส่งเสริมวิชาการฯ',
  COMMITTEE: 'คณะกรรมการบริหารงานวิจัย',
  APPROVER: 'รองอธิการบดีอนุมัติ',
};
