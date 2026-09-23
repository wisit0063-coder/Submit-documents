import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import type { NotificationChannel, NotificationMessage } from './channel';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      // Shared hosting is slow to open sockets; fail fast instead of hanging a request.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
    });
  }
  return transporter;
}

function renderHtml(message: NotificationMessage): string {
  const linkHtml = message.link
    ? `<p style="margin:24px 0"><a href="${env.appBaseUrl}${message.link}" style="background:#1e40af;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดดูในระบบ</a></p>`
    : '';
  const bodyHtml = message.body
    .split('\n')
    .map((line) => `<p style="margin:4px 0">${line}</p>`)
    .join('');

  return `<div style="font-family:'Sarabun',Tahoma,sans-serif;font-size:15px;color:#111827;line-height:1.7">
  <h2 style="font-size:18px;margin:0 0 12px">${message.subject}</h2>
  ${bodyHtml}
  ${linkHtml}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
  <p style="font-size:12px;color:#6b7280">
    อีเมลฉบับนี้ส่งจากระบบเบิกจ่ายค่าตอบแทนการตีพิมพ์บทความผลงานทางวิชาการ
    มหาวิทยาลัยราชภัฏชัยภูมิ กรุณาอย่าตอบกลับ
  </p>
</div>`;
}

export const emailChannel: NotificationChannel = {
  name: 'email',
  isEnabled: () => env.mailDriver === 'smtp' && Boolean(env.smtp.host),
  async send(message) {
    if (!message.email) return;
    await getTransporter().sendMail({
      from: env.smtp.from,
      to: message.email,
      subject: message.subject,
      text: message.link ? `${message.body}\n\n${env.appBaseUrl}${message.link}` : message.body,
      html: renderHtml(message),
    });
  },
};
