/**
 * Global Search (⌘K / Cmd+K) — Wave 1 · A
 *
 * Cross-collection search overlay: patients, bookings, Rx, surgeries, IPD.
 * Triggered from any header search icon, or via ⌘K / Ctrl+K on web.
 *
 * Backend: GET /api/search?q=...
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useSafeBack } from '../src/use-safe-back';
import { globalSearch, SearchHit } from '../src/wave1/api';
import { useAuth } from '../src/auth';
import { EmptyState } from '../src/empty-state';
import { useDarkMode } from '../src/dark-mode';

const TYPE_META: Record<string, { icon: any; color: string; label: string }> = {
  patient:         { icon: 'person-circle', color: '#0E7C8B', label: 'Patient' },
  booking:         { icon: 'calendar',      color: '#0284C7', label: 'Booking' },
  prescription:    { icon: 'medkit',        color: '#7C3AED', label: 'Rx' },
  surgery:         { icon: 'cut',           color: '#DC2626', label: 'Surgery' },
  ipd:             { icon: 'bed',           color: '#059669', label: 'IPD' },
  // Patient-side
  disease:         { icon: 'pulse',         color: '#0E7C8B', label: 'Disease' },
  education:       { icon: 'book',          color: '#9333EA', label: 'Education' },
  guide:           { icon: 'compass',       color: '#0EA5E9', label: 'Surgery guide' },
  blog:            { icon: 'newspaper',     color: '#D97706', label: 'Blog' },
  calculator:      { icon: 'calculator',    color: '#2563EB', label: 'Calculator' },
  my_booking:      { icon: 'calendar',      color: '#0284C7', label: 'My booking' },
  my_prescription: { icon: 'medkit',        color: '#7C3AED', label: 'My Rx' },
};

export default function GlobalSearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const safeBack = useSafeBack('/');
  const { user } = useAuth();
  const isPatient = (user?.role || '') === 'patient';
  const { colors: dColors, effective } = useDarkMode();
  // Only patients see dark mode — staff screens stay light.
  const isDark = isPatient && effective === 'dark';
  const screenBg = isDark ? dColors.bg : COLORS.bg;
  const headerBg = isDark ? dColors.surface : '#fff';

  const [q, setQ] = useState((params?.q as string) || '');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const debounceRef = useRef<any>(null);

  // Auto-focus input on mount.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  // Debounced search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.trim().length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await globalSearch(q, 8);
        setResults(r);
        setError(null);
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
  }, [q]);

  const grouped = useMemo(() => {
    const buckets: Record<string, SearchHit[]> = {};
    for (const r of results) {
      (buckets[r.type] = buckets[r.type] || []).push(r);
    }
    return Object.entries(buckets) as [string, SearchHit[]][];
  }, [results]);

  const open = useCallback((r: SearchHit) => {
    if (r.link) {
      router.push(r.link as any);
    } else if (r.phone) {
      router.push(`/patient-db/${encodeURIComponent(r.phone)}` as any);
    }
  }, [router]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: screenBg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: isDark ? dColors.border : COLORS.border }]}>
          <TouchableOpacity onPress={safeBack} style={styles.backBtn} testID="search-back">
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.inputWrap}>
            <Ionicons name="search" size={18} color={COLORS.textSecondary} />
            <TextInput
              ref={inputRef}
              value={q}
              onChangeText={setQ}
              placeholder={isPatient
                ? 'Search diseases, education, blogs, calculators…'
                : 'Search patients, Rx, surgeries, IPD…'}
              placeholderTextColor={COLORS.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, Platform.OS === 'web' ? (styles as any).inputWeb : null]}
              testID="search-input"
              returnKeyType="search"
              underlineColorAndroid="transparent"
              selectionColor={COLORS.primary}
            />
            {q.length > 0 ? (
              <TouchableOpacity onPress={() => setQ('')} hitSlop={10} testID="search-clear">
                <Ionicons name="close-circle" size={18} color={COLORS.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Hints */}
        {q.length < 2 ? (
          <View style={styles.hintWrap}>
            <Text style={styles.hintTitle}>
              {isPatient ? 'What are you looking for?' : 'Search everywhere'}
            </Text>
            <View style={styles.hintList}>
              {isPatient ? (
                <>
                  <Hint icon="pulse" text="Urological diseases & overviews" />
                  <Hint icon="book" text="Patient education articles" />
                  <Hint icon="compass" text="Surgery guides & recovery" />
                  <Hint icon="newspaper" text="Doctor's blog posts" />
                  <Hint icon="calculator" text="IPSS, prostate volume, eGFR…" />
                  <Hint icon="receipt-outline" text="Your bookings & prescriptions" />
                </>
              ) : (
                <>
                  <Hint icon="person" text="Patient name or phone" />
                  <Hint icon="receipt-outline" text="Registration number" />
                  <Hint icon="medkit-outline" text="Diagnosis or Rx ID" />
                  <Hint icon="cut-outline" text="Surgery name" />
                  <Hint icon="bed-outline" text="IPD admission ID" />
                </>
              )}
            </View>
            <Text style={styles.hintHelp}>
              {isPatient
                ? 'Tip: type a symptom (e.g. "burning urine") or a procedure name (e.g. "TURP").'
                : 'Tip: type at least 2 characters. Use phone digits to find a patient instantly.'}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="warning" size={24} color={COLORS.accent} />
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : results.length === 0 && q.length >= 2 ? (
          <EmptyState
            icon="search-outline"
            title={`No matches for "${q}"`}
            subtitle={isPatient
              ? 'Try a symptom (e.g. "burning urine") or a procedure name (e.g. "TURP").'
              : 'Try the patient\'s full name, last 4 digits of phone, or a registration number.'}
          />
        ) : (
          <FlatList
            data={grouped}
            keyExtractor={([type]) => type}
            contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: [type, items] }) => {
              const meta = TYPE_META[type] || TYPE_META.patient;
              return (
                <View style={styles.group}>
                  <View style={styles.groupHead}>
                    <Ionicons name={meta.icon} size={16} color={meta.color} />
                    <Text style={[styles.groupTitle, { color: meta.color }]}>
                      {meta.label} · {items.length}
                    </Text>
                  </View>
                  {items.map((r, i) => (
                    <TouchableOpacity
                      key={`${type}-${i}`}
                      style={styles.row}
                      onPress={() => open(r)}
                      testID={`search-result-${type}-${i}`}
                    >
                      <View style={[styles.rowDot, { backgroundColor: meta.color + '22' }]}>
                        <Ionicons name={meta.icon} size={14} color={meta.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
                        {r.subtitle ? (
                          <Text style={styles.rowSub} numberOfLines={1}>{r.subtitle}</Text>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                    </TouchableOpacity>
                  ))}
                </View>
              );
            }}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Hint({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.hintRow}>
      <Ionicons name={icon} size={14} color={COLORS.primary} />
      <Text style={styles.hintText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
    gap: 4,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: RADIUS.pill,
    minHeight: 40,
  },
  input: {
    flex: 1,
    ...FONTS.body,
    color: COLORS.textPrimary,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  // Web-only: kill the default browser focus outline rectangle on
  // the underlying <input>. Cast through `any` because RN typings
  // don't yet include the CSS-style outline properties.
  inputWeb: ({
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
    WebkitTapHighlightColor: 'transparent',
  } as any),
  hintWrap: { padding: 20 },
  hintTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginBottom: 12 },
  hintList: { gap: 8 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hintText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  hintHelp: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 12, marginTop: 18, fontStyle: 'italic' },
  center: { padding: 40, alignItems: 'center', justifyContent: 'center', gap: 8 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  errText: { ...FONTS.body, color: COLORS.accent, fontSize: 13 },
  group: { marginBottom: 14 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, marginLeft: 4 },
  groupTitle: { ...FONTS.bodyMedium, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 6,
  },
  rowDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
});
