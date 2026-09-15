import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errors, isSellable } from '@autoparts/core';
import { DatabaseService } from '../../database/database.module.js';
import { FitmentService } from '../fitment/fitment.service.js';
import type { AppConfig } from '../../config/configuration.js';

export type OfferSort = 'recommended' | 'cheapest' | 'nearest' | 'best_rated' | 'fastest';

export interface OfferCard {
  offerId: string;
  partner: { id: string; displayName: string; rating: number | null };
  location: { id: string | null; name: string | null; city: string | null; distanceKm: number | null };
  /** base + markup. The split is never exposed to a customer (docs/08 §2). */
  price: { amountMinor: string; currency: string };
  availability: string;
  availableQuantity: number;
  expectedAvailabilityDays: number | null;
  paymentTerms: string;
  warrantyMonths: number | null;
  /** Always present: a price beside stale stock is a half-truth (R2). */
  stock: { lastSyncedAt: string; ageMinutes: number; isStale: boolean };
  recommendedScore?: number;
}

/** Fallback origin for distance when the client sends no coordinates. */
const DEFAULT_ORIGIN = { lat: 41.7151, lon: 44.8271 }; // Tbilisi

/** Weights for the Recommended score (PRD §35). */
const WEIGHTS = { price: 0.4, availability: 0.25, reliability: 0.2, distance: 0.15 };

@Injectable()
export class OffersService {
  private readonly staleAfterMinutes: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly fitment: FitmentService,
    config: ConfigService<AppConfig, true>,
  ) {
    void config;
    this.staleAfterMinutes = 30;
  }

  /**
   * Offers for one product, for one vehicle.
   *
   * The fitment check is repeated here rather than trusted from the search that
   * led the user in: a conflict can open, or an admin mapping can change,
   * between the two requests, and an offer page is one click from a purchase
   * (R1).
   */
  async forProduct(params: {
    productId: string;
    vehicleId: string;
    sort?: OfferSort;
    availability?: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'BOTH';
    lat?: number;
    lon?: number;
  }): Promise<{ offers: OfferCard[]; fitmentBlocked?: true }> {
    const verdict = await this.fitment.evaluateOne(params.vehicleId, params.productId);
    if (!verdict || !isSellable(verdict.verdict)) {
      // Not an empty list: the caller must be able to tell "nobody stocks it"
      // from "this does not fit your car", because the next step differs.
      return { offers: [], fitmentBlocked: true };
    }

    const origin = {
      lat: params.lat ?? DEFAULT_ORIGIN.lat,
      lon: params.lon ?? DEFAULT_ORIGIN.lon,
    };

    const statuses =
      params.availability === 'BOTH' || params.availability === undefined
        ? ['IN_STOCK', 'AVAILABLE_TO_ORDER']
        : [params.availability];

    const rows = await this.db.query<{
      offer_id: string;
      partner_id: string;
      display_name: string;
      rating: string | null;
      stock_reliability: string;
      location_id: string | null;
      location_name: string | null;
      city: string | null;
      distance_km: string | null;
      customer_price_minor: string;
      currency: string;
      availability_status: string;
      available_quantity: number;
      expected_availability_days: number | null;
      payment_terms: string;
      warranty_months: number | null;
      last_synced_at: Date;
      age_minutes: number;
    }>(
      `SELECT o.id AS offer_id,
              pa.id AS partner_id, pa.display_name, pa.stock_reliability,
              (SELECT round(avg(r.seller_rating)::numeric, 2)::text
               FROM reviews r WHERE r.partner_id = pa.id) AS rating,
              l.id AS location_id, l.name AS location_name, l.city,
              CASE WHEN l.latitude IS NULL OR l.longitude IS NULL THEN NULL
                   ELSE round((
                     6371 * acos(GREATEST(-1, LEAST(1,
                       cos(radians($3)) * cos(radians(l.latitude)) *
                       cos(radians(l.longitude) - radians($4)) +
                       sin(radians($3)) * sin(radians(l.latitude))
                     )))
                   )::numeric, 1)::text
              END AS distance_km,
              o.customer_price_minor::text, o.currency, o.availability_status,
              GREATEST(av.available, 0) AS available_quantity,
              o.expected_availability_days, o.payment_terms, o.warranty_months,
              o.last_synced_at,
              (extract(epoch FROM (now() - o.last_synced_at))::int / 60) AS age_minutes
       FROM offers o
       JOIN partners pa ON pa.id = o.partner_id AND pa.status = 'APPROVED'
       LEFT JOIN partner_locations l ON l.id = o.location_id
       JOIN offer_availability av ON av.offer_id = o.id
       WHERE o.product_id = $1
         AND o.active
         AND o.availability_status::text = ANY($2::text[])
         -- An IN_STOCK offer with everything reserved is not purchasable now,
         -- so it is not shown as though it were (PRD §28).
         AND (o.availability_status <> 'IN_STOCK' OR av.available > 0)`,
      [params.productId, statuses, origin.lat, origin.lon],
    );

    const cards: OfferCard[] = rows.map((row) => ({
      offerId: row.offer_id,
      partner: {
        id: row.partner_id,
        displayName: row.display_name,
        rating: row.rating === null ? null : Number(row.rating),
      },
      location: {
        id: row.location_id,
        name: row.location_name,
        city: row.city,
        distanceKm: row.distance_km === null ? null : Number(row.distance_km),
      },
      price: { amountMinor: row.customer_price_minor, currency: row.currency },
      availability: row.availability_status,
      availableQuantity: row.available_quantity,
      expectedAvailabilityDays: row.expected_availability_days,
      paymentTerms: row.payment_terms,
      warrantyMonths: row.warranty_months,
      stock: {
        lastSyncedAt: row.last_synced_at.toISOString(),
        ageMinutes: row.age_minutes,
        isStale: row.age_minutes > this.staleAfterMinutes,
      },
    }));

    this.score(cards, rows);
    return { offers: this.sort(cards, params.sort ?? 'recommended') };
  }

  /**
   * Recommended score (PRD §35): price, availability, seller reliability and
   * distance, each normalised to 0..1 across the offers actually on screen.
   *
   * Relative rather than absolute so the ranking means something whether the
   * part costs 20 GEL or 2,000.
   */
  private score(cards: OfferCard[], rows: { stock_reliability: string }[]): void {
    if (cards.length === 0) return;

    const prices = cards.map((c) => Number(c.price.amountMinor));
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const distances = cards.map((c) => c.location.distanceKm ?? 50);
    const maxDistance = Math.max(...distances, 1);

    cards.forEach((card, i) => {
      const price = Number(card.price.amountMinor);
      const priceScore = maxPrice === minPrice ? 1 : 1 - (price - minPrice) / (maxPrice - minPrice);
      const availabilityScore = card.availability === 'IN_STOCK' ? 1 : 0.4;
      const reliability = Number(rows[i]?.stock_reliability ?? 1);
      const distanceScore = 1 - (card.location.distanceKm ?? 50) / maxDistance;

      // Stale stock is discounted rather than hidden: the partner may well have
      // it, but we are less sure, and Recommended is exactly where that belongs.
      const freshness = card.stock.isStale ? 0.85 : 1;

      card.recommendedScore =
        Math.round(
          (WEIGHTS.price * priceScore +
            WEIGHTS.availability * availabilityScore +
            WEIGHTS.reliability * reliability +
            WEIGHTS.distance * distanceScore) *
            freshness *
            1000,
        ) / 1000;
    });
  }

  private sort(cards: OfferCard[], sort: OfferSort): OfferCard[] {
    const byPrice = (a: OfferCard, b: OfferCard) =>
      Number(a.price.amountMinor) - Number(b.price.amountMinor);

    switch (sort) {
      case 'cheapest':
        return [...cards].sort(byPrice);
      case 'nearest':
        return [...cards].sort(
          (a, b) => (a.location.distanceKm ?? 1e9) - (b.location.distanceKm ?? 1e9) || byPrice(a, b),
        );
      case 'best_rated':
        return [...cards].sort((a, b) => (b.partner.rating ?? 0) - (a.partner.rating ?? 0) || byPrice(a, b));
      case 'fastest':
        // In stock beats any lead time; among the rest, the shorter wait wins.
        return [...cards].sort((a, b) => {
          const wait = (c: OfferCard) =>
            c.availability === 'IN_STOCK' ? 0 : (c.expectedAvailabilityDays ?? 30);
          return wait(a) - wait(b) || byPrice(a, b);
        });
      case 'recommended':
      default:
        return [...cards].sort(
          (a, b) => (b.recommendedScore ?? 0) - (a.recommendedScore ?? 0) || byPrice(a, b),
        );
    }
  }

  /** One offer with everything checkout needs. Used by cart and reservation. */
  async detail(offerId: string) {
    const [row] = await this.db.query<{
      id: string; partner_id: string; product_id: string; location_id: string | null;
      base_price_minor: string; platform_markup_minor: string; customer_price_minor: string;
      currency: string; availability_status: string; available: number;
      partner_status: string; active: boolean; payment_terms: string;
    }>(
      `SELECT o.id, o.partner_id, o.product_id, o.location_id,
              o.base_price_minor::text, o.platform_markup_minor::text,
              o.customer_price_minor::text, o.currency, o.availability_status,
              GREATEST(av.available, 0) AS available,
              pa.status AS partner_status, o.active, o.payment_terms
       FROM offers o
       JOIN partners pa ON pa.id = o.partner_id
       JOIN offer_availability av ON av.offer_id = o.id
       WHERE o.id = $1`,
      [offerId],
    );
    if (!row || !row.active || row.partner_status !== 'APPROVED') {
      throw errors.notFound('Offer');
    }
    return row;
  }
}
