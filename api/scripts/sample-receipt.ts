/**
 * Renders one filled-in ใบสำคัญรับเงิน to a file so a person can look at it.
 *
 * The figures mirror the real voucher the office showed us - a TCI กลุ่ม 2
 * article paid 3,000 baht, an issue quoted as a half-year range, a journal
 * carrying both a printed and an electronic ISSN - so the output can be held
 * next to the paper form. The claimant is invented: the paper belongs to a real
 * person and their name does not belong in this repository.
 *
 *   npx tsx scripts/sample-receipt.ts <output.pdf>
 */
import fs from 'fs';
import { buildReceiptVoucher } from '../src/services/pdf.service';

const out = process.argv[2];
if (!out) {
  console.error('ต้องระบุที่อยู่ไฟล์ปลายทาง');
  process.exit(1);
}

const fixture = {
  id: 1n,
  requestNo: 'RQ-2570-0012',
  articleTitle:
    'ความต้องการรูปแบบการอนุรักษ์และส่งเสริมศักยภาพพื้นที่สาธารณะแบบมีส่วนร่วมของชุมชน ' +
    'สู่การใช้ประโยชน์ร่วมกันอย่างยั่งยืนและเอื้อต่อสุขภาพผู้สูงอายุ อำเภอคอนสวรรค์ จังหวัดชัยภูมิ',
  journalName: 'วารสารราชภัฏสุรินทร์วิชาการ',
  volume: '4',
  issue: '2',
  issuePeriod: 'พฤษภาคม-สิงหาคม 2569',
  pages: 'e3781',
  issn: '2822-0870',
  issnElectronic: '2822-0889',
  amountRequested: 3000,
  amountApproved: 3000,
  owner: {
    prefix: 'อาจารย์ ดร.',
    firstName: 'ชนาภา',
    lastName: 'วิจัยไพศาล',
    academicPosition: null,
  },
  faculty: { nameTh: 'คณะศิลปศาสตร์และวิทยาศาสตร์' },
  journalTier: { nameTh: 'TCI กลุ่ม 2', databaseName: 'TCI' },
} as unknown as Parameters<typeof buildReceiptVoucher>[0];

const stream = buildReceiptVoucher(fixture);
const file = fs.createWriteStream(out);
stream.pipe(file);
file.on('finish', () => {
  console.log('เขียนแล้ว:', out, fs.statSync(out).size, 'bytes');
});
file.on('error', (error) => {
  console.error('เขียนไม่สำเร็จ:', error.message);
  process.exit(1);
});
