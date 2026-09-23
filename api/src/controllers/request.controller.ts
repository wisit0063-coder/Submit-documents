import type { Request, Response } from 'express';
import { asyncHandler, clientIp, getQuery, idParam } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { unauthorized } from '../utils/errors';
import * as requestService from '../services/request.service';
import { buildRequestDocument } from '../services/pdf.service';
import type { ListRequestsQuery } from '../validators/request.schema';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const query = getQuery<ListRequestsQuery>(req);
  const result = await requestService.listRequests(user, query);
  res.json(serialize(result));
});

export const detail = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const request = await requestService.getRequestDetail(user, idParam(req));
  res.json(serialize(request));
});

export const timeline = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const logs = await requestService.getTimeline(user, idParam(req));
  res.json(serialize(logs));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const request = await requestService.createRequest(user, req.body);
  res.status(201).json(serialize(request));
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const request = await requestService.updateRequest(user, idParam(req), req.body);
  res.json(serialize(request));
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { isFirstAuthor } = req.body as { isFirstAuthor: boolean };
  const request = await requestService.submitRequest(
    user,
    idParam(req),
    isFirstAuthor,
    clientIp(req),
  );
  res.json(serialize(request));
});

export const resubmit = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { isFirstAuthor } = req.body as { isFirstAuthor: boolean };
  const request = await requestService.resubmitRequest(
    user,
    idParam(req),
    isFirstAuthor,
    clientIp(req),
  );
  res.json(serialize(request));
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const request = await requestService.cancelRequest(
    user,
    idParam(req),
    clientIp(req),
  );
  res.json(serialize(request));
});

export const checkSubmit = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const result = await requestService.checkSubmit(
    user,
    idParam(req),
    (req.body as { isFirstAuthor?: boolean }).isFirstAuthor ?? true,
  );
  res.json(serialize(result));
});

export const previewAmount = asyncHandler(async (req: Request, res: Response) => {
  const { journalTierId, fromConference } = req.body as {
    journalTierId: string;
    fromConference: boolean;
  };
  const result = await requestService.previewAmount(BigInt(journalTierId), fromConference);
  res.json(serialize(result));
});

export const myQuota = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json(serialize(await requestService.getMyQuota(user, year)));
});

/** Streams the CPRU-RDI-F011 memo as a PDF. */
export const document = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const request = await requestService.getRequestDetail(user, idParam(req));

  // Built before any header goes out: a missing font throws, and that must reach
  // the error handler as JSON rather than as a truncated PDF.
  const document = buildRequestDocument(request);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${request.requestNo}.pdf"; filename*=UTF-8''${encodeURIComponent(`${request.requestNo}.pdf`)}`,
  );

  // Same reason as the attachment download: an unhandled 'error' here would kill
  // the process, not just this response.
  document.on('error', (error: unknown) => {
    console.error('[pdf] render failed', error instanceof Error ? error.message : error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).json({
      error: { code: 'PDF_RENDER_FAILED', message: 'สร้างเอกสาร PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
    });
  });

  document.pipe(res);
});
