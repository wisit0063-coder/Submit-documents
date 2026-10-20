import { z } from 'zod';
import { isAllowedPushEndpoint, MAX_ENDPOINT_LENGTH } from '../notifications/push-endpoint';

/** The browser's keys are URL-safe base64; real ones are 87 and 22 characters. */
const base64url = z
  .string()
  .min(16)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+=*$/, 'รูปแบบกุญแจไม่ถูกต้อง');

/**
 * The endpoint is a URL the server will later make requests to, so it is held
 * to the push-service allowlist here, before anything is stored
 * (notifications/push-endpoint.ts explains the forgery it prevents).
 */
const endpoint = z
  .string()
  .max(MAX_ENDPOINT_LENGTH)
  .refine(isAllowedPushEndpoint, { message: 'ที่อยู่สำหรับรับการแจ้งเตือนไม่ถูกต้อง' });

export const subscribePushSchema = z
  .object({
    endpoint,
    // Some browsers include it, always null for our purposes.
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: base64url, auth: base64url }).strict(),
  })
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export const unsubscribePushSchema = z
  .object({ endpoint: z.string().max(MAX_ENDPOINT_LENGTH) })
  .strict('ข้อมูลที่ส่งมามีช่องที่ระบบไม่รองรับ');

export type SubscribePushInput = z.infer<typeof subscribePushSchema>;
