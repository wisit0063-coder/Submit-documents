import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/validate';
import { unauthorized } from '../utils/errors';
import { pushPublicKey } from '../notifications/webpush.channel';
import * as pushService from '../services/push.service';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Null when the server has no keys yet; the page then hides the button. */
export const publicKey = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ publicKey: pushPublicKey() });
});

export const subscribe = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const result = await pushService.subscribe(user.id, req.body, req.get('user-agent') ?? null);
  res.status(201).json(result);
});

export const unsubscribe = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  res.json(await pushService.unsubscribe(user.id, (req.body as { endpoint: string }).endpoint));
});

export const test = asyncHandler(async (req: Request, res: Response) => {
  res.json(await pushService.sendTest(requireUser(req).id));
});
