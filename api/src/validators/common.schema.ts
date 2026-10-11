import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(3, 'กรุณากรอกชื่อผู้ใช้'),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
  newPassword: z
    .string()
    .min(8, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร')
    .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว')
    .regex(/\d/, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง'),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(10, 'token ไม่ถูกต้อง'),
  newPassword: z
    .string()
    .min(8, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร')
    .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว')
    .regex(/\d/, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว'),
});

export const journalTierSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/, 'รหัสต้องเป็นตัวพิมพ์ใหญ่และ _'),
  nameTh: z.string().trim().min(2).max(255),
  databaseName: z.string().trim().min(2).max(100),
  quartile: z.string().trim().max(5).optional().nullable(),
  rateNormal: z.coerce.number().min(0).max(1_000_000),
  rateConference: z.coerce.number().min(0).max(1_000_000),
  announcementRef: z.string().trim().max(100).optional().nullable(),
  effectiveFrom: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง'),
  effectiveTo: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง')
    .optional()
    .nullable(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const budgetYearSchema = z.object({
  year: z.coerce.number().int().min(2500).max(2700),
  totalAmount: z.coerce.number().min(0),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง'),
  endDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง'),
  isActive: z.boolean().default(false),
  note: z.string().trim().max(1000).optional().nullable(),
});

/**
 * Editing a fund year. Everything is optional because the page sends only what
 * changed, and a reason is here so a change to the ceiling can be explained;
 * the service is what insists on one when the money actually moves, since it is
 * the only place that can see the figure being replaced.
 */
export const budgetYearUpdateSchema = budgetYearSchema.partial().extend({
  reason: z.string().trim().max(500).optional(),
});

export const createUserSchema = z.object({
  username: z.string().trim().min(3).max(100),
  email: z.string().trim().email('รูปแบบอีเมลไม่ถูกต้อง'),
  prefix: z.string().trim().max(50).optional().nullable(),
  firstName: z.string().trim().min(1).max(150),
  lastName: z.string().trim().min(1).max(150),
  academicPosition: z.string().trim().max(150).optional().nullable(),
  facultyId: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  departmentId: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  staffTrack: z.enum(['ACADEMIC', 'SUPPORT']).optional().nullable(),
  phoneInternal: z.string().trim().max(20).optional().nullable(),
  phoneMobile: z.string().trim().max(20).optional().nullable(),
  roles: z
    .array(
      z.object({
        roleCode: z.string().min(2),
        facultyId: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
      }),
    )
    .min(1, 'ต้องกำหนดบทบาทอย่างน้อย 1 บทบาท'),
});

export const updateUserSchema = createUserSchema.partial().extend({
  roles: createUserSchema.shape.roles.optional(),
});

export const userStatusSchema = z.object({ isActive: z.boolean() });

export const paySchema = z.object({
  // Optional on purpose (11 ต.ค. 2569): the voucher number comes back from the
  // bursar days after the paperwork is handed over, so demanding it up front
  // would block the one person who happens to hear the outcome from recording
  // anything at all. It can be filled in later.
  voucherNo: z.string().trim().max(50).optional(),
  paidAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง'),
  note: z.string().trim().max(1000).optional().nullable(),
});

export const refundSchema = z.object({
  refundAmount: z.coerce.number().positive('จำนวนเงินต้องมากกว่า 0'),
  refundReason: z.string().trim().min(5, 'กรุณาระบุเหตุผลการเรียกเงินคืน').max(2000),
});

export const reportQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  budgetYearId: z.union([z.string(), z.number()]).transform(String).optional(),
  facultyId: z.union([z.string(), z.number()]).transform(String).optional(),
  status: z.string().optional(),
});
