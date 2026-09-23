import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { notFound } from '../utils/errors';

/**
 * A route parameter read as a BigInt id.
 *
 * BigInt('abc') throws a bare SyntaxError, which is not an AppError and so ends
 * up as a 500 with a stack trace in the log. Crawlers and mistyped links hit
 * these routes constantly, and none of that is an internal error: an id that is
 * not a number simply names nothing.
 */
export function idParam(req: Request, name = 'id'): bigint {
  const raw = req.params[name];
  if (!raw || !/^\d+$/.test(raw)) throw notFound('ไม่พบข้อมูลที่ต้องการ');
  return BigInt(raw);
}

/**
 * Client IP for the audit trail in request_status_logs.
 *
 * Uses req.ip, which Express resolves against the configured `trust proxy` hop
 * count. Reading X-Forwarded-For directly - as this used to - takes whatever the
 * caller put in the header, so anyone could write someone else's address into
 * the audit trail.
 */
export function clientIp(req: Request): string | null {
  return req.ip ?? null;
}

/** Replaces req.body with the parsed value so controllers receive typed data. */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data as z.infer<T>;
    next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true });
    next();
  };
}

export function getQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}

/** Wraps async controllers so rejected promises reach the error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
