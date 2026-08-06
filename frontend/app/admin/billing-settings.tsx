/**
 * /admin/billing-settings — Owner-only screen for editing the clinic's
 * default fee catalogue. Drives:
 *   • Patient-side "Pay" buttons (consultation, IPD).
 *   • Receipt builder line items (the "Add from catalogue" picker).
 *
 * Stored in `clinic_settings.fee_catalog` — an array of
 *   { id, category, name, amount_inr, gst_pct?, description?, archived? }.
 *
 * Categories: consultation | surgery | procedure | investigation | misc.
 * Default fees: consultation_fee_inr, ipd_advance_inr (top-level keys,
 * kept for back-compat with the PayButton helpers).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import api from '../../src/api';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { clearClinicSettingsCache } from '../../src/clinic-settings';
import PermissionGate from '../../src/permission-gate';
import { useAuth } from '../../src/auth';

type Fee = {
  id: string;
  category: 'consultation' | 'surgery' | 'procedure' | 'investigation' | 'misc';
  name: string;
  amount_inr: number;
  gst_pct?: number;
  description?: string;
  archived?: boolean;
};

const CATEGORIES: Array<{ key: Fee['category']; label: string; icon: any }> = [
  { key: 'consultation', label: 'Consultations', icon: 'medkit' },
  { key: 'surgery', label: 'Surgeries', icon: 'cut' },
  { key: 'procedure', label: 'Procedures', icon: 'pulse' },
  { key: 'investigation', label: 'Investigations', icon: 'flask' },
  { key: 'misc', label: 'Misc', icon: 'cash' },
];

export default function BillingSettings() {
  return (
    <PermissionGate require="can_manage_settings" title="Billing Settings">
      <BillingSettingsInner />
    </PermissionGate>
  );
}

function BillingSettingsInner() {
  const router = useRouter();
  const { user } = useAuth() as any;
  const role = (user?.role || '') as string;
  const isOwnerTier = ['super_owner', 'primary_owner', 'partner', 'owner'].includes(role);
  const canEdit = isOwnerTier
    || !!user?.dashboard_full_access
    || !!user?.can_manage_settings;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Fee['category']>('consultation');
  const [feeCatalog, setFeeCatalog] = useState<Fee[]>([]);
  const [defaults, setDefaults] = useState({
    consultation_fee_inr: 500,
    follow_up_fee_inr: 300,
    video_consultation_fee_inr: 500,
    ipd_advance_inr: 5000,
    billing_gst_pct_default: 0,
    payments_enabled: true,
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/clinic-settings');
        const cat: Fee[] = Array.isArray(data.fee_catalog) ? data.fee_catalog : [];
        setFeeCatalog(cat);
        setDefaults({
          consultation_fee_inr: Number(data.consultation_fee_inr ?? 500),
          follow_up_fee_inr: Number(data.follow_up_fee_inr ?? 300),
          video_consultation_fee_inr: Number(data.video_consultation_fee_inr ?? 500),
          ipd_advance_inr: Number(data.ipd_advance_inr ?? 5000),
          billing_gst_pct_default: Number(data.billing_gst_pct_default ?? 0),
          payments_enabled: data.payments_enabled !== false,
        });
      } catch (e: any) {
        showErr(e?.response?.data?.detail || 'Could not load settings.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(
    () => feeCatalog.filter((f) => f.category === tab && !f.archived),
    [feeCatalog, tab],
  );

  const updateFee = (id: string, patch: Partial<Fee>) => {
    setFeeCatalog((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setDirty(true);
  };

  const addFee = () => {
    const id = `fee-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setFeeCatalog((prev) => [
      ...prev,
      { id, category: tab, name: '', amount_inr: 0, gst_pct: defaults.billing_gst_pct_default },
    ]);
    setDirty(true);
  };

  const removeFee = (id: string) => {
    const proceed = () => {
      setFeeCatalog((prev) => prev.filter((f) => f.id !== id));
      setDirty(true);
    };
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm('Remove this fee from the catalogue?')) proceed();
      return;
    }
    Alert.alert('Remove fee?', 'This fee will be removed from the catalogue.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: proceed },
    ]);
  };

  const save = async () => {
    // Sanity: drop blank-name rows before persisting and coerce amounts.
    const cleaned = feeCatalog
      .filter((f) => (f.name || '').trim().length > 0)
      .map((f) => ({
        ...f,
        name: f.name.trim(),
        amount_inr: Number(f.amount_inr) || 0,
        gst_pct: Number(f.gst_pct ?? 0) || 0,
      }));
    setSaving(true);
    try {
      await api.patch('/clinic-settings', {
        ...defaults,
        fee_catalog: cleaned,
      });
      setFeeCatalog(cleaned);
      setDirty(false);
      clearClinicSettingsCache();
      showInfo('Billing settings saved.');
    } catch (e: any) {
      showErr(e?.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => {
    try {
      if ((router as any).canGoBack && (router as any).canGoBack()) router.back();
      else router.replace('/(tabs)/more' as any);
    } catch { router.replace('/' as any); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <TopBar onBack={goBack} title="Billing Settings" />
        <View style={styles.centered}><ActivityIndicator color={COLORS.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <TopBar onBack={goBack} title="Billing Settings" rightLabel={dirty ? 'Unsaved' : undefined} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {/* Quick defaults card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Quick defaults</Text>
            <Text style={styles.cardSub}>Used by the patient app's Pay buttons when no specific fee is selected.</Text>
            <NumField
              label="Consultation fee (₹)"
              value={defaults.consultation_fee_inr}
              onChange={(v) => { setDefaults({ ...defaults, consultation_fee_inr: v }); setDirty(true); }}
            />
            <NumField
              label="Follow-up fee (₹)"
              value={defaults.follow_up_fee_inr}
              onChange={(v) => { setDefaults({ ...defaults, follow_up_fee_inr: v }); setDirty(true); }}
            />
            <NumField
              label="Video consultation fee (₹)"
              value={defaults.video_consultation_fee_inr}
              onChange={(v) => { setDefaults({ ...defaults, video_consultation_fee_inr: v }); setDirty(true); }}
            />
            <NumField
              label="IPD advance (₹)"
              value={defaults.ipd_advance_inr}
              onChange={(v) => { setDefaults({ ...defaults, ipd_advance_inr: v }); setDirty(true); }}
            />
            <NumField
              label="Default GST percent"
              value={defaults.billing_gst_pct_default}
              suffix="%"
              onChange={(v) => { setDefaults({ ...defaults, billing_gst_pct_default: v }); setDirty(true); }}
            />
          </View>

          {/* Category tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingVertical: 8, paddingHorizontal: 2 }}
          >
            {CATEGORIES.map((c) => {
              const isActive = c.key === tab;
              const count = feeCatalog.filter((f) => f.category === c.key && !f.archived).length;
              return (
                <TouchableOpacity
                  key={c.key}
                  onPress={() => setTab(c.key)}
                  style={[styles.tab, isActive && styles.tabActive]}
                  testID={`billing-tab-${c.key}`}
                >
                  <Ionicons name={c.icon} size={14} color={isActive ? '#fff' : COLORS.primary} />
                  <Text style={[styles.tabText, isActive && { color: '#fff' }]}>{c.label} · {count}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Fee list */}
          <View style={{ marginTop: 8 }}>
            {filtered.length === 0 ? (
              <View style={styles.emptyCard}>
                <Ionicons name="cash-outline" size={36} color={COLORS.textDisabled} />
                <Text style={styles.emptyTitle}>No fees yet</Text>
                <Text style={styles.emptySub}>Tap "Add fee" to create your first {tab} fee.</Text>
              </View>
            ) : (
              filtered.map((f) => (
                <FeeRow
                  key={f.id}
                  fee={f}
                  onChange={(p) => updateFee(f.id, p)}
                  onDelete={() => removeFee(f.id)}
                />
              ))
            )}

            <TouchableOpacity style={styles.addBtn} onPress={addFee} testID="billing-add-fee">
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Add {CATEGORIES.find((x) => x.key === tab)?.label.slice(0, -1).toLowerCase()} fee</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Sticky save bar */}
        <View style={styles.stickyBar}>
          <TouchableOpacity
            onPress={save}
            disabled={!dirty || saving}
            style={[styles.saveBtn, (!dirty || saving) && styles.saveBtnDisabled]}
            testID="billing-save"
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.saveBtnText}>{dirty ? 'Save changes' : 'No changes'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function showInfo(msg: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
  else Alert.alert('Saved', msg);
}
function showErr(msg: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') window.alert(msg);
  else Alert.alert('Error', msg);
}

function TopBar({ onBack, title, rightLabel }: { onBack: () => void; title: string; rightLabel?: string }) {
  return (
    <View style={styles.bar}>
      <TouchableOpacity onPress={onBack} style={styles.barBack} testID="billing-back">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.barTitle}>{title}</Text>
      {rightLabel ? (
        <View style={styles.dirtyPill}>
          <Text style={styles.dirtyPillText}>{rightLabel}</Text>
        </View>
      ) : <View style={{ width: 40 }} />}
    </View>
  );
}

function NumField({
  label,
  value,
  onChange,
  suffix,
}: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.numInputWrap}>
        <TextInput
          value={String(value ?? '')}
          onChangeText={(t) => onChange(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
          keyboardType="numeric"
          style={styles.numInput}
          placeholder="0"
        />
        {suffix ? <Text style={styles.numSuffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function FeeRow({
  fee,
  onChange,
  onDelete,
}: {
  fee: Fee;
  onChange: (p: Partial<Fee>) => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.feeRow}>
      <View style={{ flex: 1, gap: 6 }}>
        <TextInput
          value={fee.name}
          onChangeText={(t) => onChange({ name: t })}
          placeholder="Fee name (e.g. New consultation)"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.feeNameInput}
        />
        <TextInput
          value={fee.description || ''}
          onChangeText={(t) => onChange({ description: t })}
          placeholder="Optional note (shown on receipts)"
          placeholderTextColor={COLORS.textDisabled}
          style={styles.feeDescInput}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={[styles.feePill, { flex: 1 }]}>
            <Text style={styles.feePillLabel}>₹ Amount</Text>
            <TextInput
              value={String(fee.amount_inr ?? '')}
              onChangeText={(t) => onChange({ amount_inr: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 })}
              keyboardType="numeric"
              style={styles.feePillInput}
            />
          </View>
          <View style={[styles.feePill, { width: 92 }]}>
            <Text style={styles.feePillLabel}>GST %</Text>
            <TextInput
              value={String(fee.gst_pct ?? '')}
              onChangeText={(t) => onChange({ gst_pct: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 })}
              keyboardType="numeric"
              style={styles.feePillInput}
            />
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={onDelete} style={styles.deleteBtn} testID={`billing-delete-${fee.id}`}>
        <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  barBack: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  barTitle: { ...FONTS.h4, color: COLORS.textPrimary, flex: 1, textAlign: 'center' },
  dirtyPill: { backgroundColor: COLORS.warning + '22', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  dirtyPillText: { ...FONTS.label, color: COLORS.warning, fontSize: 11 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  cardSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2, marginBottom: 10 },
  field: { marginTop: 10 },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginBottom: 6 },
  numInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12 },
  numInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, paddingVertical: 10, fontSize: 14 },
  numSuffix: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },

  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  feeRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fff', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12, marginBottom: 10,
  },
  feeNameInput: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, backgroundColor: COLORS.bg, paddingHorizontal: 10, paddingVertical: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  feeDescInput: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, backgroundColor: COLORS.bg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  feePill: {
    backgroundColor: COLORS.bg,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  feePillLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 9 },
  feePillInput: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginTop: 2, paddingVertical: 0 },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.accent + '12',
  },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.primary,
    alignSelf: 'center', marginTop: 8,
  },
  addBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  emptyCard: { alignItems: 'center', padding: 30, backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  emptyTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginTop: 10, fontSize: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12, textAlign: 'center' },

  stickyBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  saveBtn: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  saveBtnDisabled: { backgroundColor: COLORS.textDisabled },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
