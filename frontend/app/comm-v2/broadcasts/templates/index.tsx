/**
 * Comm V2 — Broadcast Templates library.
 *
 * Two-tap send: pick a template → confirm & submit (or edit before send).
 *
 * Owner-tier can also create/edit/delete templates.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, Pressable, RefreshControl,
  StyleSheet, Text, View, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../../../../src/api';
import { V2, categoryLabel, relTime, shared } from '../../../../src/comm-v2/ui-tokens';

type Template = {
  id: string;
  name: string;
  title: string;
  body: string;
  category: string;
  audience_mode: string;
  action_type: string;
  is_active: boolean;
  use_count: number;
  last_used_at: string | null;
  created_by_role: string | null;
  updated_at: string;
};

function audienceLabel(a: string): string {
  return {
    patients: 'Patients', staff: 'Staff', both: 'Everyone',
    selected_patients: 'Selected patients',
    patients_with_future_appointments: 'Upcoming appts',
  }[a] || a;
}

export default function BroadcastTemplatesScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meRes, listRes] = await Promise.all([
        api.get('/auth/me'),
        api.get('/v2/communications/broadcast-templates', { params: { limit: 100 } }),
      ]);
      setMe(meRes?.data || null);
      setItems(listRes?.data?.items || []);
    } catch (e: any) {
      Alert.alert('Load failed', e?.response?.data?.detail || e?.message || 'unknown');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const isOwner = ['super_owner', 'primary_owner', 'owner', 'partner'].includes(me?.role);

  const apply = async (t: Template) => {
    const doApply = async () => {
      setApplying(t.id);
      try {
        const r = await api.post(
          `/v2/communications/broadcast-templates/${encodeURIComponent(t.id)}/apply`, {}
        );
        const bid = r?.data?.broadcast?.id;
        if (bid) router.push(`/comm-v2/broadcasts/${bid}` as any);
      } catch (e: any) {
        Alert.alert('Apply failed',
          e?.response?.data?.detail?.message || e?.response?.data?.detail || e?.message || 'unknown');
      } finally {
        setApplying(null);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' &&
          window.confirm(`Create a new draft from “${t.name}”?`)) doApply();
    } else {
      Alert.alert('Use template', `Create a new draft from "${t.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create draft', onPress: doApply },
      ]);
    }
  };

  const del = async (t: Template) => {
    const doDelete = async () => {
      try {
        await api.delete(`/v2/communications/broadcast-templates/${encodeURIComponent(t.id)}`);
        setItems((cur) => cur.filter((x) => x.id !== t.id));
      } catch (e: any) {
        Alert.alert('Delete failed', e?.response?.data?.detail || e?.message);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' &&
          window.confirm(`Archive template "${t.name}"? Existing drafts keep their content.`)) doDelete();
    } else {
      Alert.alert('Archive template', `Archive "${t.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>Broadcast templates</Text>
        {isOwner ? (
          <Pressable onPress={() => router.push('/comm-v2/broadcasts/templates/new' as any)}
            style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: V2.accent, fontSize: 13, fontWeight: '700' }}>+ New</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      ) : items.length === 0 ? (
        <View style={shared.empty}>
          <Text style={shared.emptyTitle}>No templates yet</Text>
          <Text style={shared.emptyBody}>
            {isOwner
              ? 'Tap "+ New" to save your first weekly announcement.'
              : 'An owner needs to save one first.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={V2.accent}
              onRefresh={async () => { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                </View>
                {isOwner ? (
                  <Pressable onPress={() => del(item)} hitSlop={10} style={styles.trashBtn}>
                    <Ionicons name="trash-outline" size={18} color={V2.fgMuted} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.metaRow}>
                <View style={[shared.chip, { backgroundColor: V2.accentSoft }]}>
                  <Text style={[shared.chipTxt, { color: V2.accent }]}>
                    {categoryLabel[item.category] || item.category}
                  </Text>
                </View>
                <Text style={styles.meta}>· {audienceLabel(item.audience_mode)}</Text>
                <Text style={styles.meta}>· Used {item.use_count}×</Text>
                {item.last_used_at ? (
                  <Text style={styles.meta}>· last {relTime(item.last_used_at)}</Text>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable
                  onPress={() => apply(item)}
                  disabled={applying === item.id}
                  style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                >
                  {applying === item.id
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '700' }}>Use template</Text>}
                </Pressable>
                {isOwner ? (
                  <Pressable
                    onPress={() => router.push(`/comm-v2/broadcasts/templates/${item.id}` as any)}
                    style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                  >
                    <Text style={{ color: V2.accent, fontWeight: '700' }}>Edit</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: V2.card,
    marginHorizontal: 12, marginTop: 10,
    padding: 14, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: V2.border,
  },
  name: { fontSize: 12, fontWeight: '700', color: V2.accent, textTransform: 'uppercase',
    letterSpacing: 0.3, marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700', color: V2.fg, marginBottom: 3 },
  body: { fontSize: 13, color: V2.fgMuted, lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  meta: { fontSize: 11, color: V2.fgHint },
  trashBtn: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  btn: {
    paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center',
  },
  btnPrimary: { backgroundColor: V2.accent, borderColor: V2.accent },
  btnGhost: { backgroundColor: V2.card, borderColor: V2.accent },
});
