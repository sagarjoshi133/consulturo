/**
 * BackupHealthPanel — owner-only dashboard tab.
 *
 * Shows the latest mongodump archives and the off-host mirror status surfaced
 * by GET /api/admin/backup/status. Helps the owner verify (without SSHing in)
 * that nightly backups are running AND being pushed off-host.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO } from 'date-fns';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { Skeleton } from './skeleton';
import { useResponsive } from './responsive';

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
  const [data, setData] = useState<StatusResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
                <Text style={styles.helpTitle}>How to enable</Text>
                <Text style={styles.helpStep}>
                  1. SSH into the host running the backend.
                </Text>
                <Text style={styles.helpStep}>
                  2. Edit /app/backend/.env and add (one of):
                </Text>
                <Text style={styles.code}>
                  BACKUP_MIRROR_MODE=s3{'\n'}
                  S3_BUCKET=s3://my-bucket/consulturo{'\n'}
                  AWS_ACCESS_KEY_ID=…{'\n'}
                  AWS_SECRET_ACCESS_KEY=…
                </Text>
                <Text style={styles.helpStep}>
                  3. Restart backend: sudo supervisorctl restart backend
                </Text>
                <Text style={styles.helpStep}>
                  4. Verify: bash /app/scripts/mirror_backups.sh
                </Text>
                <Text style={[styles.muted, { marginTop: 6 }]}>
                  See /app/scripts/BACKUP_README.md for the rclone & rsync recipes.
                </Text>
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
                </View>
              ))}
              </View>
            </>
          )}
        </>
      ) : null}
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
});

export default BackupHealthPanel;
