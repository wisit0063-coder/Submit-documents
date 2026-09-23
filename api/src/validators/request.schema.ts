import { z } from 'zod';

/**
 * Schemas are the contract for request bodies and are mirrored by the frontend
 * (web/src/lib/schemas.ts) so both sides reject the same input.
 */
const idString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^\d+$/.test(value), { message: 'รหัสอ้างอิงไม่ถูกต้อง' });

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'รูปแบบวันที่ไม่ถูกต้อง' });

export const createRequestSchema = z.object({
  articleTitle: z.string().trim().min(10, 'กรุณากรอกชื่อบทความอย่างน้อย 10 ตัวอักษร').max(1000),
  journalName: z.string().trim().min(3, 'กรุณากรอกชื่อวารสาร').max(500),
  volume: z.string().trim().max(50).optional().nullable(),
  issue: z.string().trim().max(50).optional().nullable(),
  pages: z.string().trim().max(50).optional().nullable(),
  issn: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{3}[\dxX]$/, 'รูปแบบ ISSN ต้องเป็น xxxx-xxxx')
    .optional()
    .nullable()
    .or(z.literal('')),
  doi: z.string().trim().max(255).optional().nullable(),
  articleUrl: z.string().trim().url('รูปแบบ URL ไม่ถูกต้อง').optional().nullable().or(z.literal('')),
  publishedAt: isoDate,
  journalTierId: idString,
  fromConference: z.boolean().default(false),
  departmentId: idString.optional(),
  certNotOnStudyLeave: z.boolean().default(false),
  certNotThesisPart: z.boolean().default(false),
  certNotDuplicate: z.boolean().default(false),
});

/**
 * First-author confirmation is ticked on the submit dialog rather than stored on
 * the request: schema.prisma carries only the three certifications printed on
 * form CPRU-RDI-F011 and it is the source of truth for the table shape. The tick
 * is written into request_status_logs together with the submit event.
 */
export const submitSchema = z.object({
  isFirstAuthor: z.boolean(),
});

export const updateRequestSchema = createRequestSchema.partial();

export const previewAmountSchema = z.object({
  journalTierId: idString,
  fromConference: z.boolean().default(false),
});

export const listRequestsSchema = z.object({
  status: z.string().optional(),
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  facultyId: idString.optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const approveSchema = z.object({
  comment: z.string().trim().max(2000).optional(),
  qaIndicatorYear: z.coerce.number().int().min(2400).max(2700).optional(),
});

export const returnSchema = z.object({
  missingDocuments: z.string().trim().min(5, 'กรุณาระบุเอกสารหรือข้อมูลที่ต้องแก้ไข').max(2000),
  comment: z.string().trim().max(2000).optional(),
});

export const rejectSchema = z.object({
  comment: z.string().trim().min(5, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ').max(2000),
});

export const finalApproveSchema = z.object({
  amountApproved: z.coerce.number().positive('จำนวนเงินต้องมากกว่า 0').max(1_000_000),
  comment: z.string().trim().max(2000).optional(),
});

export const toCommitteeSchema = z.object({
  comment: z.string().trim().min(5, 'กรุณาระบุเหตุผลที่ส่งเข้าคณะกรรมการ').max(2000),
});

export const qaYearSchema = z.object({
  qaIndicatorYear: z.coerce.number().int().min(2400).max(2700),
});

export const uploadAttachmentSchema = z.object({
  docType: z.enum(['ACCEPTANCE_LETTER', 'ARTICLE_COPY', 'DATABASE_PROOF', 'ADDITIONAL']),
});

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestSchema>;
export type ListRequestsQuery = z.infer<typeof listRequestsSchema>;
export type FinalApproveInput = z.infer<typeof finalApproveSchema>;
