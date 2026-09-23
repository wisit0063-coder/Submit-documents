import type { Request, Response } from 'express';
import type { RegistrationStatus } from '@prisma/client';
import { asyncHandler, getQuery, idParam } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { unauthorized } from '../utils/errors';
import * as registrationService from '../services/registration.service';
import { getReviewerCoverage } from '../services/admin.service';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Public. No cookie is issued: the account stays locked until an admin approves it. */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await registrationService.register(req.body);
  res.status(201).json(serialize({ status: result.status }));
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { status } = getQuery<{ status: RegistrationStatus }>(req);
  res.json(serialize(await registrationService.listRegistrations(status)));
});

export const count = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ count: await registrationService.countPendingRegistrations() });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const result = await registrationService.approveRegistration(
    requireUser(req),
    idParam(req),
    req.body,
  );
  res.json(serialize(result));
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const { reason } = req.body as { reason: string };
  const result = await registrationService.rejectRegistration(
    requireUser(req),
    idParam(req),
    reason,
  );
  res.json(serialize(result));
});

export const coverage = asyncHandler(async (_req: Request, res: Response) => {
  res.json(serialize(await getReviewerCoverage()));
});
