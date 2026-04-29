/**
 * MedicineAutocomplete — specialized picker for the Rx composer.
 *
 * As the doctor types a medicine name, a dropdown surfaces matching
 * entries from /api/medicines/catalog (curated seed + clinic custom).
 * Selecting a suggestion AUTOFILLS not just the name, but also dosage,
 * frequency, duration, timing, and instructions — saving many keystrokes
 * for routine prescribing.
 *
 * Callers receive a fully-populated Medicine object via `onSelect`
 * and a raw text callback via `onChangeText` for free-typing.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';

export type CatalogMedicine = {
  name: string;            // canonical generic + strength (e.g. "Tamsulosin 0.4 mg")
  display_name?: string;   // "Brandname (Generic name)" — what the UI shows
  brand?: string;          // selected brand for display_name
  generic?: string;
  category?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  timing?: string;
  instructions?: string;
  brands?: string[];
  source?: 'seed' | 'custom';
};

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  onSelect: (m: CatalogMedicine) => void;
  placeholder?: string;
  testID?: string;
  /** If autofill is enabled, selecting a suggestion calls onSelect with the
   * full object so the caller can populate dosage/freq/etc. fields. */
  autofill?: boolean;
};

export function MedicineAutocomplete({
  value,
  onChangeText,
  onSelect,
  placeholder = 'e.g. Tamsulosin 0.4 mg',
  testID,
  autofill = true,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<CatalogMedicine[]>([]);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastReqId = useRef(0);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (!focused || dismissed) return;
    const q = value.trim();
    // Show top-of-catalog when focused-but-empty, and filtered otherwise.
    const reqId = ++lastReqId.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/medicines/catalog', {
          params: { q: q || undefined, limit: 10 },
        });
        if (reqId !== lastReqId.current) return;
        // Hide rows whose display_name (brand+generic) already matches
        // the current input verbatim — nothing left to pick.
        const filtered: CatalogMedicine[] = (data || []).filter(
          (m: CatalogMedicine) => {
            const dn = (m.display_name || m.name || '').toLowerCase();
            return dn !== q.toLowerCase();
          },
        );
        setItems(filtered);
      } catch {
        setItems([]);
      } finally {
        if (reqId === lastReqId.current) setLoading(false);
      }
    }, 180);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [value, focused, dismissed]);

  const commit = (m: CatalogMedicine) => {
    // Always commit the "Brandname (Generic name)" string so the
    // printed prescription, the form field, AND any later edits
    // share the same display format. Falls back to the bare generic
    // name when no brand is configured.
    const out = m.display_name || m.name;
    onChangeText(out);
    if (autofill) onSelect({ ...m, name: out });
    setItems([]);
    setDismissed(true);
    if (Platform.OS !== 'web') Keyboard.dismiss();
  };

  const showList = focused && !dismissed && items.length > 0;

  return (
    <View style={{ position: 'relative' }}>
      <TextInput
        value={value}
        onChangeText={(v) => { onChangeText(v); setDismissed(false); }}
        onFocus={() => { setFocused(true); setDismissed(false); }}
        onBlur={() => setTimeout(() => setFocused(false), 160)}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID={testID}
      />
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.primary} style={styles.spinner} />
      ) : null}
      {showList && (
        <View style={styles.dropdown}>
          <View style={styles.dropHead}>
            <Ionicons name="medkit-outline" size={12} color={COLORS.primary} />
            <Text style={styles.dropHeadText}>
              {value.trim() ? 'Matching medicines' : 'Catalogue'}
            </Text>
            <Text style={styles.autofillHint}>Tap to autofill</Text>
          </View>
          {items.map((m) => (
            <TouchableOpacity
              key={`${m.name}-${m.source || 'seed'}`}
              onPress={() => commit(m)}
              style={styles.dropRow}
              testID={testID ? `${testID}-sug-${m.name.slice(0, 20)}` : undefined}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.dropName} numberOfLines={1}>
                  {m.display_name || m.name}
                </Text>
                {m.brands && m.brands.length > 1 ? (
                  <Text style={styles.brandText} numberOfLines={1}>
                    Other brands: {m.brands.filter((b) => b !== m.brand).slice(0, 3).join(' · ')}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  {m.category ? (
                    <View style={styles.categoryChip}>
                      <Text style={styles.categoryChipText}>{m.category}</Text>
                    </View>
                  ) : null}
                  {m.frequency ? (
                    <Text style={styles.metaText} numberOfLines={1}>
                      {m.frequency}
                      {m.duration ? ` · ${m.duration}` : ''}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Ionicons name="arrow-up-outline" size={14} color={COLORS.primary} style={{ transform: [{ rotate: '45deg' }] }} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    ...FONTS.body, color: COLORS.textPrimary, fontSize: 14,
    marginTop: 4,
  },
  spinner: {
    position: 'absolute',
    right: 12, top: 16,
  },
  dropdown: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8,
    elevation: 4,
  },
  dropHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '0D',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  dropHeadText: { ...FONTS.label, color: COLORS.primary, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 },
  autofillHint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 10 },
  dropRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  dropName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  brandText: { ...FONTS.body, color: COLORS.primary, fontSize: 11, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  categoryChip: { backgroundColor: COLORS.primary + '14', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  categoryChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10 },
  metaText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, flex: 1 },
});
