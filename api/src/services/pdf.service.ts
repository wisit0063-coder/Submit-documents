import fs from 'fs';
import path from 'path';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, Content } from 'pdfmake/interfaces';
import { AppError } from '../utils/errors';
import { formatThaiDate } from '../utils/datetime';
import { DOC_TYPE_LABELS } from './attachment.service';
import { STATUS_LABELS_TH } from '../config/workflow';
import type { RequestDetail } from './request.service';

/**
 * TH SarabunPSK - the face named in the government typing rules
 * (ระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ) - is bundled with the project rather
 * than fetched at runtime: shared hosting has no fontconfig and no network
 * access from the app process.
 *
 * Do not swap this back to Google's "Sarabun". The two share a name and a
 * lineage but not their metrics, measured from the files themselves:
 *
 *   Google Sarabun   x-height 500/1000 em, cap height 700
 *   TH SarabunPSK    x-height 340/1000 em, cap height 476
 *
 * Google's letters stand about 1.47x taller at the same point size, so the memo
 * set in it at 14 pt looked like a 21 pt document to the people who read real
 * ones - which is exactly what the owner's mentor reported (28 ก.ย. 2569). The
 * sizes below are only correct for the government face.
 *
 * To move to TH Sarabun New instead (a later revision of the same design with
 * better tone-mark placement), replace the four files and keep the names.
 */
const FONT_FILE_NAMES = {
  normal: 'THSarabunPSK-Regular.ttf',
  bold: 'THSarabunPSK-Bold.ttf',
  italics: 'THSarabunPSK-Italic.ttf',
  bolditalics: 'THSarabunPSK-BoldItalic.ttf',
} as const;

/**
 * Point sizes and margins from ระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ, ภาคผนวก 2
 * (คำอธิบายการพิมพ์หนังสือราชการ). Keep them here rather than inline so the whole
 * memo can be checked against the rule in one place.
 */
const SIZE = {
  /** คำว่า "บันทึกข้อความ" */
  title: 29,
  /** ป้ายหัวเรื่อง: ส่วนราชการ / ที่ / วันที่ / เรื่อง */
  headerLabel: 20,
  /** เนื้อความ คำลงท้าย และลายมือชื่อ */
  body: 16,
  /** ตารางและหมายเหตุท้ายหน้า */
  small: 14,
} as const;

/** 1 ซม. = 28.35 pt. ขอบซ้ายกว้างกว่าเพื่อเผื่อระยะเข้าแฟ้มเสนอลงนาม. */
const CM = 28.3465;
const MARGINS: [number, number, number, number] = [
  Math.round(3.0 * CM), // ซ้าย
  Math.round(2.5 * CM), // บน
  Math.round(2.0 * CM), // ขวา
  Math.round(2.0 * CM), // ล่าง
];
/** ย่อหน้าปกติเคาะ 2.5 ซม. ตามระเบียบ */
const PARAGRAPH_INDENT = Math.round(2.5 * CM);

/**
 * Where the fonts sit depends on how the app was started, and getting this wrong
 * is silent until someone prints a memo:
 *
 *   tsx from api/       __dirname = api/src/services       -> ../../assets
 *   node dist/ (deploy) __dirname = api/dist/src/services  -> ../../../assets
 *
 * A single relative path can only satisfy one of them, so the candidates are
 * tried in turn. The working directory comes first because both Passenger and
 * the container start the app from the application root, which is also what
 * config/env.ts already assumes when it loads .env.
 */
export function resolveFontDir(): string {
  const candidates = [
    process.env.FONT_DIR,
    path.resolve(process.cwd(), 'assets/fonts'),
    path.resolve(__dirname, '../../assets/fonts'),
    path.resolve(__dirname, '../../../assets/fonts'),
  ].filter((dir): dir is string => Boolean(dir));

  const found = candidates.find((dir) =>
    Object.values(FONT_FILE_NAMES).every((file) => fs.existsSync(path.join(dir, file))),
  );
  // Nothing found: return the first candidate so the error names a real path.
  return found ?? candidates[0]!;
}

const FONT_DIR = resolveFontDir();

const fontFiles = {
  normal: path.join(FONT_DIR, FONT_FILE_NAMES.normal),
  bold: path.join(FONT_DIR, FONT_FILE_NAMES.bold),
  italics: path.join(FONT_DIR, FONT_FILE_NAMES.italics),
  bolditalics: path.join(FONT_DIR, FONT_FILE_NAMES.bolditalics),
};

let printer: PdfPrinter | null = null;

function getPrinter(): PdfPrinter {
  if (printer) return printer;

  const missing = Object.values(fontFiles).filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new AppError(
      500,
      'FONT_NOT_INSTALLED',
      'ยังไม่ได้ติดตั้งฟอนต์ TH SarabunPSK บนเซิร์ฟเวอร์ จึงออกเอกสาร PDF ไม่ได้ ' +
        'กรุณาวางไฟล์ฟอนต์ไว้ที่ api/assets/fonts/ ตามคู่มือติดตั้ง',
      { missing: missing.map((file) => path.basename(file)) },
    );
  }

  printer = new PdfPrinter({ THSarabun: fontFiles });
  return printer;
}

const money = (value: number) =>
  value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function labelValue(label: string, value: string): Content {
  return {
    columns: [
      { text: label, width: 130, bold: true },
      { text: value || '-', width: '*' },
    ],
    margin: [0, 1, 0, 1],
  };
}

/**
 * One line of the memo header. The label is the 20 pt bold of the printed form
 * while the value stays at body size, so the value is nudged down to sit on the
 * same baseline as the taller label rather than aligning at the top.
 */
function headerRow(label: string, value: string): Content {
  return {
    columns: [
      { text: label, width: 'auto', fontSize: SIZE.headerLabel, bold: true },
      {
        text: value || '-',
        width: '*',
        fontSize: SIZE.body,
        margin: [6, (SIZE.headerLabel - SIZE.body) * 0.8, 0, 0],
      },
    ],
    margin: [0, 2, 0, 2],
  };
}

/**
 * Renders form CPRU-RDI-F011 (บันทึกข้อความขอรับค่าตอบแทนการตีพิมพ์บทความ).
 * The signature blocks are filled from request_approvals, which is what stands
 * in for handwritten signatures in this system.
 */
export function buildRequestDocument(request: RequestDetail): NodeJS.ReadableStream {
  // Resolve the fonts first: a missing font must fail before the response has
  // started streaming, so the client gets a readable error instead of a broken file.
  const pdfPrinter = getPrinter();

  const owner = request.owner;
  const ownerName = `${owner.prefix ?? ''}${owner.firstName} ${owner.lastName}`;
  const tier = request.journalTier;

  const approvalRows: Content[] = request.approvals.map((approval) => {
    const approverName = approval.approver
      ? `${approval.approver.prefix ?? ''}${approval.approver.firstName} ${approval.approver.lastName}`
      : '(ยังไม่ได้ลงนาม)';
    const decisionLabel =
      approval.decision === 'APPROVED'
        ? 'เห็นชอบ / อนุมัติ'
        : approval.decision === 'RETURNED'
          ? 'ส่งกลับให้แก้ไข'
          : approval.decision === 'REJECTED'
            ? 'ไม่อนุมัติ'
            : 'รอพิจารณา';

    return {
      margin: [0, 6, 0, 6],
      stack: [
        { text: `ขั้นที่ ${approval.stepOrder}: ${approval.stepCode}`, bold: true },
        { text: `ผลการพิจารณา: ${decisionLabel}` },
        { text: `ผู้ลงนาม: ${approverName}` },
        {
          text: `วันที่: ${approval.signedAt ? formatThaiDate(approval.signedAt) : '-'}`,
        },
        ...(approval.comment ? [{ text: `ความเห็น: ${approval.comment}` }] : []),
        ...(approval.missingDocuments
          ? [{ text: `เอกสารที่ต้องแก้ไข: ${approval.missingDocuments}` }]
          : []),
        ...(approval.amountApproved
          ? [{ text: `จำนวนเงินที่อนุมัติ: ${money(Number(approval.amountApproved))} บาท`, bold: true }]
          : []),
      ],
    };
  });

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: MARGINS,
    defaultStyle: { font: 'THSarabun', fontSize: SIZE.body, lineHeight: 1 },
    info: {
      title: `${request.requestNo} - บันทึกข้อความขอรับค่าตอบแทนการตีพิมพ์`,
      author: 'มหาวิทยาลัยราชภัฏชัยภูมิ',
    },
    content: [
      { text: 'บันทึกข้อความ', fontSize: SIZE.title, bold: true, alignment: 'center' },
      {
        text: 'แบบฟอร์ม CPRU-RDI-F011',
        fontSize: SIZE.small,
        alignment: 'right',
        margin: [0, -20, 0, 10],
      },
      // The header block follows the shape of the printed form: the unit on its
      // own line, then the reference number and date sharing one, then subject.
      headerRow('ส่วนราชการ', `${request.faculty.nameTh} มหาวิทยาลัยราชภัฏชัยภูมิ`),
      {
        columns: [
          headerRow('ที่', request.requestNo),
          headerRow('วันที่', formatThaiDate(request.submittedAt ?? request.createdAt)),
        ],
        columnGap: 12,
      },
      headerRow('เรื่อง', 'ขอรับค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ'),
      { text: 'เรียน  อธิการบดีมหาวิทยาลัยราชภัฏชัยภูมิ', margin: [0, 10, 0, 8] },
      {
        leadingIndent: PARAGRAPH_INDENT,
        text:
          `ข้าพเจ้า ${ownerName} ตำแหน่ง ${owner.academicPosition ?? '-'} ` +
          // Snapshot first (CLAUDE.md ข้อ 8): the memo must keep naming the unit
          // and subject area as they were when the request was filed, even if
          // the person transfers afterwards.
          `สังกัด ${request.departmentName ?? owner.department?.nameTh ?? '-'} ${request.faculty.nameTh} ` +
          'ขอรับค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ ตามประกาศมหาวิทยาลัยราชภัฏชัยภูมิ ' +
          'เลขที่ 2131/2566 โดยมีรายละเอียดดังนี้',
        margin: [0, 0, 0, 10],
        alignment: 'justify',
      },

      { text: '1. ข้อมูลบทความ', bold: true, margin: [0, 6, 0, 4] },
      labelValue('ชื่อบทความ', request.articleTitle),
      labelValue('ชื่อวารสาร', request.journalName),
      labelValue('ปีที่ / ฉบับที่ / หน้า', [request.volume, request.issue, request.pages].filter(Boolean).join(' / ')),
      labelValue('ISSN', request.issn ?? '-'),
      labelValue('DOI', request.doi ?? '-'),
      labelValue('วันที่ตีพิมพ์', formatThaiDate(request.publishedAt)),
      labelValue('ฐานข้อมูลวารสาร', `${tier.nameTh} (${tier.databaseName})`),
      labelValue('ประเภทการตีพิมพ์', request.fromConference ? 'คัดเลือกจาก conference' : 'ตีพิมพ์ปกติ'),

      { text: '2. จำนวนเงินที่ขอรับ', bold: true, margin: [0, 10, 0, 4] },
      labelValue('อัตราตามประกาศ', `${money(Number(request.amountRequested))} บาท`),
      labelValue(
        'จำนวนที่อนุมัติ',
        request.amountApproved ? `${money(Number(request.amountApproved))} บาท` : 'รอการอนุมัติ',
      ),
      labelValue('ลำดับที่ใช้สิทธิ์ในปี', request.sequenceInYear ? `${request.sequenceInYear} / 3` : '-'),

      { text: '3. คำรับรองของผู้ขอ', bold: true, margin: [0, 10, 0, 4] },
      {
        ul: [
          `${request.certNotOnStudyLeave ? '[/]' : '[ ]'} ข้าพเจ้าไม่อยู่ระหว่างลาศึกษาต่อเต็มเวลา`,
          `${request.certNotThesisPart ? '[/]' : '[ ]'} บทความนี้ไม่เป็นส่วนหนึ่งของวิทยานิพนธ์ของข้าพเจ้า`,
          `${request.certNotDuplicate ? '[/]' : '[ ]'} บทความนี้ยังไม่เคยได้รับค่าตอบแทนจากมหาวิทยาลัย`,
        ],
        margin: [10, 0, 0, 6],
      },

      { text: '4. เอกสารประกอบ', bold: true, margin: [0, 10, 0, 4] },
      {
        ul:
          request.attachments.length > 0
            ? request.attachments.map(
                (file) =>
                  `${DOC_TYPE_LABELS[file.docType]} - ${file.fileName}` +
                  (file.isVerified ? ' (ตรวจสอบแล้ว)' : ''),
              )
            : ['ยังไม่มีเอกสารแนบ'],
        margin: [10, 0, 0, 6],
      },

      {
        text: 'จึงเรียนมาเพื่อโปรดพิจารณา',
        margin: [0, 10, 0, 20],
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            width: 220,
            stack: [
              { text: 'ลงชื่อ ..............................................', alignment: 'center' },
              { text: `( ${ownerName} )`, alignment: 'center' },
              { text: 'ผู้ขอรับค่าตอบแทน', alignment: 'center' },
            ],
          },
        ],
      },

      { text: '5. ผลการพิจารณาตามลำดับขั้น', bold: true, margin: [0, 24, 0, 4], pageBreak: 'before' },
      {
        text:
          'ระบบบันทึกผู้ลงนามและวันเวลาไว้ในฐานข้อมูล (ตาราง request_approvals) ' +
          'เอกสารฉบับนี้พิมพ์จากระบบเพื่อใช้ประกอบการเบิกจ่าย',
        fontSize: SIZE.small,
        italics: true,
        margin: [0, 0, 0, 8],
      },
      ...approvalRows,

      {
        text: `สถานะปัจจุบัน: ${STATUS_LABELS_TH[request.status]}`,
        bold: true,
        margin: [0, 12, 0, 0],
      },
      ...(request.payment
        ? [
            {
              text:
                `การเบิกจ่าย: ฎีกาเลขที่ ${request.payment.voucherNo ?? '-'} ` +
                `จำนวน ${money(Number(request.payment.amount))} บาท ` +
                `วันที่ ${request.payment.paidAt ? formatThaiDate(request.payment.paidAt) : '-'}`,
              margin: [0, 4, 0, 0],
            } as Content,
          ]
        : []),
    ],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        {
          text: `พิมพ์จากระบบเมื่อ ${formatThaiDate(new Date())}`,
          fontSize: SIZE.small,
          margin: [MARGINS[0], 0, 0, 0],
        },
        {
          text: `หน้า ${currentPage} / ${pageCount}`,
          alignment: 'right',
          fontSize: SIZE.small,
          margin: [0, 0, MARGINS[2], 0],
        },
      ],
    }),
  };

  const doc = pdfPrinter.createPdfKitDocument(definition);
  doc.end();
  return doc;
}
