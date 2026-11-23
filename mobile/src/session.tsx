import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { unregisterPush } from './push';
import {
  api,
  login as apiLogin,
  onPasswordChangeRequired,
  onSessionExpired,
  setSession,
  Session,
} from './api/client';

/**
 * Session state for the whole app.
 *
 * The token is persisted so a treasurer is not forced to log in every time
 * they open the app, which is the fastest way to make people stop using it.
 * It is cleared the moment the server rejects it.
 */

interface Ctx {
  session: Session | null;
  ready: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
}

const SessionContext = createContext<Ctx>({
  session: null,
  ready: false,
  async signIn() {},
  async signOut() {},
  async changePassword() {},
});

const STORE_KEY = 'amanahtrack.session';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const saved: Session = JSON.parse(raw);
          setSession(saved.token, saved.institution_slug);
          setSessionState(saved);
        }
      } catch {
        // Corrupt or unreadable storage is not fatal: start logged out.
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPush(); // needs the token, so before the session is cleared
    setSession(null);
    setSessionState(null);
    await AsyncStorage.removeItem(STORE_KEY).catch(() => {});
  }, []);

  useEffect(() => {
    onSessionExpired(() => {
      signOut();
    });
    onPasswordChangeRequired(() => {
      setSessionState((s) => (s ? { ...s, must_change_password: true } : s));
    });
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const s = { ...(await apiLogin(email, password)), email };
    setSessionState(s);
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(s)).catch(() => {});
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    const email = session?.email;
    await api.changePassword(current, next);
    // The server ended every sign-in, including this one.
    if (!email) return signOut();
    try {
      await signIn(email, next);
    } catch {
      await signOut();
    }
  }, [session, signIn, signOut]);

  const value = useMemo(
    () => ({ session, ready, signIn, signOut, changePassword }),
    [session, ready, signIn, signOut, changePassword],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
