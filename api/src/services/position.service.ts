import crypto from 'crypto';
import { PositionAccountAction, Prisma, RequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { notFound, unprocessable } from '../utils/errors';
import { POSITION_ROLES, POSITION_ROLE_CODES } from '../config/workflow';
import { hashPassword } from './auth.service';
import { notifyPlain } from '../notifications/dispatcher';
import type { AuthUser } from '../middleware/auth';

/**
 * Position accounts: the accounts that sign for each step of the chain.
 *
 * They belong to the post, not to the person holding it. When a term ends the
 * account is handed on rather than replaced, because the claims waiting at a
 * step are found by role and unit - a fresh account would leave that queue
 * sitting under a name nobody holds any more (CLAUDE.md ข้อ 19).
 *
 * Everything here is ADMIN-only, and every change writes a row that nothing
 * deletes, because setting the password of the account that approves money is
 * the same as being handed its signature (ข้อ 18).
 */

function holderName(user: { prefix: string | null; firstName: string; lastName: string }): string {
  return `${user.prefix ?? ''}${user.firstName} ${user.lastName}`.trim();
}

const accountSelect = {
  id: true,
  username: true,
  email: true,
  prefix: true,
  firstName: true,
  lastName: true,
  academicPosition: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  passwordChangedAt: true,
  userRoles: { select: { facultyId: true, role: { select: { code: true, nameTh: true } } } },
  // How many claims the account has FILED itself. Entitlement and claim history
  // belong to a person, not to a post (ข้อ 19.2), so a position account that has
  // filed its own claims passes that history to the next holder. The screen
  // warns on anything above zero rather than refusing.
  //
  // Counted on submitted_at, not on the row existing: a draft was never filed,
  // draws on nobody's entitlement, and is invisible to everyone but its author,
  // so counting it would warn about a handover that costs the new holder
  // nothing. Same question canSeeRequest asks, for the same reason (ข้อ 21.3).
  _count: { select: { requests: { where: { submittedAt: { not: null } } } } },
} satisfies Prisma.UserSelect;

type Account = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

/** Claims per status, and per status and unit, for the queue figures. */
async function waitingCounts() {
  const statuses = POSITION_ROLES.map((role) => role.waitingStatus).filter(
    (status): status is RequestStatus => status !== null,
  );
  const rows = await prisma.request.groupBy({
    by: ['status', 'facultyId'],
    where: { status: { in: statuses } },
    _count: { _all: true },
  });

  const byStatus = new Map<RequestStatus, number>();
  const byStatusFaculty = new Map<string, number>();
  for (const row of rows) {
    const count = row._count._all;
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + count);
    byStatusFaculty.set(`${row.status}:${row.facultyId}`, count);
  }
  return { byStatus, byStatusFaculty };
}

export async function listPositionAccounts() {
  const [accounts, faculties, waiting, handovers] = await Promise.all([
    prisma.user.findMany({
      where: { userRoles: { some: { role: { code: { in: [...POSITION_ROLE_CODES] } } } } },
      select: accountSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.faculty.findMany({
      where: { isActive: true },
      select: { id: true, nameTh: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    }),
    waitingCounts(),
    prisma.positionHandoverLog.groupBy({ by: ['userId'], _max: { createdAt: true } }),
  ]);

  const facultyName = new Map(faculties.map((faculty) => [faculty.id.toString(), faculty.nameTh]));
  const lastHandover = new Map(handovers.map((row) => [row.userId.toString(), row._max.createdAt]));

  const steps = POSITION_ROLES.map((role) => {
    const holders = accounts
      .filter((account) => account.userRoles.some((link) => link.role.code === role.roleCode))
      .map((account) => {
        // The scope of THIS role on this account. Someone may be dean of one
        // unit and quality assurance of another, and the two rows must not
        // borrow each other's unit.
        const scopes = account.userRoles
          .filter((link) => link.role.code === role.roleCode)
          .map((link) => link.facultyId);
        // A null scope means university-wide, which is how one reviewer covers
        // every unit - the same reading getReviewerCoverage and the inbox use.
        const universityWide = scopes.includes(null);

        const queue = role.waitingStatus
          ? universityWide || !role.facultyScoped
            ? (waiting.byStatus.get(role.waitingStatus) ?? 0)
            : scopes.reduce(
                (total, facultyId) =>
                  total + (waiting.byStatusFaculty.get(`${role.waitingStatus}:${facultyId}`) ?? 0),
                0,
              )
          : null;

        return {
          id: account.id,
          username: account.username,
          email: account.email,
          prefix: account.prefix,
          firstName: account.firstName,
          lastName: account.lastName,
          holderName: holderName(account),
          academicPosition: account.academicPosition,
          isActive: account.isActive,
          mustChangePassword: account.mustChangePassword,
          lastLoginAt: account.lastLoginAt,
          passwordChangedAt: account.passwordChangedAt,
          lastHandoverAt: lastHandover.get(account.id.toString()) ?? null,
          facultyIds: scopes,
          facultyNames: universityWide
            ? ['ทุกหน่วยงาน']
            : scopes.map(
                (facultyId) => facultyName.get(String(facultyId)) ?? 'หน่วยงานที่ถูกปิดใช้งาน',
              ),
          // Flags the screen turns into warnings, not refusals: both are the
          // owner's decision to make, not this endpoint's.
          holdsResearcher: account.userRoles.some((link) => link.role.code === 'RESEARCHER'),
          // Listed truthfully - the seed admin really does hold FINANCE - but
          // handover refuses it, so the screen must not offer the button.
          isAdminAccount: account.userRoles.some((link) => link.role.code === 'ADMIN'),
          ownClaims: account._count.requests,
          waitingCount: queue,
        };
      });

    // Units with nobody to sign for them. A claim filed there stops at this
    // step for good and appears in no queue at all (ข้อ 13.5 and ข้อ 21.9),
    // which is exactly the silence this screen is here to break.
    //
    // Only an account that can still sign counts as cover. A disabled one is
    // refused at login by loadAuthUser, so counting it kept this warning silent
    // in the one case it matters most: the unit's only reviewer switched off,
    // and every claim from that unit quietly stopping.
    const signing = holders.filter((holder) => holder.isActive);
    const covered = new Set(
      signing.flatMap((holder) =>
        holder.facultyIds.includes(null)
          ? faculties.map((faculty) => faculty.id.toString())
          : holder.facultyIds.map((facultyId) => String(facultyId)),
      ),
    );
    const unitsWithoutHolder = role.facultyScoped
      ? faculties.filter((faculty) => !covered.has(faculty.id.toString()))
      : [];

    return {
      order: role.order,
      roleCode: role.roleCode,
      labelTh: role.labelTh,
      facultyScoped: role.facultyScoped,
      waitingCount: role.waitingStatus ? (waiting.byStatus.get(role.waitingStatus) ?? 0) : null,
      holders,
      /** Holders who can actually sign; the screen shouts when this is zero. */
      activeHolders: signing.length,
      unitsWithoutHolder,
    };
  });

  return { steps };
}

export function listHandoverLogs(userId: bigint) {
  return prisma.positionHandoverLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/** Loads the target and refuses anything that is not a position account. */
async function loadPositionAccount(targetId: bigint, actor: AuthUser): Promise<Account> {
  const account = await prisma.user.findUnique({ where: { id: targetId }, select: accountSelect });
  if (!account) throw notFound('ไม่พบบัญชีผู้ใช้');

  // Doing this to your own account would sign you out holding a password you
  // were never shown, and there is no path back in that does not need the old
  // one. Changing your own password has its own page.
  if (account.id === actor.id) {
    throw unprocessable(
      'SELF_HANDOVER',
      'ตั้งรหัสผ่านของบัญชีตัวเองที่หน้านี้ไม่ได้ กรุณาใช้เมนูเปลี่ยนรหัสผ่าน',
    );
  }

  // Asked before the position check, because holding a signing role is not
  // enough to make an account safe to take over: the seed admin account holds
  // ADMIN *and* FINANCE, so checking only for a position role let one
  // administrator set another administrator's password and sign in as them -
  // including the owner's own account. Being an administrator is not a post that
  // changes hands, so it is simply out of scope here.
  if (account.userRoles.some((link) => link.role.code === 'ADMIN')) {
    throw unprocessable(
      'ADMIN_ACCOUNT',
      'บัญชีนี้ถือบทบาทผู้ดูแลระบบ จึงส่งมอบหรือตั้งรหัสผ่านที่หน้านี้ไม่ได้',
    );
  }

  // Deliberately narrow. This exists for the posts that sign, so it cannot be
  // turned on an ordinary claimant.
  const isPosition = account.userRoles.some((link) => POSITION_ROLE_CODES.includes(link.role.code));
  if (!isPosition) {
    throw unprocessable(
      'NOT_POSITION_ACCOUNT',
      'บัญชีนี้ไม่ใช่บัญชีประจำตำแหน่งในสายการอนุมัติ จึงส่งมอบที่หน้านี้ไม่ได้',
    );
  }

  return account;
}

/** The steps the account could sign for, as text, frozen into the log row. */
function rolesSnapshot(account: Account): string {
  return account.userRoles
    .map((link) => link.role.nameTh || link.role.code)
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' · ');
}

interface Change {
  action: PositionAccountAction;
  newHolder: { prefix: string | null; firstName: string; lastName: string } | null;
  academicPosition?: string | null;
  reason: string;
}

/**
 * Sets a new password on a position account - and, when a new holder is given,
 * the name that goes with it - in the same transaction as the evidence row.
 *
 * The password is generated here and handed back exactly once. An administrator
 * never chooses it, it is never stored or written to a log (ข้อ 11), and the
 * account keeps mustChangePassword so the new holder replaces it at first
 * login. The administrator is therefore left not knowing the credential that
 * signs, which is the point: they can grant the ability to sign, not use it.
 */
async function applyChange(
  actor: AuthUser,
  targetId: bigint,
  change: Change,
  ipAddress: string | null,
) {
  const account = await loadPositionAccount(targetId, actor);

  // Read separately rather than through accountSelect, which feeds the list
  // endpoint and the response body - a hash must not travel to a browser.
  const before = await prisma.user.findUniqueOrThrow({
    where: { id: account.id },
    select: { passwordHash: true },
  });

  const tempPassword = crypto.randomBytes(6).toString('base64url');
  const passwordHash = await hashPassword(tempPassword);
  const previousHolder = holderName(account);
  const snapshot = rolesSnapshot(account);

  const updated = await prisma.$transaction(async (tx) => {
    // Everything above was decided outside this transaction, so two
    // administrators acting at the same moment both got here. Both writes
    // succeeded, the second overwrote the first, and the administrator holding
    // the losing password handed a dead credential to the new holder with
    // nothing on screen to say so. Re-reading under a row lock turns that into
    // a refusal the second one can see - the same trap lockRequest exists to
    // close (CLAUDE.md ข้อ 9), and the same rule as refundPayment: anything
    // that rewrites a value has to re-check it inside the lock.
    const locked = await tx.$queryRaw<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE id = ${account.id} FOR UPDATE
    `;
    if (locked[0]?.password_hash !== before.passwordHash) {
      throw unprocessable(
        'INVALID_STATE',
        'บัญชีนี้เพิ่งถูกตั้งรหัสผ่านใหม่ไปแล้ว กรุณารีเฟรชหน้าจอแล้วตรวจสอบประวัติล่าสุด',
      );
    }

    const user = await tx.user.update({
      where: { id: account.id },
      data: {
        passwordHash,
        mustChangePassword: true,
        // What ends the previous holder's open sessions. Without it they keep
        // acting for this post until their token expires (utils/session.ts).
        passwordChangedAt: new Date(),
        ...(change.newHolder
          ? {
              prefix: change.newHolder.prefix,
              firstName: change.newHolder.firstName,
              lastName: change.newHolder.lastName,
              academicPosition: change.academicPosition ?? null,
            }
          : {}),
      },
      select: accountSelect,
    });

    // The previous holder's browsers are still subscribed to this account and
    // would keep showing "a claim is waiting for you" to someone who no longer
    // holds the post. The new holder allows notifications on their own device.
    await tx.pushSubscription.deleteMany({ where: { userId: account.id } });

    await tx.positionHandoverLog.create({
      data: {
        userId: account.id,
        action: change.action,
        actorId: actor.id,
        actorName: actor.fullName,
        previousHolder,
        newHolder: holderName(user),
        previousPosition: account.academicPosition,
        newPosition: user.academicPosition,
        rolesSnapshot: snapshot,
        reason: change.reason.trim(),
        ipAddress,
      },
    });

    return user;
  });

  // Best-effort, and known to go nowhere on a position account whose address
  // the office invented (ข้อ 19.3). The password reaches the new holder by hand
  // from the response body, which is the whole reason it is returned.
  await notifyPlain(
    updated.id,
    'ตั้งรหัสผ่านใหม่สำหรับบัญชีประจำตำแหน่ง',
    [
      `เรียน ${updated.firstName} ${updated.lastName}`,
      'ผู้ดูแลระบบได้ตั้งรหัสผ่านใหม่สำหรับบัญชีประจำตำแหน่งนี้',
      `ชื่อผู้ใช้: ${updated.username}`,
      'กรุณาเข้าสู่ระบบและเปลี่ยนรหัสผ่านทันทีในการเข้าใช้ครั้งแรก',
    ].join('\n'),
    '/login',
  );

  return { account: updated, tempPassword };
}

export function handoverPosition(
  actor: AuthUser,
  targetId: bigint,
  input: {
    prefix?: string | null;
    firstName: string;
    lastName: string;
    academicPosition?: string | null;
    reason: string;
  },
  ipAddress: string | null,
) {
  return applyChange(
    actor,
    targetId,
    {
      action: PositionAccountAction.HANDOVER,
      newHolder: {
        prefix: input.prefix ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
      },
      academicPosition: input.academicPosition ?? null,
      reason: input.reason,
    },
    ipAddress,
  );
}

export function resetPositionPassword(
  actor: AuthUser,
  targetId: bigint,
  input: { reason: string },
  ipAddress: string | null,
) {
  return applyChange(
    actor,
    targetId,
    { action: PositionAccountAction.PASSWORD_RESET, newHolder: null, reason: input.reason },
    ipAddress,
  );
}
