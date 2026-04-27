import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';
import { registerForPushNotifications } from './push';

export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  role: 'patient' | 'doctor' | 'owner' | 'assistant' | 'reception' | 'nursing' | string;
  /** Granted by owner — gives same dashboard tabs as owner */
  dashboard_full_access?: boolean;
  /** Convenience flag set by /auth/me: role==='owner' OR dashboard_full_access */
  effective_owner?: boolean;
  can_approve_bookings?: boolean;
  can_approve_broadcasts?: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  exchangeSessionId: (sessionId: string) => Promise<User | null>;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
  exchangeSessionId: async () => null,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // CRITICAL: if the current URL has session_id in the fragment we are
      // returning from Emergent OAuth. Skip the /auth/me check and let
      // AuthCallback exchange the session_id first — otherwise /auth/me
      // runs before the token is stored and incorrectly marks the user
      // as logged out, causing an infinite redirect back to /login.
      if (
        Platform.OS === 'web' &&
        typeof window !== 'undefined' &&
        window.location.hash &&
        window.location.hash.includes('session_id=')
      ) {
        setLoading(false);
        return;
      }
      const token = await AsyncStorage.getItem('session_token');
      if (!token) {
        setUser(null);
        return;
      }
      const { data } = await api.get('/auth/me');
      setUser(data);
      // Fire-and-forget push registration once the user is authenticated
      registerForPushNotifications().catch(() => {});
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Global deep-link safety net for native (Android/iOS).
  //
  // When the OAuth flow returns the user from Chrome Custom Tabs / SFSafari
  // back into the APK, `WebBrowser.openAuthSessionAsync` SHOULD resolve and
  // the login screen exchanges the session_id. In practice on some Android
  // builds the Custom Tab fails to intercept the `consulturo://` redirect —
  // the deep-link still reaches the app via the OS, but openAuthSessionAsync
  // never resolves. This listener catches that incoming URL and completes
  // the exchange anyway, so the user always lands signed-in.
  //
  // Wrapped in try/catch so a misbehaving expo-linking native module can
  // never take the whole app down on cold-start — falling back to the
  // login.tsx in-flow handler.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    let sub: { remove?: () => void } | null = null;

    const handleUrl = async (incoming: string | null) => {
      try {
        if (!incoming || cancelled) return;
        // (1) Magic-link deep link: consulturo://magic-link?token=...
        const mt = incoming.match(/magic-link[\?#].*token=([^&#]+)/);
        if (mt) {
          const token = decodeURIComponent(mt[1]);
          const existing = await AsyncStorage.getItem('session_token');
          if (existing) return;
          try {
            const { data } = await api.post('/auth/magic/exchange', { token });
            if (cancelled) return;
            await AsyncStorage.setItem('session_token', data.session_token);
            setUser(data.user);
            registerForPushNotifications().catch(() => {});
          } catch {
            // Surface a soft error via console; login screen will explain.
          }
          return;
        }
        // (2) Classic Google-OAuth deep link: ...?session_id=...
        const m = incoming.match(/session_id=([^&#]+)/);
        if (!m) return;
        const sid = decodeURIComponent(m[1]);
        // Avoid double-exchange if login.tsx is already handling it.
        const existing = await AsyncStorage.getItem('session_token');
        if (existing) return;
        const { data } = await api.post('/auth/session', { session_id: sid });
        if (cancelled) return;
        await AsyncStorage.setItem('session_token', data.session_token);
        setUser(data.user);
        registerForPushNotifications().catch(() => {});
      } catch {
        // Silent — login screen will surface a real error if needed.
      }
    };

    try {
      // (a) Cold-start: app was opened directly by the deep-link
      Linking.getInitialURL().then(handleUrl).catch(() => {});

      // (b) Warm: app was already running when the deep-link arrived
      sub = Linking.addEventListener('url', (event: { url: string }) => {
        handleUrl(event.url);
      }) as any;
    } catch {
      // expo-linking native module unavailable — degrade gracefully.
    }

    return () => {
      cancelled = true;
      try {
        sub?.remove?.();
      } catch {}
    };
  }, []);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    const { data } = await api.post('/auth/session', { session_id: sessionId });
    await AsyncStorage.setItem('session_token', data.session_token);
    setUser(data.user);
    registerForPushNotifications().catch(() => {});
    return data.user as User;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    await AsyncStorage.removeItem('session_token');
    setUser(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, refresh, exchangeSessionId, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
