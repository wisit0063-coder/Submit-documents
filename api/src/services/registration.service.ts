import { Prisma, RegistrationStatus } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';
import type { AuthUser } from '../middleware/auth';
import { AppError, conflict, notFound, unprocessable } from '../utils/errors';
import { hashPassword } from './auth.service';
import { notifyPlain, notifyRole } from '../notifications/dispatcher';
import type { ApproveRegistrationInput, RegisterInput } from '../validators/registration.schema';

/**
 * Self-registration (CLAUDE.md section 13).
 *
 * A sign-up creates an inactive account with no roles. Only an ADMIN can turn it
 * on, because rule 1 of the announcement - the claimant must be university
 * staff - is something a person has to check; the system cannot.
 */

/** Roles that only make sense inside one faculty and must carry a scope. */
const FACULTY_SCOPED_ROLES = ['FACULTY_QA', 'DEAN'];

export const STAFF_TRACK_LABELS = { ACADEMIC: 'ฝ่ายวิชาการ', SUPPORT: 'ฝ่ายสนับสนุน' } as const;

const registrationSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phoneMobile: true,
  staffTrack: true,
  registrationStatus: true,
  registrationNote: true,
  registrationReviewedAt: true,
  createdAt: true,
  updatedAt: true,
  faculty: { select: { id: true, code: true, nameTh: true } },
  departmentName: true,
  department: { select: { id: true, nameTh: true } },
  registrationReviewer: { select: { id: true, prefix: true, firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

async function resolveUnit(facultyId: bigint) {
  const faculty = await prisma.faculty.findUnique({ where: { id: facultyId } });
  if (!faculty || !faculty.isActive) {
    throw unprocessable('INVALID_FACULTY', 'ไม่พบหน่วยงาน/สังกัดที่เลือก');
  }
  return faculty;
}

export async function register(input: RegisterInput) {
  const faculty = await resolveUnit(BigInt(input.facultyId));

  // The email doubles as the username (section 13.2), so check both columns.
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: input.email, mode: 'insensitive' } },
        { username: { equals: input.email, mode: 'insensitive' } },
      ],
    },
  });

  // Only a rejected application may be filed again; it reuses its row because
  // email is unique. Anything else - pending, approved, or an account the admin
  // created - already owns this address.
  if (existing && existing.registrationStatus !== RegistrationStatus.REJECTED) {
    throw conflict('EMAIL_ALREADY_REGISTERED', 'อีเมลนี้ถูกใช้สมัครไว้แล้ว');
  }

  const data = {
    email: input.email,
    username: input.email,
    passwordHash: await hashPassword(input.password),
    // The applicant chose this password themselves; no forced change later.
    mustChangePassword: false,
    firstName: input.firstName,
    lastName: input.lastName,
    phoneMobile: input.phone,
    facultyId: faculty.id,
    // Typed by the applicant; an admin links a real departments row later.
    departmentName: input.departmentName,
    departmentId: null,
    staffTrack: input.staffTrack,
    isActive: false,
    registrationStatus: RegistrationStatus.PENDING,
    registrationReviewedBy: null,
    registrationReviewedAt: null,
    registrationNote: null,
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data });

  // After the write has landed: tell every admin there is someone to check.
  await notifyRole(
    'ADMIN',
    'มีใบสมัครสมาชิกใหม่รอตรวจสอบ',
    [
      `ผู้สมัคร: ${input.firstName} ${input.lastName}`,
      `หน่วยงาน/สังกัด: ${faculty.nameTh}`,
      `สายงาน/ฝ่าย: ${STAFF_TRACK_LABELS[input.staffTrack]}`,
      `สาขาวิชาที่กรอก: ${input.departmentName ?? 'ไม่ระบุ'}`,
      `อีเมล: ${input.email}`,
      'กรุณาตรวจสอบว่าเป็นบุคลากรของมหาวิทยาลัยก่อนอนุมัติ',
    ].join('\n'),
    '/admin/registrations',
  );

  return { id: user.id, status: RegistrationStatus.PENDING };
}

export async function listRegistrations(status: RegistrationStatus) {
  return prisma.user.findMany({
    where: { registrationStatus: status },
    // Oldest first: whoever has waited longest is reviewed first.
    orderBy: { updatedAt: 'asc' },
    select: registrationSelect,
  });
}

export async function countPendingRegistrations(): Promise<number> {
  return prisma.user.count({ where: { registrationStatus: RegistrationStatus.PENDING } });
}

async function loadPending(id: bigint) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.registrationStatus === null) throw notFound('ไม่พบใบสมัครที่ระบุ');
  if (user.registrationStatus !== RegistrationStatus.PENDING) {
    throw unprocessable('REGISTRATION_NOT_PENDING', 'ใบสมัครนี้ได้รับการพิจารณาไปแล้ว');
  }
  return user;
}

/**
 * Takes the applicant's row lock inside a transaction and confirms the
 * application is still waiting.
 *
 * `loadPending` runs before the transaction opens, so two admins clicking at the
 * same time both pass it. Without this the applicant is emailed the decision
 * twice, and an approve racing a reject leaves the account active while it is
 * recorded as rejected. Same reasoning as `lockRequest` in request.service.ts.
 */
async function lockPending(client: Tx, id: bigint): Promise<void> {
  const rows = await client.$queryRaw<{ registration_status: RegistrationStatus | null }[]>`
    SELECT registration_status FROM users WHERE id = ${id} FOR UPDATE
  `;
  if (rows[0]?.registration_status !== RegistrationStatus.PENDING) {
    throw unprocessable(
      'REGISTRATION_NOT_PENDING',
      'ใบสมัครนี้เพิ่งถูกพิจารณาไปแล้ว กรุณารีเฟรชหน้าจอแล้วตรวจสอบสถานะล่าสุด',
    );
  }
}

/**
 * Approves an application. RESEARCHER is always granted; the admin may add
 * higher positions in the same step (section 13.4). Faculty-scoped roles with
 * no scope default to the applicant's own unit, because an unscoped DEAN would
 * see every faculty.
 */
export async function approveRegistration(
  admin: AuthUser,
  id: bigint,
  input: ApproveRegistrationInput,
) {
  const applicant = await loadPending(id);

  // The sign-up form does not ask for a unit, so the admin supplies it here.
  // Without one the person cannot file a request: the request snapshots a
  // department, and faculty reviewers are scoped by unit.
  const facultyId = input.facultyId ? BigInt(input.facultyId) : applicant.facultyId;
  if (!facultyId) {
    throw unprocessable('FACULTY_REQUIRED', 'กรุณาระบุหน่วยงาน/สังกัดของผู้สมัครก่อนอนุมัติ');
  }
  await resolveUnit(facultyId);

  const requested = [{ roleCode: 'RESEARCHER', facultyId: null as string | null | undefined }, ...input.roles];
  const codes = [...new Set(requested.map((role) => role.roleCode))];
  const roles = await prisma.role.findMany({ where: { code: { in: codes } } });
  const roleIdByCode = new Map(roles.map((role) => [role.code, role.id]));

  const unknown = codes.filter((code) => !roleIdByCode.has(code));
  if (unknown.length > 0) {
    throw new AppError(400, 'INVALID_ROLE', `ไม่พบบทบาท: ${unknown.join(', ')}`);
  }

  // Deduplicate on (role, scope) - the pair is unique in user_roles.
  const links = new Map<string, { roleId: bigint; facultyId: bigint | null }>();
  for (const role of requested) {
    const scoped = FACULTY_SCOPED_ROLES.includes(role.roleCode);
    const scope = scoped ? (role.facultyId ? BigInt(role.facultyId) : facultyId) : null;
    links.set(`${role.roleCode}:${scope ?? ''}`, {
      roleId: roleIdByCode.get(role.roleCode) as bigint,
      facultyId: scope,
    });
  }

  await prisma.$transaction(async (tx) => {
    await lockPending(tx, id);

    await tx.user.update({
      where: { id },
      data: {
        isActive: true,
        facultyId,
        registrationStatus: RegistrationStatus.APPROVED,
        registrationReviewedBy: admin.id,
        registrationReviewedAt: new Date(),
        registrationNote: null,
      },
    });
    await tx.userRole.createMany({
      data: [...links.values()].map((link) => ({ userId: id, ...link })),
      skipDuplicates: true,
    });
  });

  await notifyPlain(
    id,
    'บัญชีของท่านได้รับการอนุมัติแล้ว - ระบบเบิกค่าตอบแทนการตีพิมพ์',
    [
      `เรียน ${applicant.firstName} ${applicant.lastName}`,
      'ผู้ดูแลระบบอนุมัติใบสมัครของท่านแล้ว',
      `เข้าสู่ระบบได้ด้วยอีเมล ${applicant.email} และรหัสผ่านที่ตั้งไว้ตอนสมัคร`,
    ].join('\n'),
    '/login',
  );

  return prisma.user.findUniqueOrThrow({ where: { id }, select: registrationSelect });
}

export async function rejectRegistration(admin: AuthUser, id: bigint, reason: string) {
  const applicant = await loadPending(id);

  await prisma.$transaction(async (tx) => {
    await lockPending(tx, id);

    await tx.user.update({
      where: { id },
      data: {
        isActive: false,
        registrationStatus: RegistrationStatus.REJECTED,
        registrationReviewedBy: admin.id,
        registrationReviewedAt: new Date(),
        registrationNote: reason,
      },
    });
  });

  await notifyPlain(
    id,
    'ผลการพิจารณาใบสมัคร - ระบบเบิกค่าตอบแทนการตีพิมพ์',
    [
      `เรียน ${applicant.firstName} ${applicant.lastName}`,
      'ใบสมัครของท่านไม่ได้รับการอนุมัติ',
      `เหตุผล: ${reason}`,
      'หากข้อมูลไม่ถูกต้อง ท่านสามารถสมัครใหม่ด้วยอีเมลเดิมได้ หรือติดต่อผู้ดูแลระบบ',
    ].join('\n'),
    '/register',
    { includeInactive: true },
  );

  return prisma.user.findUniqueOrThrow({ where: { id }, select: registrationSelect });
}
