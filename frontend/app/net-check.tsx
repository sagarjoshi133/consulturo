/**
 * Connection Diagnostics — /net-check
 *
 * Ground-truth measurement of what the INSTALLED app actually
 * experiences: which backend URL it talks to, whether the DR fallback
 * is active, and real round-trip latency + payload size for the
 * endpoints every screen depends on. Built to debug the production
 * "everything takes 10-30s" complaint from the user's own device.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { API_BASE, api } from '../src/api';
import { getActiveBase, isOnFallback } from '../src/backend-health';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { goBackSafe } from '../src/nav';

const TEXT = COLORS.textPrimary;
const BG = COLORS.bg;

type RowResult = {
  label: string;
  ms: number;
  status: number | string;
  bytes: number;
};

function verdict(rows: RowResult[]): { text: string; color: string } {
  const timed = rows.filter((r) => typeof r.status === 'number' && r.ms > 0);
  if (!timed.length) {
    return { text: 'Could not reach the server at all — check internet connection.', color: '#C62828' };
  }
  const worst = Math.max(...timed.map((r) => r.ms));
  const avg = timed.reduce((s, r) => s + r.ms, 0) / timed.length;
  if (worst > 8000) {
    return {
      text: `Server requests are timing out (worst ${(worst / 1000).toFixed(1)}s). The app is likely pointed at a slow/unreachable backend URL — share this screen with support.`,
      color: '#C62828',
    };
  }
  if (avg > 2500) {
    return {
      text: `Network to the server is slow (avg ${(avg / 1000).toFixed(1)}s per request). This is a device/network issue, not the app.`,
      color: '#E65100',
    };
  }
  return {
    text: `Server connection is healthy (avg ${Math.round(avg)}ms per request). If screens still feel slow, the installed app build is outdated — generate & install a fresh build.`,
    color: '#2E7D32',
  };
}

export default function NetCheckScreen() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<RowResult[]>([]);
  const [done, setDone] = useState(false);

  const activeBase = getActiveBase() || API_BASE.replace(/\/api$/, '');
  const fallbackActive = isOnFallback();
  const appVersion = Constants.expoConfig?.version || '?';
  const updateId = (Constants as any).expoConfig?.extra?.updateId
    || (Constants as any).manifest2?.id
    || null;

  const run = useCallback(async () => {
    setRunning(true);
    setDone(false);
    const out: RowResult[] = [];
    const token = await AsyncStorage.getItem('session_token').catch(() => null);

    const probe = async (label: string, path: string, authed = false) => {
      const t0 = Date.now();
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        const resp = await fetch(`${activeBase}/api${path}`, {
          headers: authed && token ? { Authorization: `Bearer ${token}` } : undefined,
          signal: ctrl.signal,
        });
        const body = await resp.text();
        clearTimeout(t);
        out.push({ label, ms: Date.now() - t0, status: resp.status, bytes: body.length });
      } catch (e: any) {
        out.push({
          label,
          ms: Date.now() - t0,
          status: e?.name === 'AbortError' ? 'timeout(20s)' : 'network error',
          bytes: 0,
        });
      }
      setRows([...out]);
    };

    // Axios probe — exercises the SAME transport the real app screens use
    // (on Android this is the expo/fetch adapter). Comparing this against
    // the raw-fetch pings above localises whether slowness is in the
    // network itself or specifically the axios path.
    const probeAxios = async (label: string, path: string) => {
      const t0 = Date.now();
      try {
        const resp = await api.get(path, { timeout: 20000 });
        const size = (() => { try { return JSON.stringify(resp.data).length; } catch { return 0; } })();
        out.push({ label, ms: Date.now() - t0, status: resp.status, bytes: size });
      } catch (e: any) {
        const st = e?.response?.status;
        out.push({
          label,
          ms: Date.now() - t0,
          status: typeof st === 'number' ? st : (e?.code === 'ECONNABORTED' ? 'timeout(20s)' : 'network error'),
          bytes: 0,
        });
      }
      setRows([...out]);
    };

    await probe('Server ping #1', '/health');
    await probe('Server ping #2', '/health');
    await probe('Server ping #3', '/health');
    await probeAxios('App transport (axios) #1', '/health');
    await probeAxios('App transport (axios) #2', '/health');
    await probe('Sign-in check (/auth/me)', '/auth/me', true);
    await probe('My bookings', '/bookings/me', true);
    await probe('Public content (blog)', '/blog');
    // Staff-only heavy screens — exactly what the dashboard tabs load.
    // 401/403 rows are expected for patient accounts and are skipped
    // from the verdict.
    if (token) {
      await probe('All bookings (staff)', '/bookings/all', true);
      await probe('Dashboard analytics (staff)', '/analytics/dashboard', true);
      await probe('Patients registry (staff)', '/registry/patients', true);
      await probe('Surgeries (staff)', '/surgeries', true);
      await probe('Prescriptions (staff)', '/prescriptions', true);
      await probe('Inbox', '/inbox/all', true);
    }

    setRunning(false);
    setDone(true);
  }, [activeBase]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn} testID="netcheck-back">
          <Ionicons name="arrow-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connection Diagnostics</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Info label="App version" value={`${appVersion} (${Platform.OS})`} />
          {!!updateId && <Info label="Update ID" value={String(updateId).slice(0, 18)} />}
          <Info label="Backend in use" value={activeBase.replace(/^https?:\/\//, '') || '(not set!)'} />
          <Info
            label="Backup server active"
            value={fallbackActive ? 'YES — primary was unreachable' : 'No (normal)'}
          />
        </View>

        <TouchableOpacity
          style={[styles.runBtn, running && { opacity: 0.5 }]}
          onPress={run}
          disabled={running}
          testID="netcheck-run"
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="speedometer-outline" size={20} color="#fff" />
          )}
          <Text style={styles.runText}>{running ? 'Testing…' : 'Run speed test'}</Text>
        </TouchableOpacity>

        {rows.length > 0 && (
          <View style={styles.card}>
            {rows.map((r) => (
              <View key={r.label} style={styles.resultRow}>
                <Text style={styles.resultLabel}>{r.label}</Text>
                <Text
                  style={[
                    styles.resultMs,
                    { color: typeof r.status !== 'number' || r.ms > 3000 ? '#C62828' : r.ms > 1200 ? '#E65100' : '#2E7D32' },
                  ]}
                >
                  {typeof r.status === 'number' ? `${r.ms} ms` : String(r.status)}
                </Text>
                <Text style={styles.resultMeta}>
                  {typeof r.status === 'number' ? `HTTP ${r.status}` : ''}
                  {r.bytes > 0 ? ` · ${(r.bytes / 1024).toFixed(0)} KB` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {done && (
          <View style={[styles.verdictCard, { borderColor: verdict(rows).color }]}>
            <Ionicons name="information-circle" size={20} color={verdict(rows).color} />
            <Text style={[styles.verdictText, { color: verdict(rows).color }]}>{verdict(rows).text}</Text>
          </View>
        )}

        <Text style={styles.note}>
          Tip: run this on the same network where the app feels slow, then share a screenshot.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: FONTS?.semiBold || undefined, fontWeight: '600', color: TEXT },
  body: { padding: 16, paddingBottom: 48, gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS?.md ?? 12,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5EAEE',
  },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { color: COLORS.textSecondary || '#667', fontSize: 13 },
  infoValue: { color: TEXT, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS?.md ?? 12,
    paddingVertical: 14,
  },
  runText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  resultLabel: { flex: 1, color: TEXT, fontSize: 13 },
  resultMs: { fontSize: 13, fontWeight: '700', minWidth: 70, textAlign: 'right' },
  resultMeta: { fontSize: 11, color: COLORS.textDisabled || '#99A', minWidth: 86, textAlign: 'right' },
  verdictCard: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: RADIUS?.md ?? 12,
    padding: 14,
    backgroundColor: '#fff',
  },
  verdictText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  note: { fontSize: 12, color: COLORS.textDisabled || '#99A', textAlign: 'center' },
});
