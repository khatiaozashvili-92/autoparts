'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatMoney, type OfferCard } from '@autoparts/api-client';
import { useSession } from '../../../lib/session';
import { ErrorNote, Spinner } from '../../../components/shell';

const SORTS = [
  { key: 'recommended', label: 'რეკომენდებული' },
  { key: 'cheapest', label: 'უიაფესი' },
  { key: 'nearest', label: 'უახლოესი' },
  { key: 'best_rated', label: 'საუკეთესო შეფასება' },
  { key: 'fastest', label: 'ყველაზე სწრაფი' },
] as const;

const AVAILABILITY_KEY: Record<string, string> = {
  IN_STOCK: 'availability.inStock',
  AVAILABLE_TO_ORDER: 'availability.availableToOrder',
  UNAVAILABLE: 'availability.unavailable',
};

/**
 * Fitment and offers, which only exist relative to a vehicle.
 *
 * Rendered on the client because the server has no idea whose car this is —
 * and PRD §14 forbids answering "does it fit" without one.
 */
export function ProductOffers({ productId }: { productId: string }) {
  const { api, t, selectedVehicle, me } = useSession();
  const router = useRouter();

  const [fitment, setFitment] = useState<{ verdict: string; labelKey: string } | null>(null);
  const [offers, setOffers] = useState<OfferCard[]>([]);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [sort, setSort] = useState<string>('recommended');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoading(true);
    setError(null);
    try {
      const [product, result] = await Promise.all([
        api.product(productId, selectedVehicle.id),
        api.offers(productId, selectedVehicle.id, { sort }),
      ]);
      setFitment(product.fitment ?? null);
      setOffers(result.data);
      setEmptyReason(result.emptyReason ?? null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, productId, selectedVehicle, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addToCart(offer: OfferCard) {
    if (!selectedVehicle) return;
    if (!me) {
      router.push(`/login?next=/p/${productId}`);
      return;
    }
    setAdding(offer.offerId);
    setError(null);
    try {
      await api.addToCart({ offerId: offer.offerId, vehicleId: selectedVehicle.id, quantity: 1 });
      router.push('/cart');
    } catch (err) {
      setError(err);
    } finally {
      setAdding(null);
    }
  }

  if (!selectedVehicle) {
    return (
      <div className="fitment-banner neutral">
        <strong>რომელი ავტომობილისთვის?</strong>
        <p className="muted small" style={{ margin: '6px 0 10px' }}>
          თავსებადობას მხოლოდ კონკრეტულ მანქანაზე ვამოწმებთ — სწორედ ეს არის ამ
          პლატფორმის აზრი.
        </p>
        <Link className="button primary" href={`/garage?next=/p/${productId}`}>
          ავტომობილის დამატება
        </Link>
      </div>
    );
  }

  return (
    <>
      {fitment && (
        <div className={`fitment-banner ${fitment.verdict === 'CONDITIONAL' ? 'warn' : 'ok'}`}>
          {fitment.verdict === 'CONDITIONAL' ? '⚠️' : '✅'} {t(fitment.labelKey)} —{' '}
          {selectedVehicle.label}
        </div>
      )}

      <h2>შეთავაზებები</h2>

      {emptyReason === 'NOT_COMPATIBLE' ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            ეს ნაწილი <strong>არ ერგება</strong> {selectedVehicle.label}-ს.
          </p>
          <p className="muted small">
            შეთავაზებებს განზრახ არ ვაჩვენებთ — არასწორი ნაწილის შეძენა უარესია, ვიდრე
            ცარიელი გვერდი.
          </p>
        </div>
      ) : (
        <>
          <div className="pill-row">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`pill pill-button ${sort === s.key ? 'sellable' : ''}`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <ErrorNote error={error} />
          {loading && <Spinner />}

          {!loading && offers.length === 0 && (
            <p className="muted">ამჟამად არცერთ პარტნიორს არ აქვს ეს ნაწილი.</p>
          )}

          <div className="offers">
            {offers.map((offer) => (
              <div className="offer-card" key={offer.offerId}>
                <div className="offer-head">
                  <div>
                    <strong>{offer.partner.displayName}</strong>
                    {offer.partner.rating !== null && (
                      <span className="muted small"> · ⭐ {offer.partner.rating}</span>
                    )}
                  </div>
                  <div className="offer-price">
                    {formatMoney(offer.price.amountMinor, offer.price.currency)}
                  </div>
                </div>

                <div className="offer-meta">
                  <span>
                    <span className={`dot ${offer.availability === 'IN_STOCK' ? 'ok' : 'pending'}`} />
                    {t(AVAILABILITY_KEY[offer.availability] ?? '')}
                    {offer.availability === 'IN_STOCK' ? ` (${offer.availableQuantity})` : ''}
                    {offer.expectedAvailabilityDays ? ` · ~${offer.expectedAvailabilityDays} დღე` : ''}
                  </span>
                  {offer.location.city && (
                    <span className="muted">
                      📍 {offer.location.city}
                      {offer.location.distanceKm !== null ? ` · ${offer.location.distanceKm} კმ` : ''}
                    </span>
                  )}
                </div>

                {/* Never buried: a price next to stale stock is a half-truth (R2). */}
                <div className={`offer-stock ${offer.stock.isStale ? 'stale' : ''}`}>
                  🕐 მარაგი განახლდა {offer.stock.ageMinutes} წუთის წინ
                  {offer.stock.isStale ? ' — შესაძლოა შეიცვალოს' : ''}
                </div>

                <button
                  className="button primary full"
                  onClick={() => addToCart(offer)}
                  disabled={adding !== null || offer.availability !== 'IN_STOCK'}
                >
                  {adding === offer.offerId
                    ? '…'
                    : offer.availability === 'IN_STOCK'
                      ? 'კალათაში'
                      : 'შეკვეთით'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
