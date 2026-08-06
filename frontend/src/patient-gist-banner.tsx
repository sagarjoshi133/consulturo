/**
 * PatientGistBanner — Wave 3 · N
 *
 * Auto-loads a 1-sentence AI summary for a patient and renders it as
 * a soft purple banner at the top of the patient detail screen.
 *
 * Reduces "chart-flipping" time before each visit. Cached server-side
 * for 1 hour; user can tap the refresh icon to force-regenerate.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import { getPatientGist } from './wave3/api';
import { Skeleton } from './skeleton';

type Props = {
  phone: string;
  visible?: boolean;
};

export function PatientGistBanner({ phone, visible = true }: Props) {
  const [gist, setGist] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [cached, setCached] = useState(false);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!phone) { setLoading(false); return; }
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const r = await getPatientGist(phone, refresh);
      setGist(r.gist || '');
      setCached(!!r.cached);
    } catch {
      setGist('');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [phone]);

  useEffect(() => { void load(); }, [load]);

  if (!visible || hidden) return null;

  // Don't render an empty banner when AI hasn't generated content.
  if (!loading && !gist) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.iconCircle}>
          <Ionicons name="sparkles" size={14} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>AI clinical gist {cached ? '· cached' : '· fresh'}</Text>
          {loading ? (
            <View style={{ gap: 4, marginTop: 4 }}>
              <Skeleton width="100%" height={11} />
              <Skeleton width="78%" height={11} />
            </View>
          ) : (
            <Text style={styles.gist} numberOfLines={3}>{gist}</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={() => load(true)}
          disabled={refreshing || loading}
          style={styles.iconBtn}
          testID="gist-refresh"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="refresh" size={16} color="#fff" />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setHidden(true)}
          style={styles.iconBtn}
          testID="gist-dismiss"
        >
          <Ionicons name="close" size={16} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#7C3AED',
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconCircle: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: {
    ...FONTS.bodyMedium,
    color: '#E9D5FF',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  gist: {
    ...FONTS.bodyMedium,
    color: '#fff',
    fontSize: 13.5,
    lineHeight: 19,
  },
  iconBtn: { padding: 4 },
});
