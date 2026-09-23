import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError, badRequest, unauthorized } from '../utils/errors';
import { notifyPlain } from '../notifications/dispatcher';
import { loadAuthUser, signToken, type AuthUser } from '../middleware/auth';

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function login(username: string, password: string) {
  // Case-insensitive: phones capitalise the first letter of an email, and on
  // Postgres an exact match would reject 'Admin@cpru.ac.th' for a row stored as
  // 'admin@cpru.ac.th'. MySQL used to fold case in the collation itself.
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
  });

  // Same message for unknown user and wrong password - do not leak which.
  const invalid = unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  if (!user) throw invalid;

  // Password first, account state second: otherwise anyone could type an email
  // into the login form and learn whether it has a pending application.
  const matched = await bcrypt.compare(password, user.passwordHash);
  if (!matched) throw invalid;

  if (user.registrationStatus === 'PENDING') {
    throw new AppError(403, 'ACCOUNT_PENDING', 'บัญชีอยู่ระหว่างรอผู้ดูแลระบบตรวจสอบ');
  }
  if (user.registrationStatus === 'REJECTED') {
    throw new AppError(
      403,
      'ACCOUNT_REJECTED',
      'ใบสมัครไม่ได้รับการอนุมัติ กรุณาติดต่อผู้ดูแลระบบ',
    );
  }
  if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'บัญชีนี้ถูกปิดการใช้งาน');

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const authUser = await loadAuthUser(user.id);
  if (!authUser) throw invalid;

  return { token: signToken(user.id, user.username), user: authUser };
}

export async function changePassword(
  userId: bigint,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const matched = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matched) throw badRequest('INVALID_CURRENT_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw badRequest('PASSWORD_REUSED', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
}

/**
 * Reset tokens are stateless: they are signed with the secret plus the current
 * password hash, so a token stops working the moment the password changes.
 * That keeps single-use semantics without adding a table to the schema.
 */
function resetSecret(passwordHash: string): string {
  return `${env.jwtSecret}:${passwordHash}`;
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  // Always succeed silently so the endpoint cannot be used to enumerate accounts.
  if (!user || !user.isActive) return;

  const token = jwt.sign({ sub: user.id.toString() }, resetSecret(user.passwordHash), {
    expiresIn: '1h',
  });

  await notifyPlain(
    user.id,
    'ตั้งรหัสผ่านใหม่ - ระบบเบิกค่าตอบแทนการตีพิมพ์',
    [
      `เรียน ${user.firstName} ${user.lastName}`,
      'ระบบได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของท่าน',
      'ลิงก์นี้ใช้ได้ภายใน 1 ชั่วโมง หากท่านไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้',
    ].join('\n'),
    `/reset-password?token=${token}`,
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const decoded = jwt.decode(token) as { sub?: string } | null;
  if (!decoded?.sub) throw badRequest('INVALID_RESET_TOKEN', 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว');

  const user = await prisma.user.findUnique({ where: { id: BigInt(decoded.sub) } });
  if (!user) throw badRequest('INVALID_RESET_TOKEN', 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว');

  try {
    jwt.verify(token, resetSecret(user.passwordHash));
  } catch {
    throw badRequest('INVALID_RESET_TOKEN', 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false },
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

export type { AuthUser };
