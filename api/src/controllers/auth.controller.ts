import type { Request, Response } from 'express';
import { env } from '../config/env';
import { asyncHandler } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { unauthorized } from '../utils/errors';
import { calendarYearOf } from '../utils/datetime';
import * as authService from '../services/auth.service';
import { getQuota } from '../services/validation.service';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body as { username: string; password: string };
  const { token, user } = await authService.login(username, password);

  res.cookie(env.cookieName, token, authService.cookieOptions());
  res.json(serialize({ user }));
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie(env.cookieName, { ...authService.cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

/** Current identity plus the remaining entitlement for this calendar year. */
export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw unauthorized();
  const quota = await getQuota(req.user.id, calendarYearOf(new Date()));
  res.json(serialize({ user: req.user, quota }));
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw unauthorized();
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  res.json({ ok: true });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.requestPasswordReset((req.body as { email: string }).email);
  // Always the same answer, whether or not the address exists.
  res.json({ ok: true });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token: string; newPassword: string };
  await authService.resetPassword(token, newPassword);
  res.json({ ok: true });
});
