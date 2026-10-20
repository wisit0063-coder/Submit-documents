/**
 * How two filings are judged to describe the same article when neither carries
 * an identifier.
 *
 * Kept in a module that imports nothing but the shared text rules so it can be
 * tested without a DATABASE_URL - validation.service.ts reaches config/prisma,
 * which makes its rules untestable on their own (CLAUDE.md ข้อ 21.5).
 */
import { normaliseForCompare } from './text';

/**
 * Two strings are the same text when they read the same.
 *
 * Case, runs of whitespace, invisible characters and the choice between
 * composed and decomposed accents are all differences a reader cannot see, so
 * none of them may count as a difference here. The whole definition lives in
 * utils/text.ts, shared with the predatory-journal list, so neither rule can
 * drift into being weaker than the other.
 */
export function normaliseArticleText(value: string): string {
  return normaliseForCompare(value);
}

type ArticleNaming = {
  articleTitle: string;
  journalName: string;
};

/**
 * The last net of rule 4 (one article, one payment). DOI and ISSN are the two
 * keys the check prefers, but neither is mandatory anywhere, so a filing may
 * arrive with no key at all; title plus journal is what is always present.
 *
 * Both parts must match. Title alone is too weak - a review and an article may
 * share a title across different journals - and the caller additionally scopes
 * the comparison to one publication year.
 */
export function sameArticleNaming(a: ArticleNaming, b: ArticleNaming): boolean {
  return (
    normaliseArticleText(a.articleTitle) === normaliseArticleText(b.articleTitle) &&
    normaliseArticleText(a.journalName) === normaliseArticleText(b.journalName)
  );
}
