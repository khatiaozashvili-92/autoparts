import { Injectable } from '@nestjs/common';
import { errors, isSellable, type Principal } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { FitmentService } from '../fitment/fitment.service.js';

export interface CartItem {
  id: string;
  offerId: string;
  productId: string;
  productName: string;
  brandName: string;
  vehicleId: string;
  vehicleLabel: string;
  quantity: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  currency: string;
  partner: { id: string; displayName: string };
  availableQuantity: number;
  fitmentVerdict: string;
}

export interface Cart {
  id: string;
  items: CartItem[];
  /** MVP allows one partner per checkout (PRD §40). */
  partnerIds: string[];
  subtotalMinor: string;
  currency: string | null;
  /** Set when the cart cannot be checked out as it stands. */
  blocker?: 'MULTIPLE_PARTNERS' | 'EMPTY';
}

@Injectable()
export class CartService {
  constructor(
    private readonly db: DatabaseService,
    private readonly fitment: FitmentService,
  ) {}

  async get(principal: Principal): Promise<Cart> {
    const cartId = await this.ensureCart(principal.userId);
    return this.load(cartId);
  }

  /**
   * Adds an offer to the cart.
   *
   * Fitment is checked again here even though search already filtered: a
   * conflict can open or an admin mapping can change between browsing and
   * adding, and this is the last cheap moment to catch it before money is
   * involved (R1, invariant I5).
   */
  async addItem(
    principal: Principal,
    input: { offerId: string; vehicleId: string; quantity: number },
  ): Promise<Cart> {
    const cartId = await this.ensureCart(principal.userId);

    const [vehicle] = await this.db.query<{ id: string }>(
      `SELECT id FROM vehicles WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [input.vehicleId, principal.userId],
    );
    if (!vehicle) throw errors.notFound('Vehicle');

    const [offer] = await this.db.query<{
      product_id: string; available: number; availability_status: string; active: boolean;
      partner_status: string; currency: string;
    }>(
      `SELECT o.product_id, GREATEST(av.available, 0) AS available,
              o.availability_status, o.active, pa.status AS partner_status, o.currency
       FROM offers o
       JOIN partners pa ON pa.id = o.partner_id
       JOIN offer_availability av ON av.offer_id = o.id
       WHERE o.id = $1`,
      [input.offerId],
    );
    if (!offer || !offer.active || offer.partner_status !== 'APPROVED') {
      throw errors.notFound('Offer');
    }

    const verdict = await this.fitment.evaluateOne(input.vehicleId, offer.product_id);
    if (!verdict || !isSellable(verdict.verdict)) {
      throw errors.fitmentNotConfirmed({
        verdict: verdict?.verdict ?? 'UNCERTAIN',
        productId: offer.product_id,
        vehicleId: input.vehicleId,
        ...(verdict?.missingAttributes ? { missingAttributes: verdict.missingAttributes } : {}),
        ...(verdict?.clarification ? { clarification: verdict.clarification } : {}),
      });
    }

    if (offer.availability_status === 'IN_STOCK' && offer.available < input.quantity) {
      throw errors.stockUnavailable({
        offerId: input.offerId,
        requested: input.quantity,
        available: offer.available,
      });
    }

    await this.db.query(
      `INSERT INTO cart_items (cart_id, offer_id, vehicle_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cart_id, offer_id, vehicle_id)
       DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity`,
      [cartId, input.offerId, input.vehicleId, input.quantity],
    );

    return this.load(cartId);
  }

  async updateItem(principal: Principal, itemId: string, quantity: number): Promise<Cart> {
    const cartId = await this.ensureCart(principal.userId);
    if (quantity <= 0) return this.removeItem(principal, itemId);

    const result = await this.db.query<{ id: string }>(
      `UPDATE cart_items SET quantity = $3
       WHERE id = $1 AND cart_id = $2
       RETURNING id`,
      [itemId, cartId, quantity],
    );
    if (result.length === 0) throw errors.notFound('Cart item');
    return this.load(cartId);
  }

  async removeItem(principal: Principal, itemId: string): Promise<Cart> {
    const cartId = await this.ensureCart(principal.userId);
    await this.db.query(`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, [itemId, cartId]);
    return this.load(cartId);
  }

  async clear(userId: string): Promise<void> {
    await this.db.query(
      `DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)`,
      [userId],
    );
  }

  private async ensureCart(userId: string): Promise<string> {
    const [row] = await this.db.query<{ id: string }>(
      `INSERT INTO carts (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [userId],
    );
    return row!.id;
  }

  private async load(cartId: string): Promise<Cart> {
    const rows = await this.db.query<{
      id: string; offer_id: string; product_id: string; product_name: string;
      brand_name: string; vehicle_id: string; vehicle_label: string;
      quantity: number; unit_price_minor: string; currency: string;
      partner_id: string; partner_name: string; available: number;
    }>(
      `SELECT ci.id, ci.offer_id, o.product_id, p.name AS product_name, b.name AS brand_name,
              ci.vehicle_id,
              COALESCE(v.custom_name, concat_ws(' ', c.make, c.model, c.model_year))
                AS vehicle_label,
              ci.quantity, o.customer_price_minor::text AS unit_price_minor, o.currency,
              pa.id AS partner_id, pa.display_name AS partner_name,
              GREATEST(av.available, 0) AS available
       FROM cart_items ci
       JOIN offers o ON o.id = ci.offer_id
       JOIN offer_availability av ON av.offer_id = o.id
       JOIN products p ON p.id = o.product_id
       JOIN brands b ON b.id = p.brand_id
       JOIN partners pa ON pa.id = o.partner_id
       JOIN vehicles v ON v.id = ci.vehicle_id
       LEFT JOIN vehicle_configurations c ON c.id = v.configuration_id
       WHERE ci.cart_id = $1
       ORDER BY ci.created_at`,
      [cartId],
    );

    const items: CartItem[] = rows.map((row) => ({
      id: row.id,
      offerId: row.offer_id,
      productId: row.product_id,
      productName: row.product_name,
      brandName: row.brand_name,
      vehicleId: row.vehicle_id,
      vehicleLabel: row.vehicle_label,
      quantity: row.quantity,
      unitPriceMinor: row.unit_price_minor,
      lineTotalMinor: (BigInt(row.unit_price_minor) * BigInt(row.quantity)).toString(),
      currency: row.currency,
      partner: { id: row.partner_id, displayName: row.partner_name },
      availableQuantity: row.available,
      fitmentVerdict: 'COMPATIBLE',
    }));

    const partnerIds = [...new Set(items.map((i) => i.partner.id))];
    const subtotal = items.reduce((sum, i) => sum + BigInt(i.lineTotalMinor), 0n);

    return {
      id: cartId,
      items,
      partnerIds,
      subtotalMinor: subtotal.toString(),
      currency: items[0]?.currency ?? null,
      // Surfaced rather than rejected at checkout: the customer should learn
      // this while looking at the cart, not after filling in an address.
      ...(items.length === 0
        ? { blocker: 'EMPTY' as const }
        : partnerIds.length > 1
          ? { blocker: 'MULTIPLE_PARTNERS' as const }
          : {}),
    };
  }
}
