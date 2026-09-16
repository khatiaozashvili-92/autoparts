import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { errors } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';

/**
 * Refuses a partner that no longer trades with us.
 *
 * The access token carries `roles` and `partnerId` as claims and is valid for
 * fifteen minutes, so revoking a partner in the database does not reach a
 * token already issued. Without this check an archived company keeps the full
 * portal for the rest of that window: it can still change prices, adjust stock
 * and accept orders the platform has just stopped standing behind.
 *
 * Fifteen minutes of that is not acceptable for an action whose whole purpose
 * is to stop a company trading, so partner-scoped routes re-read the company
 * on every request. That is one indexed primary-key lookup, which is a small
 * price for making "remove this partner" mean it immediately.
 *
 * Deliberately a 404 rather than a 403, matching `RolesGuard`: a refusal
 * should not confirm which partner ids exist.
 */
@Injectable()
export class PartnerActiveGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const principal = req.principal;

    // Platform staff reach these routes with no partner scope of their own;
    // RolesGuard has already decided whether they belong here.
    if (!principal?.partnerId) return true;

    const [partner] = await this.db.query<{ archived_at: Date | null; status: string }>(
      `SELECT archived_at, status::text AS status FROM partners WHERE id = $1`,
      [principal.partnerId],
    );

    if (!partner || partner.archived_at || partner.status !== 'APPROVED') {
      throw errors.notFound('Partner');
    }

    return true;
  }
}
