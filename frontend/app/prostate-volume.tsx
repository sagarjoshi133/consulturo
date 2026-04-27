import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { format } from 'date-fns';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { useToast } from '../src/toast';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { DateField } from '../src/date-picker';
import { parseUIDate, displayDate } from '../src/date';

type Reading = {
  reading_id: string;
  volume_ml: number;
  source: string;
  measured_on: string;
  notes?: string;
  created_at: string;
};

const SOURCES = ['USG', 'MRI', 'DRE', 'Other'];

function categorize(vol: number): { label: string; color: string } {
  if (vol < 25) return { label: 'Normal', color: COLORS.success };
  if (vol < 40) return { label: 'Mildly enlarged', color: '#D4A000' };
  if (vol < 80) return { label: 'Moderately enlarged', color: COLORS.warning };
  return { label: 'Significantly enlarged', color: COLORS.accent };
}

export default function ProstateVolume() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readings, setReadings] = useState<Reading[]>([]);

  // New entry modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vol, setVol] = useState('');
  const [source, setSource] = useState('USG');
  const [measuredOn, setMeasuredOn] = useState(format(new Date(), 'dd-MM-yyyy'));
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data } = await api.get('/records/prostate-volume');
      setReadings(Array.isArray(data?.readings) ? data.readings : []);
    } catch {
      setReadings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resetForm = () => {
    setVol('');
    setSource('USG');
    setMeasuredOn(format(new Date(), 'dd-MM-yyyy'));
    setNotes('');
  };

  const openAdd = () => {
    resetForm();
    setModalOpen(true);
  };

  const save = async () => {
    const n = parseFloat(vol.trim());
    if (!vol.trim() || isNaN(n)) {
      toast.error('Enter a valid volume in mL');
      return;
    }
    if (n < 5 || n > 500) {
      toast.error('Volume must be between 5 and 500 mL');
      return;
    }
    const iso = parseUIDate(measuredOn);
    if (!iso) {
      toast.error('Pick a valid measurement date');
      return;
    }
    setSaving(true);
    try {
      await api.post('/records/prostate-volume', {
        volume_ml: n,
        source,
        measured_on: iso, // YYYY-MM-DD
        notes: notes.trim(),
      });
      toast.success('Reading saved');
      setModalOpen(false);
      resetForm();
      await load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (r: Reading) => {
    const msg = `Delete the ${r.volume_ml} mL reading from ${displayDate(r.measured_on)}?`;
    const run = async () => {
      try {
        await api.delete(`/records/prostate-volume/${r.reading_id}`);
        toast.success('Reading deleted');
        await load();
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Could not delete');
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) run();
    } else {
      Alert.alert('Delete reading?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]);
    }
  };

  const latest = readings[0];
  const trend = useMemo(() => {
    if (readings.length < 2) return null;
    const prev = readings[1].volume_ml;
    const diff = latest.volume_ml - prev;
    if (Math.abs(diff) < 0.5) return { dir: 'flat' as const, diff: 0 };
    return { dir: (diff > 0 ? 'up' : 'down') as 'up' | 'down', diff: Math.abs(diff) };
  }, [latest, readings]);

  if (authLoading || loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <TopBar onBack={() => router.back()} />
        <View style={styles.emptyWrap}>
          <Ionicons name="lock-closed-outline" size={54} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Sign in to track prostate volume</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/more')} style={[styles.primaryBtn, { marginTop: 20 }]}>
            <Text style={styles.primaryBtnText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <TopBar onBack={() => router.back()} onAdd={openAdd} />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.primary} />}
      >
        {/* Latest reading hero card */}
        {latest ? (
          <View style={styles.heroCard}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>LATEST READING</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 6 }}>
                  <Text style={styles.heroValue}>{latest.volume_ml.toFixed(1)}</Text>
                  <Text style={styles.heroUnit}>mL</Text>
                </View>
                <Text style={styles.heroDate}>
                  {displayDate(latest.measured_on)} · {latest.source}
                </Text>
              </View>
              <View style={[styles.categoryPill, { backgroundColor: categorize(latest.volume_ml).color + '1A', borderColor: categorize(latest.volume_ml).color }]}>
                <Text style={[styles.categoryPillText, { color: categorize(latest.volume_ml).color }]}>
                  {categorize(latest.volume_ml).label}
                </Text>
              </View>
            </View>

            {trend && (
              <View style={styles.trendRow}>
                <Ionicons
                  name={trend.dir === 'up' ? 'trending-up' : trend.dir === 'down' ? 'trending-down' : 'remove'}
                  size={16}
                  color={trend.dir === 'up' ? COLORS.accent : trend.dir === 'down' ? COLORS.success : COLORS.textSecondary}
                />
                <Text style={styles.trendText}>
                  {trend.dir === 'flat'
                    ? 'No change from previous reading'
                    : `${trend.dir === 'up' ? 'Increased' : 'Decreased'} by ${trend.diff.toFixed(1)} mL vs previous`}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="pulse-outline" size={44} color={COLORS.textDisabled} />
            <Text style={styles.emptyCardTitle}>No readings yet</Text>
            <Text style={styles.emptyCardSub}>
              Log your prostate volume from USG, MRI, or DRE reports to build a timeline your doctor can review on your next visit.
            </Text>
            <TouchableOpacity onPress={openAdd} style={[styles.primaryBtn, { marginTop: 16 }]} testID="pv-add-empty">
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.primaryBtnText}>Add first reading</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Informational band */}
        <View style={styles.infoBand}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.primaryDark} />
          <Text style={styles.infoBandText}>
            Healthy adult prostate is {'<25 mL'}. BPH is commonly staged at {'\u2265 30 mL'}. Always share the report with Dr. Joshi for interpretation.
          </Text>
        </View>

        {/* History list */}
        {readings.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>History</Text>
              <Text style={styles.sectionCount}>{readings.length}</Text>
            </View>
            {readings.map((r) => {
              const cat = categorize(r.volume_ml);
              return (
                <View key={r.reading_id} style={styles.historyCard} testID={`pv-row-${r.reading_id}`}>
                  <View style={[styles.historyBadge, { backgroundColor: cat.color + '1A' }]}>
                    <Text style={[styles.historyBadgeVal, { color: cat.color }]}>{r.volume_ml.toFixed(1)}</Text>
                    <Text style={[styles.historyBadgeUnit, { color: cat.color }]}>mL</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.historyDate}>{displayDate(r.measured_on)}</Text>
                    <Text style={styles.historyMeta}>
                      {r.source}
                      {r.notes ? ` · ${r.notes}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => confirmDelete(r)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    testID={`pv-del-${r.reading_id}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Add-reading modal */}
      <Modal
        visible={modalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ width: '100%' }}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHead}>
                <Text style={styles.modalTitle}>Add prostate volume</Text>
                <TouchableOpacity onPress={() => setModalOpen(false)} testID="pv-modal-close">
                  <Ionicons name="close" size={22} color={COLORS.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ paddingBottom: 6 }}>
                <Text style={styles.fieldLabel}>Volume (mL) *</Text>
                <View style={styles.volumeInputRow}>
                  <TextInput
                    value={vol}
                    onChangeText={setVol}
                    placeholder="e.g. 42"
                    placeholderTextColor={COLORS.textDisabled}
                    keyboardType="decimal-pad"
                    style={styles.volumeInput}
                    testID="pv-input-volume"
                  />
                  <Text style={styles.unit}>mL</Text>
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Source</Text>
                <View style={styles.chipRow}>
                  {SOURCES.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setSource(s)}
                      style={[styles.chip, source === s && styles.chipOn]}
                      testID={`pv-source-${s}`}
                    >
                      <Text style={[styles.chipText, source === s && styles.chipTextOn]}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={{ marginTop: 14 }}>
                  <DateField
                    label="Measured on"
                    value={measuredOn}
                    onChange={setMeasuredOn}
                    testID="pv-input-date"
                  />
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 14 }]}>Notes (optional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="e.g. From USG KUB report at XYZ Clinic"
                  placeholderTextColor={COLORS.textDisabled}
                  style={styles.notesInput}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                  testID="pv-input-notes"
                />
              </ScrollView>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity
                  onPress={() => setModalOpen(false)}
                  style={[styles.btn, styles.btnGhost, { flex: 1 }]}
                  disabled={saving}
                >
                  <Text style={styles.btnGhostText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={save}
                  disabled={saving}
                  style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
                  testID="pv-modal-save"
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={styles.btnPrimaryText}>Save reading</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function TopBar({ onBack, onAdd }: { onBack: () => void; onAdd?: () => void }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn} testID="pv-back">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle}>Prostate Volume</Text>
        <Text style={styles.topSub}>Your readings over time</Text>
      </View>
      {onAdd && (
        <TouchableOpacity onPress={onAdd} style={styles.addBtn} testID="pv-add">
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 20 },
  topSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14, textAlign: 'center' },

  heroCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 20,
    marginBottom: 14,
  },
  heroLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, letterSpacing: 1 },
  heroValue: { ...FONTS.h1, color: COLORS.textPrimary, fontSize: 48, lineHeight: 54 },
  heroUnit: { ...FONTS.h3, color: COLORS.textSecondary, fontSize: 16, marginLeft: 6, marginBottom: 8 },
  heroDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },

  categoryPill: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  categoryPillText: { ...FONTS.bodyMedium, fontSize: 11 },

  trendRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 14,
    borderTopWidth: 1, borderTopColor: COLORS.border,
    paddingTop: 12,
  },
  trendText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 },

  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 24,
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyCardTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 10 },
  emptyCardSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  infoBand: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: COLORS.primary + '0D',
    borderRadius: RADIUS.md,
    padding: 12,
    marginBottom: 18,
  },
  infoBandText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 15 },
  sectionCount: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 12 },

  historyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  historyBadge: {
    minWidth: 64,
    borderRadius: RADIUS.md,
    paddingVertical: 8, paddingHorizontal: 10,
    alignItems: 'center',
  },
  historyBadgeVal: { ...FONTS.h3, fontSize: 18 },
  historyBadgeUnit: { ...FONTS.body, fontSize: 10 },
  historyDate: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  historyMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { ...FONTS.h3, color: COLORS.textPrimary },

  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, letterSpacing: 0.8, marginBottom: 6 },
  volumeInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
  },
  volumeInput: {
    flex: 1,
    ...FONTS.h2, fontSize: 22, color: COLORS.textPrimary,
    paddingVertical: 12,
  },
  unit: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 14 },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  chipTextOn: { color: '#fff' },

  notesInput: {
    ...FONTS.body, fontSize: 13, color: COLORS.textPrimary,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 80,
  },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: RADIUS.pill,
  },
  btnGhost: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  btnGhostText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnPrimaryText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.pill,
  },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
