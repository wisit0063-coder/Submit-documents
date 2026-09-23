import fs from 'fs';
import type { Request, Response } from 'express';
import { DocType } from '@prisma/client';
import { asyncHandler, clientIp, idParam } from '../middleware/validate';
import { serialize } from '../utils/serialize';
import { badRequest, unauthorized } from '../utils/errors';
import { decodeOriginalName } from '../middleware/upload';
import * as attachmentService from '../services/attachment.service';
import * as budgetService from '../services/budget.service';
import * as paymentService from '../services/payment.service';
import * as adminService from '../services/admin.service';
import * as reportService from '../services/report.service';
import { sendStaleReminders } from '../services/reminder.service';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

// ---------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------

export const uploadAttachment = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  if (!req.file) throw badRequest('FILE_REQUIRED', 'กรุณาแนบไฟล์');

  const docType = (req.body as { docType?: string }).docType;
  if (!docType || !(docType in DocType)) {
    throw badRequest('INVALID_DOC_TYPE', 'ประเภทเอกสารไม่ถูกต้อง');
  }

  const attachment = await attachmentService.addAttachment(
    user,
    idParam(req),
    docType as DocType,
    req.file,
    decodeOriginalName(req.file.originalname),
  );
  res.status(201).json(serialize(attachment));
});

/** Files are streamed through here so permissions are checked on every hit. */
export const downloadAttachment = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { attachment, absolutePath } = await attachmentService.openAttachment(
    user,
    idParam(req),
  );

  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
  );

  // An unhandled 'error' on a stream takes the whole process down, and on
  // Passenger that is the entire site. The file is checked before this point,
  // but it can still vanish or lose permissions in between.
  const stream = fs.createReadStream(absolutePath);
  stream.on('error', (error) => {
    console.error('[attachment] read failed', error instanceof Error ? error.message : error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).json({
      error: { code: 'FILE_READ_FAILED', message: 'เปิดไฟล์แนบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' },
    });
  });
  // Stop reading from disk if the browser goes away mid-download.
  res.on('close', () => stream.destroy());
  stream.pipe(res);
});

export const deleteAttachment = asyncHandler(async (req: Request, res: Response) => {
  await attachmentService.deleteAttachment(requireUser(req), idParam(req));
  res.json({ ok: true });
});

export const verifyAttachment = asyncHandler(async (req: Request, res: Response) => {
  const { isVerified } = req.body as { isVerified?: boolean };
  const result = await attachmentService.verifyAttachment(
    requireUser(req),
    idParam(req),
    isVerified ?? true,
  );
  res.json(serialize(result));
});

// ---------------------------------------------------------------
// Budget and payments
// ---------------------------------------------------------------

export const budgetSummary = asyncHandler(async (req: Request, res: Response) => {
  const budgetYearId = req.query.budgetYearId ? BigInt(String(req.query.budgetYearId)) : undefined;
  res.json(serialize(await budgetService.getBudgetSummary(budgetYearId)));
});

export const listBudgetYears = asyncHandler(async (_req: Request, res: Response) => {
  res.json(serialize(await budgetService.listBudgetYears()));
});

export const createBudgetYear = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(serialize(await budgetService.createBudgetYear(req.body)));
});

export const updateBudgetYear = asyncHandler(async (req: Request, res: Response) => {
  const result = await budgetService.updateBudgetYear(idParam(req), req.body);
  res.json(serialize(result));
});

export const listPayments = asyncHandler(async (req: Request, res: Response) => {
  const status = req.query.status as 'pending' | 'paid' | undefined;
  const year = req.query.year ? Number(req.query.year) : undefined;
  res.json(serialize(await paymentService.listPayments({ status, year })));
});

export const pay = asyncHandler(async (req: Request, res: Response) => {
  const result = await paymentService.recordPayment(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

export const refund = asyncHandler(async (req: Request, res: Response) => {
  const result = await paymentService.refundPayment(
    requireUser(req),
    idParam(req),
    req.body,
    clientIp(req),
  );
  res.json(serialize(result));
});

// ---------------------------------------------------------------
// Master data and users
// ---------------------------------------------------------------

export const listFaculties = asyncHandler(async (_req: Request, res: Response) => {
  res.json(serialize(await adminService.listFaculties()));
});

export const listDepartments = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await adminService.listDepartments(idParam(req))));
});

export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  res.json(serialize(await adminService.listRoles()));
});

export const listJournalTiers = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive =
    req.query.includeInactive === 'true' && Boolean(req.user?.roles.includes('ADMIN'));
  res.json(serialize(await adminService.listJournalTiers(includeInactive)));
});

export const createJournalTier = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(serialize(await adminService.createJournalTier(req.body)));
});

export const updateJournalTier = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.updateJournalTier(idParam(req), req.body);
  res.json(serialize(result));
});

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const result = await adminService.listUsers({
    q: req.query.q ? String(req.query.q) : undefined,
    page: req.query.page ? Number(req.query.page) : 1,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
  });
  res.json(serialize(result));
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(serialize(await adminService.createUser(req.body)));
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await adminService.updateUser(idParam(req), req.body)));
});

export const setUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const { isActive } = req.body as { isActive: boolean };
  res.json(serialize(await adminService.setUserStatus(idParam(req), isActive)));
});

// ---------------------------------------------------------------
// Reports
// ---------------------------------------------------------------

function reportFilter(req: Request) {
  return {
    year: req.query.year ? Number(req.query.year) : undefined,
    budgetYearId: req.query.budgetYearId ? String(req.query.budgetYearId) : undefined,
    facultyId: req.query.facultyId ? String(req.query.facultyId) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
  };
}

export const reportByFaculty = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await reportService.reportByFaculty(reportFilter(req))));
});

export const reportByTier = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await reportService.reportByTier(reportFilter(req))));
});

export const reportProcessingTime = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await reportService.reportProcessingTime(reportFilter(req))));
});

export const reportQaIndicator = asyncHandler(async (req: Request, res: Response) => {
  res.json(serialize(await reportService.reportQaIndicator(reportFilter(req))));
});

export const exportReport = asyncHandler(async (req: Request, res: Response) => {
  const buffer = await reportService.exportExcel(reportFilter(req));
  const filename = `cpru-publishing-fee-${Date.now()}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
});

export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  const user = requireUser(req);
  res.json(serialize(await reportService.dashboardSummary(user)));
});

// ---------------------------------------------------------------
// System
// ---------------------------------------------------------------

export const cronReminders = asyncHandler(async (_req: Request, res: Response) => {
  res.json(await sendStaleReminders());
});

export const health = (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'cpru-publishing-fee-api',
    time: new Date().toISOString(),
    timezone: process.env.TZ ?? null,
  });
};
