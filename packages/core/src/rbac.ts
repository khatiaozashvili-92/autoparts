/**
 * RBAC model (PRD §77, docs/07 §5).
 *
 * Roles are checked at the data-access layer, not in the UI. The most important
 * rule here is partner isolation: a partner must never see another partner's
 * prices (PRD §3, §31).
 */

import { UserRole } from './enums.js';

export const PLATFORM_ROLES: readonly UserRole[] = [
  UserRole.PLATFORM_SUPPORT,
  UserRole.PLATFORM_ADMIN,
  UserRole.SUPER_ADMIN,
];

export const PARTNER_ROLES: readonly UserRole[] = [
  UserRole.PARTNER_USER,
  UserRole.PARTNER_ADMIN,
];

/** Roles allowed to read across every partner. Everyone else is scoped. */
export const CROSS_PARTNER_ROLES: readonly UserRole[] = PLATFORM_ROLES;

export interface Principal {
  readonly userId: string;
  readonly roles: readonly UserRole[];
  /** Present only for PARTNER_* roles. Always taken from the token. */
  readonly partnerId: string | null;
}

export function hasRole(p: Principal, ...roles: UserRole[]): boolean {
  return roles.some((r) => p.roles.includes(r));
}

export function isPlatformStaff(p: Principal): boolean {
  return p.roles.some((r) => PLATFORM_ROLES.includes(r));
}

export function isPartner(p: Principal): boolean {
  return p.roles.some((r) => PARTNER_ROLES.includes(r));
}

export function canReadAcrossPartners(p: Principal): boolean {
  return p.roles.some((r) => CROSS_PARTNER_ROLES.includes(r));
}

export class ScopeViolationError extends Error {
  constructor(message = 'Principal is not scoped to a partner') {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

/**
 * Resolves the partner scope for a query.
 *
 * Returns `null` for platform staff (no filter) and the principal's own
 * partnerId otherwise. The partnerId always comes from the token — a
 * partnerId supplied in a request body or query string is ignored, which is
 * what makes cross-partner reads impossible rather than merely discouraged.
 */
export function resolvePartnerScope(p: Principal): string | null {
  if (canReadAcrossPartners(p)) return null;
  if (!p.partnerId) throw new ScopeViolationError();
  return p.partnerId;
}

/**
 * Permissions that are not simply "has role X".
 * Kept explicit so the admin panel and the API agree (docs/09 §9).
 */
export const Permission = {
  MANAGE_MARKUP: 'MANAGE_MARKUP',
  ISSUE_REFUND: 'ISSUE_REFUND',
  RESOLVE_FITMENT_CONFLICT: 'RESOLVE_FITMENT_CONFLICT',
  APPROVE_PARTNER: 'APPROVE_PARTNER',
  ASSIGN_ROLES: 'ASSIGN_ROLES',
  VIEW_ALL_ORDERS: 'VIEW_ALL_ORDERS',
  MANAGE_PARTNER_USERS: 'MANAGE_PARTNER_USERS',
  MANAGE_PARTNER_INTEGRATION: 'MANAGE_PARTNER_INTEGRATION',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CUSTOMER: [],
  PARTNER_USER: [],
  PARTNER_ADMIN: [Permission.MANAGE_PARTNER_USERS, Permission.MANAGE_PARTNER_INTEGRATION],
  // Support can start a refund but cannot change what the platform charges.
  PLATFORM_SUPPORT: [Permission.ISSUE_REFUND, Permission.VIEW_ALL_ORDERS],
  PLATFORM_ADMIN: [
    Permission.MANAGE_MARKUP,
    Permission.ISSUE_REFUND,
    Permission.RESOLVE_FITMENT_CONFLICT,
    Permission.APPROVE_PARTNER,
    Permission.VIEW_ALL_ORDERS,
  ],
  SUPER_ADMIN: Object.values(Permission),
};

export function can(p: Principal, permission: Permission): boolean {
  return p.roles.some((role) => ROLE_PERMISSIONS[role]?.includes(permission));
}

export function permissionsFor(roles: readonly UserRole[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) for (const perm of ROLE_PERMISSIONS[role] ?? []) set.add(perm);
  return [...set];
}
