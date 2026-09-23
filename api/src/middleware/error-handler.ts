import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบ endpoint ที่เรียก' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
        details: err.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  // Multer throws its own error class, which used to fall through to the 500
  // below - an oversized upload told the user "internal error" instead of
  // "file too large". It removes the partly written file itself.
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const limitMb = Math.round(env.maxUploadBytes / (1024 * 1024));
      return res.status(422).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: `ไฟล์มีขนาดเกิน ${limitMb}MB กรุณาลดขนาดไฟล์แล้วลองใหม่`,
        },
      });
    }
    return res.status(422).json({
      error: {
        code: 'UPLOAD_REJECTED',
        message: 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาแนบครั้งละ 1 ไฟล์ในช่องที่กำหนด',
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res
        .status(409)
        .json({ error: { code: 'DUPLICATE_ENTRY', message: 'ข้อมูลนี้มีอยู่ในระบบแล้ว' } });
    }
    if (err.code === 'P2025') {
      return res
        .status(404)
        .json({ error: { code: 'NOT_FOUND', message: 'ไม่พบข้อมูลที่ต้องการ' } });
    }
  }

  // Never log request bodies here - they may carry passwords or tokens.
  console.error('[unhandled]', err instanceof Error ? err.stack : err);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง',
      details: env.isProduction ? undefined : String(err),
    },
  });
}
