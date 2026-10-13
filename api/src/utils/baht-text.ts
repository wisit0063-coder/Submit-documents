/**
 * Money written the way a Thai receipt writes it: "3,000" becomes
 * "สามพันบาทถ้วน".
 *
 * The receipt voucher (ใบสำคัญรับเงิน) carries the amount twice - once in
 * digits and once in words - because the words are what cannot be altered with
 * a pen after signing. Getting them wrong is not a cosmetic bug on a document
 * someone signs to say they received public money.
 *
 * Three rules make this harder than joining digit names:
 *  - the tens digit 2 is "ยี่สิบ", never "สองสิบ"
 *  - a tens digit of 1 is bare "สิบ", never "หนึ่งสิบ"
 *  - a units digit of 1 is "เอ็ด" whenever anything precedes it, so 21 is
 *    "ยี่สิบเอ็ด" and 101 is "หนึ่งร้อยเอ็ด", but 1 alone is "หนึ่ง"
 *
 * Above six digits Thai repeats the scale: 1,000,000 reads as "หนึ่งล้าน" and
 * every further group of six is another "ล้าน", so the number is split into
 * six-digit groups rather than the three-digit groups used with commas.
 */

const DIGITS = [
  '',
  'หนึ่ง',
  'สอง',
  'สาม',
  'สี่',
  'ห้า',
  'หก',
  'เจ็ด',
  'แปด',
  'เก้า',
];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Reads one group of at most six digits. `hasPrefix` carries in whether a higher group spoke first, which is what turns a trailing 1 into เอ็ด. */
function readGroup(group: number, hasPrefix: boolean): string {
  if (group === 0) return '';
  const digits = String(group).split('').map(Number);
  let words = '';

  digits.forEach((digit, index) => {
    const place = digits.length - index - 1;
    if (digit === 0) return;

    if (place === 1) {
      words += digit === 1 ? '' : digit === 2 ? 'ยี่' : (DIGITS[digit] ?? '');
      words += PLACES[place] ?? '';
      return;
    }

    const isLoneUnit = place === 0 && !hasPrefix && digits.length === 1;
    if (place === 0 && digit === 1 && !isLoneUnit) {
      words += 'เอ็ด';
      return;
    }

    words += (DIGITS[digit] ?? '') + (PLACES[place] ?? '');
  });

  return words;
}

/** Reads a whole number, splitting it into the six-digit groups Thai counts by. */
function readInteger(value: number): string {
  if (value === 0) return 'ศูนย์';

  const groups: number[] = [];
  let rest = value;
  while (rest > 0) {
    groups.unshift(rest % 1_000_000);
    rest = Math.floor(rest / 1_000_000);
  }

  return groups.reduce((words, group, index) => {
    const isLast = index === groups.length - 1;
    // A middle group of zeros still owes its ล้าน: 1,000,000,000 is "หนึ่งพันล้าน".
    const spoken = readGroup(group, words.length > 0);
    return words + spoken + (isLast ? '' : 'ล้าน');
  }, '');
}

/**
 * Formats an amount as the words on a receipt. Satang are read when present
 * ("หนึ่งบาทห้าสิบสตางค์"); a whole amount ends in "ถ้วน", which is what tells
 * a reader no satang were dropped.
 */
export function bahtText(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value)) throw new Error('จำนวนเงินไม่ถูกต้อง');

  const negative = value < 0;
  // Round first: 0.005 would otherwise read as zero satang while the digits
  // printed beside it say 0.01.
  const satangTotal = Math.round(Math.abs(value) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;

  const words =
    satang === 0
      ? `${readInteger(baht)}บาทถ้วน`
      : `${baht === 0 ? '' : `${readInteger(baht)}บาท`}${readGroup(satang, false)}สตางค์`;

  return negative ? `ลบ${words}` : words;
}
