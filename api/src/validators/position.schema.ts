import { z } from 'zod';
import { stripInvisible } from '../utils/text';

/**
 * Handing a position account to its next holder (CLAUDE.md ข้อ 19).
 *
 * The name typed here is printed on the memo and the receipt voucher and is
 * snapshotted onto every signature the new holder makes, so it gets the same
 * cleaning as the other fields that reach paper (ข้อ 22.3).
 */
const cleaned = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? stripInvisible(value) : value), schema);

/**
 * Required, and not merely for the record: a password here stands in for a
 * signature (ข้อ 18), so granting one has to carry a stated reason the way a
 * change to the fund ceiling does (ข้อ 7.1). Same floor of five characters.
 */
const reason = z
  .string({ required_error: 'กรุณาระบุเหตุผล' })
  .trim()
  .min(5, 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร')
  .max(2000, 'เหตุผลยาวเกินไป');

export const handoverPositionSchema = z
  .object({
    prefix: cleaned(
      z.string().trim().min(1, 'กรุณากรอกคำนำหน้าชื่อ').max(50, 'คำนำหน้าชื่อยาวเกินไป'),
    ),
    firstName: cleaned(z.string().trim().min(1, 'กรุณากรอกชื่อ').max(150)),
    lastName: cleaned(z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(150)),
    // Optional for the same reason as on the registration form: support staff
    // hold no academic position, and requiring it only invents one.
    academicPosition: cleaned(
      z
        .string()
        .trim()
        .max(150, 'ตำแหน่งทางวิชาการยาวเกินไป')
        .optional()
        .nullable()
        .transform((value) => value || null),
    ),
    reason,
  })
  // Nothing else may ride along: roles, isActive and the password itself are
  // not the caller's to set here.
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export const resetPositionPasswordSchema = z
  .object({ reason })
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export type HandoverPositionInput = z.infer<typeof handoverPositionSchema>;
