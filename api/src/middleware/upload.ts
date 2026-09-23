import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { env } from '../config/env';
import { badRequest } from '../utils/errors';

/**
 * Attachments are written outside public_html and are never served statically -
 * downloads go through a controller that checks permissions first.
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const now = new Date();
    const dir = path.join(
      env.uploadDir,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
    );
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export const uploadAttachment = multer({
  storage,
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(badRequest('UNSUPPORTED_FILE_TYPE', 'รองรับเฉพาะไฟล์ PDF, JPG และ PNG เท่านั้น'));
      return;
    }
    cb(null, true);
  },
});

/** Original filenames arrive as latin1 from multipart; restore UTF-8 for Thai names. */
export function decodeOriginalName(name: string): string {
  return Buffer.from(name, 'latin1').toString('utf8');
}
