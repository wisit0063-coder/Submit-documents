import { RequestStatus, type Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import blacklist from '../config/blacklisted-journals.json';
import {
  ACTIVE_CLAIM_STATUSES,
  DUPLICATE_BLOCKING_STATUSES,
  ENTITLEMENT_STATUSES,
  IN_FLIGHT_STATUSES,
  MAX_ARTICLES_PER_CALENDAR_YEAR,
  REQUIRED_DOC_TYPES,
} from '../config/workflow';
import { calendarYearOf } from '../utils/datetime';

export interface ValidationIssue {
  code: string;
  message: string;
}

type RequestWithRelations = Prisma.RequestGetPayload<{
  include: { attachments: true; journalTier: true };
}>;

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Rule 7: journal must not appear on a hijacked / predatory list. */
export function isBlacklistedJournal(journalName: string, issn?: string | null): boolean {
  const name = normalise(journalName);
  const titleHit = blacklist.titles.some((title) => normalise(title) === name);
  const publisherHit = blacklist.publishers.some((publisher) => name.includes(normalise(publisher)));
  const issnHit = issn ? blacklist.issn.includes(issn.trim()) : false;
  return titleHit || publisherHit || issnHit;
}

/**
 * Rule 3: three articles per calendar year.
 *
 * Only requests that reached APPROVED consume an entitlement (rejected ones do
 * not), but requests still moving through review are counted as pending so a
 * researcher cannot queue up four at once and overshoot.
 */
export async function getQuota(userId: bigint, calendarYear: number, client: Tx = prisma) {
  const [used, pending] = await Promise.all([
    client.request.count({
      where: { userId, calendarYear, status: { in: ENTITLEMENT_STATUSES } },
    }),
    client.request.count({
      where: { userId, calendarYear, status: { in: IN_FLIGHT_STATUSES } },
    }),
  ]);

  const limit = MAX_ARTICLES_PER_CALENDAR_YEAR;
  return {
    calendarYear,
    limit,
    used,
    pending,
    remaining: Math.max(0, limit - used - pending),
  };
}

/**
 * Rule 4: one article is reimbursed once. Matched on DOI, or on ISSN plus title
 * when the article has no DOI.
 *
 * `statuses` decides how wide the net is, because the two callers ask different
 * questions. The submit gate passes ACTIVE_CLAIM_STATUSES - a second copy filed
 * while the first is still in review must be refused, otherwise both walk the
 * chain and both get approved. Final approval passes DUPLICATE_BLOCKING_STATUSES:
 * by then only a settled claim matters, and the first one to be approved wins.
 * A rejected or cancelled request never blocks anything, so it can be filed again.
 */
export async function findDuplicateArticle(
  request: { id: bigint; doi: string | null; issn: string | null; articleTitle: string },
  statuses: RequestStatus[],
  client: Tx = prisma,
) {
  const doi = request.doi?.trim();
  if (doi) {
    const byDoi = await client.request.findFirst({
      where: {
        id: { not: request.id },
        // A DOI is case-insensitive by specification, and Postgres does not
        // fold case on its own the way the old MySQL collation did.
        doi: { equals: doi, mode: 'insensitive' },
        status: { in: statuses },
      },
      select: { id: true, requestNo: true, status: true },
    });
    if (byDoi) return byDoi;
  }

  const issn = request.issn?.trim();
  if (issn) {
    const candidates = await client.request.findMany({
      where: {
        id: { not: request.id },
        issn: { equals: issn, mode: 'insensitive' },
        status: { in: statuses },
      },
      select: { id: true, requestNo: true, articleTitle: true, status: true },
    });
    const title = normalise(request.articleTitle);
    const hit = candidates.find((candidate) => normalise(candidate.articleTitle) === title);
    if (hit) return { id: hit.id, requestNo: hit.requestNo, status: hit.status };
  }

  return null;
}

/**
 * Full pre-submit gate. Returns every failing rule at once so the requester can
 * fix everything in one pass instead of discovering problems one at a time.
 */
export async function validateForSubmit(
  request: RequestWithRelations,
  options: { isFirstAuthor: boolean },
  client: Tx = prisma,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  // Rule 2 - requester must be the first author.
  if (!options.isFirstAuthor) {
    issues.push({
      code: 'NOT_FIRST_AUTHOR',
      message: 'ผู้ขอต้องเป็นผู้เขียนชื่อแรก (First author) ของบทความ',
    });
  }

  // Rules 5 and 6 - the three certifications on form CPRU-RDI-F011.
  if (
    !request.certNotOnStudyLeave ||
    !request.certNotThesisPart ||
    !request.certNotDuplicate
  ) {
    issues.push({
      code: 'CERTIFICATION_INCOMPLETE',
      message: 'กรุณายืนยันคำรับรองให้ครบทั้ง 3 ข้อ',
    });
  }

  // Rule 8 - the article must be published in the calendar year the claim is
  // filed in.
  //
  // This used to compare publishedAt against request.calendarYear, but that
  // column is itself derived from publishedAt (request.service.ts), so the two
  // were equal by construction and the rule never fired - a 2024 article could
  // be claimed in 2026. The year that matters is the one on the clock now.
  const claimYear = calendarYearOf(new Date());
  if (calendarYearOf(request.publishedAt) !== claimYear) {
    issues.push({
      code: 'PUBLISH_YEAR_MISMATCH',
      message:
        `บทความต้องตีพิมพ์ในปีปฏิทินเดียวกับปีที่ยื่นขอ (${claimYear}) ` +
        `แต่บทความนี้ตีพิมพ์ปี ${calendarYearOf(request.publishedAt)}`,
    });
  }

  // Rule 3 - yearly entitlement.
  const quota = await getQuota(request.userId, request.calendarYear, client);
  const otherPending = await client.request.count({
    where: {
      userId: request.userId,
      calendarYear: request.calendarYear,
      status: { in: IN_FLIGHT_STATUSES },
      id: { not: request.id },
    },
  });
  if (quota.used + otherPending >= MAX_ARTICLES_PER_CALENDAR_YEAR) {
    issues.push({
      code: 'QUOTA_EXCEEDED',
      message: `ปี ${request.calendarYear} ใช้สิทธิ์ครบ ${MAX_ARTICLES_PER_CALENDAR_YEAR} เรื่องแล้ว`,
    });
  }

  // Rule 4 - duplicate article, including one still moving through review.
  const duplicate = await findDuplicateArticle(request, ACTIVE_CLAIM_STATUSES, client);
  if (duplicate) {
    const settled = DUPLICATE_BLOCKING_STATUSES.includes(duplicate.status);
    issues.push({
      code: 'DUPLICATE_ARTICLE',
      message: settled
        ? `บทความนี้เคยเบิกไปแล้วในคำขอเลขที่ ${duplicate.requestNo}`
        : `บทความนี้มีคำขอเลขที่ ${duplicate.requestNo} อยู่ระหว่างพิจารณาอยู่แล้ว ` +
          'กรุณายกเลิกคำขอเดิมก่อนหากต้องการยื่นใหม่',
    });
  }

  // Rule 7 - predatory / hijacked journal.
  if (isBlacklistedJournal(request.journalName, request.issn)) {
    issues.push({
      code: 'BLACKLISTED_JOURNAL',
      message: 'วารสารนี้อยู่ในรายชื่อ Hijack Journal หรือ Beall\u2019s List จึงเบิกไม่ได้',
    });
  }

  // Three mandatory attachment types.
  const uploadedTypes = new Set(request.attachments.map((file) => file.docType));
  const missing = REQUIRED_DOC_TYPES.filter((type) => !uploadedTypes.has(type));
  if (missing.length > 0) {
    const labels: Record<string, string> = {
      ACCEPTANCE_LETTER: 'หนังสือตอบรับการตีพิมพ์',
      ARTICLE_COPY: 'สำเนาบทความฉบับเต็ม',
      DATABASE_PROOF: 'หลักฐานแสดงฐานข้อมูลวารสาร',
    };
    issues.push({
      code: 'ATTACHMENT_MISSING',
      message: `ยังขาดเอกสาร: ${missing.map((type) => labels[type]).join(', ')}`,
    });
  }

  // Requested amount must match the published rate for the selected tier.
  const expected = request.fromConference
    ? request.journalTier.rateConference
    : request.journalTier.rateNormal;
  if (!request.amountRequested.equals(expected)) {
    issues.push({
      code: 'AMOUNT_MISMATCH',
      message: `จำนวนเงินที่ขอต้องเท่ากับอัตราตามประกาศ คือ ${Number(expected).toLocaleString('th-TH')} บาท`,
    });
  }

  // A fiscal year must be open, otherwise approval has nothing to draw on.
  const budgetYear = await client.budgetYear.findFirst({ where: { isActive: true } });
  if (!budgetYear) {
    issues.push({
      code: 'NO_ACTIVE_BUDGET_YEAR',
      message: 'ยังไม่ได้ตั้งวงเงินปีงบประมาณปัจจุบัน กรุณาติดต่อผู้ดูแลระบบ',
    });
  }

  return issues;
}

export const REQUEST_STATUS_VALUES = Object.values(RequestStatus);
