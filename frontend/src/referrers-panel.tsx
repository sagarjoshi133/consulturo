import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
  Alert,
  Linking,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { useAuth } from './auth';
import { COLORS, FONTS, RADIUS } from './theme';

type Referrer = {
  referrer_id: string;
  name: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  clinic?: string;
  speciality?: string;
  city?: string;
  notes?: string;
  surgery_count?: number;
};

const EMPTY: Omit<Referrer, 'referrer_id'> = {
  name: '',
  phone: '',
  whatsapp: '',
  email: '',
  clinic: '',
  speciality: '',
  city: '',
  notes: '',
};

export function ReferrersPanel() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const canDelete = isOwner || user?.role === 'doctor';

  const [items, setItems] = useState<Referrer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Referrer | null>(null);
  const [form, setForm] = useState<Omit<Referrer, 'referrer_id'>>(EMPTY);
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/referrers');
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY);
    setMode('form');
  };

  const openEdit = (r: Referrer) => {
    setEditing(r);
    setForm({
      name: r.name || '',
      phone: r.phone || '',
      whatsapp: r.whatsapp || '',
      email: r.email || '',
      clinic: r.clinic || '',
      speciality: r.speciality || '',
      city: r.city || '',
      notes: r.notes || '',
    });
    setMode('form');
  };

  const save = async () => {
    if (!form.name.trim()) {
      const msg = 'Name is required';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Missing', msg);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/referrers/${editing.referrer_id}`, form);
      } else {
        await api.post('/referrers', form);
      }
      setMode('list');
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: Referrer) => {
    const ok = Platform.OS === 'web'
      ? window.confirm(`Delete "${r.name}"?`)
      : await new Promise<boolean>((res) =>
          Alert.alert('Delete', `Delete "${r.name}"?`, [
            { text: 'Cancel', onPress: () => res(false), style: 'cancel' },
            { text: 'Delete', onPress: () => res(true), style: 'destructive' },
          ])
        );
    if (!ok) return;
    try {
      await api.delete(`/referrers/${r.referrer_id}`);
      await load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not delete';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Error', msg);
    }
  };

  const openTel = (p?: string) => p && Linking.openURL(`tel:${p.replace(/\D/g, '')}`);
  const openWa = (p?: string) => {
    if (!p) return;
    const digits = p.replace(/\D/g, '');
    Linking.openURL(`https://wa.me/${digits}`);
  };
  const openMail = (e?: string) => e && Linking.openURL(`mailto:${e}`);

  const filtered = items.filter((r) => {
    if (!q.trim()) return true;
    const n = q.trim().toLowerCase();
    return (
      r.name?.toLowerCase().includes(n) ||
      r.phone?.toLowerCase().includes(n) ||
      r.email?.toLowerCase().includes(n) ||
      r.clinic?.toLowerCase().includes(n) ||
      r.speciality?.toLowerCase().includes(n) ||
      r.city?.toLowerCase().includes(n)
    );
  });

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;

  if (mode === 'form') {
    return (
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={() => setMode('list')} style={styles.cancelBtn} testID="ref-cancel">
            <Ionicons name="close" size={18} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>{editing ? 'Edit referrer' : 'New referrer'}</Text>
        </View>

        <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} testID="ref-name" />
        <Row>
          <Field label="Phone" value={form.phone || ''} onChange={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="ref-phone" />
          <Field label="WhatsApp" value={form.whatsapp || ''} onChange={(v) => setForm({ ...form, whatsapp: v })} keyboardType="phone-pad" testID="ref-whatsapp" />
        </Row>
        <Field label="Email" value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} keyboardType="email-address" testID="ref-email" />
        <Row>
          <Field label="Clinic / Hospital" value={form.clinic || ''} onChange={(v) => setForm({ ...form, clinic: v })} testID="ref-clinic" />
          <Field label="City" value={form.city || ''} onChange={(v) => setForm({ ...form, city: v })} testID="ref-city" />
        </Row>
        <Field label="Speciality" value={form.speciality || ''} onChange={(v) => setForm({ ...form, speciality: v })} placeholder="e.g. GP, Physician, Nephrologist" testID="ref-speciality" />
        <Field
          label="Notes"
          value={form.notes || ''}
          onChange={(v) => setForm({ ...form, notes: v })}
          multiline
          testID="ref-notes"
        />

        <TouchableOpacity onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="ref-save">
          {saving ? <ActivityIndicator color="#fff" /> : (
            <>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.saveText}>{editing ? 'Save changes' : 'Add referrer'}</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name, phone, clinic…"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.searchInput}
            testID="ref-search"
          />
        </View>
        <TouchableOpacity onPress={openNew} style={styles.addBtn} testID="ref-add">
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>{filtered.length} {filtered.length === 1 ? 'referrer' : 'referrers'}</Text>

      {filtered.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={28} color={COLORS.textDisabled} />
          <Text style={styles.emptyText}>
            {items.length === 0 ? 'No referring doctors yet.\nTap + to add the first one.' : 'No matches for your search.'}
          </Text>
        </View>
      )}

      {filtered.map((r) => (
        <View key={r.referrer_id} style={styles.card} testID={`ref-card-${r.referrer_id}`}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{r.name}</Text>
              {!!r.speciality && <Text style={styles.sub}>{r.speciality}{r.clinic ? ` · ${r.clinic}` : ''}</Text>}
              {!r.speciality && !!r.clinic && <Text style={styles.sub}>{r.clinic}</Text>}
              {!!r.city && <Text style={styles.sub}>{r.city}</Text>}
              {(r.surgery_count || 0) > 0 && (
                <View style={styles.refCount}>
                  <Ionicons name="medkit" size={11} color={COLORS.primary} />
                  <Text style={styles.refCountText}>{r.surgery_count} referred surgeries</Text>
                </View>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <TouchableOpacity onPress={() => openEdit(r)} style={styles.iconBtn} testID={`ref-edit-${r.referrer_id}`}>
                <Ionicons name="pencil" size={14} color={COLORS.primary} />
              </TouchableOpacity>
              {canDelete && (
                <TouchableOpacity onPress={() => remove(r)} style={[styles.iconBtn, { borderColor: COLORS.accent + '55' }]} testID={`ref-del-${r.referrer_id}`}>
                  <Ionicons name="trash" size={14} color={COLORS.accent} />
                </TouchableOpacity>
              )}
            </View>
          </View>
          {!!r.notes && <Text style={styles.notes}>{r.notes}</Text>}
          <View style={styles.actionsRow}>
            {!!r.phone && (
              <TouchableOpacity style={styles.actionChip} onPress={() => openTel(r.phone)} testID={`ref-call-${r.referrer_id}`}>
                <Ionicons name="call" size={12} color={COLORS.success} />
                <Text style={[styles.actionText, { color: COLORS.success }]}>{r.phone}</Text>
              </TouchableOpacity>
            )}
            {!!(r.whatsapp || r.phone) && (
              <TouchableOpacity style={styles.actionChip} onPress={() => openWa(r.whatsapp || r.phone)} testID={`ref-wa-${r.referrer_id}`}>
                <Ionicons name="logo-whatsapp" size={12} color="#25D366" />
                <Text style={[styles.actionText, { color: '#25D366' }]}>WhatsApp</Text>
              </TouchableOpacity>
            )}
            {!!r.email && (
              <TouchableOpacity style={styles.actionChip} onPress={() => openMail(r.email)} testID={`ref-mail-${r.referrer_id}`}>
                <Ionicons name="mail" size={12} color={COLORS.primary} />
                <Text style={[styles.actionText, { color: COLORS.primary }]} numberOfLines={1}>{r.email}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{children}</View>;
}

function Field({
  label,
  value,
  onChange,
  multiline,
  keyboardType,
  placeholder,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  keyboardType?: any;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View style={{ flex: 1, marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 10 : 6, borderWidth: 1, borderColor: COLORS.border },
  searchInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, fontSize: 13, outlineWidth: 0 as any },
  addBtn: { backgroundColor: COLORS.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  countText: { ...FONTS.label, color: COLORS.textSecondary, textTransform: 'uppercase', marginBottom: 10, fontSize: 10 },

  empty: { padding: 24, alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  emptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center' },

  card: { backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  name: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  refCount: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, alignSelf: 'flex-start', backgroundColor: COLORS.primary + '14', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  refCountText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10 },
  notes: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#F3F7F7', borderRadius: RADIUS.pill, maxWidth: 220 },
  actionText: { ...FONTS.bodyMedium, fontSize: 10 },
  iconBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },

  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  cancelBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  title: { ...FONTS.h3, color: COLORS.textPrimary },
  label: { ...FONTS.label, color: COLORS.textSecondary, textTransform: 'uppercase', fontSize: 10, marginBottom: 4 },
  input: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, paddingVertical: 10, ...FONTS.body, color: COLORS.textPrimary, fontSize: 14 },
  saveBtn: { marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.pill },
  saveText: { color: '#fff', ...FONTS.h4, fontSize: 14 },
});
