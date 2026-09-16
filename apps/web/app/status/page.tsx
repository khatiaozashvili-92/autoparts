import { VinDemo } from './vin-demo';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/* ─── shapes returned by the API (docs/04) ─── */

interface Meta {
  service: string;
  version: string;
  environment: string;
  buildStep: { current: number; name: string; total: number };
  providers: { fitmentPrimary: string; fitmentFallback: string; payment: string };
  defaults: { country: string; currency: string; locale: string };
  features: Record<string, boolean>;
  rules: { fitmentMinConfidence: number; reservationTtlMinutes: number; pickupDeadlineHours: number };
  domain: { fitmentVerdicts: string[]; sellableVerdicts: string[] };
}

interface Ready {
  status: string;
  migrationsApplied: number | null;
  dependencies: {
    name: string;
    state: string;
    requiredFromStep: number;
    latencyMs?: number;
    detail?: string;
  }[];
}

interface Catalog {
  configured: boolean;
  counts?: Record<string, number>;
  vehicles?: {
    make: string;
    model: string;
    model_year: number;
    engine_code: string | null;
    market: string | null;
  }[];
  comparison?: {
    product: string;
    partner: string;
    city: string | null;
    customer_price_minor: string;
    currency: string;
    availability_status: string;
    stock_age_minutes: number;
  }[];
}

const STEPS = [
  ['Architecture', 'monorepo, env, API conventions, RBAC', '02, 07'],
  ['Data Layer', 'schema, migrations, entities, seed', '03'],
  ['Vehicle / VIN', 'abstraction, MockProvider, Garage', '05'],
  ['Catalog', 'Brand, Category, MasterPart, Product, Offer', '03, 04'],
  ['Fitment Engine', 'rules, verdicts, conflicts', '05'],
  ['Partner', 'dashboard, manual inventory, CSV', '06, 10'],
  ['Search', 'OpenSearch, ka/en, fitment filter', '02, 05'],
  ['Marketplace', 'offers, sorting, filters, markup', '08'],
  ['Orders', 'cart, reservation, payment, refund', '08'],
  ['Pickup', 'Ready for Pickup, QR, 24h expiry', '01, 10'],
  ['Admin', 'full admin panel', '09'],
  ['Web / Mobile UX', 'polished UI', '11, 12'],
] as const;

const ADRS = [
  ['ADR-001 — გადახდის მოდელი', '§32 იმარჯვებს §44-ზე: ერთი ტრანზაქცია, პლატფორმა merchant of record, პარტნიორს მიდის base price.'],
  ['ADR-002 — Request Part', 'ფუნქცია P1-შია, schema P0-ში — ცოცხალ ცხრილზე მიგრაცია მოგვიანებით ძვირია.'],
  ['ADR-003 — VIN provider', 'Mock → NHTSA vPIC (უფასო, US-spec) → კომერციული fallback EU-spec-ისთვის.'],
  ['ADR-004 — Fitment', 'OEM ნომერი ხერხემალი; TecDoc არ არის MVP-ის დამოკიდებულება.'],
  ['ADR-005 — ფული', 'bigint minor units. 420.50 ₾ = 42050. float settlement-ს ანგრევს.'],
  ['ADR-006 — ინტეგრაცია', 'Manual → CSV → API. პირველ პარტნიორებს API არ ექნებათ.'],
  ['ADR-007 — ენა', 'ქართული პროზა + ინგლისური იდენტიფიკატორები. კოდი მხოლოდ ინგლისურად.'],
  ['ADR-008 — DB წვდომა', 'raw SQL migration-ები, არა Prisma: schema დგას generated columns-სა და CHECK constraint-ებზე, რასაც Prisma-ს schema ენა ვერ გამოხატავს.'],
  ['ADR-009 — ლოკალური ბაზა', 'PostgreSQL portable ბინარები, არა Docker: Docker Desktop ადმინს და WSL2-ს მოითხოვს, რაც ამ მანქანაზე არ იყო.'],
  ['ADR-010 — Search', 'PostgreSQL tsvector + pg_trgm, არა OpenSearch. რამდენიმე ათასი master part-ისთვის ერთი ბაზა ორზე მეტად ღირებულია.'],
  ['ADR-011 — ბაზის ლოკალი', '`C` ლოკალზე არა-ASCII სიმბოლოები ასოებად არ ითვლება და ქართული ძებნა ჩუმად კვდება. კლასტერი UTF-8 ctype-ით შეიქმნა.'],
  ['ADR-012 — Reservation lock', 'Postgres advisory lock + row lock ერთ ტრანზაქციაში, არა Redis: კრიტიკული სექცია ბაზის შიგნითაა.'],
  ['ADR-013 — Partner/Admin UI', 'იმავე Next აპლიკაციაში, როგორც მარშრუტები. როლები სერვერზე აღსრულდება, ამიტომ გაყოფა deploy-ის საზღვარია და არა უსაფრთხოების.'],
  ['ADR-014 — ორი React მაჟორი', 'web 19-ზეა, React Native 18-ზე. tsconfig paths აფიქსირებს react-ს, თორემ next-ის ტიპები React 18-ს ხსნიდნენ და JSX ტყდებოდა.'],
  ['ADR-015 — ავტორიზაცია SMS კოდით', 'ტელეფონის ნომერი + ერთჯერადი კოდი, პაროლის გარეშე. ნომერი თავად არის ანგარიში; რეგისტრაცია ცალკე ნაბიჯი აღარ არის — პირველი დადასტურებული კოდი ქმნის ანგარიშს.'],
] as const;

const AVAILABILITY_LABEL: Record<string, string> = {
  IN_STOCK: 'მარაგშია',
  AVAILABLE_TO_ORDER: 'შეკვეთით',
  UNAVAILABLE: 'არ არის',
};

const AVAILABILITY_DOT: Record<string, string> = {
  IN_STOCK: 'ok',
  AVAILABLE_TO_ORDER: 'pending',
  UNAVAILABLE: 'idle',
};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

function money(minor: string, currency: string): string {
  return new Intl.NumberFormat('ka-GE', { style: 'currency', currency }).format(
    Number(minor) / 100,
  );
}

export default async function Page() {
  const [meta, ready, catalog] = await Promise.all([
    fetchJson<Meta>('/api/v1/meta'),
    fetchJson<Ready>('/ready'),
    fetchJson<Catalog>('/api/v1/meta/catalog'),
  ]);

  const currentStep = meta?.buildStep.current ?? 1;

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">VIN-Based Auto Parts Marketplace · საქართველო</p>
        <h1>autoparts</h1>
        <p className="lede">
          სპეციფიკაცია დაწერილია (13 დოკუმენტი), კოდის აწყობა მიმდინარეობს. ეს გვერდი
          აჩვენებს რა დგას ახლა და რა მოდის შემდეგ.
        </p>
        <div className="links">
          <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">Swagger UI →</a>
          <a href={`${API_URL}/api/v1/meta`} target="_blank" rel="noreferrer">/api/v1/meta →</a>
          <a href={`${API_URL}/api/v1/meta/catalog`} target="_blank" rel="noreferrer">/meta/catalog →</a>
          <a href={`${API_URL}/ready`} target="_blank" rel="noreferrer">/ready →</a>
        </div>
      </header>

      {!meta && (
        <div className="card offline">
          <strong>API არ პასუხობს ({API_URL}).</strong>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>
            გაუშვი <code>pnpm dev</code> რეპოს ძირიდან — ის ორივეს (API + web) ერთად ადგამს.
          </p>
        </div>
      )}

      <h2>VIN → ავტომობილი</h2>
      <VinDemo />

      <h2>აშენების თანმიმდევრობა</h2>
      <div className="card steps">
        {STEPS.map(([name, detail, docs], i) => {
          const n = i + 1;
          const state = n < currentStep ? 'done' : n === currentStep ? 'active' : '';
          return (
            <div className="step" key={name}>
              <span className="step-num">{String(n).padStart(2, '0')}</span>
              <span>
                <span className="step-name">{name}</span>
                <br />
                <span className="step-doc">
                  {detail} · docs/{docs}
                </span>
              </span>
              <span className={`badge ${state}`}>
                {state === 'done' ? 'დასრულებული' : state === 'active' ? 'მიმდინარე' : 'რიგში'}
              </span>
            </div>
          );
        })}
      </div>

      <h2>დამოკიდებულებები</h2>
      <div className="card">
        {ready ? (
          <dl>
            {ready.dependencies.map((d) => (
              <div className="kv" key={d.name}>
                <dt>
                  <span className={`dot ${d.state === 'ok' ? 'ok' : 'idle'}`} />
                  {d.name}
                </dt>
                <dd>
                  {d.state === 'ok'
                    ? `დაკავშირებული${d.latencyMs !== undefined ? ` · ${d.latencyMs}ms` : ''}`
                    : d.state === 'unreachable'
                      ? `მიუწვდომელია — ${d.detail ?? ''}`
                      : `Step ${d.requiredFromStep}-დან`}
                </dd>
              </div>
            ))}
            {ready.migrationsApplied !== null && (
              <div className="kv">
                <dt>
                  <span className="dot ok" />
                  migrations
                </dt>
                <dd>{ready.migrationsApplied} გატარებული</dd>
              </div>
            )}
          </dl>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>—</p>
        )}
      </div>

      {catalog?.configured && catalog.counts && (
        <>
          <h2>ბაზა — seed მონაცემები</h2>
          <div className="card">
            <div className="pill-row">
              {Object.entries(catalog.counts).map(([key, value]) => (
                <span className="pill" key={key}>
                  {key.replace(/_/g, ' ')}: <strong>{value}</strong>
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {catalog?.comparison && catalog.comparison.length > 0 && (
        <>
          <h2>ფასების შედარება</h2>
          <div className="card">
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
              ერთი და იგივე ნაწილი სამ პარტნიორთან — ეს არის პროდუქტის არსი. „განახლდა X წუთის
              წინ“ ყოველთვის ჩანს: მოძველებული მარაგი მომხმარებელს დამალული არ უნდა ჰქონდეს (R2).
            </p>
            <dl>
              {catalog.comparison.map((offer, i) => (
                <div className="kv" key={i}>
                  <dt>
                    <span
                      className={`dot ${AVAILABILITY_DOT[offer.availability_status] ?? 'idle'}`}
                    />
                    {offer.partner}
                    {offer.city ? ` · ${offer.city}` : ''}
                  </dt>
                  <dd>
                    {money(offer.customer_price_minor, offer.currency)}
                    <span style={{ color: 'var(--muted)' }}>
                      {' · '}
                      {AVAILABILITY_LABEL[offer.availability_status] ?? offer.availability_status}
                      {' · განახლდა '}
                      {offer.stock_age_minutes} წთ წინ
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      {catalog?.vehicles && catalog.vehicles.length > 0 && (
        <>
          <h2>MockProvider-ის ავტომობილები</h2>
          <div className="card">
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
              US-spec ჭარბობს განზრახ — საქართველო სწორედ ამას შემოიტანს (ADR-003). US-სა და
              EU-ს ერთი მოდელის ნაწილები განსხვავდება, ამიტომ market სავალდებულო ველია.
            </p>
            <dl>
              {catalog.vehicles.map((v, i) => (
                <div className="kv" key={i}>
                  <dt>
                    {v.make} {v.model} · {v.model_year}
                  </dt>
                  <dd>
                    {v.engine_code ?? '—'} · <strong>{v.market ?? '—'}</strong>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </>
      )}

      {meta && (
        <>
          <h2>კონფიგურაცია</h2>
          <div className="grid">
            <div className="card">
              <dl>
                <div className="kv"><dt>გარემო</dt><dd>{meta.environment}</dd></div>
                <div className="kv"><dt>ვერსია</dt><dd>{meta.version}</dd></div>
                <div className="kv"><dt>ქვეყანა</dt><dd>{meta.defaults.country}</dd></div>
                <div className="kv"><dt>ვალუტა</dt><dd>{meta.defaults.currency}</dd></div>
                <div className="kv"><dt>ენა</dt><dd>{meta.defaults.locale}</dd></div>
              </dl>
            </div>
            <div className="card">
              <dl>
                <div className="kv"><dt>VIN / fitment</dt><dd>{meta.providers.fitmentPrimary}</dd></div>
                <div className="kv"><dt>fallback</dt><dd>{meta.providers.fitmentFallback}</dd></div>
                <div className="kv"><dt>გადახდა</dt><dd>{meta.providers.payment}</dd></div>
                <div className="kv"><dt>min confidence</dt><dd>{meta.rules.fitmentMinConfidence}</dd></div>
                <div className="kv"><dt>რეზერვაცია</dt><dd>{meta.rules.reservationTtlMinutes} წთ</dd></div>
                <div className="kv"><dt>აღების ვადა</dt><dd>{meta.rules.pickupDeadlineHours} სთ</dd></div>
              </dl>
            </div>
            <div className="card">
              <dl>
                {Object.entries(meta.features).map(([key, value]) => (
                  <div className="kv" key={key}>
                    <dt>{key}</dt>
                    <dd>{value ? 'ჩართული' : 'გამორთული (P1)'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <h2>Fitment verdicts</h2>
          <div className="card">
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)' }}>
              გადახაზული verdict-ები მომხმარებელს არასოდეს ეჩვენება — „არ ვიცი“ ითარგმნება
              როგორც „არა“, არა როგორც „კი“ (R1, PRD §97).
            </p>
            <div className="pill-row">
              {meta.domain.fitmentVerdicts.map((verdict) => (
                <span
                  key={verdict}
                  className={`pill ${
                    meta.domain.sellableVerdicts.includes(verdict) ? 'sellable' : 'blocked'
                  }`}
                >
                  {verdict}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <h2>გადაწყვეტილებები (ADR)</h2>
      <div className="card">
        {ADRS.map(([title, body]) => (
          <div className="adr" key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>

      <footer>
        სრული სპეციფიკაცია: <code>docs/00-index-and-decisions.md</code> →{' '}
        <code>docs/12-web-app.md</code>
      </footer>
    </main>
  );
}
