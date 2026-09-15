'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { formatMoney, type MasterPartSummary, type SearchResponse } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote, Spinner } from '../../components/shell';

const AVAILABILITY_KEY: Record<string, string> = {
  IN_STOCK: 'availability.inStock',
  AVAILABLE_TO_ORDER: 'availability.availableToOrder',
  UNAVAILABLE: 'availability.unavailable',
};

function Results() {
  const { api, t, selectedVehicle, vehicles } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const query = params.get('q') ?? '';
  const category = params.get('category');

  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [parts, setParts] = useState<MasterPartSummary[] | null>(null);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async () => {
    if (!selectedVehicle) return;
    setLoading(true);
    setError(null);
    try {
      if (category) {
        setParts(await api.partsInCategory(category, selectedVehicle.id));
        setResults(null);
      } else if (query) {
        setResults(
          await api.search(query, selectedVehicle.id, {
            ...(inStockOnly ? { availability: 'IN_STOCK' } : {}),
          }),
        );
        setParts(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, category, query, selectedVehicle, inStockOnly]);

  useEffect(() => {
    void run();
  }, [run]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (input.trim()) router.push(`/search?q=${encodeURIComponent(input)}`);
  }

  if (vehicles.length === 0) {
    return (
      <section className="hero-block">
        <h1>ჯერ ავტომობილი დაამატეთ</h1>
        <p className="lede">
          ნაწილს მხოლოდ კონკრეტული მანქანისთვის ვეძებთ — სხვაგვარად ვერ დაგპირდებით, რომ
          მოერგება.
        </p>
        <Link className="button primary" href={`/garage?next=${encodeURIComponent(`/search?q=${query}`)}`}>
          + ავტომობილის დამატება
        </Link>
      </section>
    );
  }

  return (
    <>
      <form className="search-form" onSubmit={submit}>
        <input
          className="search-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ნაწილის სახელი ან OEM ნომერი"
          aria-label="ძებნა"
        />
        <button className="button primary" type="submit">
          ძებნა
        </button>
      </form>

      {selectedVehicle && (
        <p className="muted">
          შედეგები <strong>{selectedVehicle.label}</strong>-სთვის
        </p>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={inStockOnly}
          onChange={(e) => setInStockOnly(e.target.checked)}
        />
        <span>მხოლოდ მარაგში</span>
      </label>

      <ErrorNote error={error} />
      {loading && <Spinner />}

      {results?.interpreted?.didYouMean && (
        <p className="note">
          გასწორდა: <strong>{results.interpreted.didYouMean}</strong>
        </p>
      )}

      {results && results.data.length === 0 && !loading && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>ვერაფერი მოიძებნა</h3>
          <p className="muted">
            {results.emptyReason === 'NO_COMPATIBLE_PRODUCTS'
              ? 'ეს ნაწილი არსებობს, მაგრამ თქვენს ავტომობილთან თავსებადი ვარიანტი ვერ დავადასტურეთ.'
              : results.emptyReason === 'NO_OFFERS'
                ? 'თავსებადი ნაწილი არსებობს, მაგრამ ამჟამად არცერთ პარტნიორს არ აქვს.'
                : 'ამ დასახელებით ვერაფერი ვიპოვეთ.'}
          </p>
          <p className="muted small">
            დაუდასტურებელ ალტერნატივას განზრახ არ გთავაზობთ — არასწორი ნაწილი უარესია,
            ვიდრე ცარიელი შედეგი.
          </p>
        </div>
      )}

      {results && results.data.length > 0 && (
        <div className="results">
          {results.data.map((hit) => (
            <Link key={hit.productId} className="result-card" href={`/p/${hit.productId}`}>
              <div className="result-fitment ok">✅ {t(hit.fitment.labelKey)}</div>
              <div className="result-name">{hit.name}</div>
              <div className="muted small">
                {hit.brand.name}
                {hit.oem ? ` · OEM ${hit.oem}` : ''}
              </div>
              <div className="result-meta">
                <span>
                  {hit.offerSummary.count} შეთავაზება
                  {hit.offerSummary.minCustomerPriceMinor && hit.offerSummary.currency
                    ? ` · ${formatMoney(hit.offerSummary.minCustomerPriceMinor, hit.offerSummary.currency)}-დან`
                    : ''}
                </span>
                {hit.offerSummary.bestAvailability && (
                  <span className="muted">
                    {t(AVAILABILITY_KEY[hit.offerSummary.bestAvailability] ?? '')}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {parts && (
        <>
          <h2>{category}</h2>
          <div className="card">
            <dl>
              {parts.map((part) => (
                <div className="kv" key={part.id}>
                  <dt>{part.name}</dt>
                  <dd>
                    {part.availableProducts === 0 ? (
                      <span className="muted">თავსებადი ვარიანტი არ არის</span>
                    ) : (
                      <Link href={`/search?q=${encodeURIComponent(part.name)}`}>
                        {part.availableProducts} ვარიანტი →
                      </Link>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Results />
    </Suspense>
  );
}
