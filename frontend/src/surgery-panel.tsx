import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  Platform,
  Modal,
  KeyboardAvoidingView,
  FlatList,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { API_BASE } from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton, SecondaryButton } from './components';
import { useResponsive } from './responsive';
import { displayDate, parseUIDate, todayUI, UI_DATE_PLACEHOLDER } from './date';
import { DateField } from './date-picker';
import { EmptyState } from './empty-state';
import { usePanelRefresh } from './panel-refresh';
import { SuggestInput } from './suggest-input';

type SurgeryForm = {
  patient_name: string;
  patient_phone: string;
  patient_age: string;
  patient_sex: 'Male' | 'Female' | 'Other' | '';
  patient_id_ipno: string;
  address: string;
  patient_category: string;
  consultation_date: string;
  referred_by: string;
  clinical_examination: string;
  diagnosis: string;
  imaging: string;
  department: 'OPD' | 'IPD' | 'Daycare' | '';
  date_of_admission: string;
  surgery_name: string;
  date: string;
  hospital: string;
  operative_findings: string;
  post_op_investigations: string;
  date_of_discharge: string;
  follow_up: string;
  notes: string;
};

const EMPTY: SurgeryForm = {
  patient_name: '',
  patient_phone: '',
  patient_age: '',
  patient_sex: '',
  patient_id_ipno: '',
  address: '',
  patient_category: '',
  consultation_date: '',
  referred_by: '',
  clinical_examination: '',
  diagnosis: '',
  imaging: '',
  department: '',
  date_of_admission: '',
  surgery_name: '',
  date: todayUI(),
  hospital: 'Sterling Hospital',
  operative_findings: '',
  post_op_investigations: '',
  date_of_discharge: '',
  follow_up: '',
  notes: '',
};

const INLINE_LIMIT = 10;
const PAGE_SIZE = 50;

// Memoized surgery row to prevent re-render of every card on typing in search
const SurgeryRow = React.memo(function SurgeryRow({
  s,
  onEdit,
  onDelete,
  compact = false,
}: {
  s: any;
  onEdit: (s: any) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sxName}>{s.surgery_name}</Text>
          <Text style={styles.sxMeta}>
            {s.patient_name}
            {s.patient_age ? ` · ${s.patient_age}y` : ''}
            {s.patient_sex ? ` · ${s.patient_sex}` : ''}
            {compact && s.patient_phone ? ` · ${s.patient_phone}` : ''}
          </Text>
          <Text style={styles.sxDate}>
            {displayDate(s.date)}
            {s.hospital ? ` · ${s.hospital}` : ''}
            {s.department ? ` · ${s.department}` : ''}
            {s.imported ? ' · imported' : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={() => onEdit(s)} style={styles.iconBtn} testID={`surgery-edit-${s.surgery_id}`}>
            <Ionicons name="create-outline" size={16} color={COLORS.primary} />
          </TouchableOpacity>
          {onDelete && (
            <TouchableOpacity onPress={() => onDelete(s.surgery_id)} style={styles.iconBtn} testID={`surgery-delete-${s.surgery_id}`}>
              <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
            </TouchableOpacity>
          )}
        </View>
      </View>
      {s.diagnosis ? <Text style={styles.sxDx}>Dx: {s.diagnosis}</Text> : null}
      {s.operative_findings ? (
        <Text style={styles.sxFindings} numberOfLines={2}>OP: {s.operative_findings}</Text>
      ) : null}
    </View>
  );
});

export function SurgeriesPanel({ autoOpen = 0 }: { autoOpen?: number } = {}) {
  const { isWebDesktop } = useResponsive();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [presets, setPresets] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SurgeryForm>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [showProcedurePicker, setShowProcedurePicker] = useState(false);
  const [procedureFilter, setProcedureFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; total: number; errors: any[] } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Auto-open the new-surgery form when dashboard FAB "+ New Surgery" is tapped.
  // autoOpen is a counter — every tap increments it so the effect re-fires.
  React.useEffect(() => {
    if (autoOpen > 0) {
      setEditingId(null);
      setForm({ ...EMPTY, date: todayUI(), hospital: 'Sterling Hospital' });
      setShowForm(true);
    }
    // eslint-disable-next-line
  }, [autoOpen]);

  // Full-logbook modal controls
  const [histSearch, setHistSearch] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [hospitalFilter, setHospitalFilter] = useState<string>('all');
  const [showStats, setShowStats] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const parseCsv = (text: string): any[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQ && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else inQ = !inQ;
        } else if (c === ',' && !inQ) {
          out.push(cur);
          cur = '';
        } else cur += c;
      }
      out.push(cur);
      return out.map((s) => s.trim());
    };
    const headers = parseLine(lines[0]);
    const rows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseLine(lines[i]);
      const obj: Record<string, string> = {};
      headers.forEach((h, j) => {
        obj[h] = cells[j] || '';
      });
      rows.push(obj);
    }
    return rows;
  };

  const runImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const rows = parseCsv(csvText);
      if (rows.length === 0) {
        setImportResult({ inserted: 0, total: 0, errors: [{ error: 'No rows parsed from CSV.' }] });
        return;
      }
      const { data } = await api.post('/surgeries/import', { rows });
      setImportResult(data);
      load();
    } catch (e: any) {
      setImportResult({ inserted: 0, total: 0, errors: [{ error: e?.response?.data?.detail || 'Import failed' }] });
    } finally {
      setImporting(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const [surgeriesRes, presetsRes] = await Promise.all([
        api.get('/surgeries'),
        api.get('/surgeries/presets').catch(() => ({ data: { procedures: [] } })),
      ]);
      setItems(surgeriesRes.data);
      setPresets(presetsRes.data?.procedures || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const [exporting, setExporting] = useState(false);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const token = await AsyncStorage.getItem('session_token');
      const url = `${API_BASE}/surgeries/export.csv`;
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const today = new Date().toISOString().slice(0, 10);
      const filename = `consulturo-surgeries-${today}.csv`;
      if (Platform.OS === 'web') {
        const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
      } else {
        const path = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export Surgery Logbook' });
        } else {
          Alert.alert('Saved', `File saved to: ${path}`);
        }
      }
    } catch (e: any) {
      const msg = e?.message || 'Could not export CSV';
      Platform.OS === 'web' ? window.alert(msg) : Alert.alert('Export failed', msg);
    } finally {
      setExporting(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Pull-to-refresh hook
  const [sxRefreshing, setSxRefreshing] = useState(false);
  const manualSxRefresh = useCallback(async () => {
    setSxRefreshing(true);
    try { await load(); } finally { setSxRefreshing(false); }
  }, [load]);
  usePanelRefresh('surgeries', manualSxRefresh);

  const openNew = () => {
    setForm({ ...EMPTY, date: todayUI(), hospital: 'Sterling Hospital' });
    setEditingId(null);
    setErr('');
    setShowForm(true);
  };

  const openEdit = useCallback((s: any) => {
    setForm({
      patient_name: s.patient_name || '',
      patient_phone: s.patient_phone || '',
      patient_age: s.patient_age != null ? String(s.patient_age) : '',
      patient_sex: (s.patient_sex as any) || '',
      patient_id_ipno: s.patient_id_ipno || '',
      address: s.address || '',
      patient_category: s.patient_category || '',
      consultation_date: displayDate(s.consultation_date),
      referred_by: s.referred_by || '',
      clinical_examination: s.clinical_examination || '',
      diagnosis: s.diagnosis || '',
      imaging: s.imaging || '',
      department: (s.department as any) || '',
      date_of_admission: displayDate(s.date_of_admission),
      surgery_name: s.surgery_name || '',
      date: displayDate(s.date) || todayUI(),
      hospital: s.hospital || '',
      operative_findings: s.operative_findings || '',
      post_op_investigations: s.post_op_investigations || '',
      date_of_discharge: displayDate(s.date_of_discharge),
      follow_up: s.follow_up || '',
      notes: s.notes || '',
    });
    setEditingId(s.surgery_id);
    setErr('');
    setShowForm(true);
  }, []);

  const save = async () => {
    setErr('');
    if (!form.patient_name || !form.patient_phone || !form.surgery_name || !form.date) {
      setErr('Patient name, phone, surgery name & date are required.');
      return;
    }
    const isoDate = parseUIDate(form.date);
    if (!isoDate) {
      setErr('Date of surgery must be in DD-MM-YYYY format.');
      return;
    }
    setSaving(true);
    try {
      const payload: any = { ...form };
      payload.patient_age = form.patient_age ? parseInt(form.patient_age, 10) : undefined;
      payload.date = isoDate;
      payload.consultation_date = parseUIDate(form.consultation_date);
      payload.date_of_admission = parseUIDate(form.date_of_admission);
      payload.date_of_discharge = parseUIDate(form.date_of_discharge);
      if (editingId) {
        await api.patch(`/surgeries/${editingId}`, payload);
      } else {
        await api.post('/surgeries', payload);
      }
      setShowForm(false);
      setEditingId(null);
      load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Could not save surgery.');
    } finally {
      setSaving(false);
    }
  };

  const remove = useCallback((id: string) => {
    const doDelete = async () => {
      try {
        await api.delete(`/surgeries/${id}`);
        load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        Platform.OS === 'web'
          ? typeof window !== 'undefined' && window.alert(msg)
          : Alert.alert('Error', msg);
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Delete this surgery entry?')) doDelete();
    } else {
      Alert.alert('Confirm', 'Delete this surgery entry?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  }, [load]);

  // Inline list = latest search-matched items (for fast dashboard view)
  const inlineFiltered = useMemo(() => {
    if (!search.trim()) return items.slice(0, INLINE_LIMIT);
    const q = search.toLowerCase();
    return items
      .filter(
        (s: any) =>
          (s.patient_name || '').toLowerCase().includes(q) ||
          (s.surgery_name || '').toLowerCase().includes(q) ||
          (s.patient_phone || '').includes(q) ||
          (s.diagnosis || '').toLowerCase().includes(q)
      )
      .slice(0, INLINE_LIMIT);
  }, [items, search]);

  const inlineMatchCount = useMemo(() => {
    if (!search.trim()) return items.length;
    const q = search.toLowerCase();
    return items.filter(
      (s: any) =>
        (s.patient_name || '').toLowerCase().includes(q) ||
        (s.surgery_name || '').toLowerCase().includes(q) ||
        (s.patient_phone || '').includes(q) ||
        (s.diagnosis || '').toLowerCase().includes(q)
    ).length;
  }, [items, search]);

  // Full Logbook filter pipeline
  const historyFiltered = useMemo(() => {
    let rows = items;
    if (histSearch.trim()) {
      const q = histSearch.toLowerCase();
      rows = rows.filter(
        (s: any) =>
          (s.patient_name || '').toLowerCase().includes(q) ||
          (s.surgery_name || '').toLowerCase().includes(q) ||
          (s.patient_phone || '').includes(q) ||
          (s.diagnosis || '').toLowerCase().includes(q) ||
          (s.hospital || '').toLowerCase().includes(q)
      );
    }
    if (yearFilter !== 'all') rows = rows.filter((s: any) => (s.date || '').startsWith(yearFilter));
    if (hospitalFilter !== 'all') rows = rows.filter((s: any) => (s.hospital || '') === hospitalFilter);
    return rows;
  }, [items, histSearch, yearFilter, hospitalFilter]);

  const pagedHistory = useMemo(() => historyFiltered.slice(0, visibleCount), [historyFiltered, visibleCount]);

  // Reset pagination when filters change
  React.useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [histSearch, yearFilter, hospitalFilter]);

  const availableYears = useMemo(() => {
    const set = new Set<string>();
    items.forEach((s: any) => {
      const y = (s.date || '').slice(0, 4);
      if (y && /^\d{4}$/.test(y)) set.add(y);
    });
    return Array.from(set).sort().reverse();
  }, [items]);

  const availableHospitals = useMemo(() => {
    const m: Record<string, number> = {};
    items.forEach((s: any) => {
      const h = (s.hospital || '').trim();
      if (!h) return;
      m[h] = (m[h] || 0) + 1;
    });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items]);

  // Analytics for the stats summary in the Full Logbook
  const stats = useMemo(() => {
    const base = historyFiltered;
    const procCount: Record<string, number> = {};
    const hospCount: Record<string, number> = {};
    const deptCount: Record<string, number> = {};
    const years = new Set<string>();
    base.forEach((s: any) => {
      const p = (s.surgery_name || '').trim();
      if (p) procCount[p] = (procCount[p] || 0) + 1;
      const h = (s.hospital || '').trim();
      if (h) hospCount[h] = (hospCount[h] || 0) + 1;
      const d = (s.department || '').trim();
      if (d) deptCount[d] = (deptCount[d] || 0) + 1;
      const y = (s.date || '').slice(0, 4);
      if (y && /^\d{4}$/.test(y)) years.add(y);
    });
    const top = (m: Record<string, number>, n: number) =>
      Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
    const sortedYears = Array.from(years).sort();
    const yearSpan = sortedYears.length > 1 ? `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}` : sortedYears[0] || '';
    return {
      total: base.length,
      uniqueProcedures: Object.keys(procCount).length,
      yearSpan,
      topProcedures: top(procCount, 5),
      topHospitals: top(hospCount, 4),
      departments: top(deptCount, 3),
    };
  }, [historyFiltered]);

  const filteredPresets = useMemo(() => {
    if (!procedureFilter.trim()) return presets;
    const q = procedureFilter.toLowerCase();
    return presets.filter((p) => p.toLowerCase().includes(q));
  }, [presets, procedureFilter]);

  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;
  }

  return (
    <>
      <View style={styles.topToolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone, procedure…"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.searchInput}
            testID="surgery-search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary + '40', paddingHorizontal: 8, width: 38 }]}
          onPress={async () => { setSxRefreshing(true); try { await load(); } finally { setSxRefreshing(false); } }}
          disabled={sxRefreshing}
          testID="surgery-refresh"
        >
          {sxRefreshing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={18} color={COLORS.primary} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: COLORS.primaryDark, paddingHorizontal: 8, width: 38 }]}
          onPress={() => setShowImport(true)}
          testID="surgery-import"
        >
          <Ionicons name="cloud-upload" size={18} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} onPress={openNew} testID="surgery-add">
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addBtnText}>Log</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.logbookHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.logbookTitle}>Surgery Logbook</Text>
          <Text style={styles.totalLine}>
            {items.length === 0
              ? 'No entries yet'
              : search.trim()
              ? `${inlineMatchCount} match${inlineMatchCount === 1 ? '' : 'es'} · showing top ${Math.min(INLINE_LIMIT, inlineMatchCount)}`
              : `${items.length} total · showing latest ${Math.min(INLINE_LIMIT, items.length)}`}
          </Text>
        </View>
        {items.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setHistSearch(search);
              setShowHistory(true);
            }}
            style={styles.historyBtn}
            testID="surgery-view-history"
          >
            <Ionicons name="albums-outline" size={14} color={COLORS.primary} />
            <Text style={styles.historyBtnText}>View Full Logbook</Text>
          </TouchableOpacity>
        )}
      </View>

      {inlineFiltered.length === 0 && (
        <EmptyState
          icon={search.trim() ? 'search' : 'medkit-outline'}
          title={items.length === 0 ? 'No surgeries yet' : 'No matches'}
          subtitle={
            items.length === 0
              ? 'Tap "Log" above to add your first surgery, or use the upload icon to import past entries from a CSV.'
              : 'Try another keyword or open the full logbook.'
          }
          ctaLabel={items.length === 0 ? 'Log Surgery' : undefined}
          onCta={items.length === 0 ? startNew : undefined}
          compact
          testID="sx-empty"
        />
      )}

      {inlineFiltered.length > 0 && (
      <View style={isWebDesktop ? styles.sxGrid : undefined}>
        {inlineFiltered.map((s: any) => (
          <View key={s.surgery_id} style={isWebDesktop ? styles.sxGridItem : undefined}>
            <SurgeryRow s={s} onEdit={openEdit} onDelete={remove} />
          </View>
        ))}
      </View>
      )}

      {!search.trim() && items.length > INLINE_LIMIT && (
        <TouchableOpacity
          onPress={() => setShowHistory(true)}
          style={styles.viewAllBtn}
          testID="surgery-view-all"
        >
          <Text style={styles.viewAllBtnText}>See {items.length - INLINE_LIMIT} older entries →</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showForm} animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: COLORS.bg }}
        >
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowForm(false)} testID="surgery-form-close">
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{editingId ? 'Edit Surgery' : 'Log Surgery'}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Section title="Patient" />
            <Row>
              <Field label="Name *" value={form.patient_name} onChangeText={(v) => setForm({ ...form, patient_name: v })} testID="sx-name" />
            </Row>
            <Row>
              <Field label="Mobile *" value={form.patient_phone} onChangeText={(v) => setForm({ ...form, patient_phone: v })} keyboardType="phone-pad" testID="sx-phone" />
            </Row>
            <Row>
              <HalfField label="Age" value={form.patient_age} onChangeText={(v) => setForm({ ...form, patient_age: v })} keyboardType="number-pad" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.fieldLabel}>Sex</Text>
                <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
                  {(['Male', 'Female', 'Other'] as const).map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[styles.chip, form.patient_sex === g && styles.chipActive]}
                      onPress={() => setForm({ ...form, patient_sex: g })}
                    >
                      <Text style={[styles.chipText, form.patient_sex === g && { color: '#fff' }]}>{g[0]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </Row>
            <Row>
              <HalfField label="Patient ID / IP No." value={form.patient_id_ipno} onChangeText={(v) => setForm({ ...form, patient_id_ipno: v })} />
              <HalfField label="Category" value={form.patient_category} onChangeText={(v) => setForm({ ...form, patient_category: v })} placeholder="Regular / Insurance" />
            </Row>
            <Row>
              <Field label="Address" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} multiline />
            </Row>

            <Section title="Consultation" />
            <Row>
              <View style={{ flex: 1, marginRight: 8 }}>
                <DateField
                  label="Consultation date"
                  value={form.consultation_date}
                  onChange={(v) => setForm({ ...form, consultation_date: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Referred by</Text>
                <SuggestInput
                  field="referred_by"
                  value={form.referred_by}
                  onChangeText={(v) => setForm({ ...form, referred_by: v })}
                  placeholder="e.g. Dr Vibha Naik"
                  testID="sx-referred-by"
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Clinical examination</Text>
                <SuggestInput
                  field="clinical_examination"
                  value={form.clinical_examination}
                  onChangeText={(v) => setForm({ ...form, clinical_examination: v })}
                  multiline
                  testID="sx-clin-exam"
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Diagnosis</Text>
                <SuggestInput
                  field="diagnosis"
                  value={form.diagnosis}
                  onChangeText={(v) => setForm({ ...form, diagnosis: v })}
                  multiline
                  placeholder="e.g. Right Ureteric Stone"
                  testID="sx-diagnosis"
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Imaging</Text>
                <SuggestInput
                  field="imaging"
                  value={form.imaging}
                  onChangeText={(v) => setForm({ ...form, imaging: v })}
                  multiline
                  placeholder="USG, CT, MRI findings"
                  testID="sx-imaging"
                />
              </View>
            </Row>

            <Section title="Admission & Procedure" />
            <View style={{ marginTop: 8 }}>
              <Text style={styles.fieldLabel}>Department</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                {(['OPD', 'IPD', 'Daycare'] as const).map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[styles.chip, form.department === g && styles.chipActive]}
                    onPress={() => setForm({ ...form, department: g as any })}
                  >
                    <Text style={[styles.chipText, form.department === g && { color: '#fff' }]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <Row>
              <View style={{ flex: 1 }}>
                <DateField
                  label="Date of admission"
                  value={form.date_of_admission}
                  onChange={(v) => setForm({ ...form, date_of_admission: v })}
                />
              </View>
            </Row>

            <Text style={styles.fieldLabel}>Name of Surgery / Procedure *</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <SuggestInput
                  field="surgery_name"
                  value={form.surgery_name}
                  onChangeText={(v) => setForm({ ...form, surgery_name: v })}
                  placeholder="Type or pick from presets"
                  style={{ marginTop: 0 }}
                  testID="sx-proc-name"
                />
              </View>
              <TouchableOpacity
                onPress={() => setShowProcedurePicker(true)}
                style={styles.pickBtn}
                testID="sx-proc-pick"
              >
                <Ionicons name="list" size={16} color="#fff" />
                <Text style={styles.pickBtnText}>Pick</Text>
              </TouchableOpacity>
            </View>

            <Row>
              <View style={{ flex: 1, marginRight: 8 }}>
                <DateField
                  label="Date of surgery *"
                  value={form.date}
                  onChange={(v) => setForm({ ...form, date: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Hospital</Text>
                <SuggestInput
                  field="hospital"
                  value={form.hospital}
                  onChangeText={(v) => setForm({ ...form, hospital: v })}
                  placeholder="Sterling Hospital"
                  testID="sx-hospital"
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Operative findings</Text>
                <SuggestInput
                  field="operative_findings"
                  value={form.operative_findings}
                  onChangeText={(v) => setForm({ ...form, operative_findings: v })}
                  multiline
                  testID="sx-op-findings"
                />
              </View>
            </Row>

            <Section title="Post-op & Discharge" />
            <Row>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Post-op investigations</Text>
                <SuggestInput
                  field="post_op_investigations"
                  value={form.post_op_investigations}
                  onChangeText={(v) => setForm({ ...form, post_op_investigations: v })}
                  multiline
                  testID="sx-postop"
                />
              </View>
            </Row>
            <Row>
              <View style={{ flex: 1, marginRight: 8 }}>
                <DateField
                  label="Date of discharge"
                  value={form.date_of_discharge}
                  onChange={(v) => setForm({ ...form, date_of_discharge: v })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Follow up</Text>
                <SuggestInput
                  field="follow_up"
                  value={form.follow_up}
                  onChangeText={(v) => setForm({ ...form, follow_up: v })}
                  placeholder="e.g. 2 weeks"
                  testID="sx-followup"
                />
              </View>
            </Row>
            <Row>
              <Field label="Additional notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline />
            </Row>

            {err ? <Text style={{ color: COLORS.accent, ...FONTS.body, marginTop: 10 }}>{err}</Text> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
              <PrimaryButton
                title={saving ? 'Saving…' : editingId ? 'Update' : 'Save to Logbook'}
                onPress={save}
                disabled={saving}
                icon={<Ionicons name="save" size={18} color="#fff" />}
                style={{ flex: 1 }}
                testID="sx-save"
              />
              <SecondaryButton title="Cancel" onPress={() => setShowForm(false)} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showImport} animationType="slide" onRequestClose={() => setShowImport(false)}>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowImport(false)} testID="sx-import-close">
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Import from Logbook CSV</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginBottom: 8, lineHeight: 20 }}>
              Export your Uro Logbook to CSV and paste its contents below. Supported columns (any case, any spelling):
              {' '}Name, Mobile, Age, Sex, IP No., Address, Category, Consultation Date, Referred By, Diagnosis, Imaging,
              Department, Date of Admission, Name of Surgery, Date of Surgery, Hospital, Operative Findings, Post-op
              Investigations, Date of Discharge, Follow up, Notes.
            </Text>
            <Text style={{ ...FONTS.body, color: COLORS.textSecondary, marginBottom: 12, fontSize: 12 }}>
              Dates accepted as DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, or 3-Mar-2025. Rows missing name/phone/surgery/date are skipped.
            </Text>
            <TextInput
              value={csvText}
              onChangeText={setCsvText}
              placeholder="Name,Mobile,Age,Sex,Diagnosis,Name of Surgery,Date of Surgery,Hospital&#10;Rakesh,9876543210,45,Male,Right Ureteric Stone,Right URS,12-03-2025,Sterling"
              placeholderTextColor={COLORS.textDisabled}
              style={[styles.input, { minHeight: 180, textAlignVertical: 'top', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}
              multiline
              testID="sx-import-text"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <PrimaryButton
                title={importing ? 'Importing…' : 'Import Rows'}
                onPress={runImport}
                disabled={importing || !csvText.trim()}
                icon={<Ionicons name="cloud-upload" size={18} color="#fff" />}
                style={{ flex: 1 }}
                testID="sx-import-run"
              />
              <SecondaryButton
                title="Sample"
                onPress={() =>
                  setCsvText(
                    'Name,Mobile,Age,Sex,IP No.,Diagnosis,Department,Name of Surgery,Date of Surgery,Hospital,Operative Findings\n' +
                      'Rakesh Shah,9876543210,45,Male,IP123,Right Ureteric Stone,IPD,Right URS,12-03-2025,Sterling,Single 8mm stone removed\n' +
                      'Priya Patel,9123456780,38,Female,IP124,Left Hydronephrosis,Daycare,Left DJ Stenting,13-03-2025,Sterling,Stent placed uneventfully'
                  )
                }
                style={{ flex: 1 }}
              />
            </View>
            {importResult && (
              <View style={styles.importResult}>
                <Text style={styles.importOk}>
                  Imported {importResult.inserted} / {importResult.total} rows
                </Text>
                {importResult.errors && importResult.errors.length > 0 && (
                  <>
                    <Text style={styles.importErrHeader}>{importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}:</Text>
                    {importResult.errors.slice(0, 10).map((e: any, i: number) => (
                      <Text key={i} style={styles.importErr}>
                        • Row {e.row != null ? e.row + 1 : '?'}: {e.error}
                      </Text>
                    ))}
                  </>
                )}
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Full Logbook modal — virtualized, paginated, with analytics */}
      <Modal visible={showHistory} animationType="slide" onRequestClose={() => setShowHistory(false)}>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowHistory(false)} testID="sx-history-close">
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Full Logbook ({historyFiltered.length})</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <TouchableOpacity
                onPress={exportCsv}
                testID="sx-export-csv"
                disabled={exporting || items.length === 0}
                style={{ opacity: exporting || items.length === 0 ? 0.4 : 1 }}
              >
                {exporting ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <Ionicons name="download-outline" size={22} color={COLORS.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowStats((v) => !v)} testID="sx-toggle-stats">
                <Ionicons name={showStats ? 'stats-chart' : 'stats-chart-outline'} size={22} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={pagedHistory}
            keyExtractor={(s) => s.surgery_id}
            renderItem={({ item }) => (
              <View style={{ paddingHorizontal: 16 }}>
                <TouchableOpacity
                  onPress={() => {
                    setShowHistory(false);
                    openEdit(item);
                  }}
                  testID={`sx-history-row-${item.surgery_id}`}
                  activeOpacity={0.7}
                >
                  <SurgeryRow s={item} onEdit={openEdit} compact />
                </TouchableOpacity>
              </View>
            )}
            initialNumToRender={12}
            maxToRenderPerBatch={20}
            windowSize={10}
            removeClippedSubviews
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <View style={{ flexDirection: 'row' }}>
                <View style={styles.searchBox}>
                  <Ionicons name="search" size={16} color={COLORS.textSecondary} />
                  <TextInput
                    value={histSearch}
                    onChangeText={setHistSearch}
                    placeholder="Search name, phone, procedure, diagnosis, hospital…"
                    placeholderTextColor={COLORS.textDisabled}
                    style={styles.searchInput}
                    testID="sx-history-search"
                  />
                  {histSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setHistSearch('')}>
                      <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
                </View>

                {availableYears.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingVertical: 10, paddingRight: 16 }}>
                    {(['all', ...availableYears] as const).map((y) => (
                      <TouchableOpacity
                        key={y}
                        onPress={() => setYearFilter(y)}
                        style={[styles.yearChip, yearFilter === y && styles.yearChipActive]}
                        testID={`sx-year-${y}`}
                      >
                        <Text style={[styles.yearChipText, yearFilter === y && { color: '#fff' }]} numberOfLines={1}>
                          {y === 'all' ? `All (${items.length})` : `${y} (${items.filter((s: any) => (s.date || '').startsWith(y)).length})`}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {availableHospitals.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingBottom: 10, paddingRight: 16 }}>
                    {[['all', items.length] as [string, number], ...availableHospitals].map(([h, cnt]) => (
                      <TouchableOpacity
                        key={h}
                        onPress={() => setHospitalFilter(h)}
                        style={[styles.hospChip, hospitalFilter === h && styles.hospChipActive]}
                        testID={`sx-hosp-${h}`}
                      >
                        <Ionicons
                          name="business-outline"
                          size={12}
                          color={hospitalFilter === h ? '#fff' : COLORS.primaryDark}
                        />
                        <Text style={[styles.hospChipText, hospitalFilter === h && { color: '#fff' }]} numberOfLines={1}>
                          {h === 'all' ? 'All hospitals' : h} ({cnt})
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {showStats && stats.total > 0 && (
                  <View style={styles.statsCard}>
                    <Text style={styles.statsHeader}>Summary</Text>
                    <View style={styles.statsRow}>
                      <View style={styles.statTile}>
                        <Text style={styles.statNum}>{stats.total}</Text>
                        <Text style={styles.statLbl}>Surgeries</Text>
                      </View>
                      <View style={styles.statTile}>
                        <Text style={styles.statNum}>{stats.uniqueProcedures}</Text>
                        <Text style={styles.statLbl}>Procedures</Text>
                      </View>
                      <View style={styles.statTile}>
                        <Text
                          style={[
                            styles.statNum,
                            stats.yearSpan && stats.yearSpan.length > 4 && { fontSize: 15 },
                          ]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                        >
                          {stats.yearSpan || availableYears.length}
                        </Text>
                        <Text style={styles.statLbl}>{stats.yearSpan && stats.yearSpan.length > 4 ? 'Year span' : 'Years'}</Text>
                      </View>
                    </View>
                    {stats.topProcedures.length > 0 && (
                      <>
                        <Text style={styles.statsSub}>Top procedures</Text>
                        {stats.topProcedures.map(([p, n]) => {
                          const pct = Math.round((n / Math.max(stats.total, 1)) * 100);
                          return (
                            <View key={p} style={{ marginTop: 6 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                <Text style={styles.procLbl} numberOfLines={1}>{p}</Text>
                                <Text style={styles.procCount}>{n}</Text>
                              </View>
                              <View style={styles.barBg}>
                                <View style={[styles.barFill, { width: `${pct}%` }]} />
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}
                    {stats.departments.length > 0 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                        {stats.departments.map(([d, n]) => (
                          <View key={d} style={styles.deptTag}>
                            <Text style={styles.deptTagText}>{d}: {n}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={
              <Text style={{ ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 30 }}>
                No matching entries.
              </Text>
            }
            ListFooterComponent={
              historyFiltered.length > visibleCount ? (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  onPress={() => setVisibleCount((n) => n + PAGE_SIZE)}
                  testID="sx-load-more"
                >
                  <Text style={styles.loadMoreText}>
                    Load {Math.min(PAGE_SIZE, historyFiltered.length - visibleCount)} more
                  </Text>
                  <Text style={styles.loadMoreSub}>
                    {visibleCount} of {historyFiltered.length} shown
                  </Text>
                </TouchableOpacity>
              ) : historyFiltered.length > PAGE_SIZE ? (
                <Text style={styles.endCap}>All {historyFiltered.length} entries loaded</Text>
              ) : null
            }
          />
        </View>
      </Modal>

      <Modal visible={showProcedurePicker} animationType="slide" onRequestClose={() => setShowProcedurePicker(false)}>
        <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowProcedurePicker(false)}>
              <Ionicons name="close" size={24} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Pick Procedure</Text>
            <View style={{ width: 24 }} />
          </View>
          <View style={{ padding: 16 }}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              <TextInput
                value={procedureFilter}
                onChangeText={setProcedureFilter}
                placeholder="Type to search or add new…"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.searchInput}
                autoCapitalize="words"
              />
            </View>
            {procedureFilter.trim().length > 0 &&
              !filteredPresets.some((p) => p.toLowerCase() === procedureFilter.trim().toLowerCase()) && (
                <TouchableOpacity
                  style={styles.customRow}
                  onPress={() => {
                    const name = procedureFilter.trim();
                    setForm((f) => ({ ...f, surgery_name: name }));
                    setPresets((arr) => (arr.includes(name) ? arr : [name, ...arr]));
                    setShowProcedurePicker(false);
                    setProcedureFilter('');
                  }}
                  testID="sx-preset-add-custom"
                >
                  <Ionicons name="add-circle" size={20} color={COLORS.primary} />
                  <Text style={styles.customRowText}>Add "{procedureFilter.trim()}" as new procedure</Text>
                </TouchableOpacity>
              )}
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30 }}>
            {filteredPresets.map((p) => (
              <TouchableOpacity
                key={p}
                style={styles.presetRow}
                onPress={() => {
                  setForm((f) => ({ ...f, surgery_name: p }));
                  setShowProcedurePicker(false);
                  setProcedureFilter('');
                }}
                testID={`sx-preset-${p}`}
              >
                <MaterialCommunityIcons name="medical-bag" size={18} color={COLORS.primary} />
                <Text style={styles.presetText}>{p}</Text>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.sectionH}>{title}</Text>;
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', marginTop: 10, alignItems: 'flex-start' }}>{children}</View>;
}

function Field({ label, ...props }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, props.multiline && { height: 70, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function HalfField(props: any) {
  return (
    <View style={{ flex: 1, marginRight: props.noRight ? 0 : 8 }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topToolbar: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 8 },
  searchBox: { flex: 1, minWidth: 60, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingHorizontal: 10, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, height: 38 },
  searchInput: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, padding: 0, outlineWidth: 0 as any },
  addBtn: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 38, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary },
  addBtnText: { color: '#fff', ...FONTS.bodyMedium },
  totalLine: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 2 },
  logbookHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  logbookTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 16 },
  historyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff' },
  historyBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  yearChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, flexShrink: 0, alignSelf: 'flex-start' },
  yearChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  yearChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  hospChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, flexShrink: 0, alignSelf: 'flex-start' },
  hospChipActive: { backgroundColor: COLORS.primaryDark, borderColor: COLORS.primaryDark },
  hospChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },

  card: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  sxGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sxGridItem: { width: '49%' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sxName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  sxMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  sxDate: { ...FONTS.body, color: COLORS.primary, fontSize: 12, marginTop: 2 },
  sxDx: { ...FONTS.body, color: COLORS.textPrimary, marginTop: 8, fontSize: 13 },
  sxFindings: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },

  viewAllBtn: { marginTop: 4, marginBottom: 14, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  viewAllBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border, paddingTop: Platform.OS === 'ios' ? 50 : 16 },
  modalTitle: { ...FONTS.h4, color: COLORS.textPrimary },

  sectionH: { ...FONTS.label, color: COLORS.primary, marginTop: 18, marginBottom: 4, textTransform: 'uppercase' },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12 },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, height: 40, marginTop: 22, borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark },
  pickBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 12 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 6 },
  presetText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.primary + '14', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.primary + '55', marginTop: 10 },
  customRowText: { ...FONTS.bodyMedium, color: COLORS.primary, flex: 1, fontSize: 13 },
  importResult: { marginTop: 16, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
  importOk: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 14 },
  importErrHeader: { ...FONTS.bodyMedium, color: COLORS.accent, marginTop: 8, fontSize: 12 },
  importErr: { ...FONTS.body, color: COLORS.accent, fontSize: 11, marginTop: 2 },

  statsCard: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginTop: 8, marginBottom: 14, borderWidth: 1, borderColor: COLORS.border },
  statsHeader: { ...FONTS.label, color: COLORS.primary, textTransform: 'uppercase', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statTile: { flex: 1, backgroundColor: COLORS.primary + '0D', padding: 10, borderRadius: RADIUS.md, alignItems: 'center' },
  statNum: { ...FONTS.h3, color: COLORS.primary, fontSize: 20 },
  statLbl: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  statsSub: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginTop: 10, textTransform: 'uppercase' },
  procLbl: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 12, flex: 1, marginRight: 8 },
  procCount: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  barBg: { height: 5, backgroundColor: COLORS.border, borderRadius: 3, marginTop: 3, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 3 },
  deptTag: { backgroundColor: COLORS.primaryDark + '14', paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill },
  deptTagText: { ...FONTS.body, color: COLORS.primaryDark, fontSize: 11 },

  loadMoreBtn: { margin: 16, padding: 14, backgroundColor: COLORS.primary, borderRadius: RADIUS.md, alignItems: 'center' },
  loadMoreText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
  loadMoreSub: { ...FONTS.body, color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 2 },
  endCap: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', fontSize: 11, marginTop: 14, marginBottom: 20 },
});
