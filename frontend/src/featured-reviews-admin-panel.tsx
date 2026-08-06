/**
 * FeaturedReviewsAdminPanel — Primary owner curates the 5-10 reviews
 * that appear on the patient home carousel + /reviews route +
 * prescription PDF footer (CTA + QR).
 *
 * Features:
 *   • Toggle: master enable for the homepage carousel.
 *   • Add new review (form: name, rating, text, date, location, source).
 *   • Edit / delete existing rows.
 *   • Toggle `featured` per row.
 *   • Drag-handle-less "Move up / Move down" buttons (good enough MVP).
 *   • Preview card matches the patient-facing card.
 *   • Auto-pull placeholder — disabled until user supplies the
 *     Google Places API key.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { useToast } from './toast';
import { ISODateField } from './date-picker';

type Review = {
  id: string;
  reviewer_name: string;
  reviewer_avatar_url?: string | null;
  rating: number;
  text: string;
  source?: string;
  review_date?: string;
  featured?: boolean;
  sort_order?: number;
  location?: string | null;
};

type Settings = {
  featured_reviews_enabled?: boolean;
  google_places_api_key_set?: boolean;
  google_places_place_id?: string;
};

const EMPTY_FORM: Partial<Review> = {
  reviewer_name: '',
  rating: 5,
  text: '',
  review_date: '',
  location: '',
  source: 'google',
  featured: true,
};

export default function FeaturedReviewsAdminPanel() {
  const toast = useToast();
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>({});
  const [editing, setEditing] = useState<Review | null>(null);
  const [form, setForm] = useState<Partial<Review>>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        api.get('/featured-reviews/all'),
        api.get('/clinic-settings'),
      ]);
      setRows(r.data?.items || []);
      setSettings(s.data || {});
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not load reviews.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const toggleMasterSwitch = useCallback(async (v: boolean) => {
    setSettings((s) => ({ ...s, featured_reviews_enabled: v }));
    try {
      await api.patch('/clinic-settings', { featured_reviews_enabled: v });
      toast.success(v ? 'Reviews carousel ON.' : 'Reviews carousel OFF.');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed.');
      await load();
    }
  }, [toast, load]);

  const startEdit = useCallback((r: Review | null) => {
    setEditing(r);
    setForm(r ? { ...r } : { ...EMPTY_FORM });
    setShowForm(true);
  }, []);

  const saveForm = useCallback(async () => {
    if (!form.reviewer_name?.trim() || !form.text?.trim()) {
      Alert.alert('Required', 'Reviewer name and text are required.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/featured-reviews/${editing.id}`, form);
        toast.success('Updated.');
      } else {
        await api.post('/featured-reviews', form);
        toast.success('Added.');
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Unknown error');
    } finally {
      setSaving(false);
    }
  }, [form, editing, toast, load]);

  const deleteRow = useCallback(async (r: Review) => {
    // Cross-platform confirm. React Native's `Alert.alert` is
    // unreliable on react-native-web (Vercel deployment) — it shows
    // the dialog but the destructive button's onPress never fires on
    // some browsers. Falling back to the browser's native
    // `window.confirm` on web keeps the UX identical and actually
    // wires up the delete on every platform.
    const doDelete = async () => {
      try {
        await api.delete(`/featured-reviews/${r.id}`);
        await load();
        toast.success(`Removed "${r.reviewer_name}"'s review.`);
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Delete failed.');
      }
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(`Delete "${r.reviewer_name}"'s review? This cannot be undone.`)
        : true;
      if (ok) await doDelete();
      return;
    }
    Alert.alert('Delete review?', `Remove "${r.reviewer_name}"'s review?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doDelete },
    ]);
  }, [load, toast]);

  const toggleFeatured = useCallback(async (r: Review) => {
    try {
      await api.patch(`/featured-reviews/${r.id}`, { featured: !r.featured });
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Update failed.');
    }
  }, [load, toast]);

  const move = useCallback(async (r: Review, direction: 'up' | 'down') => {
    const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = sorted.findIndex((x) => x.id === r.id);
    if (idx < 0) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    [sorted[idx], sorted[swapIdx]] = [sorted[swapIdx], sorted[idx]];
    try {
      await api.post('/featured-reviews/reorder', { ids: sorted.map((x) => x.id) });
      await load();
    } catch (e: any) {
      toast.error('Reorder failed.');
    }
  }, [rows, load, toast]);

  if (loading) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Hero */}
      <LinearGradient colors={['#fffbeb', '#fef3c7']} style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <FontAwesome name="quote-left" size={20} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Featured Patient Reviews</Text>
          <Text style={styles.heroSub}>
            Curate the 5-10 reviews shown on the patient home, /reviews page, and prescription PDFs.
          </Text>
        </View>
      </LinearGradient>

      {/* Master toggle */}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Show carousel on patient home</Text>
          <Text style={styles.helper}>
            When ON, “featured” reviews appear on the home page above Common Conditions.
          </Text>
        </View>
        <Switch
          value={!!settings.featured_reviews_enabled}
          onValueChange={toggleMasterSwitch}
          trackColor={{ true: COLORS.primary, false: '#cbd5e1' }}
          testID="featured-reviews-toggle"
        />
      </View>

      {/* Add button */}
      {!showForm ? (
        <TouchableOpacity style={styles.addBtn} onPress={() => startEdit(null)} testID="featured-reviews-add">
          <Ionicons name="add-circle" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add a review</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{editing ? 'Edit review' : 'Add review'}</Text>
          <Text style={styles.fieldLabel}>Reviewer name *</Text>
          <TextInput
            style={styles.input}
            value={form.reviewer_name || ''}
            placeholder="e.g. Priya Sharma"
            placeholderTextColor={COLORS.textTertiary}
            onChangeText={(t) => setForm((f) => ({ ...f, reviewer_name: t }))}
          />
          <Text style={styles.fieldLabel}>Review text *</Text>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            multiline
            value={form.text || ''}
            placeholder="Their kind words…"
            placeholderTextColor={COLORS.textTertiary}
            onChangeText={(t) => setForm((f) => ({ ...f, text: t }))}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Rating</Text>
              <View style={styles.starPickRow}>
                {[1, 2, 3, 4, 5].map((s) => (
                  <TouchableOpacity key={s} onPress={() => setForm((f) => ({ ...f, rating: s }))}>
                    <FontAwesome name="star" size={22} color={s <= (form.rating || 5) ? '#f59e0b' : '#fef3c7'} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Date</Text>
              <ISODateField
                value={form.review_date || ''}
                onChange={(v) => setForm((f) => ({ ...f, review_date: v }))}
                placeholder="DD-MM-YYYY"
                maximumDate={new Date()}
              />
            </View>
          </View>
          <Text style={styles.fieldLabel}>Location (optional)</Text>
          <TextInput
            style={styles.input}
            value={form.location || ''}
            placeholder="e.g. Vadodara"
            placeholderTextColor={COLORS.textTertiary}
            onChangeText={(t) => setForm((f) => ({ ...f, location: t }))}
          />
          <Text style={styles.fieldLabel}>Avatar URL (optional, leave blank for initials)</Text>
          <TextInput
            style={styles.input}
            value={form.reviewer_avatar_url || ''}
            placeholder="https://… or data:image/png;base64,…"
            placeholderTextColor={COLORS.textTertiary}
            autoCapitalize="none"
            onChangeText={(t) => setForm((f) => ({ ...f, reviewer_avatar_url: t }))}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={[styles.btnPrimary, saving && { opacity: 0.6 }]} onPress={saveForm} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
              <Text style={styles.btnPrimaryText}>{editing ? 'Update' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnSecondary} onPress={() => { setShowForm(false); setEditing(null); }}>
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Reviews list */}
      <Text style={[styles.label, { marginTop: 18 }]}>All reviews ({rows.length})</Text>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No reviews yet. Add your first one above ☝️</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((r, i) => (
            <View key={r.id} style={[styles.rowCard, !r.featured && { opacity: 0.6 }]}>
              <View style={styles.rowHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.rowName}>{r.reviewer_name}</Text>
                  <View style={{ flexDirection: 'row' }}>
                    {Array.from({ length: r.rating || 5 }).map((_, j) => (
                      <FontAwesome key={j} name="star" size={11} color="#f59e0b" />
                    ))}
                  </View>
                </View>
                <Switch
                  value={!!r.featured}
                  onValueChange={() => toggleFeatured(r)}
                  trackColor={{ true: '#f59e0b', false: '#cbd5e1' }}
                />
              </View>
              <Text style={styles.rowText} numberOfLines={2}>{r.text}</Text>
              <View style={styles.rowFooter}>
                <Text style={styles.rowMeta}>
                  {r.review_date ? r.review_date : '—'}
                  {r.location ? ` · ${r.location}` : ''}
                  {' · '}
                  <Text style={styles.rowSource}>{(r.source || 'manual').toUpperCase()}</Text>
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => move(r, 'up')} disabled={i === 0}>
                    <Ionicons name="arrow-up" size={12} color={i === 0 ? '#cbd5e1' : COLORS.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => move(r, 'down')} disabled={i === rows.length - 1}>
                    <Ionicons name="arrow-down" size={12} color={i === rows.length - 1 ? '#cbd5e1' : COLORS.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.miniBtn} onPress={() => startEdit(r)}>
                    <Ionicons name="create" size={12} color={COLORS.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.miniBtn, { backgroundColor: '#fee2e2' }]} onPress={() => deleteRow(r)}>
                    <Ionicons name="trash" size={12} color="#dc2626" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Google Auto-pull — LIVE since June 2026. Routes the owner
          to the Reviews tab where the GooglePlacesBlock provides
          API key / Place ID management + "Pull now" trigger. */}
      <View style={[styles.autopullCard, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.autopullTitle, { color: '#065f46' }]}>Auto-pull from Google — Live</Text>
          <Text style={[styles.autopullSub, { color: '#047857' }]}>
            {settings.google_places_api_key_set
              ? 'Active. New Google reviews auto-sync every 6h and appear newest-first on the patient carousel.'
              : 'Open the Reviews tab to add your Google Places API key + Place ID, then tap "Pull Google reviews now".'}
          </Text>
        </View>
        <View style={[styles.autopullBadge, { backgroundColor: '#22c55e' }]}>
          <Text style={styles.autopullBadgeText}>LIVE</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    flexDirection: 'row', gap: 12, alignItems: 'center',
    padding: 14, borderRadius: RADIUS.card, borderWidth: 1, borderColor: '#fcd34d',
    marginBottom: 14,
  },
  heroIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f59e0b', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...FONTS.h3, color: '#7c2d12', fontSize: 15 },
  heroSub: { ...FONTS.body, color: '#9a3412', marginTop: 4, fontSize: 12, lineHeight: 17 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  label: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginBottom: 6 },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginBottom: 4, lineHeight: 16 },

  addBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary, paddingVertical: 11, borderRadius: RADIUS.button, marginTop: 8,
  },
  addBtnText: { color: '#fff', fontWeight: '700' },

  formCard: { backgroundColor: '#f8fafc', padding: 12, borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border, marginTop: 8 },
  formTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginBottom: 6, fontSize: 15 },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 8, marginBottom: 4, fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    backgroundColor: '#fff', color: COLORS.textPrimary, fontSize: 13.5,
  },
  starPickRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 6 },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 16, borderRadius: RADIUS.button, flex: 1,
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
  btnSecondary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: RADIUS.button, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  btnSecondaryText: { color: COLORS.textPrimary, fontWeight: '600' },

  empty: { color: COLORS.textSecondary, fontSize: 12.5, padding: 12, textAlign: 'center' },
  rowCard: { padding: 10, backgroundColor: '#fff', borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  rowText: { color: COLORS.textSecondary, fontSize: 12.5, marginTop: 4, lineHeight: 18 },
  rowFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  rowMeta: { color: COLORS.textTertiary, fontSize: 10.5 },
  rowSource: { color: COLORS.primary, fontWeight: '700' },
  miniBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e0f2fe' },

  autopullCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, marginTop: 16, backgroundColor: '#f1f5f9', borderRadius: RADIUS.card, borderWidth: 1, borderColor: COLORS.border,
  },
  autopullTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  autopullSub: { color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  autopullBadge: { paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fef3c7', borderRadius: 999 },
  autopullBadgeText: { fontSize: 10, fontWeight: '800', color: '#92400e' },
});
