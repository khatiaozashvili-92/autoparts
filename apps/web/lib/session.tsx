'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, type GarageVehicle, type TokenStore } from '@autoparts/api-client';
import { t as translate, type Locale } from '@autoparts/i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const STORAGE_KEY = 'autoparts.tokens';
const VEHICLE_KEY = 'autoparts.vehicle';

/**
 * Tokens in localStorage.
 *
 * The refresh token really belongs in an httpOnly cookie (docs/07 §3); that
 * needs a same-origin cookie the API sets, which arrives with the deployment
 * work. Everything else — short-lived access tokens, rotation, reuse detection
 * — is already in place server-side, so the exposure here is bounded to this
 * browser.
 */
function browserTokenStore(): TokenStore {
  const read = () => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as { accessToken: string; refreshToken: string }) : null;
    } catch {
      return null;
    }
  };

  return {
    getAccessToken: () => read()?.accessToken ?? null,
    getRefreshToken: () => read()?.refreshToken ?? null,
    set: (tokens) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
      } catch {
        // Private mode, or storage disabled. The session simply lasts one page.
      }
    },
    clear: () => {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

export interface Me {
  id: string;
  /** The number the account signs in on, and its identity (ADR-015). */
  phone: string | null;
  firstName: string | null;
  /** Optional since ADR-015: an account created by SMS may never have one. */
  email: string | null;
  roles: string[];
  partnerId: string | null;
}

interface SessionValue {
  api: ApiClient;
  me: Me | null;
  loading: boolean;
  locale: Locale;
  setLocale(locale: Locale): void;
  t(key: string): string;
  refreshMe(): Promise<Me | null>;
  signOut(): Promise<void>;
  /** The car every part search is answered for (PRD §14). */
  vehicles: GarageVehicle[];
  selectedVehicle: GarageVehicle | null;
  selectVehicle(id: string | null): void;
  reloadGarage(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocaleState] = useState<Locale>('ka');
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_URL,
        locale,
        tokens: browserTokenStore(),
        onUnauthenticated: () => setMe(null),
      }),
    // The client holds mutable locale; rebuilding on every change would drop
    // nothing but is unnecessary, so it is set imperatively below.
    [],
  );

  useEffect(() => {
    api.locale = locale;
  }, [api, locale]);

  const reloadGarage = useCallback(async () => {
    try {
      const garage = await api.garage();
      setVehicles(garage);
      setSelectedId((current) => {
        if (current && garage.some((v) => v.id === current)) return current;
        const stored = window.localStorage.getItem(VEHICLE_KEY);
        if (stored && garage.some((v) => v.id === stored)) return stored;
        // One car means no choice to make — pick it (PRD §12).
        return garage.find((v) => v.isDefault)?.id ?? garage[0]?.id ?? null;
      });
    } catch {
      setVehicles([]);
    }
  }, [api]);

  /**
   * Reloads the signed-in user, and hands them back.
   *
   * The return value matters at sign-in: where someone lands depends on which
   * workspace they belong to, and reading `me` from context right there would
   * give the previous render's value, which is still null.
   */
  const refreshMe = useCallback(async (): Promise<Me | null> => {
    try {
      const user = await api.me();
      setMe(user);
      await reloadGarage();
      return user;
    } catch {
      setMe(null);
      setVehicles([]);
      return null;
    } finally {
      setLoading(false);
    }
  }, [api, reloadGarage]);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const selectVehicle = useCallback((id: string | null) => {
    setSelectedId(id);
    try {
      if (id) window.localStorage.setItem(VEHICLE_KEY, id);
      else window.localStorage.removeItem(VEHICLE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setMe(null);
    setVehicles([]);
    setSelectedId(null);
  }, [api]);

  const value: SessionValue = {
    api,
    me,
    loading,
    locale,
    setLocale: setLocaleState,
    t: (key: string) => translate(key, locale),
    refreshMe,
    signOut,
    vehicles,
    selectedVehicle: vehicles.find((v) => v.id === selectedId) ?? null,
    selectVehicle,
    reloadGarage,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
