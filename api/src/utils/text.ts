/**
 * What counts as "the same text" and what gets stored.
 *
 * Imports nothing so the rules can be tested without a DATABASE_URL, for the
 * same reason config/authz.ts does.
 */

/**
 * Characters a reader cannot see: zero-width spaces and joiners, the bidi
 * overrides, word joiners, the soft hyphen and the byte-order mark.
 *
 * None of them has a use in an article title or a journal name written in Thai
 * or English, and every one of them changes the string without changing what
 * anyone reads. That is enough to walk past any rule that compares text, which
 * is exactly what happened on 18 ต.ค. 2569: the same article was filed twice,
 * the second time with a U+200B typed into the middle of the title, and both
 * were accepted. The same trick got a journal past the predatory-journal list.
 *
 * U+202A to U+202E are worse than invisible: they reverse the reading order of
 * everything after them, so a title carrying one prints backwards in the memo
 * that goes to the bursar.
 */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;

/**
 * Cleans text on its way into the database: composes accents the same way,
 * drops the invisible characters above, turns non-breaking spaces into
 * ordinary ones and trims the ends.
 *
 * It deliberately does NOT collapse runs of spaces inside the text or change
 * case - that is the author's writing, and this is storage, not comparison.
 */
export function stripInvisible(value: string): string {
  return value.normalize('NFC').replace(INVISIBLE, '').replace(/ /g, ' ').trim();
}

/**
 * Cleans text for comparison, which may be stricter than storage: on top of the
 * above it folds case and collapses every run of whitespace, so two titles that
 * read identically compare equal.
 */
export function normaliseForCompare(value: string): string {
  return stripInvisible(value).toLowerCase().replace(/\s+/g, ' ').trim();
}
