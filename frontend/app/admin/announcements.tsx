/**
 * /admin/announcements — Owner-only manage screen for in-app banners.
 *
 * Lets Dr Joshi (primary_owner / partner) create / edit / toggle /
 * delete announcements. All banner copy is trilingual (en/hi/gu).
 * Banners can target patients / staff / both, and any combination of
 * placements (public landing, patient home, booking flow, dashboard).
 *
 * The list shows quick visual status (variant + active + pinned) and
 * a one-tap delete with confirmation.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Switch, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToast } from '../../src/toast';
import { confirmAction, infoAlert } from '../../src/cross-alert';
import { ISODateField } from '../../src/date-picker';
import {
  VARIANT_META,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementPlacement,
  type AnnouncementVariant,
} from '../../src/announcements/types';

const EMPTY: Partial<Announcement> = {
  title_en: '', title_hi: '', title_gu: '',
  body_en: '', body_hi: '', body_gu: '',
  cta_label_en: '', cta_label_hi: '', cta_label_gu: '',
  cta_url: '',
  variant: 'info',
  audience: 'both',
  placements: ['patient_home', 'dashboard'],
  pinned: false,
  active: true,
  start_at: '',
  end_at: '',
};

const PLACEMENT_LABELS: Record<AnnouncementPlacement, string> = {
  public_landing: 'Public landing (/c/<slug>)',
  patient_home: 'Patient home',
  booking_flow: 'Booking flow top',
  dashboard: 'Staff dashboard',
};

export default function AnnouncementsAdmin() {
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Announcement> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/announcements');
      setItems((r.data?.items || []) as Announcement[]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load announcements');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    if (!editing) return;
    if (!(editing.title_en || '').trim()) {
      infoAlert('Required', 'English title is required.');
      return;
    }
    if (!(editing.placements || []).length) {
      infoAlert('Required', 'Pick at least one placement.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...editing,
        start_at: editing.start_at ? new Date(editing.start_at + 'T00:00:00').toISOString() : null,
        end_at: editing.end_at ? new Date(editing.end_at + 'T23:59:59').toISOString() : null,
      };
      if ((editing as any).id) {
        await api.patch(`/admin/announcements/${(editing as any).id}`, payload);
        toast.success('Announcement updated.');
      } else {
        await api.post('/admin/announcements', payload);
        toast.success('Announcement created.');
      }
      setEditing(null);
      await load();
    } catch (e: any) {
      infoAlert('Save failed', e?.response?.data?.detail || 'Unknown');
    } finally {
      setBusy(false);
    }
  }, [editing, load, toast]);

  const remove = useCallback((a: Announcement) => {
    // Use confirmAction so the dialog works on BOTH native and web —
    // RN's Alert.alert is a silent no-op under react-native-web,
    // which is why the delete button "did nothing" when Dr Joshi
    // hit it from the desktop sidebar (Jun-16 bug).
    confirmAction({
      title: 'Delete announcement?',
      message: `"${a.title_en}" will be removed permanently.`,
      confirmText: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await api.delete(`/admin/announcements/${a.id}`);
          toast.success('Deleted.');
          await load();
        } catch (e: any) {
          infoAlert('Delete failed', e?.response?.data?.detail || 'Unknown');
        }
      },
    });
  }, [load, toast]);

  const toggleActive = useCallback(async (a: Announcement) => {
    try {
      await api.patch(`/admin/announcements/${a.id}`, { active: !a.active });
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Toggle failed');
    }
  }, [load, toast]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <Stack.Screen
        options={{
          title: 'Announcements',
          headerStyle: { backgroundColor: COLORS.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.h1}>In-app Announcements</Text>
            <Text style={styles.sub}>
              Trilingual banners shown to patients, staff or both — on
              the public landing page, patient home, booking flow or
              your dashboard. Schedule, pin, dismiss-able.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => setEditing({ ...EMPTY })}
            testID="ann-new-btn"
          >
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.newBtnText}>New</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="megaphone-outline" size={36} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>No announcements yet</Text>
            <Text style={styles.emptyText}>
              Create one to show banners across your patient app and dashboard.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {items.map((a) => {
              const meta = VARIANT_META[a.variant] || VARIANT_META.info;
              return (
                <View key={a.id} style={[styles.card, { borderLeftColor: meta.color, borderLeftWidth: 4 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <View style={[styles.variantBubble, { backgroundColor: meta.bg }]}>
                      <Ionicons name={(a.icon as any) || meta.icon} size={14} color={meta.color} />
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>{a.title_en}</Text>
                    {a.pinned ? (
                      <View style={[styles.tag, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="pin" size={10} color="#B45309" />
                        <Text style={[styles.tagText, { color: '#B45309' }]}>Pinned</Text>
                      </View>
                    ) : null}
                    <View style={[styles.tag, a.active ? { backgroundColor: '#DCFCE7' } : { backgroundColor: '#FEE2E2' }]}>
                      <Text style={[styles.tagText, a.active ? { color: '#166534' } : { color: '#991B1B' }]}>
                        {a.active ? 'Active' : 'Off'}
                      </Text>
                    </View>
                  </View>
                  {a.body_en ? <Text style={styles.cardBody} numberOfLines={2}>{a.body_en}</Text> : null}
                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>👥 {a.audience}</Text>
                    <Text style={styles.metaText}>📍 {(a.placements || []).length} placements</Text>
                    {a.start_at ? <Text style={styles.metaText}>From {String(a.start_at).slice(0, 10)}</Text> : null}
                    {a.end_at ? <Text style={styles.metaText}>Till {String(a.end_at).slice(0, 10)}</Text> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      style={styles.smallBtn}
                      onPress={() => setEditing({
                        ...a,
                        start_at: a.start_at ? String(a.start_at).slice(0, 10) : '',
                        end_at: a.end_at ? String(a.end_at).slice(0, 10) : '',
                      })}
                      testID={`ann-edit-${a.id}`}
                    >
                      <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                      <Text style={styles.smallBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.smallBtn}
                      onPress={() => toggleActive(a)}
                      testID={`ann-toggle-${a.id}`}
                    >
                      <Ionicons name={a.active ? 'pause' : 'play'} size={14} color={COLORS.primary} />
                      <Text style={styles.smallBtnText}>{a.active ? 'Pause' : 'Activate'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.smallBtn, { borderColor: '#dc2626' }]}
                      onPress={() => remove(a)}
                      testID={`ann-del-${a.id}`}
                    >
                      <Ionicons name="trash-outline" size={14} color="#dc2626" />
                      <Text style={[styles.smallBtnText, { color: '#dc2626' }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Editor modal */}
      <Modal visible={!!editing} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing ? (
          <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditing(null)} style={styles.modalClose}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>
                {(editing as any).id ? 'Edit Announcement' : 'New Announcement'}
              </Text>
              <TouchableOpacity onPress={save} style={styles.modalClose} disabled={busy} testID="ann-save">
                {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={22} color="#fff" />}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <Text style={styles.sectionLabel}>Variant</Text>
              <View style={styles.chipRow}>
                {(['info', 'success', 'warning', 'festive'] as AnnouncementVariant[]).map((v) => {
                  const meta = VARIANT_META[v];
                  const selected = editing.variant === v;
                  return (
                    <TouchableOpacity
                      key={v}
                      onPress={() => setEditing({ ...editing, variant: v })}
                      style={[styles.variantChip, { borderColor: meta.color }, selected && { backgroundColor: meta.color }]}
                    >
                      <Ionicons name={meta.icon as any} size={14} color={selected ? '#fff' : meta.color} />
                      <Text style={[styles.variantChipText, { color: selected ? '#fff' : meta.color }]}>{v}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>Audience</Text>
              <View style={styles.chipRow}>
                {(['patients', 'staff', 'both'] as AnnouncementAudience[]).map((a) => (
                  <TouchableOpacity
                    key={a}
                    onPress={() => setEditing({ ...editing, audience: a })}
                    style={[styles.toggle, editing.audience === a && styles.toggleOn]}
                  >
                    <Text style={[styles.toggleText, editing.audience === a && { color: '#fff' }]}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionLabel}>Placements *</Text>
              <View style={{ gap: 6 }}>
                {(Object.keys(PLACEMENT_LABELS) as AnnouncementPlacement[]).map((p) => {
                  const on = (editing.placements || []).includes(p);
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[styles.placementRow, on && styles.placementRowOn]}
                      onPress={() => {
                        const next = on
                          ? (editing.placements || []).filter((x) => x !== p)
                          : [...(editing.placements || []), p];
                        setEditing({ ...editing, placements: next });
                      }}
                    >
                      <Ionicons
                        name={on ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={on ? COLORS.primary : COLORS.textSecondary}
                      />
                      <Text style={[styles.placementText, on && { fontWeight: '700' }]}>{PLACEMENT_LABELS[p]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.sectionLabel}>Title (English) *</Text>
              <TextInput
                style={styles.input}
                value={editing.title_en || ''}
                onChangeText={(v) => setEditing({ ...editing, title_en: v })}
                placeholder="e.g. Clinic closed on Sunday"
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.sectionLabel}>Title (हिन्दी)</Text>
              <TextInput
                style={styles.input}
                value={editing.title_hi || ''}
                onChangeText={(v) => setEditing({ ...editing, title_hi: v })}
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.sectionLabel}>Title (ગુજરાતી)</Text>
              <TextInput
                style={styles.input}
                value={editing.title_gu || ''}
                onChangeText={(v) => setEditing({ ...editing, title_gu: v })}
                placeholderTextColor={COLORS.textSecondary}
              />

              <Text style={styles.sectionLabel}>Body (English)</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                value={editing.body_en || ''}
                onChangeText={(v) => setEditing({ ...editing, body_en: v })}
                multiline
                placeholder="Brief details — keep under 200 characters."
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.sectionLabel}>Body (हिन्दी)</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                value={editing.body_hi || ''}
                onChangeText={(v) => setEditing({ ...editing, body_hi: v })}
                multiline
                placeholderTextColor={COLORS.textSecondary}
              />
              <Text style={styles.sectionLabel}>Body (ગુજરાતી)</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
                value={editing.body_gu || ''}
                onChangeText={(v) => setEditing({ ...editing, body_gu: v })}
                multiline
                placeholderTextColor={COLORS.textSecondary}
              />

              <Text style={styles.sectionLabel}>Call-to-action (optional)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editing.cta_label_en || ''}
                  onChangeText={(v) => setEditing({ ...editing, cta_label_en: v })}
                  placeholder="Button label (EN)"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editing.cta_label_hi || ''}
                  onChangeText={(v) => setEditing({ ...editing, cta_label_hi: v })}
                  placeholder="(HI)"
                  placeholderTextColor={COLORS.textSecondary}
                />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={editing.cta_label_gu || ''}
                  onChangeText={(v) => setEditing({ ...editing, cta_label_gu: v })}
                  placeholder="(GU)"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>
              <TextInput
                style={styles.input}
                value={editing.cta_url || ''}
                onChangeText={(v) => setEditing({ ...editing, cta_url: v })}
                placeholder="Button URL — /book (in-app) or https://example.com"
                placeholderTextColor={COLORS.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text style={styles.sectionLabel}>Schedule (optional)</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Start date</Text>
                  <ISODateField
                    value={editing.start_at || ''}
                    onChange={(v) => setEditing({ ...editing, start_at: v })}
                    placeholder="DD-MM-YYYY"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>End date</Text>
                  <ISODateField
                    value={editing.end_at || ''}
                    onChange={(v) => setEditing({ ...editing, end_at: v })}
                    placeholder="DD-MM-YYYY"
                  />
                </View>
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>📌 Pinned</Text>
                  <Text style={styles.switchSub}>Stickier, more prominent banner</Text>
                </View>
                <Switch
                  value={!!editing.pinned}
                  onValueChange={(v) => setEditing({ ...editing, pinned: v })}
                  trackColor={{ true: COLORS.primary, false: '#cbd5e1' }}
                />
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>✅ Active</Text>
                  <Text style={styles.switchSub}>Visible to the audience above</Text>
                </View>
                <Switch
                  value={editing.active !== false}
                  onValueChange={(v) => setEditing({ ...editing, active: v })}
                  trackColor={{ true: COLORS.primary, false: '#cbd5e1' }}
                />
              </View>
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 14 },
  h1: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 18 },
  sub: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.button,
  },
  newBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  card: {
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    ...Platform.select({
      ios: { shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
      android: { elevation: 1 },
      default: {},
    }),
  },
  variantBubble: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  cardBody: { color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 17 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 999,
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  metaText: { color: COLORS.textSecondary, fontSize: 11 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.primary,
    backgroundColor: '#fff',
  },
  smallBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 11.5 },
  empty: {
    alignItems: 'center', paddingVertical: 32,
    backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed',
  },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 14, marginTop: 10 },
  emptyText: { color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 4, paddingHorizontal: 24, lineHeight: 17 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8, paddingVertical: 12,
  },
  modalClose: { padding: 8 },
  modalTitle: { ...FONTS.h3, color: '#fff', fontSize: 16 },
  sectionLabel: {
    color: COLORS.textSecondary, fontSize: 11.5,
    marginTop: 14, marginBottom: 6, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  variantChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, backgroundColor: '#fff',
  },
  variantChipText: { fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  toggle: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff',
  },
  toggleOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  toggleText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  placementRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  placementRowOn: { borderColor: COLORS.primary, backgroundColor: '#F0FDFA' },
  placementText: { color: COLORS.textPrimary, fontSize: 13 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 9 : 7,
    backgroundColor: '#fff', color: COLORS.textPrimary, fontSize: 13,
    marginBottom: 4,
  },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  switchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 8,
  },
  switchLabel: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 13 },
  switchSub: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2 },
});
