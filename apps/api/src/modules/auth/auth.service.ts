import { Injectable, Logger } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AppError, ErrorCode, UserRole, errors, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { PasswordService } from './password.service.js';
import { TokenService, type TokenPair } from './token.service.js';

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  password_hash: string | null;
  first_name: string | null;
  last_name: string | null;
  locale: string;
  country: string;
  suspended_at: Date | null;
}

export interface RegisterInput {
  email?: string;
  phone?: string;
  password: string;
  firstName?: string;
  lastName?: string;
  locale?: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
  deviceId?: string;
}

/**
 * A dummy hash to verify against when no user matched, so a failed login takes
 * roughly the same time whether or not the account exists. Without it, response
 * timing enumerates registered users (docs/07 §6.2).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000';

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<{ userId: string } & TokenPair> {
    const email = input.email?.trim().toLowerCase() || null;
    const phone = normalizePhone(input.phone) || null;

    if (!email && !phone) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'Either an email or a phone number is required.',
        messageKey: 'error.auth.identifierRequired',
      });
    }

    const passwordProblem = this.passwords.validate(input.password);
    if (passwordProblem) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'Password does not meet the minimum requirements.',
        messageKey: passwordProblem,
      });
    }

    const existing = await this.findByIdentifier(email ?? phone!);
    if (existing) {
      // Same shape and status as a successful-looking failure elsewhere: do not
      // confirm that this address is already registered.
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: 'Registration could not be completed.',
        messageKey: 'error.auth.registrationFailed',
      });
    }

    const passwordHash = await this.passwords.hash(input.password);

    const [user] = await this.db.query<{ id: string }>(
      `INSERT INTO users (email, phone, password_hash, first_name, last_name, locale)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'ka'))
       RETURNING id`,
      [email, phone, passwordHash, input.firstName ?? null, input.lastName ?? null, input.locale ?? null],
    );
    if (!user) throw errors.internal();

    await this.db.query(
      `INSERT INTO user_roles (user_id, role) VALUES ($1, 'CUSTOMER')`,
      [user.id],
    );

    const pair = await this.tokens.issue(user.id, [UserRole.CUSTOMER], null);
    return { userId: user.id, ...pair };
  }

  async login(input: LoginInput): Promise<{ userId: string } & TokenPair> {
    const user = await this.findByIdentifier(input.identifier);

    // Always run a verification, even with no user, so the two paths cost the
    // same amount of time.
    const hashToCheck = user?.password_hash ?? DUMMY_HASH;
    const passwordOk = await this.passwords.verify(hashToCheck, input.password);

    if (!user || !passwordOk || !constantTrue(user.password_hash !== null)) {
      throw new AppError({
        code: ErrorCode.UNAUTHENTICATED,
        status: 401,
        message: 'Invalid credentials.',
        messageKey: 'error.auth.invalidCredentials',
      });
    }

    if (user.suspended_at) {
      throw new AppError({
        code: ErrorCode.FORBIDDEN,
        status: 403,
        message: 'This account is suspended.',
        messageKey: 'error.auth.suspended',
      });
    }

    if (this.passwords.needsRehash(user.password_hash!)) {
      const upgraded = await this.passwords.hash(input.password);
      await this.db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [upgraded, user.id]);
    }

    await this.db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);

    const { roles, partnerId } = await this.tokens.rolesFor(user.id);
    const pair = await this.tokens.issue(user.id, roles, partnerId, input.deviceId);
    return { userId: user.id, ...pair };
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

  private async findByIdentifier(identifier: string): Promise<UserRow | null> {
    const trimmed = identifier.trim();
    const asPhone = normalizePhone(trimmed);
    const [row] = await this.db.query<UserRow>(
      `SELECT id, email, phone, password_hash, first_name, last_name, locale, country, suspended_at
       FROM users
       WHERE email = $1 OR (phone IS NOT NULL AND phone = $2)
       LIMIT 1`,
      [trimmed.toLowerCase(), asPhone],
    );
    return row ?? null;
  }
}

/** Keeps the boolean check off the fast path so both branches cost the same. */
function constantTrue(value: boolean): boolean {
  const a = Buffer.from([value ? 1 : 0]);
  const b = Buffer.from([1]);
  return timingSafeEqual(a, b);
}

/** Georgian numbers are stored in E.164; anything else is kept as typed. */
function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.length === 9 && digits.startsWith('5')) return `+995${digits}`;
  if (digits.startsWith('995')) return `+${digits}`;
  return digits;
}
