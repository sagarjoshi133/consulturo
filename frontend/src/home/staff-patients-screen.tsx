/**
 * StaffPatientsScreen — Lightweight "Patients" tab rendered for staff
 * roles inside the (tabs)/tools.tsx slot.
 *
 * Provides:
 *   • Phone-number search (uses /api/patients/lookup)
 *   • Quick result card with reg-no, name, last visit
 *   • Tap-through to /dashboard?tab=consultations for full history
 *
 * The full patient directory + grouped consultation history already
 * lives inside the dashboard ConsultationsPanel; this tab is a fast
 * lookup surface so reception / staff can quickly find a returning
 * patient by their phone digits.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import api from '../api';
import { COLORS, FONTS, RADIUS } from '../theme';
import { CockpitHeader, SectionHeader, Card } from './cockpit-ui';

type LookupResult = {
  found: boolean;
  phone?: string;
  reg_no?: string;
  name?: string;
  last_visit?: string;
  age?: number;
  gender?: string;
};

type HistoryItem = {
  id: string;
  patient_name?: string;
  booking_date?: string;
  start_time?: string;
  status?: string;
  reg_no?: string;
};

export default function StaffPatientsScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');

  const doLookup = useCallback(async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 6) {
      setError('Enter at least 6 digits');
      return;
    }
    setError('');
    setLoading(true);
    setResult(null);
    setHistory([]);
    try {
      const [lookup, hist] = await Promise.allSettled([
        api.get('/patients/lookup', { params: { phone: digits } }),
        api.get('/patients/history', { params: { phone: digits } }),
      ]);
      if (lookup.status === 'fulfilled') setResult(lookup.value.data);
      if (hist.status === 'fulfilled') {
        const raw = hist.value.data;
        const items: HistoryItem[] = Array.isArray(raw) ? raw : raw?.items || raw?.bookings || [];
        setHistory(items.slice(0, 8));
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [phone]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <CockpitHeader subtitle="Look up a patient by phone number" />

          {/* Quick access to the full patient directory + Unregistered tab.
              This is the primary browse surface — search below is a
              secondary phone-first shortcut. */}
          <TouchableOpacity
            onPress={() => router.push('/patients' as any)}
            activeOpacity={0.8}
            style={styles.directoryTile}
            testID="staff-patients-open-directory"
          >
            <View style={styles.directoryIcon}>
              <Ionicons name="people-circle" size={28} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.directoryTitle}>Patient directory</Text>
              <Text style={styles.directorySub}>
                Registered · Unregistered (walk-ins) · All
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>

          {/* Search box */}
          <View style={styles.searchRow}>
            <View style={styles.inputWrap}>
              <Ionicons name="call" size={16} color={COLORS.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                value={phone}
                onChangeText={(v) => { setPhone(v); setError(''); }}
                placeholder="Phone number (last 10 digits)"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="phone-pad"
                style={styles.input}
                onSubmitEditing={doLookup}
                returnKeyType="search"
                testID="staff-patients-input"
              />
            </View>
            <TouchableOpacity
              onPress={doLookup}
              style={styles.searchBtn}
              activeOpacity={0.85}
              testID="staff-patients-search"
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="search" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>
          {!!error && <Text style={styles.errText}>{error}</Text>}

          {/* Result */}
          {result && (
            <>
              <SectionHeader title="Patient" />
              {result.found ? (
                <Card>
                  <View style={styles.cardRow}>
                    <View style={styles.avatarBlock}>
                      <Ionicons name="person" size={26} color={COLORS.primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.patientName} numberOfLines={1}>
                        {result.name || 'Unnamed'}
                      </Text>
                      <Text style={styles.patientMeta} numberOfLines={2}>
                        {result.reg_no ? `Reg #${result.reg_no} · ` : ''}
                        {result.phone || phone}
                        {result.age ? ` · ${result.age}y` : ''}
                        {result.gender ? ` · ${result.gender}` : ''}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                    <TouchableOpacity
                      style={styles.actionPill}
                      onPress={() => router.push(`/(tabs)/book?phone=${encodeURIComponent(result.phone || phone)}&name=${encodeURIComponent(result.name || '')}` as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="calendar" size={14} color={COLORS.primary} />
                      <Text style={styles.actionPillText}>Book</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionPill}
                      onPress={() => router.push('/dashboard?tab=consultations' as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="medkit" size={14} color={COLORS.primary} />
                      <Text style={styles.actionPillText}>Consults</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionPill}
                      onPress={() => router.push('/dashboard?tab=prescriptions' as any)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="document-text" size={14} color={COLORS.primary} />
                      <Text style={styles.actionPillText}>Rx</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              ) : (
                <Card>
                  <View style={styles.cardRow}>
                    <Ionicons name="information-circle" size={22} color={COLORS.textSecondary} />
                    <Text style={[styles.patientMeta, { marginLeft: 8 }]}>
                      No patient found for this phone. You can still create a booking.
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.actionPill, { alignSelf: 'flex-start', marginTop: 12 }]}
                    onPress={() => router.push(`/(tabs)/book?phone=${encodeURIComponent(phone)}` as any)}
                  >
                    <Ionicons name="add" size={14} color={COLORS.primary} />
                    <Text style={styles.actionPillText}>Create booking</Text>
                  </TouchableOpacity>
                </Card>
              )}
            </>
          )}

          {/* History */}
          {result?.found && history.length > 0 && (
            <>
              <SectionHeader
                title="Recent visits"
                rightLabel="Full history"
                onRightPress={() => router.push('/dashboard?tab=consultations' as any)}
              />
              <Card style={{ padding: 0 }}>
                {history.map((h, idx) => (
                  <View key={h.id || idx} style={[styles.histRow, idx > 0 && styles.rowDivider]}>
                    <View style={styles.dateBubble}>
                      <Text style={styles.dateText}>{(h.booking_date || '').slice(5) || '—'}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.histStatus} numberOfLines={1}>
                        {(h.status || '—').toUpperCase()}
                      </Text>
                      <Text style={styles.histMeta} numberOfLines={1}>
                        {h.start_time || ''}{h.reg_no ? ` · #${h.reg_no}` : ''}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            </>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <Card style={{ marginTop: 16 }}>
              <View style={{ alignItems: 'center', padding: 14 }}>
                <Ionicons name="people" size={32} color={COLORS.textSecondary} />
                <Text style={[styles.patientMeta, { textAlign: 'center', marginTop: 8 }]}>
                  Enter a phone number above to look up a patient.
                </Text>
                <TouchableOpacity
                  style={[styles.actionPill, { marginTop: 12 }]}
                  onPress={() => router.push('/dashboard?tab=consultations' as any)}
                >
                  <Ionicons name="list" size={14} color={COLORS.primary} />
                  <Text style={styles.actionPillText}>Open Consultations</Text>
                </TouchableOpacity>
              </View>
            </Card>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  input: {
    flex: 1,
    ...FONTS.body,
    fontSize: 14,
    color: COLORS.textPrimary,
    padding: 0,
  },
  searchBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errText: {
    ...FONTS.body,
    fontSize: 12,
    color: '#EF4444',
    marginTop: 6,
    marginLeft: 4,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarBlock: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: COLORS.primary + '18',
    justifyContent: 'center',
    alignItems: 'center',
  },
  patientName: {
    ...FONTS.body,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  patientMeta: {
    ...FONTS.body,
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: COLORS.primary + '12',
    borderRadius: 10,
  },
  actionPillText: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  dateBubble: {
    backgroundColor: COLORS.primary + '12',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 46,
    alignItems: 'center',
  },
  dateText: {
    ...FONTS.body,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  histStatus: {
    ...FONTS.body,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    letterSpacing: 0.3,
  },
  histMeta: {
    ...FONTS.body,
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  directoryTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  directoryIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: COLORS.primary + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  directoryTitle: {
    ...FONTS.body, fontSize: 15, fontWeight: '700', color: COLORS.textPrimary,
  },
  directorySub: {
    ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 2,
  },
});
