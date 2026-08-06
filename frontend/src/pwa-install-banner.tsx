/**
 * PwaInstallBanner — bottom-anchored, dismissible "Install app"
 * promo that appears ONLY on the web build (no-op on native).
 *
 * Behaviour:
 *   • Android / desktop Chrome (and any Chromium browser): listens for
 *     the `beforeinstallprompt` event, intercepts it, and surfaces a
 *     branded "Install ConsultUro" CTA. Tapping the button calls
 *     event.prompt() so the OS install dialog appears.
 *   • iOS Safari: there's no `beforeinstallprompt` on iOS at all, so
 *     we detect iOS + Safari and show a short "Tap Share → Add to
 *     Home Screen" hint instead.
 *   • Already installed (display-mode: standalone) → never shows.
 *   • Permanently dismissed (localStorage `pwa_install_dismissed=1`)
 *     → never shows again until the user clears site data.
 *
 * No external dependencies, ~3 KB gzipped. Hidden on native via the
 * Platform.OS guard at the top of the export.
 */
import React, { useEffect, useState } from 'react';
import { Platform, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS } from './theme';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'pwa_install_dismissed';
const DEFER_KEY = 'pwa_install_deferred_until';

function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  // Chrome / desktop / Android — display-mode media query
  const standalone =
    window.matchMedia &&
    window.matchMedia('(display-mode: standalone)').matches;
  // iOS Safari sets a non-standard property when launched from A2HS
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!(standalone || iosStandalone);
}

function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  // Exclude Chrome-on-iOS (CriOS), Firefox-on-iOS (FxiOS), Edge etc.
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIOS && isSafari;
}

export default function PwaInstallBanner() {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Native — bail. Web-only logic below.
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;
    if (isInstalled()) return;

    // Respect dismiss / defer.
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === '1') return;
      const deferredUntil = parseInt(
        window.localStorage.getItem(DEFER_KEY) || '0',
        10,
      );
      if (deferredUntil && Date.now() < deferredUntil) return;
    } catch {
      /* localStorage blocked — proceed anyway */
    }

    // ── Chrome / Edge / Android ───────────────────────────────────
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall as any);

    // Hide the banner if the browser fires the installed event
    // while it's still up (e.g. user installed from the address bar).
    const onInstalled = () => {
      setVisible(false);
      setPromptEvent(null);
      try {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } catch {}
    };
    window.addEventListener('appinstalled', onInstalled);

    // ── iOS Safari fallback ───────────────────────────────────────
    // Show the hint only after the user has actually engaged with the
    // page for a few seconds — pops too early on cold-load and feels
    // spammy.
    let iosTimer: ReturnType<typeof setTimeout> | null = null;
    if (isIOSSafari()) {
      iosTimer = setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 6000);
    }

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        onBeforeInstall as any,
      );
      window.removeEventListener('appinstalled', onInstalled);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  if (!visible) return null;
  if (Platform.OS !== 'web') return null;

  const onInstall = async () => {
    if (!promptEvent) return;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') {
        try {
          window.localStorage.setItem(DISMISS_KEY, '1');
        } catch {}
      } else {
        // User said "not now" — back off for 7 days.
        try {
          window.localStorage.setItem(
            DEFER_KEY,
            String(Date.now() + 7 * 24 * 60 * 60 * 1000),
          );
        } catch {}
      }
    } catch {
      /* Some browsers throw if prompt() is called twice — ignore. */
    } finally {
      setVisible(false);
      setPromptEvent(null);
    }
  };

  const onDismiss = (forever: boolean) => {
    setVisible(false);
    try {
      if (forever) {
        window.localStorage.setItem(DISMISS_KEY, '1');
      } else {
        window.localStorage.setItem(
          DEFER_KEY,
          String(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
      }
    } catch {}
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Ionicons
            name={iosHint ? 'share-outline' : 'download-outline'}
            size={22}
            color="#fff"
          />
        </View>
        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Text style={styles.title} numberOfLines={1}>
            {iosHint ? 'Install ConsultUro on iPhone' : 'Install ConsultUro'}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {iosHint
              ? 'Tap the Share button, then choose "Add to Home Screen".'
              : 'Add it to your home screen for instant access and offline support.'}
          </Text>
        </View>
        {iosHint ? (
          <TouchableOpacity
            onPress={() => onDismiss(false)}
            style={[styles.btn, styles.btnSecondary]}
            testID="pwa-install-got-it"
          >
            <Text style={styles.btnSecondaryText}>Got it</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <TouchableOpacity
              onPress={() => onDismiss(true)}
              style={[styles.btn, styles.btnGhost]}
              testID="pwa-install-dismiss"
              accessibilityLabel="Dismiss install prompt"
            >
              <Ionicons name="close" size={18} color="#475569" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onInstall}
              style={[styles.btn, styles.btnPrimary]}
              testID="pwa-install-install"
            >
              <Text style={styles.btnPrimaryText}>Install</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: 18,
    alignItems: 'center',
    zIndex: 4000,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 560,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(14, 124, 139, 0.18)',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...FONTS.h3,
    color: '#0F172A',
    fontSize: 14,
    letterSpacing: -0.1,
  },
  sub: {
    ...FONTS.body,
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  btn: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnGhost: {
    width: 36,
    paddingHorizontal: 0,
    backgroundColor: '#F1F5F9',
  },
  btnSecondary: { backgroundColor: COLORS.primary, paddingHorizontal: 16 },
  btnSecondaryText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
