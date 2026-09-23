import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';

/**
 * Fixed-window limiter kept in process memory.
 *
 * CLAUDE.md section 3 rules out Redis, so the counters live here. That makes the
 * limit best-effort: each process counts on its own and a restart resets the
 * window. It is a brake on scripted sign-up spam, not a security boundary.
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  function consume(key: string, now = Date.now()): boolean {
    // Drop expired windows as we go so the map cannot grow without bound.
    if (hits.size > 5_000) {
      for (const [storedKey, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(storedKey);
      }
    }

    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= options.max;
  }

  function middleware(req: Request, _res: Response, next: NextFunction) {
    const key = req.ip ?? 'unknown';
    if (!consume(key)) {
      return next(
        new AppError(429, 'TOO_MANY_REQUESTS', 'ส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง'),
      );
    }
    next();
  }

  return { middleware, consume };
}

/** Section 13.7: five sign-ups per hour per IP. */
export const registerRateLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

/**
 * Sign-in attempts. Passwords are checked with bcrypt at 10 rounds, so an
 * unthrottled endpoint is both a password-guessing oracle and a cheap way to
 * saturate the CPU of a shared host.
 *
 * Twenty in fifteen minutes leaves room for a person who genuinely cannot
 * remember which of their passwords it was, while ending any scripted attempt.
 */
export const loginRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
