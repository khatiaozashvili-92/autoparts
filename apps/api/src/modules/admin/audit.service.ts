import { Injectable } from '@nestjs/common';
import { redact, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';

export type AuditAction =
  | 'PRICE_CHANGE'
  | 'STOCK_CHANGE'
  | 'FITMENT_CHANGE'
  | 'ORDER_STATUS_CHANGE'
  | 'REFUND'
  | 'PARTNER_ACTION'
  | 'ADMIN_ACTION'
  | 'COMMISSION_CHANGE'
  | 'USER_ACTION';

/**
 * Audit trail (PRD §79).
 *
 * Append-only: nothing in the application ever updates or deletes a row here,
 * and the log is the record of who changed money, stock or compatibility.
 *
 * Every payload passes through `redact`, so a before/after snapshot of a user
 * row cannot put a phone number or an e-mail into the audit table (docs/07 §7).
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(params: {
    actor: Principal | null;
    action: AuditAction;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
    partnerId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, partner_id, action, entity_type, entity_id,
          before, after, ip, user_agent)
       VALUES ($1,$2::user_role,$3,$4,$5,$6,$7,$8,$9::inet,$10)`,
      [
        params.actor?.userId ?? null,
        params.actor?.roles[0] ?? null,
        params.partnerId ?? null,
        params.action,
        params.entityType,
        params.entityId ?? null,
        params.before === undefined ? null : JSON.stringify(redact(params.before)),
        params.after === undefined ? null : JSON.stringify(redact(params.after)),
        params.ip ?? null,
        params.userAgent ?? null,
      ],
    );
  }

  async list(filter: {
    action?: string;
    entityType?: string;
    entityId?: string;
    actorId?: string;
    limit?: number;
  }) {
    return this.db.query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.before, a.after,
              a.created_at, a.actor_role,
              u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       WHERE ($1::text IS NULL OR a.action = $1)
         AND ($2::text IS NULL OR a.entity_type = $2)
         AND ($3::uuid IS NULL OR a.entity_id = $3)
         AND ($4::uuid IS NULL OR a.actor_id = $4)
       ORDER BY a.created_at DESC
       LIMIT $5`,
      [
        filter.action ?? null,
        filter.entityType ?? null,
        filter.entityId ?? null,
        filter.actorId ?? null,
        Math.min(filter.limit ?? 100, 500),
      ],
    );
  }
}
