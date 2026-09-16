'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import type { OtpChallenge } from '@autoparts/api-client';
import { useSession } from '../../lib/session';
import { ErrorNote } from '../../components/shell';

/**
 * Signing in is a phone number and a six-digit code (ADR-015).
 *
 * There is no register/login switch. The customer types a number; whether that
 * ends in a new account or an existing one is the API's business, and asking
 * someone to remember which of the two they did last time is a question the
 * product can answer for itself.
 */
function LoginForm() {
  const { api, refreshMe, t } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const codeInput = useRef<HTMLInputElement>(null);
  /**
   * When the next code may be asked for, and for which number.
   *
   * A deadline rather than a decrementing count, so a backgrounded tab resumes
   * with the right value instead of however far the timer got before the
   * browser throttled it. The number is stored with it because the limit is
   * per-number on the server — without that, typing a different number would
   * leave someone staring at a countdown that does not apply to them.
   */
  const [cooldown, setCooldown] = useState<{ until: number; phone: string } | null>(null);
  const cooldownUntil = cooldown && cooldown.phone === phone.trim() ? cooldown.until : null;

  // Moving to the code step should put the cursor in the code box. Without
  // this the customer lands on a screen whose only field is not focused, and
  // on a phone the keyboard does not open.
  useEffect(() => {
    if (challenge) codeInput.current?.focus();
  }, [challenge]);

  useEffect(() => {
    if (cooldownUntil === null) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const issued = await api.requestOtp(phone);
      setChallenge(issued);
      setCode('');
      setCooldown({ until: Date.now() + issued.resendAfter * 1000, phone: phone.trim() });
    } catch (err) {
      setError(err);
      // "A code was already sent" is the one refusal that is only about time.
      // The API says how much is left, so the button counts down to it rather
      // than leaving someone pressing a dead control and guessing.
      const wait = retryAfterOf(err);
      if (wait !== null) setCooldown({ until: Date.now() + wait * 1000, phone: phone.trim() });
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api.verifyOtp({
        challengeId: challenge.challengeId,
        code,
        firstName: firstName.trim() || undefined,
      });
      await refreshMe();
      router.push(next);
    } catch (err) {
      setError(err);
      // A rejected code is almost always a typo. Clearing it saves a select-all
      // before the retry, and the challenge stays alive for the next attempt.
      setCode('');
      codeInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (!challenge) {
    return (
      <section className="narrow">
        <h1 className="page-title">{t('auth.title')}</h1>

        <form className="card form" onSubmit={sendCode}>
          <label>
            <span>{t('auth.phoneLabel')}</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="555 12 34 56"
              autoComplete="tel"
              inputMode="tel"
              autoFocus
              required
            />
            <small className="muted">{t('auth.phoneHint')}</small>
          </label>

          <ErrorNote error={error} />

          <button className="button primary" type="submit" disabled={busy || secondsLeft > 0}>
            {busy
              ? '…'
              : secondsLeft > 0
                ? `${t('auth.resendIn')} ${secondsLeft}s`
                : t('auth.sendCode')}
          </button>
        </form>

        <DevAccountsNote />
      </section>
    );
  }

  return (
    <section className="narrow">
      <h1 className="page-title">{t('auth.codeTitle')}</h1>

      <form className="card form" onSubmit={verify}>
        <p className="muted small" style={{ marginTop: 0 }}>
          {t('auth.codeSentTo')} <strong>{challenge.maskedPhone}</strong>
        </p>

        <label>
          <span>{t('auth.codeLabel')}</span>
          <input
            ref={codeInput}
            value={code}
            // Digits only: a pasted code often arrives with spaces around it,
            // and the six-digit rule is enforced by the API either way.
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            style={{ fontSize: '1.6rem', letterSpacing: '0.4em', textAlign: 'center' }}
            required
          />
        </label>

        {/*
          Asked on this screen rather than a third one. It is only used when
          the code creates the account, so it stays optional — nobody is kept
          out of their own order history for skipping it.
        */}
        <label>
          <span>{t('auth.nameLabel')}</span>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
          />
          <small className="muted">{t('auth.nameHint')}</small>
        </label>

        {challenge.devCode && (
          <p className="muted small" style={{ margin: 0 }}>
            <strong>SMS gateway: console.</strong> {t('auth.codeLabel')}:{' '}
            <code style={{ fontSize: '1.1rem' }}>{challenge.devCode}</code>
          </p>
        )}

        <ErrorNote error={error} />

        <button className="button primary" type="submit" disabled={busy || code.length < 6}>
          {busy ? '…' : t('auth.verify')}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => void sendCode()}
          disabled={busy || secondsLeft > 0}
        >
          {secondsLeft > 0 ? `${t('auth.resendIn')} ${secondsLeft}s` : t('auth.resend')}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setChallenge(null);
            setError(null);
          }}
        >
          {t('auth.changeNumber')}
        </button>
      </form>
    </section>
  );
}

/**
 * Seconds to wait, when the API refused because one was already sent.
 *
 * Returns null for every other error — those are not about time, and counting
 * down to nothing would be worse than saying nothing.
 */
function retryAfterOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('details' in error)) return null;
  const details = (error as { details?: Record<string, unknown> }).details;
  const wait = details?.['retryAfter'];
  return typeof wait === 'number' && wait > 0 ? wait : null;
}

/**
 * The seeded accounts, for a developer looking at this page on localhost.
 *
 * Published numbers, and no secret to leak: signing in as one still requires
 * reading its code out of the API log, or off this page while the console SMS
 * stub is configured.
 */
function DevAccountsNote() {
  return (
    <div className="card">
      <p className="muted small" style={{ margin: 0 }}>
        <strong>სატესტო ანგარიშები</strong> (seed-იდან). კოდი გამოჩნდება ეკრანზე, სანამ{' '}
        <code>SMS_PROVIDER=console</code>:
      </p>
      <ul className="muted small">
        <li>
          <code>555 00 00 01</code> — მომხმარებელი
        </li>
        <li>
          <code>555 00 00 02</code> — პარტნიორი „Auto Motors“
        </li>
        <li>
          <code>555 00 00 04</code> — ადმინისტრატორი
        </li>
      </ul>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
