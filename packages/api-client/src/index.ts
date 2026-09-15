/**
 * Typed API client shared by the web, partner, admin and mobile apps.
 *
 * One client rather than four copies of `fetch`: the error shape, the
 * Idempotency-Key discipline and token refresh are things every caller must get
 * right, and getting them right once is the only way that happens.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    messageKey: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** The i18n key the UI should render. `message` is for developers only. */
    readonly messageKey: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static from(status: number, body: unknown): ApiError {
    const parsed = body as Partial<ApiErrorBody>;
    const error = parsed?.error;
    return new ApiError(
      status,
      error?.code ?? 'UNKNOWN',
      error?.messageKey ?? 'error.internal',
      error?.message ?? `Request failed with ${status}`,
      error?.details,
      error?.requestId,
    );
  }
}

export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  set(tokens: { accessToken: string; refreshToken: string }): void;
  clear(): void;
}

/** Non-persistent store. Browsers and React Native supply their own. */
export function memoryTokenStore(): TokenStore {
  let access: string | null = null;
  let refresh: string | null = null;
  return {
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    set: (t) => {
      access = t.accessToken;
      refresh = t.refreshToken;
    },
    clear: () => {
      access = null;
      refresh = null;
    },
  };
}

export interface ClientOptions {
  baseUrl: string;
  locale?: string;
  tokens?: TokenStore;
  fetchImpl?: typeof fetch;
  onUnauthenticated?: () => void;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Required by the API on every mutating call (docs/04 §9). */
  idempotencyKey?: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** Internal: prevents an infinite refresh loop. */
  retrying?: boolean;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  readonly tokens: TokenStore;
  locale: string;

  constructor(private readonly options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokens = options.tokens ?? memoryTokenStore();
    this.locale = options.locale ?? 'ka';
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const accessToken = this.tokens.getAccessToken();
    const headers: Record<string, string> = { 'accept-language': this.locale };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (accessToken) headers['authorization'] = `Bearer ${accessToken}`;
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    const response = await this.fetchImpl(url.toString(), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (response.ok) return parsed as T;

    // One refresh attempt, then give up. Retrying a refresh that already failed
    // would loop, and the reuse-detection on the server would revoke the whole
    // session for what is really a client bug.
    if (response.status === 401 && !options.retrying && this.tokens.getRefreshToken()) {
      const refreshed = await this.refresh();
      if (refreshed) return this.request<T>(path, { ...options, retrying: true });
      this.options.onUnauthenticated?.();
    }

    throw ApiError.from(response.status, parsed);
  }

  private async refresh(): Promise<boolean> {
    const refreshToken = this.tokens.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const result = await this.request<{ accessToken: string; refreshToken: string }>(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken }, retrying: true },
      );
      this.tokens.set(result);
      return true;
    } catch {
      this.tokens.clear();
      return false;
    }
  }

  /* ─────────────────────────── auth ─────────────────────────── */

  async login(identifier: string, password: string) {
    const result = await this.request<{ userId: string; accessToken: string; refreshToken: string }>(
      '/auth/login',
      { method: 'POST', body: { identifier, password } },
    );
    this.tokens.set(result);
    return result;
  }

  async register(input: { email?: string; phone?: string; password: string; firstName?: string }) {
    const result = await this.request<{ userId: string; accessToken: string; refreshToken: string }>(
      '/auth/register',
      { method: 'POST', body: input },
    );
    this.tokens.set(result);
    return result;
  }

  me() {
    return this.request<{ id: string; email: string | null; roles: string[]; partnerId: string | null }>(
      '/auth/me',
    );
  }

  async logout() {
    const refreshToken = this.tokens.getRefreshToken();
    if (refreshToken) {
      await this.request<void>('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(
        () => undefined,
      );
    }
    this.tokens.clear();
  }

  /* ─────────────────────── vehicles ─────────────────────── */

  decodeVin(vin: string) {
    return this.request<VinDecodeResponse>('/vin/decode', { method: 'POST', body: { vin } });
  }

  garage() {
    return this.request<GarageVehicle[]>('/vehicles');
  }

  addVehicle(input: {
    configurationId: string;
    customName?: string;
    clarificationAnswers?: Record<string, string>;
  }) {
    return this.request<GarageVehicle>('/vehicles', { method: 'POST', body: input });
  }

  removeVehicle(id: string) {
    return this.request<void>(`/vehicles/${id}`, { method: 'DELETE' });
  }

  /* ─────────────────────── catalogue ─────────────────────── */

  categories() {
    return this.request<CategoryNode[]>('/categories');
  }

  partsInCategory(slug: string, vehicleId?: string) {
    return this.request<MasterPartSummary[]>(`/categories/${slug}/parts`, {
      query: { vehicleId },
    });
  }

  productsForPart(masterPartId: string, vehicleId: string) {
    return this.request<ProductDetail[]>(`/master-parts/${masterPartId}/products`, {
      query: { vehicleId },
    });
  }

  product(id: string, vehicleId?: string) {
    return this.request<ProductDetail>(`/products/${id}`, { query: { vehicleId } });
  }

  /* ─────────────────────── search and offers ─────────────────────── */

  search(query: string, vehicleId: string, options: { availability?: string } = {}) {
    return this.request<SearchResponse>('/search', {
      query: { q: query, vehicleId, availability: options.availability },
    });
  }

  offers(productId: string, vehicleId: string, options: { sort?: string; availability?: string } = {}) {
    return this.request<{ data: OfferCard[]; emptyReason?: string }>('/offers', {
      query: { productId, vehicleId, sort: options.sort, availability: options.availability },
    });
  }

  /* ─────────────────────── cart and checkout ─────────────────────── */

  cart() {
    return this.request<Cart>('/cart');
  }

  addToCart(input: { offerId: string; vehicleId: string; quantity: number }) {
    return this.request<Cart>('/cart/items', { method: 'POST', body: input });
  }

  updateCartItem(itemId: string, quantity: number) {
    return this.request<Cart>(`/cart/items/${itemId}`, { method: 'PATCH', body: { quantity } });
  }

  removeCartItem(itemId: string) {
    return this.request<Cart>(`/cart/items/${itemId}`, { method: 'DELETE' });
  }

  reserve() {
    return this.request<CheckoutQuote>('/checkout/reserve', { method: 'POST' });
  }

  confirm(reservationIds: string[], idempotencyKey: string) {
    return this.request<{ orderId: string; orderNumber: string; payment: { status: string } }>(
      '/checkout/confirm',
      { method: 'POST', body: { reservationIds }, idempotencyKey },
    );
  }

  capture(orderId: string) {
    return this.request<{ status: string; orderNumber: string }>(`/orders/${orderId}/capture`, {
      method: 'POST',
    });
  }

  /* ─────────────────────── orders ─────────────────────── */

  orders() {
    return this.request<OrderSummary[]>('/orders');
  }

  order(id: string) {
    return this.request<Record<string, unknown>>(`/orders/${id}`);
  }

  pickupCode(orderId: string) {
    return this.request<PickupCredential>(`/orders/${orderId}/pickup-code`);
  }

  confirmReceipt(orderId: string) {
    return this.request<{ status: string }>(`/orders/${orderId}/confirm-receipt`, {
      method: 'POST',
    });
  }

  cancelOrder(orderId: string) {
    return this.request<{ status: string }>(`/orders/${orderId}/cancel`, { method: 'POST' });
  }
}

/* ─────────────────────── response shapes ─────────────────────── */

export interface VinDecodeResponse {
  configurationId: string;
  vinMasked: string;
  provider: string;
  fromCache: boolean;
  checksumSuspect: boolean;
  configuration: Record<string, string | number | null>;
  clarifications: {
    id: string;
    questionKey: string;
    attribute: string;
    options: { value: string; labelKey: string }[];
  }[];
}

export interface GarageVehicle {
  id: string;
  label: string;
  customName: string | null;
  vinMasked: string | null;
  isDefault: boolean;
  configuration: Record<string, string | number | null> | null;
  userSuppliedData: Record<string, unknown>;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  synonyms: string[];
  children: CategoryNode[];
}

export interface MasterPartSummary {
  id: string;
  key: string;
  name: string;
  categorySlug: string;
  availableProducts?: number;
}

export interface ProductDetail {
  id: string;
  name: string;
  brand: { id: string; name: string; type: string };
  masterPart: { id: string; name: string; categorySlug: string };
  identifiers: { kind: string; value: string; isPrimary: boolean }[];
  warrantyMonths: number | null;
  fitment?: { verdict: string; confidence: number; labelKey: string };
}

export interface SearchResponse {
  interpreted: {
    matchedBy: 'IDENTIFIER' | 'EXACT_TEXT' | 'FUZZY_TEXT' | 'NONE';
    masterPartName?: string;
    didYouMean?: string;
  };
  data: {
    productId: string;
    name: string;
    brand: { name: string; type: string };
    oem: string | null;
    masterPartName: string;
    fitment: { verdict: string; confidence: number; labelKey: string };
    offerSummary: {
      count: number;
      minCustomerPriceMinor: string | null;
      currency: string | null;
      bestAvailability: string | null;
    };
  }[];
  emptyReason?: string;
}

export interface OfferCard {
  offerId: string;
  partner: { id: string; displayName: string; rating: number | null };
  location: { name: string | null; city: string | null; distanceKm: number | null };
  price: { amountMinor: string; currency: string };
  availability: string;
  availableQuantity: number;
  expectedAvailabilityDays: number | null;
  warrantyMonths: number | null;
  stock: { lastSyncedAt: string; ageMinutes: number; isStale: boolean };
  recommendedScore?: number;
}

export interface Cart {
  id: string;
  items: {
    id: string;
    offerId: string;
    productId: string;
    productName: string;
    brandName: string;
    vehicleLabel: string;
    quantity: number;
    unitPriceMinor: string;
    lineTotalMinor: string;
    currency: string;
    partner: { id: string; displayName: string };
  }[];
  partnerIds: string[];
  subtotalMinor: string;
  currency: string | null;
  blocker?: 'MULTIPLE_PARTNERS' | 'EMPTY';
}

export interface CheckoutQuote {
  reservationIds: string[];
  expiresAt: string;
  totals: { subtotalMinor: string; markupMinor: string; totalMinor: string; currency: string };
  partner: { id: string; displayName: string };
  pickupLocation: { name: string | null; address: string | null };
}

export interface OrderSummary {
  id: string;
  order_number: string;
  status: string;
  total_minor: string;
  currency: string;
  created_at: string;
  partner_name: string | null;
  item_count: string;
}

export interface PickupCredential {
  code: string;
  orderNumber: string;
  expiresAt: string | null;
  partnerName: string;
  location: { name: string | null; address: string | null };
}

/** Formats minor units for display. Locale-driven, never a hardcoded symbol. */
export function formatMoney(amountMinor: string, currency: string, locale = 'ka-GE'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    Number(amountMinor) / 100,
  );
}
