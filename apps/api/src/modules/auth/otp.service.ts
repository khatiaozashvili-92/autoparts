import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode, maskPhone } from '@autoparts/core';
import type { SmsProvider } from '@autoparts/providers';
import { DatabaseService } from '../../database/database.module.js';
import { SMS_PROVIDER } from './sms.provider.js';
import type { AppConfig } from '../../config/configuration.js';

/**
 * One-time SMS codes (docs/07 §2).
 *
 * The threat here is not a clever attacker, it is volume: someone walking the
 * 5XXXXXXXX range to see which numbers are registered, and someone guessing
 * six digits. Both are answered the same way — every response looks identical
 * whether or not the number has an account, and a challenge dies after a
 * handful of wrong guesses rather than staying open for its full lifetime.
 */

export interface OtpChallenge {
  challengeId: string;
  /** Seconds until the code stops working. */
  expiresIn: number;
  /** Seconds before a new code may be requested for this number. */
  resendAfter: number;
  maskedPhone: string;
  /**
   * The code itself, outside production only. There is no SMS gateway on a
   * developer machine or a CI runner, so without this nobody could sign in at
   * all. Production is excluded in `devEchoEnabled`, and `loadConfig` refuses
   * to boot a production process with the flag on.
   */
  devCode?: string;
}

interface ChallengeRow {
  id: string;
  phone: string;
  code_hash: string;
  attempts: number;
  expired: boolean;
  consumed_at: Date | null;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger('OtpService');

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  /**
   * Issues a code for a number, or refuses because too many were asked for.
   *
   * Nothing in the result distinguishes a registered number from an unknown
   * one: whether this ends in a new account is decided at verification time,
   * not here.
   */
  async request(phone: string, requestIp: string | null): Promise<OtpChallenge> {
    const ttl = this.config.get('OTP_TTL_SECONDS', { infer: true });
    const cooldown = this.config.get('OTP_RESEND_COOLDOWN_SECONDS', { infer: true });
    const perHour = this.config.get('OTP_MAX_PER_HOUR', { infer: true });

    // Both limits in one round trip: the last code's age, and the hour's count.
    const [recent] = await this.db.query<{
      seconds_since_last: number | null;
      issued_last_hour: number;
    }>(
      `SELECT
         EXTRACT(EPOCH FROM (now() - max(created_at)))::int AS seconds_since_last,
         count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS issued_last_hour
       FROM otp_challenges
       WHERE phone = $1`,
      [phone],
    );

    const sinceLast = recent?.seconds_since_last ?? null;
    if (sinceLast !== null && sinceLast < cooldown) {
      throw new AppError({
        code: ErrorCode.RATE_LIMITED,
        status: 429,
        message: `A code was already sent. Retry in ${cooldown - sinceLast}s.`,
        messageKey: 'error.otp.resendTooSoon',
        details: { retryAfter: cooldown - sinceLast },
      });
    }

    if ((recent?.issued_last_hour ?? 0) >= perHour) {
      // Deliberately not "this number is blocked": the same answer is given to
      // a number that has never been seen.
      throw new AppError({
        code: ErrorCode.RATE_LIMITED,
        status: 429,
        message: 'Too many codes requested for this number.',
        messageKey: 'error.otp.tooManyRequests',
        details: { retryAfter: 3600 },
      });
    }

    // Any code still outstanding for this number is retired first, so a resend
    // cannot leave two working codes in the wild.
    await this.db.query(
      `UPDATE otp_challenges SET consumed_at = now()
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [phone],
    );

    const code = generateCode();

    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO otp_challenges (phone, code_hash, expires_at, request_ip)
       VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4)
       RETURNING id`,
      [phone, this.hashCode(phone, code), String(ttl), requestIp],
    );
    if (!row) {
      throw new AppError({
        code: ErrorCode.INTERNAL,
        status: 500,
        message: 'Could not create a challenge.',
        messageKey: 'error.internal',
      });
    }

    const sent = await this.sms.send({
      to: phone,
      body: `autoparts: ${code}. კოდი მოქმედებს ${Math.round(ttl / 60)} წუთი.`,
    });

    if (sent.status === 'FAILED') {
      // The challenge stays in the table — it expires on its own — but the
      // customer is told the truth rather than being parked on a code screen
      // waiting for a message that was never delivered.
      this.logger.error(
        JSON.stringify({
          event: 'sms_send_failed',
          provider: sent.provider,
          failureCode: sent.failureCode,
        }),
      );
      throw new AppError({
        code: ErrorCode.PROVIDER_UNAVAILABLE,
        status: 502,
        message: 'The SMS gateway did not accept the message.',
        messageKey: 'error.otp.deliveryFailed',
      });
    }

    return {
      challengeId: row.id,
      expiresIn: ttl,
      resendAfter: cooldown,
      maskedPhone: maskPhone(phone),
      ...(this.devEchoEnabled() ? { devCode: code } : {}),
    };
  }

  /**
   * Checks a code and consumes the challenge.
   *
   * Returns the number the challenge was issued to — the caller never trusts a
   * phone number sent alongside the code, or a challenge could be verified
   * into somebody else's account.
   */
  async verify(challengeId: string, code: string): Promise<string> {
    const maxAttempts = this.config.get('OTP_MAX_ATTEMPTS', { infer: true });

    const [row] = await this.db.query<ChallengeRow>(
      `SELECT id, phone, code_hash, attempts, consumed_at, (expires_at <= now()) AS expired
       FROM otp_challenges WHERE id = $1`,
      [challengeId],
    );

    // An unknown, spent or expired challenge is one error, not three. Telling
    // them apart tells an attacker which challenge IDs are real.
    if (!row || row.consumed_at || row.expired) throw invalidCode();

    if (row.attempts >= maxAttempts) {
      await this.db.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [row.id]);
      throw new AppError({
        code: ErrorCode.RATE_LIMITED,
        status: 429,
        message: 'Too many incorrect attempts.',
        messageKey: 'error.otp.tooManyAttempts',
      });
    }

    const expected = this.hashCode(row.phone, code.trim());
    if (!constantTimeEquals(expected, row.code_hash)) {
      // The counter is incremented before the error leaves, so a client that
      // hangs up mid-request still burns the attempt.
      await this.db.query(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [
        row.id,
      ]);
      throw invalidCode();
    }

    // Consuming and checking in one statement: two parallel requests carrying
    // the same correct code must not both succeed, or a leaked code could be
    // replayed into a second session.
    const consumed = await this.db.query<{ id: string }>(
      `UPDATE otp_challenges SET consumed_at = now()
       WHERE id = $1 AND consumed_at IS NULL
       RETURNING id`,
      [row.id],
    );
    if (consumed.length === 0) throw invalidCode();

    return row.phone;
  }

  /**
   * Codes are stored as an HMAC keyed on the number, so two customers who are
   * sent the same six digits do not share a hash — and a stolen table cannot
   * be reversed with a table of a million pre-computed digests.
   */
  private hashCode(phone: string, code: string): string {
    return createHmac('sha256', this.config.get('JWT_SECRET', { infer: true }))
      .update(`${phone}:${code}`)
      .digest('hex');
  }

  private devEchoEnabled(): boolean {
    return (
      this.config.get('NODE_ENV', { infer: true }) !== 'production' &&
      this.config.get('OTP_ECHO_CODE', { infer: true }) &&
      this.sms.echoesCode
    );
  }
}

function generateCode(): string {
  // randomInt, not Math.random: a predictable code is no code at all.
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function invalidCode(): AppError {
  return new AppError({
    code: ErrorCode.UNAUTHENTICATED,
    status: 401,
    message: 'That code is not valid.',
    messageKey: 'error.otp.invalidCode',
  });
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
