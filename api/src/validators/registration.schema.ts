import { z } from 'zod';
import { stripInvisible } from '../utils/text';

/**
 * Self-registration contract (CLAUDE.md section 13.2).
 * Mirrored by web/src/lib/registration-schema.ts so both sides reject the same input.
 */

/**
 * Names reach both printed documents, so they get the same cleaning as the
 * article fields: invisible characters out, accents composed one way. A bidi
 * override typed into a surname would print the rest of the line backwards on
 * the memo that goes to the bursar (utils/text.ts).
 */
const cleaned = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? stripInvisible(value) : value), schema);

const idString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+$/.test(value), { message: 'รหัสอ้างอิงไม่ถูกต้อง' });

/** Dashes and spaces are stripped, then a Thai number of 9-10 digits starting with 0. */
export const phoneSchema = z
  .string({ required_error: 'กรุณากรอกเบอร์โทรศัพท์' })
  .transform((value) => value.replace(/[\s-]/g, ''))
  .refine((value) => /^0\d{8,9}$/.test(value), {
    message: 'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก',
  });

export const passwordSchema = z
  .string({ required_error: 'กรุณากรอกรหัสผ่าน' })
  .min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
  .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว')
  .regex(/\d/, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');

export const registerSchema = z
  .object({
    facultyId: idString,
    staffTrack: z.enum(['ACADEMIC', 'SUPPORT'], {
      errorMap: () => ({ message: 'กรุณาเลือกสายงาน/ฝ่าย' }),
    }),
    // Free text, not a departments row: the real list per unit does not exist
    // yet (CLAUDE.md ข้อ 13.9 Q5) and applicants type their own.
    departmentName: cleaned(
      z
        .string()
        .trim()
        .max(255, 'ชื่อสาขาวิชายาวเกินไป')
        .optional()
        .nullable()
        .transform((value) => value || null),
    ),
    // Both documents the system prints carry the claimant's title: the memo
    // writes "ข้าพเจ้า <คำนำหน้า><ชื่อ> ตำแหน่ง <ตำแหน่งทางวิชาการ>" and the receipt
    // voucher repeats the name under the signature line. Form CPRU-RDI-F011 has
    // the claimant fill in both themselves (section 1), and the reviewers who
    // sign below are what confirms them - so the form asks for them here rather
    // than leaving every self-registered claimant printing a bare name.
    prefix: cleaned(
      z.string().trim().min(1, 'กรุณากรอกคำนำหน้าชื่อ').max(50, 'คำนำหน้าชื่อยาวเกินไป'),
    ),
    // Optional on purpose: support staff may claim too (ข้อ 13.9 Q3) and most
    // hold no academic position. Requiring it would only produce invented ones.
    academicPosition: cleaned(
      z
        .string()
        .trim()
        .max(150, 'ตำแหน่งทางวิชาการยาวเกินไป')
        .optional()
        .nullable()
        .transform((value) => value || null),
    ),
    firstName: cleaned(z.string().trim().min(1, 'กรุณากรอกชื่อ').max(150)),
    lastName: cleaned(z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(150)),
    phone: phoneSchema,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('รูปแบบอีเมลไม่ถูกต้อง')
      .max(100, 'อีเมลยาวเกินไป'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  // Unknown keys are rejected, not stripped: a client must never be able to send
  // roles, isActive or registrationStatus and have them considered.
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ')
  .refine((value) => value.password === value.confirmPassword, {
    message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    path: ['confirmPassword'],
  });

export const approveRegistrationSchema = z
  .object({
    // Unit assigned at approval. Required while the applicant has none, which
    // the service enforces because it knows the stored value.
    facultyId: idString.nullish(),
    roles: z
      .array(
        z.object({
          roleCode: z.string().min(2),
          facultyId: idString.nullish(),
        }),
      )
      .default([]),
  })
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export const rejectRegistrationSchema = z
  .object({
    reason: z.string().trim().min(5, 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(2000),
  })
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export const listRegistrationsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type ApproveRegistrationInput = z.infer<typeof approveRegistrationSchema>;
