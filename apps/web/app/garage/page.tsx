'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import type { VinDecodeResponse } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote } from '../../components/shell';

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

function Garage() {
  const { api, t, vehicles, reloadGarage, selectVehicle, selectedVehicle } = useSession();
  const router = useRouter();
  const next = useSearchParams().get('next');

  const [vin, setVin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [decoded, setDecoded] = useState<VinDecodeResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customName, setCustomName] = useState('');

  async function decode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setDecoded(null);
    setAnswers({});
    try {
      setDecoded(await api.decodeVin(vin));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!decoded) return;
    setBusy(true);
    setError(null);
    try {
      const vehicle = await api.addVehicle({
        configurationId: decoded.configurationId,
        ...(customName ? { customName } : {}),
        ...(Object.keys(answers).length ? { clarificationAnswers: answers } : {}),
      });
      await reloadGarage();
      selectVehicle(vehicle.id);
      setDecoded(null);
      setVin('');
      setCustomName('');
      if (next) router.push(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.removeVehicle(id).catch(() => undefined);
    await reloadGarage();
  }

  return (
    <>
      <h1 className="page-title">ჩემი გარაჟი</h1>

      <section className="card">
        <form className="search-form" onSubmit={decode}>
          <input
            className="search-input mono"
            value={vin}
            maxLength={17}
            spellCheck={false}
            placeholder="VIN — 17 სიმბოლო"
            onChange={(e) => setVin(e.target.value.toUpperCase().replace(/\s/g, ''))}
            aria-label="VIN"
          />
          <button className="button primary" type="submit" disabled={busy || vin.length < 11}>
            {busy ? '…' : 'ამოცნობა'}
          </button>
        </form>

        <div className="pill-row" style={{ marginTop: 10 }}>
          {[
            ['WBA1J5C50FV123456', 'BMW 228i'],
            ['2HKRW2H875H112233', 'Honda CR-V'],
            ['W0L0AHL0885667788', 'Opel Astra'],
          ].map(([sample, label]) => (
            <button
              key={sample}
              className="pill pill-button"
              onClick={() => setVin(sample!)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <ErrorNote error={error} />

        {decoded && (
          <div className="result">
            <h3 style={{ marginTop: 0 }}>ვიპოვეთ თქვენი ავტომობილი</h3>
            <dl>
              {Object.entries(FIELD_LABELS).map(([key, label]) => {
                const value = decoded.configuration[key];
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
                <dd className="mono">{decoded.vinMasked}</dd>
              </div>
            </dl>

            {decoded.checksumSuspect && (
              <p className="note">
                ⚠️ VIN-ის საკონტროლო ციფრი არ ემთხვევა. ავტომობილი მაინც ამოვიცანით —
                გადაამოწმეთ, რომ სწორია.
              </p>
            )}

            {decoded.clarifications.map((q) => (
              <div className="clarify" key={q.id}>
                <p style={{ margin: '0 0 8px', fontSize: 13 }}>{t(q.questionKey)}</p>
                <div className="pill-row">
                  {q.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`pill pill-button ${answers[q.attribute] === o.value ? 'sellable' : ''}`}
                      onClick={() => setAnswers({ ...answers, [q.attribute]: o.value })}
                    >
                      {t(o.labelKey)}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="pill pill-button"
                    onClick={() => {
                      const { [q.attribute]: _dropped, ...rest } = answers;
                      setAnswers(rest);
                    }}
                  >
                    არ ვიცი
                  </button>
                </div>
                {!answers[q.attribute] && (
                  <p className="note">
                    უპასუხოდ დატოვება დასაშვებია. ამ ატრიბუტზე დამოკიდებული ნაწილები უბრალოდ
                    არ გამოჩნდება — გამოცნობა არასწორ მონაცემს შექმნიდა.
                  </p>
                )}
              </div>
            ))}

            <label className="inline-field">
              <span>სახელი (არასავალდებულო)</span>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="მაგ. ჩემი BMW"
              />
            </label>

            <div className="cta-row">
              <button className="button primary" onClick={confirm} disabled={busy}>
                სწორია, დამატება
              </button>
              <button className="button" onClick={() => setDecoded(null)} disabled={busy}>
                ეს ჩემი მანქანა არ არის
              </button>
            </div>
          </div>
        )}
      </section>

      <h2>ავტომობილები ({vehicles.length})</h2>
      {vehicles.length === 0 ? (
        <p className="muted">ჯერ არცერთი ავტომობილი არ დაგიმატებიათ.</p>
      ) : (
        <div className="card">
          <dl>
            {vehicles.map((v) => (
              <div className="kv" key={v.id}>
                <dt>
                  <span className={`dot ${v.id === selectedVehicle?.id ? 'ok' : 'idle'}`} />
                  {v.label}
                  {v.vinMasked ? <span className="mono muted"> · {v.vinMasked}</span> : null}
                </dt>
                <dd>
                  <button className="link-button" onClick={() => selectVehicle(v.id)}>
                    არჩევა
                  </button>
                  {' · '}
                  <button className="link-button" onClick={() => remove(v.id)}>
                    წაშლა
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

export default function GaragePage() {
  return (
    <Suspense fallback={null}>
      <Garage />
    </Suspense>
  );
}
