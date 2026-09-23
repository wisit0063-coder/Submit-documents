import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

const isProductionEnv = process.env.NODE_ENV === 'production';

/**
 * Placeholder secrets that ship in .env.example and docker-compose.yml. They are
 * published in the repository, so anyone can read them and forge a token.
 */
const PUBLISHED_PLACEHOLDERS = new Set([
  'dev-secret-do-not-use-in-production',
  'test-jwt-secret-local-docker-only',
  'test-cron-token-local-docker-only',
  'change-me-to-a-long-random-string',
  'change-me-too',
]);

const MIN_SECRET_LENGTH = 32;

/** A secret a development run may default, but production must set for real. */
function secret(key: string, devFallback: string): string {
  const value = process.env[key];
  return value && value !== '' ? value : devFallback;
}

function secretProblem(key: string): string | null {
  const value = process.env[key];
  if (!value || value === '') {
    return (
      `${key} must be set when NODE_ENV=production. ` +
      `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  if (PUBLISHED_PLACEHOLDERS.has(value)) {
    return (
      `${key} is still the placeholder value published in .env.example / docker-compose.yml. ` +
      'Anyone who can read the repository can forge a token with it.'
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    return `${key} must be at least ${MIN_SECRET_LENGTH} characters in production.`;
  }
  return null;
}

/**
 * Refuses to start a production process that still uses the published
 * placeholder secrets.
 *
 * A wrong JWT secret is invisible at runtime - the app behaves perfectly while
 * anyone who read the repository can mint an ADMIN token - so start-up is the
 * only moment this gets noticed.
 *
 * Deliberately a function called from server.ts rather than a check inside the
 * module body: importing the config must stay side-effect free, so tests, the
 * seed script and CLI tooling can read env without a production .env present.
 */
export function assertProductionSecrets(): void {
  if (!isProductionEnv) return;

  const problems = ['JWT_SECRET', 'CRON_TOKEN']
    .map((key) => secretProblem(key))
    .filter((problem): problem is string => problem !== null);

  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  // Passenger injects PORT. Never hard-code it.
  port: toInt(process.env.PORT, 3000),
  timezone: process.env.TZ ?? 'Asia/Bangkok',
  /**
   * How many reverse proxies sit in front of the app. One for the nginx
   * container, one for Passenger on cPanel - so 1 fits both. Raise it only if a
   * CDN or another proxy is added, and never set it so high that Express starts
   * trusting hops the client controls.
   */
  trustProxyHops: toInt(process.env.TRUST_PROXY_HOPS, 1),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',

  jwtSecret: secret('JWT_SECRET', 'dev-secret-do-not-use-in-production'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  cookieName: process.env.COOKIE_NAME ?? 'cpru_token',
  cookieSecure: toBool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),

  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), '../storage/uploads'),
  maxUploadBytes: toInt(process.env.MAX_UPLOAD_MB, 10) * 1024 * 1024,

  mailDriver: (process.env.MAIL_DRIVER ?? 'log') as 'smtp' | 'log',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: toInt(process.env.SMTP_PORT, 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'no-reply@cpru.ac.th',
  },

  // Guards POST /cron/reminders, which is reachable without a session.
  cronToken: secret('CRON_TOKEN', ''),
  reminderAfterBusinessDays: toInt(process.env.REMINDER_AFTER_BUSINESS_DAYS, 5),
};
