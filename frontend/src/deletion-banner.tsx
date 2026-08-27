// Global "account scheduled for deletion" banner.
//
// Shown while the signed-in user has `pending_deletion: true`. The
// account stays fully usable during the 30-day grace window; this banner
// gives a one-tap "Cancel deletion" (restore) action and shows the exact
// purge date. Rendered near the top of the More tab and the Profile
// screen.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { useAuth } from './auth';
import { useI18n } from './i18n';

function formatPurgeDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function DeletionBanner() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = React.useState(false);

  const pending = !!(user as any)?.pending_deletion;
  if (!pending) return null;

  const purgeDate = formatPurgeDate((user as any)?.deletion_purge_at);

  const doRestore = async () => {
    setBusy(true);
    try {
      await api.post('/auth/me/restore');
      await refresh();
    } catch {
      const msg = t('profile.restoreFailed') || 'Could not cancel deletion. Please try again.';
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.alert(msg);
      } else {
        Alert.alert(t('profile.deleteFailedTitle') || 'Error', msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const line = purgeDate
    ? (t('profile.deletionBannerDated') || 'Account scheduled for deletion on {date}.').replace('{date}', purgeDate)
    : (t('profile.deletionBanner') || 'Account scheduled for deletion.');

  return (
    <View style={styles.wrap} testID="deletion-banner">
      <View style={styles.iconWrap}>
        <Ionicons name="warning" size={18} color="#B45309" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{line}</Text>
        <Text style={styles.sub}>{t('profile.deletionBannerSub') || 'Changed your mind? You can still restore it.'}</Text>
      </View>
      <TouchableOpacity
        onPress={doRestore}
        disabled={busy}
        style={styles.btn}
        testID="deletion-banner-cancel"
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.btnText}>{t('profile.cancelDeletion') || 'Cancel'}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  iconWrap: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#92400E', fontSize: 13, fontFamily: 'Manrope_700Bold' },
  sub: { color: '#B45309', fontSize: 11, marginTop: 1 },
  btn: { backgroundColor: '#B45309', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, minWidth: 64, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 12, fontFamily: 'Manrope_700Bold' },
});
