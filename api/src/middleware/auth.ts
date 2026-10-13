import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { forbidden, unauthorized } from '../utils/errors';

export interface AuthUser {
  id: bigint;
  username: string;
  email: string;
  fullName: string;
  /** Academic position as it stands now; snapshotted onto signatures. */
  academicPosition: string | null;
  departmentId: bigint | null;
  facultyId: bigint | null;
  mustChangePassword: boolean;
  roles: string[];
  /** Faculty scope per role, e.g. DEAN of faculty 3. Null means university-wide. */
  roleScopes: { roleCode: string; facultyId: bigint | null }[];
}

export interface JwtPayload {
  sub: string;
  username: string;
}

export function signToken(userId: bigint, username: string): string {
  const payload: JwtPayload = { sub: userId.toString(), username };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn } as jwt.SignOptions);
}

export async function loadAuthUser(userId: bigint): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      department: true,
      userRoles: { include: { role: true } },
    },
  });
  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: `${user.prefix ?? ''}${user.firstName} ${user.lastName}`.trim(),
    academicPosition: user.academicPosition,
    departmentId: user.departmentId,
    // The unit lives on the user (section 13.6) because a self-registered
    // person may have no department. Older accounts fall back to theirs.
    facultyId: user.facultyId ?? user.department?.facultyId ?? null,
    mustChangePassword: user.mustChangePassword,
    roles: user.userRoles.map((ur) => ur.role.code),
    roleScopes: user.userRoles.map((ur) => ({ roleCode: ur.role.code, facultyId: ur.facultyId })),
  };
}

/** Populates req.user from the httpOnly cookie; rejects when absent or stale. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[env.cookieName] as string | undefined;
    if (!token) throw unauthorized();

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, env.jwtSecret) as JwtPayload;
    } catch {
      throw unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }

    const user = await loadAuthUser(BigInt(decoded.sub));
    if (!user) throw unauthorized('บัญชีนี้ถูกปิดการใช้งาน');

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    const allowed = req.user.roles.some((role) => roles.includes(role));
    if (!allowed) return next(forbidden('บทบาทของคุณไม่สามารถเข้าถึงส่วนนี้ได้'));
    next();
  };
}

export function hasRole(user: AuthUser, role: string): boolean {
  return user.roles.includes(role);
}

/** Faculty ids a user holds the given role for. Empty array = university-wide. */
export function facultyScopesFor(user: AuthUser, roleCode: string): bigint[] {
  return user.roleScopes
    .filter((scope) => scope.roleCode === roleCode && scope.facultyId !== null)
    .map((scope) => scope.facultyId as bigint);
}

/** Guards the cron endpoints with a shared secret header instead of a session. */
export function requireCronToken(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('X-Cron-Token');
  if (!env.cronToken || token !== env.cronToken) {
    return next(forbidden('cron token ไม่ถูกต้อง'));
  }
  next();
}
