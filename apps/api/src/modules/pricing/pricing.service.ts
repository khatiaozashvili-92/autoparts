import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.module.js';

export interface MarkupRule {
  id: string;
  partnerId: string | null;
  categoryId: string | null;
  markupPercent: number | null;
  markupFixedMinor: bigint | null;
  priority: number;
}

/**
 * Markup engine (PRD §33, docs/08 §3).
 *
 * The platform's margin is added on top of the partner's base price
 * (ADR-001), and which margin applies is a configuration question answered by
 * `price_rules` — never a constant in code, because an admin changes it from
 * the dashboard.
 */
@Injectable()
export class PricingService {
  private cache: { rules: MarkupRule[]; loadedAt: number } | null = null;
  private static readonly TTL_MS = 30_000;

  constructor(private readonly db: DatabaseService) {}

  async markupFor(params: {
    partnerId: string;
    categoryId: string | null;
  }): Promise<MarkupRule | null> {
    const rules = await this.rules();

    const applicable = rules.filter(
      (r) =>
        (r.partnerId === null || r.partnerId === params.partnerId) &&
        (r.categoryId === null || r.categoryId === params.categoryId),
    );

    // More specific wins, then explicit priority. partner+category (3) beats
    // partner (2) beats category (1) beats the platform default (0).
    applicable.sort((a, b) => specificity(b) - specificity(a) || b.priority - a.priority);
    return applicable[0] ?? null;
  }

  async computeMarkupMinor(
    basePriceMinor: bigint,
    params: { partnerId: string; categoryId: string | null },
  ): Promise<bigint> {
    const rule = await this.markupFor(params);
    if (!rule) return 0n;

    if (rule.markupFixedMinor !== null) return rule.markupFixedMinor;
    if (rule.markupPercent === null) return 0n;

    // Integer arithmetic throughout, half-up. Percent is scaled to 1/1000ths so
    // a rule like 8.5% is exact rather than a float approximation (ADR-005).
    const scaled = BigInt(Math.round(rule.markupPercent * 1000));
    const numerator = basePriceMinor * scaled;
    const denominator = 100_000n;
    const quotient = numerator / denominator;
    const remainder = numerator % denominator;
    return quotient + (remainder * 2n >= denominator ? 1n : 0n);
  }

  /** Dropped after an admin edits a rule, so a change takes effect at once. */
  invalidate(): void {
    this.cache = null;
  }

  private async rules(): Promise<MarkupRule[]> {
    if (this.cache && Date.now() - this.cache.loadedAt < PricingService.TTL_MS) {
      return this.cache.rules;
    }

    const rows = await this.db.query<{
      id: string;
      partner_id: string | null;
      category_id: string | null;
      markup_percent: string | null;
      markup_fixed_minor: string | null;
      priority: number;
    }>(
      `SELECT id, partner_id, category_id, markup_percent, markup_fixed_minor, priority
       FROM price_rules
       WHERE active
         AND valid_from <= now()
         AND (valid_to IS NULL OR valid_to > now())`,
    );

    const rules = rows.map((r) => ({
      id: r.id,
      partnerId: r.partner_id,
      categoryId: r.category_id,
      markupPercent: r.markup_percent === null ? null : Number(r.markup_percent),
      markupFixedMinor: r.markup_fixed_minor === null ? null : BigInt(r.markup_fixed_minor),
      priority: r.priority,
    }));

    this.cache = { rules, loadedAt: Date.now() };
    return rules;
  }
}

function specificity(rule: MarkupRule): number {
  if (rule.partnerId && rule.categoryId) return 3;
  if (rule.partnerId) return 2;
  if (rule.categoryId) return 1;
  return 0;
}
