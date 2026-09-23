import crypto from 'crypto';
import { Prisma, type StaffTrack } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import { badRequest, notFound, unprocessable } from '../utils/errors';
import { hashPassword } from './auth.service';
import { notifyPlain } from '../notifications/dispatcher';

// ---------------------------------------------------------------
// Master data
// ---------------------------------------------------------------

export function listFaculties() {
  return prisma.faculty.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
}

export function listDepartments(facultyId: bigint) {
  return prisma.department.findMany({
    where: { facultyId, isActive: true },
    orderBy: { code: 'asc' },
  });
}

export function listRoles() {
  return prisma.role.findMany({ orderBy: { id: 'asc' } });
}

/**
 * Only active tiers reach the request form. Closed databases such as ACI are
 * deactivated rather than deleted, because older requests still point at them.
 */
export function listJournalTiers(includeInactive = false) {
  return prisma.journalTier.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export function createJournalTier(input: {
  code: string;
  nameTh: string;
  databaseName: string;
  quartile?: string | null;
  rateNormal: number;
  rateConference: number;
  announcementRef?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  sortOrder: number;
}) {
  return prisma.journalTier.create({
    data: {
      code: input.code,
      nameTh: input.nameTh,
      databaseName: input.databaseName,
      quartile: input.quartile ?? null,
      rateNormal: new Prisma.Decimal(input.rateNormal),
      rateConference: new Prisma.Decimal(input.rateConference),
      announcementRef: input.announcementRef ?? null,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
}

export async function updateJournalTier(
  id: bigint,
  input: Partial<{
    code: string;
    nameTh: string;
    databaseName: string;
    quartile: string | null;
    rateNormal: number;
    rateConference: number;
    announcementRef: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    isActive: boolean;
    sortOrder: number;
  }>,
) {
  const existing = await prisma.journalTier.findUnique({ where: { id } });
  if (!existing) throw notFound('ไม่พบประเภทวารสารที่ระบุ');

  return prisma.journalTier.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.nameTh !== undefined ? { nameTh: input.nameTh } : {}),
      ...(input.databaseName !== undefined ? { databaseName: input.databaseName } : {}),
      ...(input.quartile !== undefined ? { quartile: input.quartile } : {}),
      ...(input.rateNormal !== undefined
        ? { rateNormal: new Prisma.Decimal(input.rateNormal) }
        : {}),
      ...(input.rateConference !== undefined
        ? { rateConference: new Prisma.Decimal(input.rateConference) }
        : {}),
      ...(input.announcementRef !== undefined ? { announcementRef: input.announcementRef } : {}),
      ...(input.effectiveFrom ? { effectiveFrom: new Date(input.effectiveFrom) } : {}),
      ...(input.effectiveTo !== undefined
        ? { effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    },
  });
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------

const userSelect = {
  id: true,
  username: true,
  email: true,
  prefix: true,
  firstName: true,
  lastName: true,
  academicPosition: true,
  phoneInternal: true,
  phoneMobile: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  staffTrack: true,
  registrationStatus: true,
  departmentName: true,
  faculty: { select: { id: true, nameTh: true } },
  department: {
    select: { id: true, nameTh: true, faculty: { select: { id: true, nameTh: true } } },
  },
  userRoles: { select: { id: true, facultyId: true, role: { select: { id: true, code: true, nameTh: true } } } },
} satisfies Prisma.UserSelect;

/**
 * Works out the unit and department to store on a user. A department always
 * implies its faculty; giving both is allowed only when they agree.
 */
async function resolveUserUnit(
  facultyId: string | null | undefined,
  departmentId: string | null | undefined,
): Promise<{ facultyId: bigint | null; departmentId: bigint | null }> {
  const department = departmentId
    ? await prisma.department.findUnique({ where: { id: BigInt(departmentId) } })
    : null;
  if (departmentId && !department) throw badRequest('INVALID_DEPARTMENT', 'ไม่พบสาขาวิชาที่ระบุ');

  if (facultyId && department && department.facultyId !== BigInt(facultyId)) {
    throw unprocessable(
      'DEPARTMENT_FACULTY_MISMATCH',
      'สาขาวิชาที่เลือกไม่อยู่ในหน่วยงาน/สังกัดที่เลือก',
    );
  }

  return {
    facultyId: facultyId ? BigInt(facultyId) : (department?.facultyId ?? null),
    departmentId: department?.id ?? null,
  };
}

export async function listUsers(query: { q?: string; page: number; pageSize: number }) {
  const where: Prisma.UserWhereInput = query.q
    ? {
        OR: [
          // Postgres compares strings case-sensitively, unlike the MySQL
          // collation this used to run on: without the mode the search box
          // would miss 'Somchai' when the user types 'somchai'.
          { username: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { firstName: { contains: query.q, mode: 'insensitive' } },
          { lastName: { contains: query.q, mode: 'insensitive' } },
        ],
      }
    : {};

  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return { items, total, page: query.page, pageSize: query.pageSize };
}

interface RoleAssignment {
  roleCode: string;
  facultyId?: string | null;
}

async function resolveRoleIds(roles: RoleAssignment[]) {
  const codes = [...new Set(roles.map((role) => role.roleCode))];
  const found = await prisma.role.findMany({ where: { code: { in: codes } } });
  const byCode = new Map(found.map((role) => [role.code, role.id]));

  const missing = codes.filter((code) => !byCode.has(code));
  if (missing.length > 0) {
    throw badRequest('INVALID_ROLE', `ไม่พบบทบาท: ${missing.join(', ')}`);
  }
  return roles.map((role) => ({
    roleId: byCode.get(role.roleCode) as bigint,
    facultyId: role.facultyId ? BigInt(role.facultyId) : null,
  }));
}

const ADMIN_ROLE = 'ADMIN';

/**
 * Accounts other than `excludeUserId` that can still reach the admin screens:
 * active, and holding ADMIN.
 *
 * Nothing in the app can grant ADMIN back once the last holder loses it - the
 * only way out is editing user_roles directly in the database. So any change that
 * would take this to zero is refused rather than confirmed.
 */
async function countOtherActiveAdmins(excludeUserId: bigint, client: Tx = prisma): Promise<number> {
  return client.user.count({
    where: {
      id: { not: excludeUserId },
      isActive: true,
      userRoles: { some: { role: { code: ADMIN_ROLE } } },
    },
  });
}

/** Temporary password is emailed to the account holder and must be changed on first login. */
export async function createUser(input: {
  username: string;
  email: string;
  prefix?: string | null;
  firstName: string;
  lastName: string;
  academicPosition?: string | null;
  facultyId?: string | null;
  departmentId?: string | null;
  staffTrack?: StaffTrack | null;
  phoneInternal?: string | null;
  phoneMobile?: string | null;
  roles: RoleAssignment[];
}) {
  const roleLinks = await resolveRoleIds(input.roles);
  const unit = await resolveUserUnit(input.facultyId, input.departmentId);
  const tempPassword = crypto.randomBytes(6).toString('base64url');

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        username: input.username,
        email: input.email,
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        prefix: input.prefix ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        academicPosition: input.academicPosition ?? null,
        facultyId: unit.facultyId,
        departmentId: unit.departmentId,
        staffTrack: input.staffTrack ?? null,
        phoneInternal: input.phoneInternal ?? null,
        phoneMobile: input.phoneMobile ?? null,
      },
    });

    await tx.userRole.createMany({
      data: roleLinks.map((link) => ({
        userId: created.id,
        roleId: link.roleId,
        facultyId: link.facultyId,
      })),
    });

    return created;
  });

  // The password is emailed as well, but the email is best-effort: with
  // MAIL_DRIVER=log, or whenever the university SMTP is unreachable, it never
  // arrives and the account would be unreachable forever.
  await notifyPlain(
    user.id,
    'บัญชีผู้ใช้ระบบเบิกค่าตอบแทนการตีพิมพ์',
    [
      `เรียน ${input.firstName} ${input.lastName}`,
      'ระบบได้สร้างบัญชีผู้ใช้สำหรับท่านเรียบร้อยแล้ว',
      `ชื่อผู้ใช้: ${input.username}`,
      `รหัสผ่านชั่วคราว: ${tempPassword}`,
      'กรุณาเข้าสู่ระบบและเปลี่ยนรหัสผ่านทันทีในการเข้าใช้ครั้งแรก',
    ].join('\n'),
    '/login',
  );

  const created = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: userSelect,
  });

  // Handed back exactly once, in the response body of the call that created the
  // account, so the admin can pass it on by hand when the email does not land.
  // It is never written to a log or stored anywhere else (CLAUDE.md ข้อ 11) and
  // the account still carries mustChangePassword, so it dies at first login.
  return { ...created, tempPassword };
}

export async function updateUser(
  id: bigint,
  input: Partial<{
    username: string;
    email: string;
    prefix: string | null;
    firstName: string;
    lastName: string;
    academicPosition: string | null;
    facultyId: string | null;
    departmentId: string | null;
    staffTrack: StaffTrack | null;
    phoneInternal: string | null;
    phoneMobile: string | null;
    roles: RoleAssignment[];
  }>,
) {
  const existing = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { select: { role: { select: { code: true } } } } },
  });
  if (!existing) throw notFound('ไม่พบผู้ใช้ที่ระบุ');

  // Refuse to strip ADMIN from the last active holder. Checked before the
  // transaction so nothing is written when the answer is no; the account being
  // edited is excluded from the count because its own roles are about to change.
  if (input.roles) {
    const hasAdminNow = existing.userRoles.some((link) => link.role.code === ADMIN_ROLE);
    const keepsAdmin = input.roles.some((role) => role.roleCode === ADMIN_ROLE);
    if (existing.isActive && hasAdminNow && !keepsAdmin) {
      if ((await countOtherActiveAdmins(id)) === 0) {
        throw unprocessable(
          'LAST_ADMIN',
          'ถอดบทบาทผู้ดูแลระบบออกไม่ได้ เพราะนี่เป็นผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย ' +
            'กรุณามอบบทบาทผู้ดูแลระบบให้ผู้ใช้อีกคนก่อน',
        );
      }
    }
  }

  const unitChanged = input.facultyId !== undefined || input.departmentId !== undefined;
  const unit = unitChanged
    ? await resolveUserUnit(
        input.facultyId !== undefined ? input.facultyId : existing.facultyId?.toString(),
        input.departmentId !== undefined ? input.departmentId : existing.departmentId?.toString(),
      )
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.prefix !== undefined ? { prefix: input.prefix } : {}),
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.academicPosition !== undefined
          ? { academicPosition: input.academicPosition }
          : {}),
        ...(unit ? { facultyId: unit.facultyId, departmentId: unit.departmentId } : {}),
        ...(input.staffTrack !== undefined ? { staffTrack: input.staffTrack } : {}),
        ...(input.phoneInternal !== undefined ? { phoneInternal: input.phoneInternal } : {}),
        ...(input.phoneMobile !== undefined ? { phoneMobile: input.phoneMobile } : {}),
      },
    });

    if (input.roles) {
      const roleLinks = await resolveRoleIds(input.roles);
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({
        data: roleLinks.map((link) => ({ userId: id, roleId: link.roleId, facultyId: link.facultyId })),
      });
    }
  });

  return prisma.user.findUniqueOrThrow({ where: { id }, select: userSelect });
}

export async function setUserStatus(id: bigint, isActive: boolean) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { userRoles: { select: { role: { select: { code: true } } } } },
  });
  if (!user) throw notFound('ไม่พบผู้ใช้ที่ระบุ');

  // Deactivating locks the account out just as surely as removing the role
  // (loadAuthUser rejects inactive users), so the same guard applies here.
  if (!isActive && user.isActive && user.userRoles.some((link) => link.role.code === ADMIN_ROLE)) {
    if ((await countOtherActiveAdmins(id)) === 0) {
      throw unprocessable(
        'LAST_ADMIN',
        'ปิดใช้งานบัญชีนี้ไม่ได้ เพราะเป็นผู้ดูแลระบบที่ใช้งานอยู่คนสุดท้าย ' +
          'กรุณามอบบทบาทผู้ดูแลระบบให้ผู้ใช้อีกคนก่อน',
      );
    }
  }

  // Switching an application on here would skip the approval step and leave it
  // with no roles. Applications are decided on the registrations page.
  if (user.registrationStatus === 'PENDING' || user.registrationStatus === 'REJECTED') {
    throw unprocessable(
      'REGISTRATION_NOT_APPROVED',
      'บัญชีนี้มาจากใบสมัครที่ยังไม่ได้อนุมัติ กรุณาพิจารณาที่เมนูใบสมัครสมาชิก',
    );
  }

  return prisma.user.update({ where: { id }, data: { isActive }, select: userSelect });
}

/**
 * Units that are missing a faculty-level reviewer (section 13.5). A request
 * filed from such a unit would sit in the first workflow step forever, so the
 * admin is warned up front. A role granted with no faculty scope covers every
 * unit, matching how the inbox treats it.
 */
export async function getReviewerCoverage() {
  const [faculties, scopedRoles] = await Promise.all([
    prisma.faculty.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } }),
    prisma.userRole.findMany({
      where: { role: { code: { in: ['FACULTY_QA', 'DEAN'] } }, user: { isActive: true } },
      select: { facultyId: true, role: { select: { code: true } } },
    }),
  ]);

  const covers = (roleCode: string, facultyId: bigint) =>
    scopedRoles.some(
      (link) =>
        link.role.code === roleCode && (link.facultyId === null || link.facultyId === facultyId),
    );

  return faculties
    .map((faculty) => ({
      facultyId: faculty.id,
      facultyName: faculty.nameTh,
      missingFacultyQa: !covers('FACULTY_QA', faculty.id),
      missingDean: !covers('DEAN', faculty.id),
    }))
    .filter((row) => row.missingFacultyQa || row.missingDean);
}

export { userSelect };
