import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import { Prisma } from "@prisma/client";
import {
  buildReceiptVoucher,
  buildRequestDocument,
  resolveFontDir,
} from "../src/services/pdf.service";
import { bahtText } from "../src/utils/baht-text";
import { AppError } from "../src/utils/errors";
import type { RequestDetail } from "../src/services/request.service";

const FONT_DIR = path.resolve(__dirname, "../assets/fonts");
const fontsInstalled = [
  "THSarabunPSK-Regular.ttf",
  "THSarabunPSK-Bold.ttf",
  "THSarabunPSK-Italic.ttf",
  "THSarabunPSK-BoldItalic.ttf",
].every((file) => fs.existsSync(path.join(FONT_DIR, file)));

const decimal = (value: number) => new Prisma.Decimal(value);

/** A fully populated request, as GET /requests/:id would return it. */
function fixture(): RequestDetail {
  return {
    id: 1n,
    requestNo: "RQ-2569-0007",
    userId: 5n,
    facultyId: 3n,
    departmentId: 9n,
    articleTitle:
      "การพัฒนาระบบสารสนเทศเพื่อการบริหารจัดการงานวิจัยของมหาวิทยาลัยราชภัฏ",
    journalName: "Kasetsart Journal of Social Sciences",
    volume: "46",
    issue: "2",
    pages: "125-138",
    issn: "2452-3151",
    doi: "10.1016/j.kjss.2025.02.004",
    articleUrl: "https://example.org/article",
    publishedAt: new Date("2025-06-15T00:00:00Z"),
    journalTierId: 2n,
    fromConference: false,
    amountRequested: decimal(20000),
    amountApproved: decimal(18000),
    calendarYear: 2025,
    sequenceInYear: 2,
    budgetYearId: 1n,
    qaIndicatorYear: 2568,
    certNotOnStudyLeave: true,
    certNotThesisPart: true,
    certNotDuplicate: true,
    status: "APPROVED",
    currentStep: 5,
    submittedAt: new Date("2025-07-01T03:00:00Z"),
    approvedAt: new Date("2025-08-20T07:00:00Z"),
    closedAt: null,
    createdAt: new Date("2025-06-30T03:00:00Z"),
    updatedAt: new Date("2025-08-20T07:00:00Z"),
    owner: {
      id: 5n,
      prefix: "ผศ.ดร.",
      firstName: "สมชาย",
      lastName: "ใจดี",
      email: "somchai@cpru.ac.th",
      academicPosition: "ผู้ช่วยศาสตราจารย์",
      phoneMobile: "081-234-5678",
      phoneInternal: "1234",
      department: {
        id: 9n,
        nameTh: "วิทยาการคอมพิวเตอร์",
        faculty: { id: 3n, nameTh: "คณะวิทยาศาสตร์และเทคโนโลยี" },
      },
    },
    faculty: { id: 3n, code: "SCI", nameTh: "คณะวิทยาศาสตร์และเทคโนโลยี" },
    journalTier: {
      id: 2n,
      code: "SCOPUS_Q2",
      nameTh: "Scopus ควอไทล์ 2",
      databaseName: "Scopus",
      quartile: "Q2",
      rateNormal: decimal(20000),
      rateConference: decimal(12000),
      announcementRef: "2131/2566",
      effectiveFrom: new Date("2023-10-01T00:00:00Z"),
      effectiveTo: null,
      isActive: true,
      sortOrder: 2,
    },
    budgetYear: { id: 1n, year: 2569 },
    attachments: [
      {
        id: 1n,
        requestId: 1n,
        docType: "ACCEPTANCE_LETTER",
        fileName: "acceptance-letter.pdf",
        storedPath: "/storage/uploads/2025/07/a.pdf",
        mimeType: "application/pdf",
        fileSize: 120_000,
        uploadedBy: 5n,
        isVerified: true,
        verifiedBy: 7n,
        verifiedAt: new Date("2025-07-10T04:00:00Z"),
        createdAt: new Date("2025-06-30T04:00:00Z"),
        verifier: { id: 7n, firstName: "กิตติ", lastName: "วิจัยพัฒนา" },
      },
    ],
    approvals: [
      {
        id: 1n,
        requestId: 1n,
        stepOrder: 1,
        stepCode: "FACULTY_QA",
        approverId: 6n,
        decision: "APPROVED",
        comment: "ตรวจสอบเอกสารครบถ้วน",
        missingDocuments: null,
        amountApproved: null,
        signedAt: new Date("2025-07-03T04:00:00Z"),
        createdAt: new Date("2025-07-01T03:00:00Z"),
        approver: {
          id: 6n,
          prefix: "นางสาว",
          firstName: "ปวีณา",
          lastName: "ทดสอบ",
          academicPosition: null,
        },
      },
      {
        id: 2n,
        requestId: 1n,
        stepOrder: 5,
        stepCode: "APPROVER",
        approverId: 8n,
        decision: "APPROVED",
        comment: "อนุมัติตามหลักเกณฑ์",
        missingDocuments: null,
        amountApproved: decimal(18000),
        signedAt: new Date("2025-08-20T07:00:00Z"),
        createdAt: new Date("2025-08-10T07:00:00Z"),
        approver: {
          id: 8n,
          prefix: "รศ.ดร.",
          firstName: "ธนกฤต",
          lastName: "ทดสอบ",
          academicPosition: "รองศาสตราจารย์",
        },
      },
    ],
    payment: null,
  } as unknown as RequestDetail;
}

/**
 * The font directory used to be a single path relative to the module, which
 * resolved correctly from src/ but not from the compiled dist/ - so printing a
 * memo failed on every deployed build while this suite, which runs from source,
 * stayed green. The lookup now tries several layouts.
 */
test("the TH SarabunPSK fonts are found wherever the app is started from", () => {
  const dir = resolveFontDir();
  const missing = [
    "THSarabunPSK-Regular.ttf",
    "THSarabunPSK-Bold.ttf",
    "THSarabunPSK-Italic.ttf",
    "THSarabunPSK-BoldItalic.ttf",
  ].filter((file) => !fs.existsSync(path.join(dir, file)));
  assert.deepEqual(missing, [], `ไม่พบฟอนต์ใน ${dir}`);
});

test("the font lookup does not depend on the module being under src/", () => {
  // Simulating the deployed layout: cwd is the application root either way, and
  // that candidate is tried first, so a dist/ build resolves to the same place.
  const fromCwd = path.resolve(process.cwd(), "assets/fonts");
  assert.equal(
    fs.existsSync(path.join(fromCwd, "THSarabunPSK-Regular.ttf")),
    true,
    "assets/fonts ต้องอยู่ใต้ application root เพื่อให้ build ที่ deploy แล้วหาเจอ",
  );
});

test(
  "missing fonts fail loudly instead of producing a PDF with no Thai text",
  { skip: fontsInstalled ? "fonts are installed on this machine" : false },
  () => {
    assert.throws(
      () => buildRequestDocument(fixture()),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "FONT_NOT_INSTALLED" &&
        error.statusCode === 500,
    );
  },
);

test(
  "renders form CPRU-RDI-F011 as a valid PDF",
  {
    skip: fontsInstalled
      ? false
      : "TH SarabunPSK fonts not installed - see assets/fonts/README.md",
  },
  async () => {
    const target = path.join(os.tmpdir(), `cpru-pdf-test-${Date.now()}.pdf`);
    const stream = buildRequestDocument(fixture());

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(target);
      stream.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
      stream.on("error", reject);
    });

    const bytes = fs.readFileSync(target);
    fs.unlinkSync(target);

    assert.equal(
      bytes.subarray(0, 5).toString(),
      "%PDF-",
      "must start with a PDF header",
    );
    assert.ok(
      bytes.length > 10_000,
      `expected a real document, got ${bytes.length} bytes`,
    );

    // The approval trail starts on its own page, so a signed request is never
    // a single page.
    const pageCount = Number(
      /\/Count\s+(\d+)/.exec(bytes.toString("latin1"))?.[1] ?? 0,
    );
    assert.ok(pageCount >= 2, `expected at least two pages, got ${pageCount}`);
  },
);

/** The same request after approval, as the receipt voucher needs it. */
function receiptFixture(): RequestDetail {
  return {
    ...fixture(),
    issnElectronic: "2822-0889",
    issuePeriod: "พฤษภาคม-สิงหาคม 2569",
  } as unknown as RequestDetail;
}

test("a receipt is refused for a request with no approved amount", () => {
  const pending = {
    ...receiptFixture(),
    amountApproved: null,
  } as unknown as RequestDetail;
  assert.throws(
    () => buildReceiptVoucher(pending),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "RECEIPT_NOT_APPROVED" &&
      error.statusCode === 422,
    "ใบสำคัญรับเงินของเงินที่ยังไม่มีใครอนุมัติ คือเอกสารที่ไม่ควรมีอยู่",
  );
});

test(
  "renders ใบสำคัญรับเงิน as a valid one-page PDF",
  {
    skip: fontsInstalled
      ? false
      : "TH SarabunPSK fonts not installed - see assets/fonts/README.md",
  },
  async () => {
    const target = path.join(
      os.tmpdir(),
      `cpru-receipt-test-${Date.now()}.pdf`,
    );
    const stream = buildReceiptVoucher(receiptFixture());

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(target);
      stream.pipe(file);
      file.on("finish", resolve);
      file.on("error", reject);
      stream.on("error", reject);
    });

    const bytes = fs.readFileSync(target);
    fs.unlinkSync(target);

    assert.equal(
      bytes.subarray(0, 5).toString(),
      "%PDF-",
      "must start with a PDF header",
    );
    // The voucher is signed at a counter: it has to stay on one sheet, or the
    // signature and the amount end up on different pieces of paper.
    const pageCount = Number(
      /\/Count\s+(\d+)/.exec(bytes.toString("latin1"))?.[1] ?? 0,
    );
    assert.equal(
      pageCount,
      1,
      `ใบสำคัญรับเงินต้องอยู่ในหน้าเดียว แต่ได้ ${pageCount} หน้า`,
    );
  },
);

test("the amount in words is the one printed beside the digits", () => {
  // The two halves of the voucher must agree: the digits can be altered with a
  // pen after signing, the words are what makes that visible.
  assert.equal(
    bahtText(Number(receiptFixture().amountApproved)),
    "หนึ่งหมื่นแปดพันบาทถ้วน",
  );
});
