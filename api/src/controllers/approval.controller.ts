import type { Request, Response } from 'express';
import { asyncHandler, clientIp, idParam } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { unauthorized } from '../utils/errors';
import * as approvalService from '../services/approval.service';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const inbox = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await approvalService.getInbox(requireUser(req))));
});

export const inboxCount = asyncHandler(async (req: Request, res: Response) => {
  res.json({ count: await approvalService.getInboxCount(requireUser(req)) });
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvalService.approveStep(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const returnToRequester = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvalService.returnStep(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  const { comment } = req.body as { comment: string };
  const result = await approvalService.rejectRequest(
    requireUser(req),
    idParam(req),
    comment,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const finalApprove = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvalService.finalApprove(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const toCommittee = asyncHandler(async (req: Request, res: Response) => {
  const { comment } = req.body as { comment: string };
  const result = await approvalService.sendToCommittee(
    requireUser(req),
    idParam(req),
    comment,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const setQaYear = asyncHandler(async (req: Request, res: Response) => {
  const { qaIndicatorYear } = req.body as { qaIndicatorYear: number };
  const result = await approvalService.setQaIndicatorYear(
    requireUser(req),
    idParam(req),
    qaIndicatorYear,
  );
  res.json(serialize(result));
});
