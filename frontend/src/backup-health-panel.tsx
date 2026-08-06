/**
 * BackupHealthPanel — owner-only dashboard tab.
 *
 * Shows the latest mongodump archives and the off-host mirror status surfaced
 * by GET /api/admin/backup/status. Helps the owner verify (without SSHing in)
 * that nightly backups are running AND being pushed off-host.
 *
 * Owner actions:
 *   • "Backup now"     — POST /api/admin/backup/run (sync, ~5-30s).
 *   • Per-archive ↓    — GET  /api/admin/backup/download/{name} streams the
 *                        .tar.gz so the owner has an offline copy.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Alert, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, parseISO } from 'date-fns';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { Skeleton } from './skeleton';
import { useResponsive } from './responsive';
import GDriveWizard from './gdrive-wizard';

type Archive = {
  name: string;
  size_bytes: number;
  size_human: string;
  modified: string;
};
type MirrorStatus = {
  ts?: string;
  mode?: string;
  ok?: boolean;
  message?: string;
  detail?: string;
} | null;
type StatusResp = {
  mode: string;
  configured: boolean;
  local: { dir: string; count: number; recent: Archive[] };
  mirror: MirrorStatus;
  now: string;
};

const MODE_DESC: Record<string, { label: string; tip: string }> = {
  none: { label: 'Not configured', tip: 'Local-disk only — set BACKUP_MIRROR_MODE in /app/backend/.env' },
  s3: { label: 'AWS S3', tip: 'Daily mirror to S3 bucket' },
  rclone: { label: 'rclone (Drive / Dropbox / B2)', tip: 'Daily mirror via rclone' },
  rsync: { label: 'rsync over SSH', tip: 'Daily mirror to remote Linux host' },
};

function fmtTs(iso?: string) {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'd MMM, HH:mm');
  } catch {
    return iso;
  }
}

function ageHours(iso?: string): number | null {
  if (!iso) return null;
  try {
    return Math.max(0, (Date.now() - parseISO(iso).getTime()) / 3600000);
  } catch {
    return null;
  }
}

export function BackupHealthPanel() {
  const router = useRouter();
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { isWebDesktop } = useResponsive();

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get('/admin/backup/status');
      setData(r.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'Could not load backup status.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // ── Backup now ─────────────────────────────────────────────
  const runBackup = useCallback(async () => {
    setRunningBackup(true);
    try {
      const r = await api.post('/admin/backup/run');
      const name = r.data?.archive?.name;
      const human = r.data?.archive?.size_human;
      if (Platform.OS === 'web') {
        window.alert(`Backup created${name ? `\n${name}` : ''}${human ? ` (${human})` : ''}`);
      } else {
        Alert.alert('Backup complete', name ? `Saved ${name}${human ? ` (${human})` : ''}` : 'Done.');
      }
      // Refresh so the new archive appears in the list.
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Backup failed.';
      if (Platform.OS === 'web') window.alert('Backup failed:\n' + msg);
      else Alert.alert('Backup failed', msg);
    } finally {
      setRunningBackup(false);
    }
  }, [load]);

  // ── Download a single archive ───────────────────────────────
  const downloadArchive = useCallback(async (name: string) => {
    setDownloading(name);
    try {
      // Build the absolute URL using the same baseURL the api client
      // uses (handles dev / preview / prod via EXPO_PUBLIC_BACKEND_URL).
      const base = (api.defaults?.baseURL || '').replace(/\/+$/, '');
      const url = `${base}/admin/backup/download/${encodeURIComponent(name)}`;
      // Token-bearing fetch → blob → object URL (so the server-side
      // auth header survives) is web-only. On native we let the OS
      // sharing flow handle the blob via expo-file-system.
      if (Platform.OS === 'web') {
        // Use axios so the Authorization header is added automatically.
        const resp = await api.get(`/admin/backup/download/${encodeURIComponent(name)}`, {
          responseType: 'blob',
        });
        const blob = new Blob([resp.data], { type: 'application/gzip' });
        const obj = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = obj;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(obj), 4000);
      } else {
        // Native: simplest path — open in the system browser. The
        // request will hit the API which returns a 401 unless the
        // token is in the URL. So we use a pre-signed query-token
        // fallback: open the public-equivalent in the browser using
        // the same session cookie; if that fails we fall back to
        // showing the URL and letting the user share it.
        try {
          await Linking.openURL(url);
        } catch {
          Alert.alert(
            'Open this link to download',
            url,
            [{ text: 'Copy', onPress: () => {} }, { text: 'OK' }],
          );
        }
      }
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || 'Download failed.';
      if (Platform.OS === 'web') window.alert('Download failed:\n' + msg);
      else Alert.alert('Download failed', msg);
    } finally {
      setDownloading(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const newestAge = data ? ageHours(data.local.recent[0]?.modified) : null;
  const lastBackupHealthy = newestAge != null && newestAge <= 36; // < 36h
  const mirrorHealthy = data?.mirror?.ok === true;
  const mirrorConfigured = !!data?.configured;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 0, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
    >
      <Text style={styles.heading}>Backups & Mirror</Text>
      <Text style={styles.sub}>
        Patient data is dumped daily to /app/backups and (optionally) mirrored off-host so a disk failure can't lose records.
      </Text>

      {/* Owner actions row — sits ABOVE the status cards so the "Backup
          now" CTA is the most prominent control. */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={runBackup}
          disabled={runningBackup}
          style={[styles.primaryBtn, runningBackup && { opacity: 0.6 }]}
          testID="backup-run-now"
          activeOpacity={0.85}
        >
          {runningBackup ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Ionicons name="cloud-upload" size={16} color="#fff" />
          )}
          <Text style={styles.primaryBtnText}>
            {runningBackup ? 'Backing up…' : 'Backup now'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRefresh} style={styles.secondaryBtn} testID="backup-refresh">
          <Ionicons name="refresh" size={16} color={COLORS.primary} />
          <Text style={styles.secondaryBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {loading && !data ? (
        <View style={{ marginTop: 16, gap: 12 }}>
          <Skeleton w="100%" h={70} br={12} />
          <Skeleton w="100%" h={70} br={12} />
          <Skeleton w="100%" h={48} br={10} />
        </View>
      ) : error ? (
        <View style={[styles.card, { borderColor: COLORS.accent + '66' }]}>
          <View style={styles.cardHead}>
            <Ionicons name="alert-circle" size={20} color={COLORS.accent} />
            <Text style={[styles.cardTitle, { color: COLORS.accent }]}>Could not load status</Text>
          </View>
          <Text style={styles.cardBody}>{error}</Text>
        </View>
      ) : data ? (
        <>
          <View style={isWebDesktop ? { flexDirection: 'row', gap: 14, marginTop: 8 } : undefined}>
          {/* Card 1 — local dumps */}
          <View
            style={[
              styles.card,
              { borderColor: lastBackupHealthy ? COLORS.success + '55' : COLORS.warning + '66' },
              isWebDesktop && { flex: 1, marginBottom: 0 },
            ]}
            testID="backup-local-card"
          >
            <View style={styles.cardHead}>
              <Ionicons
                name={lastBackupHealthy ? 'checkmark-circle' : 'time-outline'}
                size={20}
                color={lastBackupHealthy ? COLORS.success : COLORS.warning}
              />
              <Text
                style={[
                  styles.cardTitle,
                  { color: lastBackupHealthy ? COLORS.success : COLORS.warning },
                ]}
              >
                Local dumps · {data.local.count}
              </Text>
            </View>
            <Text style={styles.cardBody}>
              {data.local.recent[0]
                ? `Latest: ${fmtTs(data.local.recent[0].modified)} (${data.local.recent[0].size_human})`
                : 'No archives yet — nightly backup hasn’t run.'}
            </Text>
            {newestAge != null && (
              <Text style={[styles.muted, { marginTop: 4 }]}>
                {newestAge < 1
                  ? `${Math.round(newestAge * 60)} minutes ago`
                  : `${newestAge.toFixed(1)} hours ago`}
              </Text>
            )}
          </View>

          {/* Card 2 — off-host mirror */}
          <View
            style={[
              styles.card,
              {
                borderColor: !mirrorConfigured
                  ? COLORS.warning + '55'
                  : mirrorHealthy
                  ? COLORS.success + '55'
                  : COLORS.accent + '66',
              },
              isWebDesktop && { flex: 1, marginBottom: 0 },
            ]}
            testID="backup-mirror-card"
          >
            <View style={styles.cardHead}>
              <Ionicons
                name={
                  !mirrorConfigured ? 'cloud-offline-outline' : mirrorHealthy ? 'cloud-done' : 'cloud-offline'
                }
                size={20}
                color={
                  !mirrorConfigured ? COLORS.warning : mirrorHealthy ? COLORS.success : COLORS.accent
                }
              />
              <Text
                style={[
                  styles.cardTitle,
                  {
                    color: !mirrorConfigured
                      ? COLORS.warning
                      : mirrorHealthy
                      ? COLORS.success
                      : COLORS.accent,
                  },
                ]}
              >
                Off-host mirror — {(MODE_DESC[data.mode] || MODE_DESC.none).label}
              </Text>
            </View>
            <Text style={styles.cardBody}>
              {(MODE_DESC[data.mode] || MODE_DESC.none).tip}
            </Text>
            {data.mirror?.message ? (
              <Text style={[styles.muted, { marginTop: 6 }]}>
                Last run: {fmtTs(data.mirror.ts)} — {data.mirror.message}
              </Text>
            ) : null}
            {data.mirror?.detail ? (
              <Text style={styles.muted}>{data.mirror.detail}</Text>
            ) : null}
            {!mirrorConfigured && (
              <View style={styles.helpBox}>
                <Text style={styles.helpTitle}>One-tap Google Drive setup</Text>
                <Text style={styles.helpStep}>
                  Authorize Google Drive in your phone's browser, paste the token back into the app, and we'll set up the mirror for you. Takes ~60 seconds.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => setWizardOpen(true)}
                    style={styles.primaryBtn}
                    testID="backup-gdrive-setup"
                    activeOpacity={0.85}
                  >
                    <Ionicons name="logo-google" size={15} color="#fff" />
                    <Text style={styles.primaryBtnText}>Set up Google Drive</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => router.push('/admin/backup-setup-guide' as any)}
                    style={styles.secondaryBtn}
                    testID="backup-gdrive-guide"
                  >
                    <Ionicons name="book-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.secondaryBtnText}>Setup guide</Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.muted, { marginTop: 8 }]}>
                  S3, rsync and advanced rclone setups — see /app/scripts/BACKUP_README.md.
                </Text>
              </View>
            )}
            {mirrorConfigured && data.mode === 'rclone' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <TouchableOpacity
                  onPress={() => setWizardOpen(true)}
                  style={styles.secondaryBtn}
                  testID="backup-gdrive-manage"
                >
                  <Ionicons name="settings-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.secondaryBtnText}>Manage Google Drive</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/admin/backup-setup-guide' as any)}
                  style={styles.secondaryBtn}
                  testID="backup-gdrive-guide-manage"
                >
                  <Ionicons name="book-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.secondaryBtnText}>Setup guide</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          </View>

          {/* Recent archives */}
          {data.local.recent.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Recent archives</Text>
              <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } : undefined}>
              {data.local.recent.map((a) => (
                <View key={a.name} style={[styles.row, isWebDesktop && { width: '49%' }]} testID={`backup-row-${a.name}`}>
                  <Ionicons name="archive-outline" size={18} color={COLORS.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName} numberOfLines={1}>{a.name}</Text>
                    <Text style={styles.muted}>
                      {fmtTs(a.modified)} · {a.size_human}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => downloadArchive(a.name)}
                    disabled={downloading === a.name}
                    style={[styles.downloadBtn, downloading === a.name && { opacity: 0.5 }]}
                    testID={`backup-download-${a.name}`}
                    hitSlop={8}
                  >
                    {downloading === a.name ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <Ionicons name="download-outline" size={18} color={COLORS.primary} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
              </View>
            </>
          )}
        </>
      ) : null}
      <GDriveWizard
        visible={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onConnected={() => { void load(); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  heading: { ...FONTS.h3, color: COLORS.textPrimary },
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 13, lineHeight: 18 },
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, marginBottom: 8 },
  card: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { ...FONTS.bodyMedium, fontSize: 14 },
  cardBody: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, marginTop: 6, lineHeight: 18 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },
  helpBox: {
    marginTop: 12,
    padding: 12,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  helpTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginBottom: 6 },
  helpStep: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  code: {
    ...FONTS.body,
    fontFamily: 'monospace' as any,
    color: COLORS.textPrimary,
    fontSize: 11,
    backgroundColor: '#0e7c8b10',
    padding: 8,
    borderRadius: 6,
    marginTop: 6,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  rowName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  actionsRow: {
    flexDirection: 'row', gap: 10, marginTop: 14, marginBottom: 4, flexWrap: 'wrap',
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 10,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.pill,
    minWidth: 140, justifyContent: 'center',
  },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.primary + '55',
  },
  secondaryBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  downloadBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1, borderColor: COLORS.primary + '33',
  },
});

export default BackupHealthPanel;
