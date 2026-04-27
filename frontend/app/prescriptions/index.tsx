import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { PrimaryButton } from '../../src/components';
import { EmptyState } from '../../src/empty-state';
import {
  fetchRxAndRun,
  printPrescription,
  downloadPrescriptionPdf,
  loadClinicSettings,
  ClinicSettings,
} from '../../src/rx-pdf';

export default function PrescriptionsList() {
  const router = useRouter();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  // Owner + doctor (and any custom prescriber role) can access the Rx list.
  const canPrescribe = !!user && (user.role === 'owner' || user.role === 'doctor');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [settings, setSettings] = useState<ClinicSettings>({});
  const [busyId, setBusyId] = useState<string>(''); // `${id}:print` | `${id}:pdf` | `${id}:delete`

  const load = useCallback(async () => {
    if (!canPrescribe) {
      setItems([]);
      setLoading(false);
      return;
    }
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
      setRefreshing(false);
    }
  }, [canPrescribe]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
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

  const runDelete = (id: string) => {
    const doDelete = async () => {
      setBusyId(`${id}:delete`);
      try {
        await api.delete(`/prescriptions/${id}`);
        await load();
      } catch (e: any) {
        const msg = e?.response?.data?.detail || 'Could not delete';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('Error', msg);
      } finally {
        setBusyId('');
      }
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Delete this prescription permanently?')) doDelete();
    } else {
      Alert.alert('Delete prescription?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]);
    }
  };

  if (!canPrescribe) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Prescriptions</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="shield-checkmark" size={54} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Prescriber Access Only</Text>
          <Text style={styles.emptySub}>
            Prescription generation is restricted to Dr. Sagar Joshi and his team doctors.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="rx-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Prescriptions</Text>
        <TouchableOpacity
          onPress={() => router.push('/prescriptions/new')}
          style={styles.newBtn}
          testID="rx-new-button"
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />
          }
        >
          <EmptyState
            icon="document-text-outline"
            title="No prescriptions yet"
            subtitle="Generated prescriptions appear here with full PDF, print and share tools."
            ctaLabel="Create First Prescription"
            onCta={() => router.push('/prescriptions/new')}
            testID="rx-empty"
          />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} />
          }
        >
          {items.map((rx) => (
            <View key={rx.prescription_id} style={styles.card} testID={`rx-${rx.prescription_id}`}>
              {/* Tap the main body → Open detail view */}
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
                testID={`rx-open-${rx.prescription_id}`}
              >
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rxPatient} numberOfLines={1}>{rx.patient_name}</Text>
                    <Text style={styles.rxDate}>
                      {format(new Date(rx.created_at), 'dd-MM-yyyy, h:mm a')}
                      {rx.registration_no ? `  ·  Reg. ${rx.registration_no}` : ''}
                    </Text>
                  </View>
                  <View style={styles.rxPill}>
                    <Text style={styles.rxPillText}>Rx</Text>
                  </View>
                </View>
                {rx.chief_complaints ? (
                  <Text style={styles.rxReason} numberOfLines={2}>{rx.chief_complaints}</Text>
                ) : null}
                <Text style={styles.rxMeds}>{(rx.medicines || []).length} medicine(s)</Text>
              </TouchableOpacity>

              {/* Action row */}
              <View style={styles.actionRow}>
                <RowAction
                  icon="eye-outline"
                  label="Open"
                  onPress={() => router.push({ pathname: '/prescriptions/[id]', params: { id: rx.prescription_id } } as any)}
                  testID={`rx-open-btn-${rx.prescription_id}`}
                />
                <RowAction
                  icon="create-outline"
                  label="Edit"
                  onPress={() => router.push({ pathname: '/prescriptions/new', params: { rxId: rx.prescription_id } } as any)}
                  testID={`rx-edit-${rx.prescription_id}`}
                />
                <RowAction
                  icon="print-outline"
                  label="Print"
                  loading={busyId === `${rx.prescription_id}:print`}
                  onPress={() => runPrint(rx.prescription_id)}
                  testID={`rx-print-${rx.prescription_id}`}
                />
                <RowAction
                  icon="download-outline"
                  label="PDF"
                  loading={busyId === `${rx.prescription_id}:pdf`}
                  onPress={() => runDownload(rx.prescription_id)}
                  testID={`rx-pdf-${rx.prescription_id}`}
                />
                {isOwner && (
                  <RowAction
                    icon="trash-outline"
                    label="Delete"
                    color={COLORS.accent}
                    loading={busyId === `${rx.prescription_id}:delete`}
                    onPress={() => runDelete(rx.prescription_id)}
                    testID={`rx-del-${rx.prescription_id}`}
                  />
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RowAction({
  icon,
  label,
  onPress,
  loading,
  color,
  testID,
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
    <TouchableOpacity onPress={onPress} disabled={loading} style={styles.rowAction} testID={testID}>
      {loading ? <ActivityIndicator size="small" color={c} /> : <Ionicons name={icon} size={16} color={c} />}
      <Text style={[styles.rowActionText, { color: c }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center' },
  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rxPatient: { ...FONTS.h4, color: COLORS.textPrimary },
  rxDate: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  rxPill: { backgroundColor: COLORS.primary + '18', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10 },
  rxPillText: { ...FONTS.label, color: COLORS.primary, fontSize: 10 },
  rxReason: { ...FONTS.body, color: COLORS.textPrimary, marginTop: 8 },
  rxMeds: { ...FONTS.body, color: COLORS.primary, fontSize: 12, marginTop: 6 },

  actionRow: { flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border, justifyContent: 'space-around' },
  rowAction: { alignItems: 'center', justifyContent: 'center', flex: 1, paddingVertical: 6, gap: 3 },
  rowActionText: { ...FONTS.label, fontSize: 10 },
});
