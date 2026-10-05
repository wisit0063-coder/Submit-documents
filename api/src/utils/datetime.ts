/**
 * Everything is stored in UTC. Display formatting happens on the client.
 * Shared-hosting server time is unreliable, so we never read the OS timezone
 * for business logic - only Date.now() in UTC.
 */

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Calendar year (คริสต์ศักราช) of a date as seen in Bangkok. */
export function calendarYearOf(date: Date): number {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCFullYear();
}

/** Calendar month (1-12) of a date as seen in Bangkok. */
export function calendarMonthOf(date: Date): number {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).getUTCMonth() + 1;
}

/** Thai fiscal year (ปีงบประมาณ พ.ศ.): 1 Oct - 30 Sep. */
export function fiscalYearOf(date: Date): number {
  const local = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = local.getUTCFullYear() + 543;
  return local.getUTCMonth() >= 9 ? year + 1 : year;
}

export function formatThaiDate(date: Date): string {
  const local = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const day = local.getUTCDate();
  const month = THAI_MONTHS[local.getUTCMonth()] ?? '';
  const year = local.getUTCFullYear() + 543;
  return `${day} ${month} ${year}`;
}

/** Business days elapsed between two instants, skipping Sat/Sun. */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let days = 0;
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

/** Date-only value for @db.Date columns, anchored at UTC midnight. */
export function toDateOnly(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
