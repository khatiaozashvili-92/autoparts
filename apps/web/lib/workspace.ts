import type { Me } from './session';

/**
 * Which of the three products a signed-in person is actually using.
 *
 * The same deployment serves three different jobs, and until now they shared
 * one interface: an admin and a partner both carried the customer's VIN picker
 * in the header and the customer's cart in the nav, neither of which they have
 * any use for. A partner does not shop for parts for their own car here, and a
 * super admin does not either.
 *
 * Roles already decide what the API will answer (docs/07 §5). This decides
 * what the interface offers, which is a different question: the API refusing a
 * request is a safety net, not a design.
 */
export type Workspace = 'customer' | 'partner' | 'admin';

export const PLATFORM_ROLES = ['PLATFORM_SUPPORT', 'PLATFORM_ADMIN', 'SUPER_ADMIN'] as const;

export function isPlatformStaff(me: Me | null): boolean {
  return !!me?.roles.some((r) => (PLATFORM_ROLES as readonly string[]).includes(r));
}

export function isPartner(me: Me | null): boolean {
  return !!me?.partnerId;
}

export function isSuperAdmin(me: Me | null): boolean {
  return !!me?.roles.includes('SUPER_ADMIN');
}

/**
 * Platform staff outrank a partner role on the same account, because someone
 * holding both is here to run the marketplace.
 */
export function workspaceOf(me: Me | null): Workspace {
  if (isPlatformStaff(me)) return 'admin';
  if (isPartner(me)) return 'partner';
  return 'customer';
}

/** Where signing in should land each of them. */
export function homeFor(me: Me | null): string {
  switch (workspaceOf(me)) {
    case 'admin':
      return '/admin';
    case 'partner':
      return '/partner';
    default:
      return '/';
  }
}

export interface NavItem {
  href: string;
  label: string;
  /** Super admin only: creating partners and categories is not delegated. */
  superAdminOnly?: boolean;
}

/**
 * What each workspace offers.
 *
 * Read this as the answer to "what is this person's job here":
 *
 * - customer  finds a part that fits their car, and buys it
 * - partner   keeps their catalogue, stock and prices right, and sees what sold
 * - admin     runs the marketplace: who sells on it, and what it sells
 */
export const NAV: Record<Workspace, NavItem[]> = {
  customer: [
    { href: '/search', label: 'ძებნა' },
    { href: '/garage', label: 'გარაჟი' },
    { href: '/orders', label: 'შეკვეთები' },
    { href: '/transactions', label: 'ტრანზაქციები' },
  ],
  partner: [
    { href: '/partner', label: 'მიმოხილვა' },
    { href: '/partner/products', label: 'პროდუქცია' },
    { href: '/partner/stock', label: 'მარაგი' },
    { href: '/partner/reports', label: 'გაყიდვები' },
    { href: '/partner/transactions', label: 'ტრანზაქციები' },
  ],
  admin: [
    { href: '/admin', label: 'მიმოხილვა' },
    { href: '/admin/partners', label: 'პარტნიორები' },
    { href: '/admin/categories', label: 'კატეგორიები' },
    { href: '/admin/inventory', label: 'მარაგები' },
    { href: '/admin/products', label: 'პროდუქციის განხილვა' },
    { href: '/admin/transactions', label: 'ტრანზაქციები' },
    // The one thing that does not delegate: only the owner hires.
    { href: '/admin/staff', label: 'თანამშრომლები', superAdminOnly: true },
  ],
};

export function navFor(me: Me | null): NavItem[] {
  const items = NAV[workspaceOf(me)];
  return items.filter((item) => !item.superAdminOnly || isSuperAdmin(me));
}

/**
 * Whether the header should carry the car picker.
 *
 * Only the customer workspace. The picker is the whole premise of the shopping
 * experience (PRD §74) and pure noise in the other two.
 */
export function showsVehicleBar(me: Me | null): boolean {
  return workspaceOf(me) === 'customer';
}
