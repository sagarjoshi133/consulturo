/**
 * Comm V2 — Broadcast detail.
 *
 * Combines preview + owner actions (approve/reject/schedule/cancel/retry)
 * + analytics view. Everything the owner needs from the moment a
 * draft is submitted until dispatch is done.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { V2, relTime, shared, stateLabel, stateTint } from '../../../src/comm-v2/ui-tokens';

type Broadcast = {
  id: string;
  state: string;
  title: string;
  body: string;
  category: string;
  audience_mode: string;
  scheduled_at: string | null;
  frozen_at: string | null;
  recipient_count_frozen: number;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  dispatch_started_at: string | null;
  dispatch_completed_at: string | null;
  created_at: string;
};

type PreviewResp = {
  broadcast: Broadcast;
  audience_summary: {
    intended_total: number; included: number; excluded: number; push_eligible: number;
  };
  excluded_by_reason?: Record<string, number>;
};

type AnalyticsResp = {
  broadcast_id: string;
  state: string;
  counters: Record<string, number>;
  excluded_by_reason?: Record<string, number>;
  note: string;
};

const OWNER_ROLES = new Set(['super_owner', 'primary_owner', 'owner', 'partner']);

export default function BroadcastDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = !!user?.role && OWNER_ROLES.has(user.role);
  const [b, setB] = useState<Broadcast | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        api.get(`/v2/communications/broadcasts/${encodeURIComponent(String(id))}`),
        api.get(`/v2/communications/broadcasts/${encodeURIComponent(String(id))}/preview`).catch(() => null),
      ]);
      setB(r1?.data?.broadcast);
      setPreview(r2?.data || null);
      const state = r1?.data?.broadcast?.state;
      if (state && ['scheduled', 'dispatching', 'completed', 'partially_failed'].includes(state)) {
        const r3 = await api.get(`/v2/communications/broadcasts/${encodeURIComponent(String(id))}/analytics`).catch(() => null);
        setAnalytics(r3?.data || null);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  const doAction = useCallback(async (path: string, body?: any) => {
    if (!id) return;
    setBusy(true);
    try {
      await api.post(`/v2/communications/broadcasts/${encodeURIComponent(String(id))}/${path}`, body || {});
      await reload();
    } catch (e: any) {
      Alert.alert('Action failed',
        e?.response?.data?.detail?.message || e?.response?.data?.detail || e?.message || 'unknown');
    } finally {
      setBusy(false);
    }
  }, [id, reload]);

  if (loading || !b) {
    return (
      <SafeAreaView edges={['top']} style={shared.screen}>
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      </SafeAreaView>
    );
  }

  const stateT = stateTint[b.state] || { bg: V2.divider, fg: V2.fgMuted };

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>Broadcast</Text>
        {(b.state === 'draft' || b.state === 'rejected') ? (
          <Pressable
            onPress={() => router.push(`/comm-v2/broadcasts/compose?edit=${b.id}` as any)}
            style={{ paddingHorizontal: 10, paddingVertical: 6 }}
          >
            <Text style={{ color: V2.accent, fontSize: 13, fontWeight: '600' }}>Edit</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

        <View style={shared.card}>
          <View style={[shared.chip, { backgroundColor: stateT.bg, marginBottom: 10 }]}>
            <Text style={[shared.chipTxt, { color: stateT.fg }]}>
              {stateLabel[b.state] || b.state}
            </Text>
          </View>
          <Text style={styles.title}>{b.title}</Text>
          <Text style={styles.body}>{b.body}</Text>
          {b.rejection_reason ? (
            <View style={styles.rejectedBox}>
              <Text style={styles.rejectedLabel}>Rejection reason</Text>
              <Text style={styles.rejectedBody}>{b.rejection_reason}</Text>
            </View>
          ) : null}
        </View>

        {/* Preview (audience summary — computed live pre-approval, from frozen row post-approval) */}
        {preview ? (
          <View style={shared.card}>
            <Text style={styles.sectionTitle}>Audience</Text>
            <MetricRow label="Intended" value={preview.audience_summary.intended_total} />
            <MetricRow label="Included" value={preview.audience_summary.included} />
            <MetricRow label="Excluded" value={preview.audience_summary.excluded} />
            <MetricRow label="Push-eligible" value={preview.audience_summary.push_eligible} accent />
            {preview.excluded_by_reason && Object.keys(preview.excluded_by_reason).length ? (
              <View style={{ marginTop: 8 }}>
                {Object.entries(preview.excluded_by_reason).map(([r, n]) => (
                  <Text key={r} style={styles.reason}>· {r}: {n}</Text>
                ))}
              </View>
            ) : null}
            {b.frozen_at ? (
              <Text style={styles.frozenNote}>Frozen at approval: {relTime(b.frozen_at)}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Analytics (post-schedule) */}
        {analytics ? (
          <View style={shared.card}>
            <Text style={styles.sectionTitle}>Analytics — every counter independent</Text>
            <MetricRow label="Intended recipients" value={analytics.counters.intended_recipients} />
            <MetricRow label="Excluded recipients" value={analytics.counters.excluded_recipients} />
            <MetricRow label="Inbox items created" value={analytics.counters.inbox_items_created} />
            <MetricRow label="Push-eligible" value={analytics.counters.push_eligible} />
            <MetricRow label="Push enqueued" value={analytics.counters.push_enqueued} />
            <MetricRow label="Provider accepted" value={analytics.counters.provider_accepted} accent />
            <MetricRow label="Provider failed" value={analytics.counters.provider_failed}
              danger={analytics.counters.provider_failed > 0} />
            <MetricRow label="Invalid tokens" value={analytics.counters.invalid_tokens}
              danger={analytics.counters.invalid_tokens > 0} />
            <MetricRow label="Broadcast read" value={analytics.counters.broadcast_read} accent />
            <Text style={styles.honestNote}>{analytics.note}</Text>
          </View>
        ) : null}

        {/* Owner actions */}
        {isOwner ? (
          <View style={shared.card}>
            <Text style={styles.sectionTitle}>Owner actions</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {b.state === 'pending_approval' ? (
                <>
                  <ActionBtn label="Approve" tone="primary"
                    onPress={() => doAction('approve')} disabled={busy} />
                  <ActionBtn label="Reject" tone="danger"
                    onPress={() => promptReject((r) => doAction('reject', { reason: r }))}
                    disabled={busy} />
                </>
              ) : null}
              {b.state === 'approved' ? (
                <>
                  <ActionBtn label="Send now" tone="primary"
                    onPress={() => doAction('schedule', { scheduled_at: new Date().toISOString() })}
                    disabled={busy} />
                  <ActionBtn label="Cancel" tone="ghost"
                    onPress={() => doAction('cancel')} disabled={busy} />
                </>
              ) : null}
              {b.state === 'scheduled' ? (
                <ActionBtn label="Cancel" tone="ghost" onPress={() => doAction('cancel')} disabled={busy} />
              ) : null}
              {b.state === 'partially_failed' ? (
                <ActionBtn label="Retry failed" tone="primary"
                  onPress={() => doAction('retry-failed')} disabled={busy} />
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Meta */}
        <View style={shared.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          <MetaRow label="Category" value={b.category} />
          <MetaRow label="Audience" value={b.audience_mode.replace(/_/g, ' ')} />
          <MetaRow label="Created" value={relTime(b.created_at)} />
          {b.approved_at ? <MetaRow label="Approved" value={relTime(b.approved_at)} /> : null}
          {b.dispatch_completed_at ? <MetaRow label="Dispatch completed" value={relTime(b.dispatch_completed_at)} /> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricRow({ label, value, accent, danger }: { label: string; value: number; accent?: boolean; danger?: boolean }) {
  const c = danger ? V2.danger : accent ? V2.accent : V2.fg;
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: c }]}>{value || 0}</Text>
    </View>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function ActionBtn({ label, tone, onPress, disabled }: {
  label: string; tone: 'primary' | 'ghost' | 'danger'; onPress: () => void; disabled?: boolean;
}) {
  const style =
    tone === 'primary' ? { backgroundColor: V2.accent, color: '#fff' } :
    tone === 'danger'  ? { backgroundColor: V2.danger, color: '#fff' } :
                         { backgroundColor: V2.card, color: V2.accent, borderWidth: 1, borderColor: V2.accent };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
        backgroundColor: (style as any).backgroundColor,
        borderWidth: (style as any).borderWidth || 0, borderColor: (style as any).borderColor,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: (style as any).color, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function promptReject(cb: (reason: string) => void) {
  Alert.prompt?.(
    'Reject broadcast',
    'Reason (optional):',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: (r) => cb(r || '') },
    ],
  ) || cb('');
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '700', color: V2.fg, marginBottom: 6 },
  body: { fontSize: 14, color: V2.fg, lineHeight: 21 },
  rejectedBox: {
    marginTop: 12, padding: 10, backgroundColor: V2.dangerSoft, borderRadius: 8,
  },
  rejectedLabel: { fontSize: 11, fontWeight: '700', color: V2.danger, marginBottom: 2 },
  rejectedBody: { fontSize: 13, color: V2.danger },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', color: V2.fgMuted,
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  metric: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6,
  },
  metricLabel: { fontSize: 13, color: V2.fgMuted },
  metricValue: { fontSize: 16, fontWeight: '700' },
  metaValue: { fontSize: 13, color: V2.fg, fontWeight: '600' },
  reason: { fontSize: 11, color: V2.fgMuted, marginLeft: 4 },
  frozenNote: { fontSize: 11, color: V2.accent, marginTop: 8, fontStyle: 'italic' },
  honestNote: {
    fontSize: 11, color: V2.fgMuted, marginTop: 8,
    fontStyle: 'italic', lineHeight: 15,
  },
});
