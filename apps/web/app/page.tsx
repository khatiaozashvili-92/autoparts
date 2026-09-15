'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import type { CategoryNode } from '@autoparts/api-client';
import { useSession } from '../lib/session';

/**
 * Home (PRD §83).
 *
 * One idea: your car, then your part. Everything else on this page is
 * subordinate to establishing which vehicle the answer is for.
 */
export default function HomePage() {
  const { api, me, selectedVehicle, vehicles } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [categories, setCategories] = useState<CategoryNode[]>([]);

  useEffect(() => {
    void api.categories().then(setCategories).catch(() => setCategories([]));
  }, [api]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    // Without a vehicle there is nothing to answer, so the user is sent to add
    // one rather than shown a list that cannot be trusted (PRD §14).
    if (!selectedVehicle) {
      router.push(`/garage?next=${encodeURIComponent(`/search?q=${query}`)}`);
      return;
    }
    router.push(`/search?q=${encodeURIComponent(query)}`);
  }

  // The signed-out hero doubles as the loading state. Rendering a spinner here
  // would leave the server-rendered HTML empty, which costs both the first
  // paint and anything a crawler would see (docs/12 §1).
  if (!me) {
    return (
      <section className="hero-block">
        <p className="eyebrow">VIN-ზე დაფუძნებული ავტონაწილების marketplace</p>
        <h1>იპოვე ზუსტი ნაწილი შენი ავტომობილისთვის</h1>
        <p className="lede">
          შეიყვანე VIN ერთხელ და აღარასოდეს იფიქრო, მოერგება თუ არა ნაწილი შენს მანქანას.
          ჩვენ მხოლოდ იმას გაჩვენებთ, რაც დადასტურებით ერგება.
        </p>
        <div className="cta-row">
          <Link className="button primary" href="/login">
            შესვლა / რეგისტრაცია
          </Link>
          <Link className="button" href="/status">
            პროექტის სტატუსი
          </Link>
        </div>

        <ol className="steps-flow">
          <li>VIN → ზუსტი ავტომობილი</li>
          <li>ნაწილის ძებნა</li>
          <li>მხოლოდ თავსებადი შედეგები</li>
          <li>ფასების შედარება</li>
          <li>გადახდა და აღება</li>
        </ol>
      </section>
    );
  }

  return (
    <>
      {vehicles.length === 0 ? (
        <section className="hero-block">
          <h1>დაამატე ავტომობილი VIN-ით</h1>
          <p className="lede">
            ნაწილის ძებნა მანქანის გარეშე ვერ დაიწყება — სწორედ ეს არის ის შეცდომა,
            რომლის თავიდან აცილებასაც ეს პლატფორმა ემსახურება.
          </p>
          <Link className="button primary" href="/garage">
            + ავტომობილის დამატება
          </Link>
        </section>
      ) : (
        <>
          <h1 className="page-title">რა ნაწილი გჭირდებათ?</h1>
          {selectedVehicle && (
            <p className="muted">
              ვეძებთ <strong>{selectedVehicle.label}</strong>-სთვის
              {selectedVehicle.configuration?.['market']
                ? ` · ბაზარი ${selectedVehicle.configuration['market']}`
                : ''}
            </p>
          )}

          <form className="search-form" onSubmit={onSearch}>
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="მაგ. სამუხრუჭე ხუნდები, საქარე მინა, OEM ნომერი…"
              aria-label="ნაწილის ძებნა"
            />
            <button className="button primary" type="submit">
              ძებნა
            </button>
          </form>

          <div className="pill-row">
            {['სამუხრუჭე ხუნდები', 'ზეთის ფილტრი', 'აკუმულატორი', 'რადიატორი'].map((q) => (
              <button
                key={q}
                className="pill pill-button"
                onClick={() => {
                  setQuery(q);
                  if (selectedVehicle) router.push(`/search?q=${encodeURIComponent(q)}`);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </>
      )}

      <h2>კატეგორიები</h2>
      <div className="category-grid">
        {categories.map((c) => (
          <Link
            key={c.id}
            className="category-tile"
            href={`/search?category=${c.slug}`}
          >
            {c.name}
          </Link>
        ))}
      </div>
    </>
  );
}
