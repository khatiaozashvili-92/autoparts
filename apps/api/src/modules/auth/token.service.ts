import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { errors, type Principal, type UserRole } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import type { AppConfig } from '../../config/configuration.js';

export interface AccessTokenClaims {
  sub: string;
  roles: UserRole[];
  partnerId: string | null;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger('TokenService');

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly db: DatabaseService,
  ) {}

  /**
   * The access token carries identifiers only — never an e-mail, phone number,
   * name or VIN (docs/07 §3). A JWT is readable by anyone holding it.
   */
  async issue(
    userId: string,
    roles: UserRole[],
    partnerId: string | null,
    deviceId?: string,
  ): Promise<TokenPair> {
    const claims: AccessTokenClaims = { sub: userId, roles, partnerId, jti: randomUUID() };

    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
    });

    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_id, expires_at)
       VALUES ($1, $2, $3, now() + $4::interval)`,
      [userId, hashToken(refreshToken), deviceId ?? null, refreshIntervalSql(this.config)],
    );

    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  async verifyAccess(token: string): Promise<Principal> {
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      return { userId: claims.sub, roles: claims.roles ?? [], partnerId: claims.partnerId ?? null };
    } catch {
      throw errors.unauthenticated();
    }
  }

  /**
   * Rotates a refresh token.
   *
   * Re-presenting a token that was already used means it leaked, so every
   * session for that user is revoked rather than just this one. That makes a
   * stolen token single-use instead of a standing key (docs/07 §3).
   */
  async rotate(refreshToken: string, deviceId?: string): Promise<TokenPair> {
    const tokenHash = hashToken(refreshToken);

    const [row] = await this.db.query<{
      id: string;
      user_id: string;
      revoked_at: Date | null;
      expired: boolean;
    }>(
      `SELECT id, user_id, revoked_at, (expires_at <= now()) AS expired
       FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );

    if (!row) throw errors.unauthenticated();

    if (row.revoked_at) {
      this.logger.warn(
        JSON.stringify({ event: 'refresh_token_reuse', userId: row.user_id }),
      );
      await this.revokeAllForUser(row.user_id);
      throw errors.unauthenticated();
    }

    if (row.expired) throw errors.unauthenticated();

    await this.db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);

    const roles = await this.rolesFor(row.user_id);
    return this.issue(row.user_id, roles.roles, roles.partnerId, deviceId);
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(refreshToken)],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }

  async rolesFor(userId: string): Promise<{ roles: UserRole[]; partnerId: string | null }> {
    const rows = await this.db.query<{ role: UserRole; partner_id: string | null }>(
      `SELECT role, partner_id FROM user_roles WHERE user_id = $1`,
      [userId],
    );
    const partnerRow = rows.find((r) => r.partner_id !== null);
    return {
      roles: rows.map((r) => r.role),
      partnerId: partnerRow?.partner_id ?? null,
    };
  }
}

/** Only the hash is stored, so a database leak yields no usable tokens. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function refreshIntervalSql(config: ConfigService<AppConfig, true>): string {
  const ttl = config.get('JWT_REFRESH_TTL', { infer: true });
  const match = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!match) return '30 days';
  const units = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' } as const;
  return `${match[1]} ${units[match[2] as keyof typeof units]}`;
}
