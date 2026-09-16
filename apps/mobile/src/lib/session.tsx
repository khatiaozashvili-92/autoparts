import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiClient,
  type GarageVehicle,
  type OtpChallenge,
  type TokenStore,
} from '@autoparts/api-client';
import { t as translate, type Locale } from '@autoparts/i18n';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'autoparts.tokens';

/**
 * Tokens in AsyncStorage.
 *
 * On a real build these belong in Keychain/Keystore (docs/11 §9) — that needs
 * expo-secure-store and a development build rather than Expo Go, so it is left
 * as the one deliberate gap here rather than pretended away.
 *
 * The store is synchronous by contract but AsyncStorage is not, so tokens are
 * mirrored in memory and hydrated once at startup.
 */
let cachedTokens: { accessToken: string; refreshToken: string } | null = null;

async function hydrateTokens(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    cachedTokens = raw ? JSON.parse(raw) : null;
  } catch {
    cachedTokens = null;
  }
}

const tokenStore: TokenStore = {
  getAccessToken: () => cachedTokens?.accessToken ?? null,
  getRefreshToken: () => cachedTokens?.refreshToken ?? null,
  set: (tokens) => {
    cachedTokens = tokens;
    void AsyncStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  },
  clear: () => {
    cachedTokens = null;
    void AsyncStorage.removeItem(TOKEN_KEY);
  },
};

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
  ready: boolean;
  t(key: string): string;
  /** Step one: ask the API to text a code to this number. */
  requestCode(phone: string): Promise<OtpChallenge>;
  /** Step two: exchange the code for a session. */
  verifyCode(input: { challengeId: string; code: string; firstName?: string }): Promise<void>;
  signOut(): Promise<void>;
  vehicles: GarageVehicle[];
  selectedVehicle: GarageVehicle | null;
  selectVehicle(id: string): void;
  reloadGarage(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [vehicles, setVehicles] = useState<GarageVehicle[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locale] = useState<Locale>('ka');

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_URL,
        locale,
        tokens: tokenStore,
        onUnauthenticated: () => setMe(null),
      }),
    [locale],
  );

  const reloadGarage = useCallback(async () => {
    try {
      const garage = await api.garage();
      setVehicles(garage);
      setSelectedId((current) => {
        if (current && garage.some((v) => v.id === current)) return current;
        // One car means no choice to make (PRD §12).
        return garage.find((v) => v.isDefault)?.id ?? garage[0]?.id ?? null;
      });
    } catch {
      setVehicles([]);
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      await hydrateTokens();
      try {
        setMe(await api.me());
        await reloadGarage();
      } catch {
        setMe(null);
      } finally {
        setReady(true);
      }
    })();
  }, [api, reloadGarage]);

  const requestCode = useCallback((phone: string) => api.requestOtp(phone), [api]);

  const verifyCode = useCallback(
    async (input: { challengeId: string; code: string; firstName?: string }) => {
      await api.verifyOtp(input);
      setMe(await api.me());
      await reloadGarage();
    },
    [api, reloadGarage],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    setMe(null);
    setVehicles([]);
    setSelectedId(null);
  }, [api]);

  const value: SessionValue = {
    api,
    me,
    ready,
    t: (key: string) => translate(key, locale),
    requestCode,
    verifyCode,
    signOut,
    vehicles,
    selectedVehicle: vehicles.find((v) => v.id === selectedId) ?? null,
    selectVehicle: setSelectedId,
    reloadGarage,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
