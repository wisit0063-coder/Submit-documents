import { z } from 'zod';
import type { StaffTrack } from '@/types';

/**
 * Mirror of api/src/validators/registration.schema.ts (CLAUDE.md section 13.2).
 * The two must reject the same input; the server check is the one that counts,
 * this copy only lets the form show errors before a round trip.
 */
export const registerFormSchema = z
  .object({
    facultyId: z.string().min(1, 'กรุณาเลือกหน่วยงาน/สังกัด'),
    staffTrack: z.enum(['ACADEMIC', 'SUPPORT'], {
      errorMap: () => ({ message: 'กรุณาเลือกสายงาน/ฝ่าย' }),
    }),
    // Free text: units have no confirmed department list yet, so applicants type it.
    departmentName: z
      .string()
      .trim()
      .max(255, 'ชื่อสาขาวิชายาวเกินไป')
      .nullable()
      .transform((value) => value || null),
    firstName: z.string().trim().min(1, 'กรุณากรอกชื่อ').max(150),
    lastName: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(150),
    phone: z
      .string()
      .transform((value) => value.replace(/[\s-]/g, ''))
      .refine((value) => value.length > 0, { message: 'กรุณากรอกเบอร์โทรศัพท์' })
      .refine((value) => value.length === 0 || /^0\d{8,9}$/.test(value), {
        message: 'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก',
      }),
    email: z.string().trim().toLowerCase().email('รูปแบบอีเมลไม่ถูกต้อง').max(100, 'อีเมลยาวเกินไป'),
    password: z
      .string()
      .min(8, 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร')
      .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว')
      .regex(/\d/, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว'),
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
    path: ['confirmPassword'],
  });

export type RegisterForm = {
  facultyId: string;
  staffTrack: StaffTrack | '';
  departmentName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export const STAFF_TRACK_LABELS: Record<StaffTrack, string> = {
  ACADEMIC: 'ฝ่ายวิชาการ',
  SUPPORT: 'ฝ่ายสนับสนุน',
};
