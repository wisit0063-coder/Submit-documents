/**
 * The calendar years a claim can possibly belong to, newest first.
 *
 * It grows downwards from next year rather than being a sliding window of the
 * last few years. A window quietly drops the oldest year as time passes: in
 * 2030 a claim filed in 2026 is still in the database, but no filter can reach
 * it any more. The floor is the year ประกาศ 2131/2566 took effect, and rule 8
 * requires an article to be published in the year it is claimed, so no row can
 * be older than that.
 *
 * Next year is included because the December grace window lets a claim be filed
 * in January for an article published the previous December.
 *
 * DO NOT turn this back into a sliding window. If the list ever grows
 * unwieldy, read the years that actually exist from the database instead of
 * dropping the old ones.
 *
 * The value comes from the clock of whoever opened the page; a machine with the
 * wrong date gets the wrong list.
 */
export const FIRST_CLAIMABLE_YEAR = 2023;

export function claimableYears(now: Date = new Date()): number[] {
  const newest = now.getFullYear() + 1;
  const length = Math.max(1, newest - FIRST_CLAIMABLE_YEAR + 1);
  return Array.from({ length }, (_unused, index) => newest - index);
}
