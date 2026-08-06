/**
 * Dashboard — Prescriptions panel.
 *
 * Lists clinic prescriptions with search + per-row actions
 * (Open / Edit / Print / PDF / Share / Delete). Pull-to-refresh
 * via the shared `usePanelRefresh('prescriptions', …)` hook.
 *
 * Extracted from app/dashboard.tsx during the 2026-05-31 refactor.
 * No behavioural changes — just moved into its own file so the
 * dashboard orchestrator can stay readable.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../api';
import { useAuth } from '../auth';
import { COLORS, FONTS, RADIUS } from '../theme';
import { Skeleton } from '../skeleton';
import { useToast } from '../toast';
import { useResponsive } from '../responsive';
import { usePanelRefresh } from '../panel-refresh';
import { parseBackendDate, formatISTDate } from '../date';
import {
  fetchRxAndRun,
  printPrescription,
  downloadPrescriptionPdf,
  sharePrescriptionPdf,
  loadClinicSettings,
  ClinicSettings,
} from '../rx-pdf';
import { styles } from './dashboard-styles';

export default function PrescriptionsPanel() {
  const { isWebDesktop } = useResponsive();
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<ClinicSettings>({});
  const [busyId, setBusyId] = useState<string>(''); // `${id}:print` | `${id}:pdf` | `${id}:delete`

  const load = useCallback(async () => {
    try {
      const [{ data }, s] = await Promise.all([
        api.get('/prescriptions'),
        loadClinicSettings(),
      ]);
      setItems(data);
      setSettings(s);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Pull-to-refresh
  const [rxRefreshing, setRxRefreshing] = useState(false);
  const manualRxRefresh = useCallback(async () => {
    setRxRefreshing(true);
    try { await load(); } finally { setRxRefreshing(false); }
  }, [load]);
  usePanelRefresh('prescriptions', manualRxRefresh);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const runPrint = async (id: string) => {
    setBusyId(`${id}:print`);
    await fetchRxAndRun(id, (rx) => printPrescription(rx, settings));
    setBusyId('');
  };

  const runDownload = async (id: string) => {
    setBusyId(`${id}:pdf`);
    await fetchRxAndRun(id, (rx) => downloadPrescriptionPdf(rx, settings));
    setBusyId('');
  };

  const runShare = async (id: string) => {
    setBusyId(`${id}:share`);
    await fetchRxAndRun(id, (rx) => sharePrescriptionPdf(rx, settings));
    setBusyId('');
  };

  const deleteRx = (id: string) => {
    const doDelete = async () => {
      setBusyId(`${id}:delete`);
      try {
        await api.delete(`/prescriptions/${id}`);
        load();
        toast.success('Prescription deleted');
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        toast.error(msg);
      } finally {
        setBusyId('');
      }
    };
    if (Platform.OS === 'web') {
      if ((globalThis as any).window?.confirm?.('Delete this prescription permanently?')) doDelete();
    } else {
      Alert.alert('Delete prescription?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  const filtered = React.useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (rx) =>
        (rx.patient_name || '').toLowerCase().includes(q) ||
        (rx.patient_phone || '').includes(q) ||
        (rx.registration_no || '').includes(q) ||
        (rx.diagnosis || '').toLowerCase().includes(q),
    );
  }, [items, search]);

  return (
    <>
      {items.length > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, height: 40 }}>
            <Ionicons name="search" size={16} color={COLORS.textSecondary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, phone, reg, diagnosis…"
              placeholderTextColor={COLORS.textDisabled}
              style={{ flex: 1, marginLeft: 8, ...FONTS.body, color: COLORS.textPrimary }}
              testID="rx-search"
            />
          </View>
          <TouchableOpacity
            onPress={() => router.push('/prescriptions/new')}
            style={[styles.refreshBtn, { backgroundColor: COLORS.primary, borderColor: COLORS.primary }]}
            activeOpacity={0.75}
            testID="dashboard-new-rx"
            accessibilityLabel="New prescription"
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={manualRxRefresh}
            disabled={rxRefreshing}
            style={styles.refreshBtn}
            activeOpacity={0.75}
            testID="rx-refresh"
          >
            {rxRefreshing ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Ionicons name="refresh" size={18} color={COLORS.primary} />
            )}
          </TouchableOpacity>
        </View>
      )}
      {loading ? (
        <View style={{ marginTop: 16, gap: 12 }} testID="dashboard-rx-skel">
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ padding: 14, borderRadius: RADIUS.md, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, gap: 10 }}>
              <Skeleton w="55%" h={16} />
              <Skeleton w="35%" h={12} />
              <Skeleton w="80%" h={12} />
            </View>
          ))}
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 24, paddingHorizontal: 16 }}>
          <Text style={{ ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center' }}>
            {items.length === 0 ? 'No prescriptions yet' : 'No matches.'}
          </Text>
          {items.length === 0 && (
            <TouchableOpacity
              onPress={() => router.push('/prescriptions/new')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: COLORS.primary,
                paddingVertical: 10, paddingHorizontal: 18,
                borderRadius: 22, marginTop: 12,
              }}
              testID="dashboard-new-rx-empty"
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={{ ...FONTS.bodyMedium, color: '#fff' }}>New Prescription</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={isWebDesktop ? styles.bkGrid : undefined}>
          {filtered.map((rx) => (
            <View key={rx.prescription_id} style={[styles.rxCard, isWebDesktop && styles.bkCardDesktop]}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
                testID={`rx-open-${rx.prescription_id}`}
              >
                <View style={styles.bkHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bkName}>{rx.patient_name}</Text>
                    {rx.registration_no ? (
                      <Text style={{ ...FONTS.body, color: COLORS.primary, fontSize: 11, marginTop: 2 }}>
                        Reg. {rx.registration_no}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.bkMeta}>{formatISTDate(parseBackendDate(rx.created_at))}</Text>
                </View>
                {rx.chief_complaints ? (
                  <Text style={styles.bkReason} numberOfLines={2}>{rx.chief_complaints}</Text>
                ) : null}
                <Text style={[styles.bkActionText, { marginTop: 6 }]}>{(rx.medicines || []).length} medicine(s)</Text>
              </TouchableOpacity>

              <View style={styles.rxActionRow}>
                <RxRowAction
                  icon="eye-outline" label="Open"
                  onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
                  testID={`rx-view-${rx.prescription_id}`}
                />
                <RxRowAction
                  icon="create-outline" label="Edit"
                  onPress={() => router.push({ pathname: '/prescriptions/new', params: { rxId: rx.prescription_id } } as any)}
                  testID={`rx-edit-${rx.prescription_id}`}
                />
                <RxRowAction
                  icon="print-outline" label="Print"
                  loading={busyId === `${rx.prescription_id}:print`}
                  onPress={() => runPrint(rx.prescription_id)}
                  testID={`rx-print-${rx.prescription_id}`}
                />
                <RxRowAction
                  icon="download-outline" label="PDF"
                  loading={busyId === `${rx.prescription_id}:pdf`}
                  onPress={() => runDownload(rx.prescription_id)}
                  testID={`rx-pdf-${rx.prescription_id}`}
                />
                <RxRowAction
                  icon="share-social-outline" label="Share"
                  loading={busyId === `${rx.prescription_id}:share`}
                  onPress={() => runShare(rx.prescription_id)}
                  testID={`rx-share-${rx.prescription_id}`}
                />
                {isOwner && (
                  <RxRowAction
                    icon="trash-outline" label="Delete"
                    color={COLORS.accent}
                    loading={busyId === `${rx.prescription_id}:delete`}
                    onPress={() => deleteRx(rx.prescription_id)}
                    testID={`rx-del-${rx.prescription_id}`}
                  />
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

function RxRowAction({
  icon, label, onPress, loading, color, testID,
}: {
  icon: any;
  label: string;
  onPress: () => void;
  loading?: boolean;
  color?: string;
  testID?: string;
}) {
  const c = color || COLORS.primary;
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={styles.rxRowAction} testID={testID}>
      {loading ? <ActivityIndicator size="small" color={c} /> : <Ionicons name={icon} size={16} color={c} />}
      <Text style={[styles.rxRowActionText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}
