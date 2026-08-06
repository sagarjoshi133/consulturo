/**
 * Patient Lab Trends — Wave 1 · E
 *
 * Add lab values + see trend line (sparkline) per test.
 *
 * Backend: GET /lab-results/presets · GET/POST/DELETE /lab-results
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import Svg, { Polyline, Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useSafeBack } from '../src/use-safe-back';
import { useToast } from '../src/toast';
import { confirmAction } from '../src/cross-alert';
import { EmptyState } from '../src/empty-state';
import { SkeletonCard } from '../src/skeleton';
import { haptics } from '../src/haptics';
import { labOcr } from '../src/wave3/api';
import * as ImagePicker from 'expo-image-picker';
import { resizeImageForUpload } from '../src/image-resize';
import {
  getLabPresets,
  listLabResults,
  addLabResult,
  deleteLabResult,
  LabPreset,
  LabResult,
} from '../src/wave1/api';

export default function PatientLabsScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const params = useLocalSearchParams<{ phone?: string; name?: string }>();
  const phone = (params?.phone as string) || '';
  const name = (params?.name as string) || 'Patient';
  const safeBack = useSafeBack(`/patient-db/${encodeURIComponent(phone)}` as any);

  const [presets, setPresets] = useState<LabPreset[]>([]);
  const [results, setResults] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  // Add-form state
  const [testKey, setTestKey] = useState<string>('psa');
  const [valueStr, setValueStr] = useState('');
  const [dateStr, setDateStr] = useState(new Date().toISOString().slice(0, 10));
  const [unit, setUnit] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);

  // ── Wave 3 (Q) — Lab Report OCR ─────────────────────────────────
  const handleScanReport = async () => {
    try {
      const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
      let granted = perm.granted;
      if (!granted) {
        if (!perm.canAskAgain) {
          toast.error('Photo access blocked. Enable it in Settings.');
          return;
        }
        const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      haptics.medium();
      setOcrRunning(true);
      const asset = result.assets[0];
      // Wave 6 (CC) — Downscale before the multipart upload. A typical
      // phone photo is 8–12 MB; resized it's <500 KB and the OCR is
      // identical in quality but ~5× faster end-to-end.
      const resized = await resizeImageForUpload(asset.uri, { requireBase64: false });
      const r = await labOcr({
        imageUri: resized.uri || asset.uri,
        phone,
        autoSave: true,
        filename: asset.fileName || `lab_${Date.now()}.jpg`,
      });
      haptics.success();
      toast.success(`${r.saved_count} value${r.saved_count === 1 ? '' : 's'} added from report`);
      void load();
    } catch (e: any) {
      haptics.error();
      toast.error(e?.response?.data?.detail || e?.message || 'OCR failed');
    } finally {
      setOcrRunning(false);
    }
  };

  const load = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    try {
      const [p, r] = await Promise.all([getLabPresets(), listLabResults(phone)]);
      setPresets(p);
      setResults(r);
    } catch {}
    setLoading(false);
  }, [phone]);

  useEffect(() => { void load(); }, [load]);

  // Group by test
  const grouped = useMemo(() => {
    const buckets: Record<string, LabResult[]> = {};
    for (const r of results) {
      const k = (r.test_key || r.test_name || '').toLowerCase();
      (buckets[k] = buckets[k] || []).push(r);
    }
    // sort each by date asc
    Object.values(buckets).forEach((arr) => arr.sort((a, b) => a.date.localeCompare(b.date)));
    return Object.entries(buckets);
  }, [results]);

  const presetByKey = useMemo(() => {
    const m: Record<string, LabPreset> = {};
    presets.forEach((p) => { m[p.key] = p; });
    return m;
  }, [presets]);

  const onPickPreset = (k: string) => {
    setTestKey(k);
    const p = presetByKey[k];
    if (p) setUnit(p.unit || '');
  };

  const save = async () => {
    const v = parseFloat(valueStr);
    if (!Number.isFinite(v)) { toast.error('Enter a numeric value'); return; }
    if (!testKey.trim()) { toast.error('Pick a test'); return; }
    setSaving(true);
    try {
      const p = presetByKey[testKey];
      await addLabResult({
        phone,
        test_name: p?.label || testKey,
        value: v,
        unit: unit || p?.unit || '',
        date: dateStr,
        notes,
      });
      haptics.success();
      toast.success('Lab value added');
      setAddOpen(false);
      setValueStr(''); setNotes('');
      void load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = (id: string) => {
    confirmAction({
      title: 'Delete lab value?',
      message: 'This entry will be removed permanently.',
      confirmText: 'Delete',
      destructive: true,
      onConfirm: async () => {
        try {
          await deleteLabResult(id);
          toast.success('Deleted');
          void load();
        } catch (e: any) {
          toast.error(e?.response?.data?.detail || 'Delete failed');
        }
      },
    });
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="labs-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Lab trends</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{name} · {phone}</Text>
        </View>
        <TouchableOpacity
          onPress={handleScanReport}
          disabled={ocrRunning || !phone}
          style={[styles.iconBtn, ocrRunning && { opacity: 0.5 }]}
          testID="labs-ocr"
        >
          {ocrRunning ? (
            <ActivityIndicator size="small" color="#7C3AED" />
          ) : (
            <Ionicons name="scan" size={22} color="#7C3AED" />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setAddOpen(true)} style={styles.iconBtn} testID="labs-add">
          <Ionicons name="add-circle" size={26} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ padding: 16, gap: 12 }}>
          <SkeletonCard height={140} />
          <SkeletonCard height={140} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}>
          {grouped.length === 0 ? (
            <EmptyState
              icon="flask-outline"
              title="No lab values yet"
              subtitle="Track PSA, creatinine, eGFR, haemoglobin and 14 more tests. We'll plot trend lines as values are added."
              actionLabel="Add first value"
              onAction={() => { haptics.tap(); setAddOpen(true); }}
              secondaryLabel="📸 Scan a report"
              onSecondary={handleScanReport}
            />
          ) : (
            grouped.map(([key, arr]) => {
              const p = presetByKey[key];
              return (
                <View key={key} style={styles.testCard}>
                  <View style={styles.testHead}>
                    <View>
                      <Text style={styles.testTitle}>{p?.label || arr[0].test_name}</Text>
                      <Text style={styles.muted}>{arr[0].unit || p?.unit || ''} · {arr.length} reading{arr.length === 1 ? '' : 's'}</Text>
                    </View>
                    <View style={styles.latestBadge}>
                      <Text style={styles.latestVal}>{arr[arr.length - 1].value}</Text>
                      <Text style={styles.latestLbl}>latest</Text>
                    </View>
                  </View>
                  <Sparkline data={arr.map(r => r.value)} />
                  {arr.slice().reverse().map((r) => (
                    <View key={r.result_id} style={styles.row}>
                      <Text style={styles.rowDate}>{r.date}</Text>
                      <Text style={styles.rowVal}>{r.value} <Text style={styles.rowUnit}>{r.unit || ''}</Text></Text>
                      <TouchableOpacity onPress={() => onDelete(r.result_id)} hitSlop={8}>
                        <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={addOpen} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setAddOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setAddOpen(false)} style={styles.iconBtn}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Add lab value</Text>
            <View style={styles.iconBtn} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
            <Text style={styles.label}>Test</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {presets.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => onPickPreset(p.key)}
                  style={[styles.pill, testKey === p.key && styles.pillActive]}
                  testID={`lab-preset-${p.key}`}
                >
                  <Text style={[styles.pillText, testKey === p.key && styles.pillTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>Value</Text>
            <View style={styles.valRow}>
              <TextInput
                value={valueStr}
                onChangeText={setValueStr}
                placeholder="e.g. 4.2"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="decimal-pad"
                style={[styles.input, { flex: 2 }]}
                testID="lab-value"
              />
              <TextInput
                value={unit}
                onChangeText={setUnit}
                placeholder="unit"
                placeholderTextColor={COLORS.textDisabled}
                style={[styles.input, { flex: 1 }]}
                testID="lab-unit"
              />
            </View>
            <Text style={styles.label}>Date</Text>
            <TextInput
              value={dateStr}
              onChangeText={setDateStr}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.textDisabled}
              style={styles.input}
              testID="lab-date"
            />
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Lab: ... / fasting / post-procedure"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
              multiline
              testID="lab-notes"
            />
            <TouchableOpacity
              onPress={save}
              disabled={saving}
              style={[styles.saveBtn, saving && { opacity: 0.6 }, { marginTop: 14 }]}
              testID="lab-save"
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="save" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>  Save value</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const w = Math.min(Dimensions.get('window').width - 60, 700);
  const h = 90;
  const pad = 14;
  if (!data || data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (v - min) / range);
    return { x, y, v };
  });
  const poly = points.map(p => `${p.x},${p.y}`).join(' ');
  return (
    <View style={{ marginVertical: 8 }}>
      <Svg width={w} height={h}>
        {/* baseline */}
        <SvgLine x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={COLORS.border} strokeWidth={1} />
        <Polyline
          points={poly}
          fill="none"
          stroke={COLORS.primary}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={COLORS.primary} />
        ))}
        <SvgText x={pad} y={pad + 2} fontSize={10} fill={COLORS.textSecondary}>{max}</SvgText>
        <SvgText x={pad} y={h - 2} fontSize={10} fill={COLORS.textSecondary}>{min}</SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff',
  },
  iconBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 17 },
  headerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  center: { padding: 40, alignItems: 'center' },

  emptyCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 36, alignItems: 'center', gap: 6,
  },
  emptyText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  muted: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },

  testCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14, marginBottom: 12,
  },
  testHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  testTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 16 },
  latestBadge: {
    backgroundColor: COLORS.primary + '14', borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center',
  },
  latestVal: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 16 },
  latestLbl: { ...FONTS.body, color: COLORS.primary, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 },

  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 6, borderTopWidth: 1, borderTopColor: COLORS.border + '55',
  },
  rowDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, flex: 1 },
  rowVal: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginRight: 12 },
  rowUnit: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  label: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  pill: {
    backgroundColor: '#fff', borderRadius: 999,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  pillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pillText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  pillTextActive: { color: '#fff' },
  valRow: { flexDirection: 'row', gap: 6 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    fontSize: 14, color: COLORS.textPrimary, backgroundColor: '#fff',
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary,
  },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
