'use client';

import { useState } from 'react';

// This runs in the visitor's browser, so it has to be the public origin. A
// hardcoded localhost sends every request to whatever is listening on the
// visitor's own machine, which is exactly how the first deployment broke.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface DecodeResponse {
  configurationId: string;
  vinMasked: string;
  provider: string;
  fromCache: boolean;
  checksumSuspect: boolean;
  configuration: Record<string, string | number | null>;
  clarifications: {
    id: string;
    questionKey: string;
    options: { value: string; labelKey: string }[];
  }[];
}

interface ErrorResponse {
  error: { code: string; messageKey: string; details?: Record<string, unknown> };
}

/** Sample VINs the mock provider knows, plus two that must fail. */
const SAMPLES: { vin: string; label: string }[] = [
  { vin: 'WBA1J5C50FV123456', label: 'BMW 228i · აზუსტებს კითხვას' },
  { vin: '2HKRW2H875H112233', label: 'Honda CR-V · US' },
  { vin: 'W0L0AHL0885667788', label: 'Opel Astra · EU' },
  { vin: 'WBA1J5C50FV12345O', label: 'შეიცავს O — უარყოფილი' },
  { vin: 'WBA9Z9Z99ZZ999999', label: 'უცნობი — ხელით შეყვანა' },
];

// The API returns i18n keys, never rendered copy (PRD §80). A real client
// resolves them through @autoparts/i18n; this page carries the few it can show.
const MESSAGES: Record<string, string> = {
  'error.vin.length': 'VIN უნდა იყოს ზუსტად 17 სიმბოლო.',
  'error.vin.characters': 'VIN-ში არ გვხვდება ასოები I, O და Q.',
  'error.vin.notDecoded': 'ვერ მოვახერხეთ თქვენი ავტომობილის ამოცნობა.',
  'error.validation': 'შეყვანილი მონაცემები არასწორია.',
  'vin.clarify.brakeConfig':
    'თქვენს ავტომობილს აქვს 2 განსხვავებული სამუხრუჭე კონფიგურაცია. აირჩიეთ შესაბამისი:',
  'brake.standard': 'სტანდარტული',
  'brake.mSport': 'M Sport',
};

const FIELD_LABELS: Record<string, string> = {
  make: 'მარკა',
  model: 'მოდელი',
  modelYear: 'წელი',
  generation: 'თაობა',
  engine: 'ძრავი',
  engineCode: 'ძრავის კოდი',
  fuelType: 'საწვავი',
  transmission: 'ტრანსმისია',
  driveType: 'წამყვანი',
  bodyType: 'ძარა',
  trim: 'კომპლექტაცია',
  market: 'ბაზარი',
};

export function VinDemo() {
  const [vin, setVin] = useState('WBA1J5C50FV123456');
  const [state, setState] = useState<'idle' | 'loading'>('idle');
  const [result, setResult] = useState<DecodeResponse | null>(null);
  const [error, setError] = useState<ErrorResponse['error'] | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);

  async function decode(value: string) {
    setState('loading');
    setResult(null);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/vin/decode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ vin: value }),
      });
      const body = await res.json();
      if (res.ok) setResult(body as DecodeResponse);
      else setError((body as ErrorResponse).error);
    } catch {
      setError({ code: 'NETWORK', messageKey: 'error.network' });
    } finally {
      setState('idle');
    }
  }

  return (
    <div className="card">
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
        შეიყვანე VIN და ნახე რას აბრუნებს სისტემა. სრული VIN პასუხში არასოდეს ბრუნდება —
        მხოლოდ დაფარული ფორმა (PRD §76).
      </p>

      <div className="vin-row">
        <input
          className="vin-input mono"
          value={vin}
          maxLength={17}
          spellCheck={false}
          onChange={(e) => setVin(e.target.value.toUpperCase().replace(/\s/g, ''))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void decode(vin);
          }}
          aria-label="VIN"
        />
        <button className="vin-button" onClick={() => void decode(vin)} disabled={state === 'loading'}>
          {state === 'loading' ? '…' : 'ამოცნობა'}
        </button>
      </div>

      <div className="pill-row" style={{ marginTop: 10 }}>
        {SAMPLES.map((s) => (
          <button
            key={s.vin}
            className="pill pill-button"
            onClick={() => {
              setVin(s.vin);
              void decode(s.vin);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="result error-box">
          <strong>{MESSAGES[error.messageKey] ?? error.messageKey}</strong>
          {error.details?.canEnterManually === true && (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              → შემოთავაზებულია ხელით შეყვანა (make / model / year), რომელიც
              user_supplied_data-ში ინახება — verified_data ცარიელი რჩება.
            </p>
          )}
          <p className="mono" style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            {error.code} · {error.messageKey}
          </p>
        </div>
      )}

      {result && (
        <div className="result">
          <dl>
            {Object.entries(FIELD_LABELS).map(([key, label]) => {
              const value = result.configuration[key];
              if (value === null || value === undefined || value === '') return null;
              return (
                <div className="kv" key={key}>
                  <dt>{label}</dt>
                  <dd>{String(value)}</dd>
                </div>
              );
            })}
            <div className="kv">
              <dt>VIN</dt>
              <dd className="mono">{result.vinMasked}</dd>
            </div>
            <div className="kv">
              <dt>წყარო</dt>
              <dd>
                {result.provider}
                {result.fromCache ? ' · ჩვენი ბაზიდან' : ' · provider-ის ზარი'}
              </dd>
            </div>
          </dl>

          {result.checksumSuspect && (
            <p className="note">
              ⚠️ check digit არ ემთხვევა. VIN მაინც ამოიცნო უფასო provider-მა — ფასიანი
              ზარი ასეთზე არ იხარჯება.
            </p>
          )}

          {result.clarifications.map((q) => (
            <div className="clarify" key={q.id}>
              <p style={{ margin: '0 0 8px', fontSize: 13 }}>
                {MESSAGES[q.questionKey] ?? q.questionKey}
              </p>
              <div className="pill-row">
                {q.options.map((o) => (
                  <button
                    key={o.value}
                    className={`pill pill-button ${answer === o.value ? 'sellable' : ''}`}
                    onClick={() => setAnswer(o.value)}
                  >
                    {MESSAGES[o.labelKey] ?? o.labelKey}
                  </button>
                ))}
                <button
                  className={`pill pill-button ${answer === 'UNKNOWN' ? 'sellable' : ''}`}
                  onClick={() => setAnswer('UNKNOWN')}
                >
                  არ ვიცი
                </button>
              </div>
              {answer && (
                <p className="note">
                  {answer === 'UNKNOWN'
                    ? 'პასუხი არ ინახება. ამ ატრიბუტზე დამოკიდებული ნაწილები UNCERTAIN-ად რჩება, ანუ არ გამოჩნდება — მომხმარებლის იძულება, გამოიცნოს, არასწორ მონაცემს შექმნიდა.'
                    : `ინახება user_supplied_data-ში როგორც brake_config=${answer} — verified_data-სგან განცალკევებით, რადგან ეს მფლობელის პასუხია და არა provider-ის დადასტურება.`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
