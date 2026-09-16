import { z } from 'zod';

/**
 * Env vars are always strings, so `z.coerce.boolean()` is wrong here:
 * `Boolean("false")` is `true`, which would make every feature flag
 * impossible to turn off. Parse the text explicitly instead.
 */
const boolFromEnv = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v.trim() === '') return fallback;
      const normalized = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
      if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
      return fallback;
    });

/**
 * Environment schema (docs/02 §7.1).
 *
 * Every provider and locale default is selected here, never in business logic.
 * `if (country === 'GE')` inside a service is forbidden (PRD §80) — these are
 * defaults for a deployment, not facts about the product.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_PORT: z.coerce.number().int().positive().default(3000),

  // Empty until Step 2. The API still boots so the skeleton is inspectable.
  DATABASE_URL: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  OPENSEARCH_URL: z.string().optional().default(''),

  JWT_SECRET: z.string().min(8).default('dev-only-change-me-in-production'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  VIN_ENCRYPTION_KEY: z.string().default('dev-only-32-byte-key-change-me!!'),

  FITMENT_PROVIDER_PRIMARY: z.string().default('mock'),
  FITMENT_PROVIDER_FALLBACK: z.string().default('mock'),
  PAYMENT_PROVIDER: z.string().default('mock'),
  SMS_PROVIDER: z.string().default('console'),

  DEFAULT_COUNTRY: z.string().length(2).default('GE'),
  DEFAULT_CURRENCY: z.string().length(3).default('GEL'),
  DEFAULT_LOCALE: z.string().default('ka'),

  FEATURE_REQUEST_PART: boolFromEnv(false),
  FEATURE_COURIER_DELIVERY: boolFromEnv(false),
  FEATURE_REVIEWS: boolFromEnv(false),

  // Authentication is a phone number and a six-digit code (ADR-015). Five
  // minutes is long enough to fetch a phone from another room and short
  // enough that a code read over someone's shoulder is close to worthless.
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
  // Returns the code in the API response so a machine with no SMS gateway can
  // still sign in. Refused in production by loadConfig below.
  OTP_ECHO_CODE: boolFromEnv(true),

  FITMENT_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  RESERVATION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  PICKUP_DEADLINE_HOURS: z.coerce.number().int().positive().default(24),
});

export type AppConfig = z.infer<typeof schema>;

/**
 * Parses and validates the environment.
 *
 * Nest passes the merged `.env`-plus-`process.env` record when this is used as
 * ConfigModule's `validate`. The default keeps it callable on its own, which
 * is how the migration CLI and the tests reach it.
 */
export function loadConfig(raw: Record<string, unknown> = process.env): AppConfig {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const config = parsed.data;

  // Fail loudly rather than shipping a dev secret to production.
  if (config.NODE_ENV === 'production') {
    if (config.JWT_SECRET.startsWith('dev-only')) {
      throw new Error('JWT_SECRET must be set to a real secret in production.');
    }
    if (config.VIN_ENCRYPTION_KEY.startsWith('dev-only')) {
      throw new Error('VIN_ENCRYPTION_KEY must be set to a real key in production.');
    }
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production.');
    }
    if (config.OTP_ECHO_CODE) {
      throw new Error('OTP_ECHO_CODE must be off in production: it returns the code to the caller.');
    }
    if (config.SMS_PROVIDER === 'console') {
      throw new Error('SMS_PROVIDER must be a real gateway in production, not the console stub.');
    }
  }

  return config;
}
