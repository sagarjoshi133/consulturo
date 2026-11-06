/**
 * Branding → Centres.
 *
 * Owner manages the practice's physical centres (name, address, Google
 * Maps link, contact, and a "By prior confirmation only" toggle for
 * centres that don't take online slots). Stored in
 * clinic_settings.locations and consumed by the booking page (centre
 * picker + per-centre slots) and the public About page.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from './theme';
import api from './api';
import { clearClinicSettingsCache } from './clinic-settings';

type Centre = {
  id: string;
  name: string;
  address?: string;
  map_url?: string;
  phone?: string;
  whatsapp?: string;
  hours?: string;
  request_only?: boolean;
  active?: boolean;
  order?: number;
};

const newId = () => `loc-${Math.random().toString(36).slice(2, 9)}`;

export default function CentresSettingsPanel() {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/clinic-settings');
        setCentres(Array.isArray(data?.locations) ? data.locations : []);
      } catch { /* empty */ }
      finally { setLoading(false); }
    })();
  }, []);

  const persist = async (next: Centre[]) => {
    setCentres(next);
    setSaving(true);
    try {
      await api.patch('/clinic-settings', { locations: next.map((c, i) => ({ ...c, order: i })) });
      clearClinicSettingsCache();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Could not save. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const addCentre = () => {
    const c: Centre = { id: newId(), name: '', address: '', map_url: '', phone: '', whatsapp: '', request_only: false, active: true };
    persist([...centres, c]);
  };

  const update = (id: string, patch: Partial<Centre>) =>
    setCentres((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const commit = () => { void persist(centres); };

  const remove = (id: string) => {
    Alert.alert('Remove centre?', 'This centre will no longer appear for booking.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => persist(centres.filter((c) => c.id !== id)) },
    ]);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= centres.length) return;
    const next = [...centres];
    [next[idx], next[j]] = [next[j], next[idx]];
    persist(next);
  };

  if (loading) return <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 90 }} showsVerticalScrollIndicator={false}>
      <Text style={styles.intro}>
        Add the places where you consult. Patients pick a centre when booking In-Person; each centre
        shows slots from its own hours (set under Availability). Mark a centre "By prior confirmation
        only" to hide slots and ask patients to call/WhatsApp instead.
      </Text>

      {centres.map((c, idx) => (
        <View key={c.id} style={styles.card} testID={`centre-card-${c.id}`}>
          <View style={styles.cardTop}>
            <View style={styles.arrows}>
              <TouchableOpacity onPress={() => move(idx, -1)} disabled={idx === 0} style={styles.arrowBtn}>
                <Ionicons name="chevron-up" size={16} color={idx === 0 ? COLORS.textDisabled : COLORS.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => move(idx, 1)} disabled={idx === centres.length - 1} style={styles.arrowBtn}>
                <Ionicons name="chevron-down" size={16} color={idx === centres.length - 1 ? COLORS.textDisabled : COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.cardTitle} numberOfLines={1}>{c.name || 'New centre'}</Text>
            <TouchableOpacity onPress={() => remove(c.id)} style={styles.trashBtn} testID={`centre-remove-${c.id}`}>
              <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
            </TouchableOpacity>
          </View>

          <Field label="Centre name" value={c.name} onChangeText={(v) => update(c.id, { name: v })} onBlur={commit} placeholder="e.g. Shivansh Urology Centre" testID={`centre-name-${c.id}`} />
          <Field label="Address" value={c.address || ''} onChangeText={(v) => update(c.id, { address: v })} onBlur={commit} placeholder="Street, area, city" multiline />
          <Field label="Google Maps link" value={c.map_url || ''} onChangeText={(v) => update(c.id, { map_url: v })} onBlur={commit} placeholder="https://share.google/…" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Phone" value={c.phone || ''} onChangeText={(v) => update(c.id, { phone: v })} onBlur={commit} placeholder="+91…" /></View>
            <View style={{ flex: 1 }}><Field label="WhatsApp" value={c.whatsapp || ''} onChangeText={(v) => update(c.id, { whatsapp: v })} onBlur={commit} placeholder="+91…" /></View>
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>By prior confirmation only</Text>
              <Text style={styles.switchHint}>No online slots — patients call/WhatsApp to fix a time.</Text>
            </View>
            <Switch
              value={!!c.request_only}
              onValueChange={(v) => { update(c.id, { request_only: v }); setTimeout(commit, 0); }}
              trackColor={{ true: COLORS.primary }}
              testID={`centre-reqonly-${c.id}`}
            />
          </View>
        </View>
      ))}

      <TouchableOpacity onPress={addCentre} style={styles.addBtn} testID="centre-add">
        <Ionicons name="add-circle" size={18} color={COLORS.primary} />
        <Text style={styles.addBtnTxt}>Add centre</Text>
      </TouchableOpacity>

      <Text style={styles.foot}>Changes save automatically{saving ? ' · saving…' : ' ✓'}. Set each centre's hours in Settings → Availability.</Text>
    </ScrollView>
  );
}

function Field({ label, ...props }: any) {
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, props.multiline && { minHeight: 56, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  card: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 12, marginBottom: 14, backgroundColor: '#fff' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  arrows: { flexDirection: 'column' },
  arrowBtn: { width: 26, height: 18, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  trashBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 10 : 7, fontSize: 13, color: COLORS.textPrimary, backgroundColor: '#FCFEFE' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: COLORS.border },
  switchLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  switchHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 15 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: COLORS.primary, borderStyle: 'dashed', borderRadius: RADIUS.md, paddingVertical: 14 },
  addBtnTxt: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 14 },
  foot: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginTop: 12, lineHeight: 17 },
});
