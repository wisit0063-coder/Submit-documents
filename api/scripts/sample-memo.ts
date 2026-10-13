/**
 * Renders one fully filled-in memo to a file so a person can look at it.
 *
 * Typography is the one thing the test suite cannot judge: it can prove the PDF
 * parses, not that the result looks like a government document. Print a sample
 * and open it whenever the layout in pdf.service.ts changes.
 *
 *   npx tsx scripts/sample-memo.ts <output.pdf>
 */
import fs from 'fs';
import { buildRequestDocument } from '../src/services/pdf.service';

const out = process.argv[2];
if (!out) {
  console.error('ต้องระบุที่อยู่ไฟล์ปลายทาง');
  process.exit(1);
}

const fixture = {
  id: 1n,
  requestNo: 'RQ-2569-0007',
  userId: 5n,
  facultyId: 3n,
  departmentId: 9n,
  articleTitle: 'การพัฒนาระบบสารสนเทศเพื่อการบริหารจัดการงานวิจัยของมหาวิทยาลัยราชภัฏชัยภูมิ',
  journalName: 'Kasetsart Journal of Social Sciences',
  volume: '46',
  issue: '2',
  pages: '125-138',
  issn: '2452-3151',
  doi: '10.1016/j.kjss.2025.01.004',
  articleUrl: null,
  publishedAt: new Date('2026-03-15'),
  fromConference: false,
  amountRequested: 5000,
  amountApproved: 5000,
  sequenceInYear: 1,
  calendarYear: 2026,
  certNotOnStudyLeave: true,
  certNotThesisPart: true,
  certNotDuplicate: true,
  status: 'PAID',
  currentStep: 5,
  qaIndicatorYear: 2569,
  submittedAt: new Date('2026-04-02'),
  approvedAt: new Date('2026-05-10'),
  closedAt: null,
  createdAt: new Date('2026-04-01'),
  updatedAt: new Date(),
  departmentName: 'สาขาวิชาวิทยาการคอมพิวเตอร์',
  budgetYearId: 1n,
  journalTierId: 1n,
  owner: {
    id: 5n,
    prefix: 'ผู้ช่วยศาสตราจารย์ ดร.',
    firstName: 'สมชาย',
    lastName: 'ใจดีมีเมตตา',
    academicPosition: 'ผู้ช่วยศาสตราจารย์',
    department: { nameTh: 'สาขาวิชาวิทยาการคอมพิวเตอร์' },
  },
  faculty: { id: 3n, nameTh: 'คณะศิลปศาสตร์และวิทยาศาสตร์' },
  journalTier: { nameTh: 'TCI กลุ่ม 1', databaseName: 'TCI' },
  attachments: [
    { id: 1n, docType: 'ACCEPTANCE_LETTER', fileName: 'acceptance-letter.pdf', isVerified: true },
    { id: 2n, docType: 'ARTICLE_COPY', fileName: 'article-full-text.pdf', isVerified: true },
    { id: 3n, docType: 'DATABASE_PROOF', fileName: 'tci-proof.pdf', isVerified: false },
  ],
  approvals: [
    {
      stepOrder: 1,
      stepCode: 'FACULTY_QA',
      decision: 'APPROVED',
      signedAt: new Date('2026-04-05'),
      comment: 'ตรวจสอบเอกสารประกอบครบถ้วนตามประกาศ',
      missingDocuments: null,
      amountApproved: null,
      approver: { prefix: 'นาง', firstName: 'สุดา', lastName: 'ประกันคุณภาพ' },
      approverName: 'นางสุดา ประกันคุณภาพ',
      approverPosition: null,
    },
    {
      stepOrder: 2,
      stepCode: 'DEAN',
      decision: 'APPROVED',
      signedAt: new Date('2026-04-12'),
      comment: null,
      missingDocuments: null,
      amountApproved: null,
      approver: { prefix: 'รองศาสตราจารย์ ดร.', firstName: 'วิชัย', lastName: 'คณบดีศรีสุข' },
      approverName: 'รองศาสตราจารย์ ดร.วิชัย คณบดีศรีสุข',
      approverPosition: 'รองศาสตราจารย์',
    },
    {
      stepOrder: 5,
      stepCode: 'APPROVER',
      decision: 'APPROVED',
      signedAt: new Date('2026-05-10'),
      comment: 'อนุมัติตามอัตราที่ประกาศกำหนด',
      missingDocuments: null,
      amountApproved: 5000,
      approver: { prefix: 'รองศาสตราจารย์ ดร.', firstName: 'ประเสริฐ', lastName: 'รองอธิการบดี' },
      approverName: 'รองศาสตราจารย์ ดร.ประเสริฐ รองอธิการบดี',
      approverPosition: 'รองศาสตราจารย์',
    },
  ],
  payment: { voucherNo: 'ฎ.1234/2569', amount: 5000, paidAt: new Date('2026-06-01') },
} as unknown as Parameters<typeof buildRequestDocument>[0];

const stream = buildRequestDocument(fixture);
const file = fs.createWriteStream(out);
stream.pipe(file);
file.on('finish', () => {
  console.log('เขียนแล้ว:', out, fs.statSync(out).size, 'bytes');
});
file.on('error', (error) => {
  console.error('เขียนไม่สำเร็จ:', error.message);
  process.exit(1);
});
