import { z } from 'zod';
import { RequestStatus } from '@prisma/client';
import { FIRST_CLAIMABLE_YEAR, isPlausiblePublicationYear } from '../config/workflow';
import { stripInvisible } from '../utils/text';

/**
 * Free text on its way into the database. Trims, composes accents one way and
 * drops characters a reader cannot see - the zero-width spaces and the bidi
 * overrides that make a title print backwards in the memo sent to the bursar
 * (utils/text.ts explains what and why).
 *
 * Applied to every field that is printed on a document or compared by a rule.
 */
const cleaned = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (typeof value === 'string' ? stripInvisible(value) : value), schema);

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

/** Both ISSNs take the same shape; a journal may carry one, both or neither. */
const issnField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{3}[\dxX]$/, 'รูปแบบ ISSN ต้องเป็น xxxx-xxxx')
  .optional()
  .nullable()
  .or(z.literal(''));

export const createRequestSchema = z.object({
  articleTitle: cleaned(
    z.string().trim().min(10, 'กรุณากรอกชื่อบทความอย่างน้อย 10 ตัวอักษร').max(1000),
  ),
  journalName: cleaned(z.string().trim().min(3, 'กรุณากรอกชื่อวารสาร').max(500)),
  volume: cleaned(z.string().trim().max(50).optional().nullable()),
  issue: cleaned(z.string().trim().max(50).optional().nullable()),
  pages: cleaned(z.string().trim().max(50).optional().nullable()),
  issn: issnField,
  issnElectronic: issnField,
  // Free text on purpose: journals write their coverage however they like
  // ("พฤษภาคม-สิงหาคม 2569", "Vol 4 No 2 (2026)") and the voucher quotes it
  // verbatim. It is never parsed, so there is nothing to get wrong by typing.
  issuePeriod: cleaned(z.string().trim().max(120).optional().nullable().or(z.literal(''))),
  doi: cleaned(z.string().trim().max(255).optional().nullable()),
  articleUrl: z.string().trim().url('รูปแบบ URL ไม่ถูกต้อง').optional().nullable().or(z.literal('')),
  publishedAt: isoDate.refine(
    (value) => isPlausiblePublicationYear(new Date(value)),
    {
      message: `ปีที่ตีพิมพ์ต้องอยู่ระหว่าง พ.ศ. ${FIRST_CLAIMABLE_YEAR + 543} ถึงปีหน้า`,
    },
  ),
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
  // Checked against the enum rather than passed through: an unknown value used
  // to answer 200 with every row, so the screen looked unfiltered when the
  // caller believed it was filtered. Every other filter here already refuses
  // what it cannot use. The web drops empty parameters before sending, so no
  // screen relies on "" meaning "all".
  status: z.nativeEnum(RequestStatus, { message: 'สถานะที่ใช้กรองไม่ถูกต้อง' }).optional(),
  year: z.coerce.number().int().min(2000).max(3000).optional(),
  facultyId: idString.optional(),
  // "1" narrows the list to the caller's own claims. It can only ever remove
  // rows the visibility filter already allowed, never add any.
  mine: z.enum(['0', '1']).optional(),
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
