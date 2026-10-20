import type { Request, Response } from 'express';
import { asyncHandler, clientIp, idParam } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { unauthorized } from '../utils/errors';
import * as positionService from '../services/position.service';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** The handover screen: every signing post, in the order a claim meets them. */
export const list = asyncHandler(async (_req: Request, res: Response) => {
  res.json(serialize(await positionService.listPositionAccounts()));
});

export const logs = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await positionService.listHandoverLogs(idParam(req))));
});

/**
 * Both of these answer with a one-time password, the same way POST /users does:
 * the address on a position account often has no mailbox behind it, so the only
 * reliable way the new holder gets in is the administrator reading it off this
 * response and passing it on.
 */
export const handover = asyncHandler(async (req: Request, res: Response) => {
  const result = await positionService.handoverPosition(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await positionService.resetPositionPassword(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});
