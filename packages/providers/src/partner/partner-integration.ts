import { normalizeIdentifier } from '@autoparts/core';

/**
 * Partner Integration Layer (PRD §71, docs/06 §1).
 *
 * Every partner names their fields differently — `stock_qty`, `available`,
 * `qty` — and none of that variety is allowed past this boundary. Adapters
 * normalize into one shape so the marketplace never learns whose ERP it is
 * talking to, and onboarding a partner needs a mapping row rather than a
 * deploy.
 */

export type IntegrationMode = 'API' | 'CSV' | 'MANUAL';

export interface NormalizedInventoryItem {
  sku: string;
  identifiers: { kind: 'OEM' | 'MPN' | 'EAN'; value: string; normalized: string }[];
  productName: string;
  brandName: string;
  priceMinor: bigint;
  currency: string;
  quantity: number;
  availability: 'IN_STOCK' | 'AVAILABLE_TO_ORDER' | 'UNAVAILABLE';
  expectedAvailabilityDays?: number | null;
  warrantyMonths?: number | null;
  /**
   * Where the part belongs, when the partner is loading a catalogue rather
   * than repricing one. Only read if the row has to create a product.
   */
  categorySlug?: string | null;
  /**
   * The part TYPE, which is what fitment hangs off.
   *
   * Distinct from productName on purpose: "front brake pads" is a type that
   * many brands make, while "Ferodo FDB1234 front brake pads" is one product.
   * Filing every product under a type named after itself would give every
   * product its own type, and fitment established for one would benefit none
   * of the others.
   */
  partType?: string | null;
  /** Vehicles the partner claims this fits — a signal, never the last word (R3). */
  declaredFitment?: DeclaredFitment[];
}

export interface DeclaredFitment {
  make: string;
  model?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  engineCode?: string | null;
  market?: string | null;
}

export interface RowError {
  row: number;
  column?: string;
  code: string;
  message: string;
  value?: string;
}

export interface NormalizationResult {
  items: NormalizedInventoryItem[];
  errors: RowError[];
}

/** Field names a partner may use for each of our fields. */
export interface FieldMapping {
  sku?: string[];
  oem?: string[];
  mpn?: string[];
  ean?: string[];
  name?: string[];
  brand?: string[];
  price?: string[];
  currency?: string[];
  quantity?: string[];
  availability?: string[];
  warranty?: string[];
  expectedDays?: string[];
  /** Only used when a partner is loading a catalogue, not pricing one. */
  category?: string[];
  /** The kind of part, as opposed to this particular branded item. */
  partType?: string[];
}

export const DEFAULT_FIELD_MAPPING: Required<FieldMapping> = {
  sku: ['sku', 'article', 'code', 'partner_sku'],
  oem: ['oem', 'oem_number', 'oe', 'oe_number'],
  mpn: ['mpn', 'part_number', 'partnumber', 'manufacturer_part_number'],
  ean: ['ean', 'barcode', 'gtin'],
  name: ['name', 'product_name', 'title', 'description'],
  brand: ['brand', 'manufacturer', 'make'],
  price: ['price', 'cost', 'amount', 'base_price'],
  currency: ['currency', 'ccy'],
  quantity: ['quantity', 'qty', 'stock', 'stock_qty', 'count', 'available_qty'],
  availability: ['availability', 'status', 'available', 'in_stock'],
  warranty: ['warranty', 'warranty_months'],
  expectedDays: ['expected_days', 'lead_time', 'eta_days'],
  // Georgian headers too: partners write their own spreadsheets, and a file
  // that has to be re-typed in English is a file that never gets uploaded.
  category: ['category', 'category_slug', 'kategoria', 'კატეგორია'],
  partType: ['part_type', 'type', 'part', 'ნაწილი'],
};

const REQUIRED = ['sku', 'name', 'brand', 'price', 'quantity'] as const;

/**
 * Turns partner rows into our shape.
 *
 * Partial by design (docs/06 §5): a bad row is rejected and reported with its
 * line number while the rest import. All-or-nothing would let one typo hold
 * back a partner's entire catalogue, which is how a partner stops uploading.
 */
export function normalizeRows(
  rows: Record<string, string>[],
  mapping: FieldMapping = {},
  defaults: { currency: string } = { currency: 'GEL' },
): NormalizationResult {
  const resolved = { ...DEFAULT_FIELD_MAPPING, ...mapping };
  const items: NormalizedInventoryItem[] = [];
  const errors: RowError[] = [];
  const seenSku = new Map<string, number>();

  rows.forEach((raw, index) => {
    // +2: one for the header, one because humans count from 1.
    const rowNumber = index + 2;
    const row = lowerKeys(raw);

    const pick = (field: keyof Required<FieldMapping>): string | undefined => {
      for (const candidate of resolved[field]) {
        const value = row[candidate];
        if (value !== undefined && value.trim() !== '') return value.trim();
      }
      return undefined;
    };

    const values: Record<string, string | undefined> = {
      sku: pick('sku'),
      name: pick('name'),
      brand: pick('brand'),
      price: pick('price'),
      quantity: pick('quantity'),
      category: pick('category'),
      partType: pick('partType'),
    };

    const missing = REQUIRED.filter((f) => !values[f]);
    if (missing.length > 0) {
      for (const column of missing) {
        errors.push({
          row: rowNumber,
          column,
          code: 'MISSING_REQUIRED',
          message: `Required column "${column}" is empty or absent`,
        });
      }
      return;
    }

    const sku = values['sku']!;
    const duplicateOf = seenSku.get(sku.toUpperCase());
    if (duplicateOf !== undefined) {
      errors.push({
        row: rowNumber,
        column: 'sku',
        code: 'DUPLICATE_IN_FILE',
        message: `SKU already appears on row ${duplicateOf}`,
        value: sku,
      });
      return;
    }
    seenSku.set(sku.toUpperCase(), rowNumber);

    const priceMinor = parsePriceToMinor(values['price']!);
    if (priceMinor === null) {
      errors.push({
        row: rowNumber, column: 'price', code: 'INVALID_PRICE',
        message: 'Price is not a number', value: values['price'],
      });
      return;
    }
    if (priceMinor < 0n) {
      errors.push({
        row: rowNumber, column: 'price', code: 'NEGATIVE_PRICE',
        message: 'Price cannot be negative', value: values['price'],
      });
      return;
    }

    const quantity = Number.parseInt(values['quantity']!, 10);
    if (!Number.isFinite(quantity)) {
      errors.push({
        row: rowNumber, column: 'quantity', code: 'INVALID_QUANTITY',
        message: 'Quantity is not a whole number', value: values['quantity'],
      });
      return;
    }
    if (quantity < 0) {
      errors.push({
        row: rowNumber, column: 'quantity', code: 'NEGATIVE_QUANTITY',
        message: 'Quantity cannot be negative', value: values['quantity'],
      });
      return;
    }

    const identifiers: NormalizedInventoryItem['identifiers'] = [];
    for (const [kind, field] of [['OEM', 'oem'], ['MPN', 'mpn'], ['EAN', 'ean']] as const) {
      const value = pick(field);
      if (!value) continue;
      const normalized = normalizeIdentifier(value);
      if (!/^[A-Z0-9]{3,50}$/.test(normalized)) {
        errors.push({
          row: rowNumber, column: field, code: 'INVALID_IDENTIFIER',
          message: `${kind} is not a usable identifier`, value,
        });
        continue;
      }
      identifiers.push({ kind, value, normalized });
    }

    if (identifiers.length === 0) {
      errors.push({
        row: rowNumber, column: 'oem', code: 'NO_IDENTIFIER',
        message: 'At least one of OEM, MPN or EAN is needed to match the product',
      });
      return;
    }

    items.push({
      sku,
      identifiers,
      categorySlug: values['category'] ?? null,
      partType: values['partType'] ?? null,
      productName: values['name']!,
      brandName: values['brand']!,
      priceMinor,
      currency: (pick('currency') ?? defaults.currency).toUpperCase(),
      quantity,
      availability: parseAvailability(pick('availability'), quantity),
      expectedAvailabilityDays: toInt(pick('expectedDays')),
      warrantyMonths: toInt(pick('warranty')),
    });
  });

  return { items, errors };
}

function lowerKeys(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.trim().toLowerCase().replace(/[\s-]+/g, '_')] = value ?? '';
  }
  return out;
}

/** Accepts "420.50", "420,50" and "1 420.50". Returns minor units. */
export function parsePriceToMinor(input: string, exponent = 2): bigint | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.');
  const padded = frac.padEnd(exponent, '0').slice(0, exponent);
  const minor = BigInt(whole) * BigInt(10 ** exponent) + BigInt(padded || '0');
  return negative ? -minor : minor;
}

/**
 * Availability from whatever the partner wrote, falling back to the quantity.
 *
 * A stated availability wins over the count: a partner who says
 * "available to order" with quantity 0 means it, and treating that as
 * UNAVAILABLE would silently drop stock they can actually supply (PRD §27).
 */
export function parseAvailability(
  stated: string | undefined,
  quantity: number,
): NormalizedInventoryItem['availability'] {
  if (stated) {
    const v = stated.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (['IN_STOCK', 'INSTOCK', 'STOCK', 'YES', 'TRUE', '1', 'AVAILABLE'].includes(v)) {
      return quantity > 0 ? 'IN_STOCK' : 'AVAILABLE_TO_ORDER';
    }
    if (['AVAILABLE_TO_ORDER', 'ON_ORDER', 'ORDER', 'BACKORDER', 'PREORDER'].includes(v)) {
      return 'AVAILABLE_TO_ORDER';
    }
    if (['UNAVAILABLE', 'NO', 'FALSE', '0', 'OUT_OF_STOCK', 'DISCONTINUED'].includes(v)) {
      return 'UNAVAILABLE';
    }
  }
  return quantity > 0 ? 'IN_STOCK' : 'UNAVAILABLE';
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}
