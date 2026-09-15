'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { useSession } from '../../lib/session';
import { ErrorNote } from '../../components/shell';

function LoginForm() {
  const { api, refreshMe } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await api.login(identifier, password);
      else await api.register({ email: identifier, password });
      await refreshMe();
      router.push(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="narrow">
      <h1 className="page-title">{mode === 'login' ? 'შესვლა' : 'რეგისტრაცია'}</h1>

      <form className="card form" onSubmit={submit}>
        <label>
          <span>Email {mode === 'login' ? 'ან ტელეფონი' : ''}</span>
          <input
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          <span>პაროლი</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 10 : undefined}
            required
          />
          {mode === 'register' && <small className="muted">მინიმუმ 10 სიმბოლო.</small>}
        </label>

        <ErrorNote error={error} />

        <button className="button primary" type="submit" disabled={busy}>
          {busy ? '…' : mode === 'login' ? 'შესვლა' : 'ანგარიშის შექმნა'}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? 'ანგარიში არ გაქვთ? დარეგისტრირდით' : 'უკვე გაქვთ ანგარიში? შედით'}
        </button>
      </form>

      <div className="card">
        <p className="muted small" style={{ margin: 0 }}>
          <strong>სატესტო ანგარიშები</strong> (seed-იდან, პაროლი{' '}
          <code>dev-password-change-me</code>):
        </p>
        <ul className="muted small">
          <li>
            <code>customer@autoparts.dev</code> — მომხმარებელი
          </li>
          <li>
            <code>partner@autoparts.dev</code> — პარტნიორი „Auto Motors“
          </li>
          <li>
            <code>admin@autoparts.dev</code> — ადმინისტრატორი
          </li>
        </ul>
      </div>
    </section>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
