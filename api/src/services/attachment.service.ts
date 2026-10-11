import fs from 'fs';
import path from 'path';
import { DocType, RequestStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import type { AuthUser } from '../middleware/auth';
import { EDITABLE_STATUSES } from '../config/workflow';
import { forbidden, notFound, unprocessable } from '../utils/errors';
import { canViewRequest } from './request.service';

/** Removes an orphaned upload when the database write is refused. */
function discard(storedPath: string): void {
  fs.promises.unlink(storedPath).catch(() => undefined);
}

export async function addAttachment(
  user: AuthUser,
  requestId: bigint,
  docType: DocType,
  file: Express.Multer.File,
  originalName: string,
) {
  const request = await prisma.request.findUnique({ where: { id: requestId } });
  if (!request) {
    discard(file.path);
    throw notFound('ไม่พบคำขอที่ระบุ');
  }
  if (request.userId !== user.id) {
    discard(file.path);
    throw forbidden('แนบไฟล์ได้เฉพาะคำขอของตนเอง');
  }
  if (!EDITABLE_STATUSES.includes(request.status)) {
    discard(file.path);
    throw unprocessable('NOT_EDITABLE', 'แนบไฟล์ได้เฉพาะสถานะร่างหรือถูกตีกลับเท่านั้น');
  }

  // One file per mandatory document type: a replacement supersedes the old one.
  if (docType !== DocType.ADDITIONAL) {
    const existing = await prisma.requestAttachment.findFirst({ where: { requestId, docType } });
    if (existing) {
      await prisma.requestAttachment.delete({ where: { id: existing.id } });
      discard(existing.storedPath);
    }
  }

  return prisma.requestAttachment.create({
    data: {
      requestId,
      docType,
      fileName: originalName,
      storedPath: file.path,
      mimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: user.id,
    },
  });
}

/**
 * Attachments live outside public_html and are never served statically: every
 * download passes through this check first.
 */
export async function openAttachment(user: AuthUser, attachmentId: bigint) {
  const attachment = await prisma.requestAttachment.findUnique({
    where: { id: attachmentId },
    include: { request: { select: { id: true, userId: true, facultyId: true, status: true } } },
  });
  if (!attachment) throw notFound('ไม่พบไฟล์แนบที่ระบุ');
  if (!canViewRequest(user, attachment.request)) {
    throw forbidden('คุณไม่มีสิทธิ์เข้าถึงไฟล์นี้');
  }

  // Defence in depth: never read outside the configured upload root, whatever
  // the stored path says.
  const resolved = path.resolve(attachment.storedPath);
  if (!resolved.startsWith(path.resolve(env.uploadDir))) {
    throw forbidden('เส้นทางไฟล์ไม่ถูกต้อง');
  }
  if (!fs.existsSync(resolved)) throw notFound('ไฟล์นี้ไม่มีอยู่บนเซิร์ฟเวอร์แล้ว');

  return { attachment, absolutePath: resolved };
}

export async function deleteAttachment(user: AuthUser, attachmentId: bigint) {
  const attachment = await prisma.requestAttachment.findUnique({
    where: { id: attachmentId },
    include: { request: { select: { id: true, userId: true, status: true } } },
  });
  if (!attachment) throw notFound('ไม่พบไฟล์แนบที่ระบุ');
  if (attachment.request.userId !== user.id) throw forbidden('ลบได้เฉพาะไฟล์ของตนเอง');
  if (!EDITABLE_STATUSES.includes(attachment.request.status)) {
    throw unprocessable('NOT_EDITABLE', 'ลบไฟล์ได้เฉพาะสถานะร่างหรือถูกตีกลับเท่านั้น');
  }

  await prisma.requestAttachment.delete({ where: { id: attachmentId } });
  discard(attachment.storedPath);
}

/** RDI ticks off each document as it is checked against the evidence rules. */
export async function verifyAttachment(user: AuthUser, attachmentId: bigint, isVerified: boolean) {
  const attachment = await prisma.requestAttachment.findUnique({
    where: { id: attachmentId },
    include: { request: { select: { status: true } } },
  });
  if (!attachment) throw notFound('ไม่พบไฟล์แนบที่ระบุ');
  if (attachment.request.status === RequestStatus.DRAFT) {
    throw unprocessable('NOT_SUBMITTED', 'คำขอนี้ยังไม่ได้ยื่นเข้าระบบ');
  }

  return prisma.requestAttachment.update({
    where: { id: attachmentId },
    data: {
      isVerified,
      verifiedBy: isVerified ? user.id : null,
      verifiedAt: isVerified ? new Date() : null,
    },
  });
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  ACCEPTANCE_LETTER: 'หนังสือตอบรับการตีพิมพ์',
  ARTICLE_COPY: 'สำเนาบทความฉบับเต็ม',
  DATABASE_PROOF: 'หลักฐานแสดงฐานข้อมูลวารสาร',
  ADDITIONAL: 'เอกสารเพิ่มเติม',
};
