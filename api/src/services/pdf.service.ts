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
 * Sarabun is the Thai government standard face and is bundled with the project
 * rather than fetched at runtime: shared hosting has no fontconfig and no
 * network access from the app process.
 *
 * Place the four TTF files in api/assets/fonts/ before deploying - see README.
 */
const FONT_FILE_NAMES = {
  normal: 'Sarabun-Regular.ttf',
  bold: 'Sarabun-Bold.ttf',
  italics: 'Sarabun-Italic.ttf',
  bolditalics: 'Sarabun-BoldItalic.ttf',
} as const;

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
      'ยังไม่ได้ติดตั้งฟอนต์ Sarabun บนเซิร์ฟเวอร์ จึงออกเอกสาร PDF ไม่ได้ ' +
        'กรุณาวางไฟล์ฟอนต์ไว้ที่ api/assets/fonts/ ตามคู่มือติดตั้ง',
      { missing: missing.map((file) => path.basename(file)) },
    );
  }

  printer = new PdfPrinter({ Sarabun: fontFiles });
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
    pageMargins: [70, 50, 50, 50],
    defaultStyle: { font: 'Sarabun', fontSize: 14, lineHeight: 1.25 },
    info: {
      title: `${request.requestNo} - บันทึกข้อความขอรับค่าตอบแทนการตีพิมพ์`,
      author: 'มหาวิทยาลัยราชภัฏชัยภูมิ',
    },
    content: [
      { text: 'บันทึกข้อความ', fontSize: 24, bold: true, alignment: 'center' },
      {
        text: 'แบบฟอร์ม CPRU-RDI-F011',
        fontSize: 11,
        alignment: 'right',
        margin: [0, -18, 0, 10],
      },
      labelValue('ส่วนราชการ', `${request.faculty.nameTh} มหาวิทยาลัยราชภัฏชัยภูมิ`),
      labelValue('ที่', request.requestNo),
      labelValue('วันที่', formatThaiDate(request.submittedAt ?? request.createdAt)),
      labelValue('เรื่อง', 'ขอรับค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ'),
      { text: 'เรียน  อธิการบดีมหาวิทยาลัยราชภัฏชัยภูมิ', margin: [0, 8, 0, 8] },
      {
        text:
          `ข้าพเจ้า ${ownerName} ตำแหน่ง ${owner.academicPosition ?? '-'} ` +
          `สังกัด ${owner.department?.nameTh ?? '-'} ${request.faculty.nameTh} ` +
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
        fontSize: 11,
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
          fontSize: 10,
          margin: [50, 0, 0, 0],
        },
        {
          text: `หน้า ${currentPage} / ${pageCount}`,
          alignment: 'right',
          fontSize: 10,
          margin: [0, 0, 50, 0],
        },
      ],
    }),
  };

  const doc = pdfPrinter.createPdfKitDocument(definition);
  doc.end();
  return doc;
}
