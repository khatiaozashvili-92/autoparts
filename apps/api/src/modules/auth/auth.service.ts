import { Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  ErrorCode,
  UserRole,
  errors,
  isMobileNumber,
  normalizePhone,
  type Principal,
} from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { OtpService, type OtpChallenge } from './otp.service.js';
import { TokenService, type TokenPair } from './token.service.js';

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  locale: string;
  country: string;
  suspended_at: Date | null;
}

export interface RequestCodeInput {
  phone: string;
  requestIp?: string | null;
}

export interface VerifyCodeInput {
  challengeId: string;
  code: string;
  /** Collected on the code screen, and only used when the account is new. */
  firstName?: string;
  lastName?: string;
  locale?: string;
  deviceId?: string;
}

export interface SignInResult extends TokenPair {
  userId: string;
  /** True when this verification created the account (PRD §12). */
  isNewUser: boolean;
}

/**
 * Authentication is a phone number and a one-time code — nothing else
 * (ADR-015).
 *
 * There is no registration step separate from signing in. A number that has
 * no account gets one at the moment its first code is verified, because
 * asking someone to pick "register" or "log in" only makes them guess which
 * of the two they did last time.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly db: DatabaseService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  /** Step one: send a code. Says nothing about whether the number is known. */
  async requestCode(input: RequestCodeInput): Promise<OtpChallenge> {
    const phone = normalizePhone(input.phone);

    if (!phone || !isMobileNumber(phone)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'A mobile number that can receive an SMS is required.',
        messageKey: 'error.auth.phoneInvalid',
      });
    }

    // A suspended account is refused here rather than after the code is typed,
    // so a blocked customer is not charged an SMS to be told no.
    const [existing] = await this.db.query<{ suspended_at: Date | null }>(
      `SELECT suspended_at FROM users WHERE phone = $1`,
      [phone],
    );
    if (existing?.suspended_at) throw suspended();

    return this.otp.request(phone, input.requestIp ?? null);
  }

  /** Step two: check the code, then find or create the account behind it. */
  async verifyCode(input: VerifyCodeInput): Promise<SignInResult> {
    // The number comes back from the challenge, never from the request body.
    const phone = await this.otp.verify(input.challengeId, input.code);

    const existing = await this.findByPhone(phone);
    if (existing?.suspended_at) throw suspended();

    const { user, isNewUser } = existing
      ? { user: existing, isNewUser: false }
      : { user: await this.createCustomer(phone, input), isNewUser: true };

    // Verifying a code is proof the number reaches this person, so the number
    // is marked verified on every sign-in, not only the first.
    await this.db.query(
      `UPDATE users SET phone_verified_at = now(), last_login_at = now() WHERE id = $1`,
      [user.id],
    );

    const { roles, partnerId } = await this.tokens.rolesFor(user.id);
    const pair = await this.tokens.issue(user.id, roles, partnerId, input.deviceId);

    return { userId: user.id, isNewUser, ...pair };
  }

  async me(principal: Principal) {
    const [user] = await this.db.query<UserRow>(
      `SELECT id, email, phone, first_name, last_name, locale, country, suspended_at
       FROM users WHERE id = $1`,
      [principal.userId],
    );
    if (!user) throw errors.unauthenticated();

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.first_name,
      lastName: user.last_name,
      locale: user.locale,
      country: user.country,
      roles: principal.roles,
      partnerId: principal.partnerId,
    };
  }

  private async createCustomer(phone: string, input: VerifyCodeInput): Promise<UserRow> {
    // ON CONFLICT rather than a check-then-insert: two codes verified for the
    // same number at once would otherwise race into a duplicate-key error
    // instead of both landing on the same account.
    const [created] = await this.db.query<UserRow>(
      `INSERT INTO users (phone, first_name, last_name, locale, phone_verified_at)
       VALUES ($1, $2, $3, COALESCE($4, 'ka'), now())
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, email, phone, first_name, last_name, locale, country, suspended_at`,
      [phone, input.firstName ?? null, input.lastName ?? null, input.locale ?? null],
    );
    if (!created) throw errors.internal();

    await this.db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'CUSTOMER')
       ON CONFLICT DO NOTHING`,
      [created.id],
    );

    this.logger.log(JSON.stringify({ event: 'user_registered', userId: created.id }));
    return created;
  }

  private async findByPhone(phone: string): Promise<UserRow | null> {
    const [row] = await this.db.query<UserRow>(
      `SELECT id, email, phone, first_name, last_name, locale, country, suspended_at
       FROM users WHERE phone = $1`,
      [phone],
    );
    return row ?? null;
  }
}

function suspended(): AppError {
  return new AppError({
    code: ErrorCode.FORBIDDEN,
    status: 403,
    message: 'This account is suspended.',
    messageKey: 'error.auth.suspended',
  });
}
