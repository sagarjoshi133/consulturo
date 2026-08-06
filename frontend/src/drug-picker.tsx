/**
 * DrugPicker — Phase 5.29.
 *
 * Auto-complete dropdown into the clinic-wide Drug Repository.
 * Used by:
 *   • The IPD Medications tab (admission detail) — pick a drug to add
 *     to the chart with one-tap dose/route/freq defaults
 *   • (Future) the OPD prescription composer
 *
 * On select, the callback receives the full repo entry so the caller
 * can pre-fill its own form. Owner-tier users see an inline
 * "Custom drug…" row at the bottom of the suggestions.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

export type RepoDrug = {
  drug_id: string;
  name: string;
  category: string;
  form: string;
  is_injectable: boolean;
  default_strength?: string | null;
  default_dose?: string | null;
  default_frequency?: string | null;
  default_route?: string | null;
  default_duration?: string | null;
  brands?: string[];
  notes?: string | null;
  custom?: boolean;
};

const FORM_ICON: Record<string, any> = {
  tablet: 'tablet-portrait-outline',
  capsule: 'medical',
  injection: 'medkit',
  iv_fluid: 'water',
  syrup: 'beaker',
  topical: 'hand-left-outline',
  drop: 'eyedrop-outline',
  spray: 'cloud-outline',
  inhaler: 'cloud-outline',
};

export default function DrugPicker({
  onPick,
  placeholder = 'Search drug name or brand…',
  testID,
  initialCategory,
  initialForm,
}: {
  onPick: (d: RepoDrug) => void;
  placeholder?: string;
  testID?: string;
  initialCategory?: string;
  initialForm?: string;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<RepoDrug[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(initialCategory || null);
  const [form, setForm] = useState<string | null>(initialForm || null);
  const [categories, setCategories] = useState<string[]>([]);
  const debounceRef = useRef<any>(null);

  // Pull category list once for chip filtering.
  useEffect(() => {
    api.get('/drug-repository/categories')
      .then((r) => setCategories(r.data?.all_categories || []))
      .catch(() => setCategories([]));
  }, []);

  const fetchResults = useCallback(async (term: string, cat: string | null, frm: string | null) => {
    setLoading(true);
    try {
      const params: any = { limit: 30 };
      if (term.trim()) params.q = term.trim();
      if (cat) params.category = cat;
      if (frm) params.form = frm;
      const r = await api.get('/drug-repository', { params });
      setResults((r.data?.items || []) as RepoDrug[]);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!open) return;
    debounceRef.current = setTimeout(() => {
      void fetchResults(q, category, form);
    }, q ? 220 : 0);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q, category, form, open, fetchResults]);

  const handleSelect = (d: RepoDrug) => {
    onPick(d);
    setQ('');
    setOpen(false);
    setResults([]);
  };

  const formChips = ['tablet', 'capsule', 'injection', 'iv_fluid', 'syrup'];

  return (
    <View style={styles.wrap}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={COLORS.textSecondary} style={{ marginLeft: 10 }} />
        <TextInput
          value={q}
          onChangeText={(v) => { setQ(v); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textSecondary}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          testID={testID}
        />
        {q ? (
          <TouchableOpacity onPress={() => { setQ(''); setResults([]); }} hitSlop={10} style={{ padding: 8 }}>
            <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {open ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6, gap: 6 }}>
            <Chip label="All" active={!category} onPress={() => setCategory(null)} />
            {categories.slice(0, 12).map((c) => (
              <Chip key={c} label={c} active={category === c} onPress={() => setCategory(category === c ? null : c)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6, gap: 6 }}>
            <Chip label="Any form" active={!form} onPress={() => setForm(null)} small />
            {formChips.map((f) => (
              <Chip key={f} label={f.replace('_', ' ')} active={form === f} onPress={() => setForm(form === f ? null : f)} small />
            ))}
          </ScrollView>

          <View style={styles.dropdown}>
            {loading ? (
              <View style={{ padding: 14, alignItems: 'center' }}>
                <ActivityIndicator color={COLORS.primary} size="small" />
              </View>
            ) : results.length === 0 ? (
              <Text style={styles.empty}>
                {q ? 'No matches. Tap "Custom drug" below to add a new one.' : 'Type to search the drug repository.'}
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 320 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {results.map((d) => (
                  <TouchableOpacity
                    key={d.drug_id + '-' + d.form}
                    onPress={() => handleSelect(d)}
                    style={styles.row}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.iconBubble, { backgroundColor: d.is_injectable ? '#FEE2E2' : '#E0F2FE' }]}>
                      <Ionicons
                        name={FORM_ICON[d.form] || 'medical'}
                        size={16}
                        color={d.is_injectable ? '#DC2626' : '#0284C7'}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                        <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                        {d.default_strength ? <Text style={styles.strength}>{d.default_strength}</Text> : null}
                      </View>
                      <Text style={styles.meta} numberOfLines={1}>
                        {d.category}
                        {d.default_route ? ` · ${d.default_route}` : ''}
                        {d.default_frequency ? ` · ${d.default_frequency}` : ''}
                      </Text>
                      {d.brands && d.brands.length ? (
                        <Text style={styles.brands} numberOfLines={1}>
                          {d.brands.slice(0, 3).join(' · ')}{d.brands.length > 3 ? ` +${d.brands.length - 3}` : ''}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Chip({ label, active, onPress, small }: { label: string; active: boolean; onPress: () => void; small?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        small && { paddingVertical: 4, paddingHorizontal: 8 },
        active && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
      ]}
      activeOpacity={0.85}
    >
      <Text style={[styles.chipText, small && { fontSize: 11 }, active && { color: '#fff' }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F3F7F8', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border, height: 42,
  },
  input: {
    flex: 1, height: 42, paddingHorizontal: 10,
    fontFamily: FONTS.regular, fontSize: 14, color: COLORS.textPrimary,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 16, borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  chipText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  dropdown: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md, marginTop: 6,
  },
  empty: { padding: 14, color: COLORS.textSecondary, fontFamily: FONTS.regular, fontSize: 12.5, textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border,
  },
  iconBubble: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { color: COLORS.textPrimary, fontFamily: FONTS.bold, fontWeight: '700', fontSize: 13.5, flexShrink: 1 },
  strength: { color: COLORS.primary, fontSize: 11.5, fontWeight: '700' },
  meta: { color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  brands: { color: '#4B5563', fontSize: 11, marginTop: 1, fontStyle: 'italic' },
});
