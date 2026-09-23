/** Error codes are SCREAMING_SNAKE_CASE and travel to the client verbatim. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new AppError(400, code, message, details);

export const unauthorized = (message = 'กรุณาเข้าสู่ระบบ') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const forbidden = (message = 'ไม่มีสิทธิ์ดำเนินการนี้') =>
  new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'ไม่พบข้อมูลที่ต้องการ') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

/** 422 is reserved for business-rule / validation failures. */
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new AppError(422, code, message, details);
