import { Injectable, Logger } from '@nestjs/common';
import {
  AppError,
  ErrorCode,
  errors,
  isMobileNumber,
  normalizePhone,
  type Principal,
} from '@autoparts/core';
import { DatabaseService, type TransactionClient } from '../../database/database.module.js';
import { AuditService } from './audit.service.js';

/**
 * Creating and retiring partner companies, and deciding who may act for one
 * (docs/09 §4, docs/10 §1).
 *
 * There is deliberately no self-registration anywhere in the product. A
 * partner is a commercial relationship with a signed agreement, a tax number
 * and an agreed commission behind it; letting a company create its own account
 * would mean the marketplace lists sellers nobody vetted. So the row is only
 * ever written here, by a super admin.
 */

export interface CreatePartnerInput {
  legalName: string;
  displayName: string;
  taxId?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** The person who will run it. An account is created if none exists. */
  adminPhone: string;
  adminFirstName?: string;
}

interface PartnerRow {
  id: string;
  legal_name: string;
  display_name: string;
  status: string;
  archived_at: Date | null;
}

@Injectable()
export class PartnerAdminService {
  private readonly logger = new Logger('PartnerAdminService');

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates the company and its first administrator in one step.
   *
   * One step on purpose: a partner company with nobody able to sign in to it
   * is not a partner, it is a row. Every path that creates one here leaves
   * somebody able to use it.
   */
  async createPartner(principal: Principal, input: CreatePartnerInput) {
    const adminPhone = normalizePhone(input.adminPhone);
    if (!adminPhone || !isMobileNumber(adminPhone)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'The partner administrator needs a mobile number that can receive an SMS.',
        messageKey: 'error.auth.phoneInvalid',
      });
    }

    const [duplicate] = await this.db.query<{ id: string }>(
      `SELECT id FROM partners
       WHERE lower(legal_name) = lower($1) AND archived_at IS NULL`,
      [input.legalName],
    );
    if (duplicate) {
      throw new AppError({
        code: ErrorCode.CONFLICT,
        status: 409,
        message: 'A partner with this legal name already exists.',
        messageKey: 'error.partner.duplicateName',
      });
    }

    return this.db.transaction(async (tx) => {
      const [partner] = await tx.query<PartnerRow>(
        `INSERT INTO partners (legal_name, display_name, tax_id, contact_email, contact_phone,
                               status, integration_mode, approved_at)
         VALUES ($1, $2, $3, $4, $5, 'APPROVED', 'MANUAL', now())
         RETURNING id, legal_name, display_name, status, archived_at`,
        [
          input.legalName,
          input.displayName,
          input.taxId ?? null,
          input.contactEmail ?? null,
          normalizePhone(input.contactPhone) ?? null,
        ],
      );
      if (!partner) throw errors.internal();

      // Approved on creation, because a super admin creating it *is* the
      // approval. The PENDING state belongs to a self-registration flow this
      // product does not have.

      const userId = await this.ensureUser(tx, adminPhone, input.adminFirstName);
      await this.grantPartnerAdmin(tx, partner.id, userId);

      await this.audit.record({
        actor: principal,
        action: 'PARTNER_ACTION',
        entityType: 'partner',
        entityId: partner.id,
        after: { created: true, legalName: input.legalName, adminUserId: userId },
      });

      return {
        id: partner.id,
        legalName: partner.legal_name,
        displayName: partner.display_name,
        status: partner.status,
        adminUserId: userId,
        adminPhone,
      };
    });
  }

  /**
   * Retires a company. Archived, never deleted.
   *
   * Offers, orders and audit rows all reference a partner, and a company that
   * traded for a year cannot be made never to have existed. Archiving takes
   * its offers off the marketplace and its people out of the portal, which is
   * every effect a deletion was wanted for.
   */
  async archivePartner(principal: Principal, partnerId: string) {
    const [partner] = await this.db.query<PartnerRow>(
      `SELECT id, legal_name, display_name, status, archived_at
       FROM partners WHERE id = $1`,
      [partnerId],
    );
    if (!partner) throw errors.notFound('Partner');
    if (partner.archived_at) return { archived: true, alreadyArchived: true };

    return this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE partners
         SET archived_at = now(), status = 'SUSPENDED', updated_at = now()
         WHERE id = $1`,
        [partnerId],
      );

      // Its stock leaves the marketplace immediately. Without this a customer
      // could still reserve and pay for a part from a company that no longer
      // trades with us.
      const offers = await tx.query<{ id: string }>(
        `UPDATE offers SET active = false, updated_at = now()
         WHERE partner_id = $1 AND active
         RETURNING id`,
        [partnerId],
      );

      // Their people lose the portal, but keep their accounts: the same phone
      // number may well be a customer too, and that is a separate identity
      // question from whether they still work for this company.
      const roles = await tx.query<{ user_id: string }>(
        `DELETE FROM user_roles
         WHERE partner_id = $1 AND role IN ('PARTNER_USER','PARTNER_ADMIN')
         RETURNING user_id`,
        [partnerId],
      );
      await tx.query(`DELETE FROM partner_users WHERE partner_id = $1`, [partnerId]);

      await this.audit.record({
        actor: principal,
        action: 'PARTNER_ACTION',
        entityType: 'partner',
        entityId: partnerId,
        before: { status: partner.status, archived: false },
        after: { archived: true, offersDeactivated: offers.length, usersRevoked: roles.length },
      });

      return {
        archived: true,
        offersDeactivated: offers.length,
        usersRevoked: roles.length,
      };
    });
  }

  /** The people who can act for a partner. */
  async partnerUsers(partnerId: string) {
    return this.db.query(
      `SELECT u.id, u.phone, u.first_name, u.last_name, ur.role::text AS role,
              u.last_login_at, u.suspended_at
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.partner_id = $1 AND ur.role IN ('PARTNER_USER','PARTNER_ADMIN')
       ORDER BY u.created_at`,
      [partnerId],
    );
  }

  /**
   * Gives a phone number the keys to a partner's portal.
   *
   * Identified by number rather than invited by e-mail, because the number is
   * the account (ADR-015). If nobody has signed in on it yet the account is
   * created here, and the person simply finds the portal waiting the first
   * time they ask for a code.
   */
  async addPartnerUser(
    principal: Principal,
    partnerId: string,
    input: { phone: string; firstName?: string; role?: 'PARTNER_USER' | 'PARTNER_ADMIN' },
  ) {
    const phone = normalizePhone(input.phone);
    if (!phone || !isMobileNumber(phone)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'A mobile number that can receive an SMS is required.',
        messageKey: 'error.auth.phoneInvalid',
      });
    }

    const [partner] = await this.db.query<{ id: string; archived_at: Date | null }>(
      `SELECT id, archived_at FROM partners WHERE id = $1`,
      [partnerId],
    );
    if (!partner || partner.archived_at) throw errors.notFound('Partner');

    return this.db.transaction(async (tx) => {
      const userId = await this.ensureUser(tx, phone, input.firstName);
      await this.grantPartnerAdmin(tx, partnerId, userId, input.role ?? 'PARTNER_ADMIN');

      await this.audit.record({
        actor: principal,
        action: 'ROLE_ACTION',
        entityType: 'user',
        entityId: userId,
        after: { partnerId, role: input.role ?? 'PARTNER_ADMIN' },
      });

      return { userId, phone, role: input.role ?? 'PARTNER_ADMIN' };
    });
  }

  /** Takes the portal away from one person without touching the company. */
  async removePartnerUser(principal: Principal, partnerId: string, userId: string) {
    const removed = await this.db.query<{ user_id: string }>(
      `DELETE FROM user_roles
       WHERE partner_id = $1 AND user_id = $2 AND role IN ('PARTNER_USER','PARTNER_ADMIN')
       RETURNING user_id`,
      [partnerId, userId],
    );
    if (removed.length === 0) throw errors.notFound('Partner user');

    await this.db.query(`DELETE FROM partner_users WHERE partner_id = $1 AND user_id = $2`, [
      partnerId,
      userId,
    ]);

    await this.audit.record({
      actor: principal,
      action: 'ROLE_ACTION',
      entityType: 'user',
      entityId: userId,
      before: { partnerId },
      after: { partnerId: null },
    });

    return { removed: true };
  }

  /* ───────────────────────── platform staff ───────────────────────── */

  /**
   * The people who run the marketplace.
   *
   * Distinct from partner users, who run one company on it. A platform admin
   * can do everything the owner can — admit partner companies, approve what
   * partners add, manage categories — with exactly one exception: they cannot
   * create another one of themselves. Hiring is the owner's decision, and it
   * is the only power that does not delegate.
   */
  async staff() {
    return this.db.query(
      `SELECT u.id, u.phone, u.first_name, u.last_name, ur.role::text AS role,
              u.last_login_at, u.suspended_at, ur.granted_at
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.role IN ('PLATFORM_SUPPORT','PLATFORM_ADMIN','SUPER_ADMIN')
       ORDER BY
         CASE ur.role WHEN 'SUPER_ADMIN' THEN 0 WHEN 'PLATFORM_ADMIN' THEN 1 ELSE 2 END,
         u.created_at`,
    );
  }

  /**
   * Gives a phone number a seat in the admin workspace.
   *
   * SUPER_ADMIN only. Identified by number rather than invited by e-mail,
   * because the number is the account (ADR-015): the person simply finds the
   * admin panel waiting the first time they ask for a code.
   */
  async addStaff(
    principal: Principal,
    input: { phone: string; firstName?: string; role?: 'PLATFORM_SUPPORT' | 'PLATFORM_ADMIN' },
  ) {
    const phone = normalizePhone(input.phone);
    if (!phone || !isMobileNumber(phone)) {
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'A mobile number that can receive an SMS is required.',
        messageKey: 'error.auth.phoneInvalid',
      });
    }

    const role = input.role ?? 'PLATFORM_ADMIN';

    return this.db.transaction(async (tx) => {
      const userId = await this.ensureUser(tx, phone, input.firstName);

      // Platform roles carry no partner scope, and the user_roles CHECK
      // refuses a partner role without one — so this passes null deliberately
      // rather than by omission.
      await tx.query(
        `INSERT INTO user_roles (user_id, role, partner_id, granted_by)
         VALUES ($1, $2::user_role, NULL, $3)
         ON CONFLICT DO NOTHING`,
        [userId, role, principal.userId],
      );

      await this.audit.record({
        actor: principal,
        action: 'ROLE_ACTION',
        entityType: 'user',
        entityId: userId,
        after: { role, staff: true },
      });

      return { userId, phone, role };
    });
  }

  /** Takes the admin workspace away from one person. */
  async removeStaff(principal: Principal, userId: string) {
    if (userId === principal.userId) {
      // Removing your own access would leave the marketplace with one fewer
      // owner and no way back in if you are the last one.
      throw new AppError({
        code: ErrorCode.VALIDATION_FAILED,
        status: 400,
        message: 'You cannot remove your own access.',
        messageKey: 'error.staff.cannotRemoveSelf',
      });
    }

    const removed = await this.db.query<{ role: string }>(
      `DELETE FROM user_roles
       WHERE user_id = $1 AND role IN ('PLATFORM_SUPPORT','PLATFORM_ADMIN')
       RETURNING role::text AS role`,
      [userId],
    );
    if (removed.length === 0) {
      // A SUPER_ADMIN is deliberately not removable here: demoting an owner is
      // a decision that should not be one click away in a list.
      throw errors.notFound('Staff member');
    }

    await this.audit.record({
      actor: principal,
      action: 'ROLE_ACTION',
      entityType: 'user',
      entityId: userId,
      before: { role: removed[0]!.role },
      after: { role: null },
    });

    return { removed: true };
  }

  /**
   * Finds or creates the account behind a number.
   *
   * No code is sent and no session is created: this only establishes that the
   * number has an account for the role to hang on. The person still proves the
   * number is theirs the normal way, by verifying a code they asked for.
   */
  private async ensureUser(
    tx: TransactionClient,
    phone: string,
    firstName?: string,
  ): Promise<string> {
    const [user] = await tx.query<{ id: string }>(
      `INSERT INTO users (phone, first_name, locale)
       VALUES ($1, $2, 'ka')
       ON CONFLICT (phone) DO UPDATE
         SET first_name = COALESCE(users.first_name, EXCLUDED.first_name)
       RETURNING id`,
      [phone, firstName ?? null],
    );
    if (!user) throw errors.internal();
    return user.id;
  }

  private async grantPartnerAdmin(
    tx: TransactionClient,
    partnerId: string,
    userId: string,
    role: 'PARTNER_USER' | 'PARTNER_ADMIN' = 'PARTNER_ADMIN',
  ): Promise<void> {
    await tx.query(
      `INSERT INTO user_roles (user_id, role, partner_id)
       VALUES ($1, $2::user_role, $3)
       ON CONFLICT DO NOTHING`,
      [userId, role, partnerId],
    );
    await tx.query(
      `INSERT INTO partner_users (partner_id, user_id, is_admin)
       VALUES ($1, $2, $3)
       ON CONFLICT (partner_id, user_id) DO UPDATE SET is_admin = EXCLUDED.is_admin`,
      [partnerId, userId, role === 'PARTNER_ADMIN'],
    );
  }
}
