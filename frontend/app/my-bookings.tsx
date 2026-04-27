import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format } from 'date-fns';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { useToast } from '../src/toast';
import { useNotifications } from '../src/notifications';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { PrimaryButton } from '../src/components';
import { EmptyState } from '../src/empty-state';
import { useI18n } from '../src/i18n';
import { displayDate, displayDateLong, display12h } from '../src/date';
import { haptics } from '../src/haptics';
import { cancelBookingReminders } from '../src/booking-reminders';

type Booking = {
  booking_id: string;
  patient_name: string;
  patient_phone?: string;
  reason?: string;
  booking_date: string;
  booking_time: string;
  original_date?: string;
  original_time?: string;
  mode?: string;
  status?: string;
  confirmed_by_name?: string;
  confirmed_by_email?: string;
  confirmed_at?: string;
  approver_note?: string;
  cancellation_reason?: string;
  cancelled_by?: string;
  rejection_reason?: string;
  rejected_by_name?: string;
  reschedule_reason?: string;
  rescheduled_by_name?: string;
};

const statusColorFor = (s?: string) =>
  s === 'requested' ? COLORS.warning :
  s === 'confirmed' ? COLORS.success :
  s === 'completed' ? COLORS.primaryDark :
  s === 'cancelled' || s === 'rejected' ? COLORS.accent :
  COLORS.textSecondary;

export default function MyBookings() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { unread } = useNotifications();
  const { t } = useI18n();
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  // Guest flow state — phone number stored locally so patient doesn't
  // need to re-type it after the first booking.
  const [guestPhone, setGuestPhone] = useState<string>('');
  const [guestPhoneInput, setGuestPhoneInput] = useState<string>('');
  const [guestLoaded, setGuestLoaded] = useState(false);

  // Cancellation dialog state
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Bootstrap: pull saved guest_phone from AsyncStorage so returning
  // guests land straight on their bookings.
  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem('guest_phone');
        if (saved) {
          setGuestPhone(saved);
          setGuestPhoneInput(saved);
        }
      } catch {}
      setGuestLoaded(true);
    })();
  }, []);

  const loadAuthenticated = useCallback(async () => {
    try {
      const { data } = await api.get('/bookings/me');
      setItems(data || []);
    } catch {
      setItems([]);
    }
  }, []);

  const loadGuest = useCallback(async (phoneArg?: string) => {
    const p = (phoneArg ?? guestPhone).trim();
    if (!p) {
      setItems([]);
      return;
    }
    try {
      const { data } = await api.get('/bookings/guest', { params: { phone: p } });
      setItems(data || []);
    } catch {
      setItems([]);
    }
  }, [guestPhone]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (user) {
        await loadAuthenticated();
      } else if (guestPhone) {
        await loadGuest();
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user, guestPhone, loadAuthenticated, loadGuest]);

  useFocusEffect(
    useCallback(() => {
      if (guestLoaded) {
        load();
      }
    }, [guestLoaded, load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onGuestLookup = async () => {
    const p = guestPhoneInput.trim();
    if (p.replace(/\D/g, '').length < 6) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setGuestPhone(p);
    try { await AsyncStorage.setItem('guest_phone', p); } catch {}
    await loadGuest(p);
  };

  const onClearGuestPhone = async () => {
    setGuestPhone('');
    setGuestPhoneInput('');
    setItems([]);
    try { await AsyncStorage.removeItem('guest_phone'); } catch {}
  };

  const { upcoming, past } = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const up: Booking[] = [];
    const ps: Booking[] = [];
    for (const b of items) {
      const isFutureDate = (b.booking_date || '') >= today;
      const isOpenStatus = b.status === 'requested' || b.status === 'confirmed';
      // Upcoming = future date with an open status. Cancelled/completed/rejected always go to Past.
      if (isFutureDate && isOpenStatus) up.push(b);
      else ps.push(b);
    }
    // Sort upcoming by soonest; past by most recent
    up.sort((a, b) => (a.booking_date + a.booking_time).localeCompare(b.booking_date + b.booking_time));
    ps.sort((a, b) => (b.booking_date + b.booking_time).localeCompare(a.booking_date + a.booking_time));
    return { upcoming: up, past: ps };
  }, [items]);

  const visibleList = tab === 'upcoming' ? upcoming : past;

  const openCancel = (b: Booking) => {
    setCancelTarget(b);
    setCancelReason('');
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const r = cancelReason.trim();
    if (!r) {
      toast.error('Please enter a reason');
      return;
    }
    setCancelling(true);
    try {
      const body: any = { reason: r };
      if (!user) body.patient_phone = guestPhone || cancelTarget.patient_phone;
      await api.post(`/bookings/${cancelTarget.booking_id}/cancel`, body);
      // Also cancel any local reminders this user scheduled for the booking
      await cancelBookingReminders(cancelTarget.booking_id);
      haptics.success();
      toast.success('Appointment cancelled');
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch (e: any) {
      haptics.error();
      toast.error(e?.response?.data?.detail || 'Could not cancel booking');
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancel = (b: Booking) => {
    const msg = `Cancel your ${displayDate(b.booking_date)} ${display12h(b.booking_time)} appointment?`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && !window.confirm(msg)) return;
      openCancel(b);
    } else {
      Alert.alert('Cancel appointment?', msg, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Cancel it', style: 'destructive', onPress: () => openCancel(b) },
      ]);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="bookings-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>My Bookings</Text>
        {user ? (
          <TouchableOpacity
            onPress={() => router.push('/notifications' as any)}
            style={styles.bellBtn}
            testID="bookings-bell"
          >
            <Ionicons name="notifications-outline" size={22} color={COLORS.textPrimary} />
            {unread > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : String(unread)}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['upcoming', 'past'] as const).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.tab, tab === k && styles.tabActive]}
            onPress={() => setTab(k)}
            testID={`bookings-tab-${k}`}
          >
            <Text style={[styles.tabText, tab === k && styles.tabTextActive]}>
              {k === 'upcoming' ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : !user && !guestPhone ? (
        // Guest onboarding: ask for phone
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={styles.guestCard}>
              <Ionicons name="call-outline" size={40} color={COLORS.primary} />
              <Text style={styles.guestTitle}>View bookings by phone</Text>
              <Text style={styles.guestSub}>
                Enter the phone number you used while booking. We'll show all appointments linked to it.
              </Text>
              <TextInput
                value={guestPhoneInput}
                onChangeText={setGuestPhoneInput}
                placeholder="Phone number"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="phone-pad"
                style={styles.phoneInput}
                testID="bookings-phone-input"
              />
              <PrimaryButton
                title="Find my bookings"
                onPress={onGuestLookup}
                style={{ marginTop: 12 }}
                testID="bookings-phone-lookup"
              />
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/more')}
                style={{ marginTop: 16, alignItems: 'center' }}
              >
                <Text style={styles.loginHint}>or Sign in for full experience</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : visibleList.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {!user && !!guestPhone && (
            <View style={[styles.guestPhoneBar, { marginHorizontal: 20, marginTop: 10 }]}>
              <Ionicons name="call" size={14} color={COLORS.textSecondary} />
              <Text style={styles.guestPhoneText} numberOfLines={1}>
                Showing bookings for {guestPhone}
              </Text>
              <TouchableOpacity onPress={onClearGuestPhone}>
                <Text style={styles.guestPhoneSwitch}>Change</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.emptyFlex}>
            <EmptyState
              icon={tab === 'upcoming' ? 'calendar-outline' : 'time-outline'}
              title={tab === 'upcoming' ? t('book.emptyUpcomingTitle') : t('book.emptyPastTitle')}
              subtitle={tab === 'upcoming' ? t('book.emptyUpcomingSub') : t('book.emptyPastSub')}
              ctaLabel={tab === 'upcoming' ? (past.length === 0 ? t('book.bookFirstVisit') : t('book.bookNext')) : undefined}
              onCta={tab === 'upcoming' ? () => router.push('/(tabs)/book') : undefined}
              testID="bookings-empty"
            />
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {!user && !!guestPhone && (
            <View style={styles.guestPhoneBar}>
              <Ionicons name="call" size={14} color={COLORS.textSecondary} />
              <Text style={styles.guestPhoneText} numberOfLines={1}>
                Showing bookings for {guestPhone}
              </Text>
              <TouchableOpacity onPress={onClearGuestPhone}>
                <Text style={styles.guestPhoneSwitch}>Change</Text>
              </TouchableOpacity>
            </View>
          )}

          {visibleList.map((b) => {
            const sColor = statusColorFor(b.status);
            const canCancel = b.status === 'requested' || b.status === 'confirmed';
            return (
              <View key={b.booking_id} style={styles.card}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    const suffix = !user && guestPhone ? `?phone=${encodeURIComponent(guestPhone)}` : '';
                    router.push(`/bookings/${b.booking_id}${suffix}` as any);
                  }}
                  testID={`bookings-card-${b.booking_id}`}
                >
                  <View style={styles.cardHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardDate}>
                        {displayDateLong(b.booking_date)} · {display12h(b.booking_time)}
                      </Text>
                      <Text style={styles.cardName}>{b.patient_name}</Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: sColor + '22' }]}>
                      <Text style={[styles.statusText, { color: sColor }]}>{b.status}</Text>
                    </View>
                  </View>
                  {b.reason ? <Text style={styles.cardReason} numberOfLines={2}>{b.reason}</Text> : null}
                  <View style={styles.cardFoot}>
                    <Ionicons name={b.mode === 'online' ? 'logo-whatsapp' : 'medical'} size={14} color={COLORS.primary} />
                    <Text style={styles.cardMode}>{b.mode === 'online' ? 'Online' : 'In-person'}</Text>
                    <Text style={styles.cardId}>ID: {b.booking_id}</Text>
                  </View>

                  {/* Rescheduled badge */}
                  {((b.original_date && b.original_date !== b.booking_date) ||
                    (b.original_time && b.original_time !== b.booking_time)) && (
                    <View style={styles.rescheduledBadge} testID={`bk-rescheduled-${b.booking_id}`}>
                      <Ionicons name="sync" size={12} color={COLORS.primary} />
                      <Text style={styles.rescheduledText} numberOfLines={2}>
                        Rescheduled from {displayDate(b.original_date || '')} {display12h(b.original_time || '')}
                        {b.rescheduled_by_name ? ` by ${b.rescheduled_by_name}` : ''}
                      </Text>
                    </View>
                  )}
                  {b.reschedule_reason ? (
                    <View style={styles.noteBubble}>
                      <Ionicons name="chatbubble-ellipses" size={12} color={COLORS.primary} style={{ marginTop: 2 }} />
                      <Text style={styles.noteText}>Reason: {b.reschedule_reason}</Text>
                    </View>
                  ) : null}

                  {/* Approver badge + note */}
                  {b.status === 'confirmed' && (b.confirmed_by_name || b.confirmed_by_email) && (
                    <View style={styles.approverRow}>
                      <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                      <Text style={styles.approverText}>
                        Confirmed by {b.confirmed_by_name || 'staff'}
                      </Text>
                    </View>
                  )}
                  {b.approver_note ? (
                    <View style={styles.noteBubble}>
                      <Ionicons name="chatbubble-ellipses" size={12} color={COLORS.primary} style={{ marginTop: 2 }} />
                      <Text style={styles.noteText}>{b.approver_note}</Text>
                    </View>
                  ) : null}

                  {/* Rejected */}
                  {b.status === 'rejected' ? (
                    <View style={styles.cancelReasonBox}>
                      <Ionicons name="close-circle" size={12} color={COLORS.accent} style={{ marginTop: 2 }} />
                      <Text style={styles.cancelReasonText}>
                        Rejected{b.rejected_by_name ? ` by ${b.rejected_by_name}` : ''}
                        {b.rejection_reason ? `: ${b.rejection_reason}` : ''}
                      </Text>
                    </View>
                  ) : null}

                  {/* Cancelled */}
                  {b.status === 'cancelled' && b.cancellation_reason ? (
                    <View style={styles.cancelReasonBox}>
                      <Ionicons name="close-circle" size={12} color={COLORS.accent} style={{ marginTop: 2 }} />
                      <Text style={styles.cancelReasonText}>
                        {b.cancelled_by === 'patient' ? 'You cancelled' : 'Cancelled by clinic'}: {b.cancellation_reason}
                      </Text>
                    </View>
                  ) : null}
                </TouchableOpacity>

                {canCancel && (
                  <TouchableOpacity
                    onPress={() => confirmCancel(b)}
                    style={styles.cancelBtn}
                    testID={`bookings-cancel-${b.booking_id}`}
                  >
                    <Ionicons name="close-circle-outline" size={16} color={COLORS.accent} />
                    <Text style={styles.cancelBtnText}>Cancel appointment</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Cancel reason modal */}
      <Modal
        visible={!!cancelTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelTarget(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => !cancelling && setCancelTarget(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Cancel appointment</Text>
            {cancelTarget ? (
              <Text style={styles.modalSub}>
                {displayDateLong(cancelTarget.booking_date)} · {display12h(cancelTarget.booking_time)}
              </Text>
            ) : null}
            <Text style={styles.modalLabel}>Reason *</Text>
            <TextInput
              value={cancelReason}
              onChangeText={setCancelReason}
              placeholder="Tell us why you're cancelling"
              placeholderTextColor={COLORS.textDisabled}
              multiline
              style={styles.reasonInput}
              testID="bookings-cancel-reason"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                onPress={() => setCancelTarget(null)}
                style={[styles.modalBtn, { borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }]}
                disabled={cancelling}
              >
                <Text style={[styles.modalBtnText, { color: COLORS.textSecondary }]}>Keep</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitCancel}
                style={[styles.modalBtn, { backgroundColor: COLORS.accent }]}
                disabled={cancelling}
                testID="bookings-cancel-confirm"
              >
                {cancelling ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>Cancel it</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border,
  },
  bellBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.accent,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2, borderColor: COLORS.bg,
  },
  bellBadgeText: { color: '#fff', fontSize: 10, fontFamily: 'Manrope_700Bold' },

  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 14, marginBottom: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  tabTextActive: { color: '#fff' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyFlex: { flex: 1, justifyContent: 'center' },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center' },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardDate: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  cardName: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { ...FONTS.label, fontSize: 10, textTransform: 'uppercase' },
  cardReason: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  cardMode: { ...FONTS.body, color: COLORS.primary, fontSize: 12, marginRight: 12 },
  cardId: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, marginLeft: 'auto' },
  approverRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  approverText: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 12 },
  rescheduledBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1, borderColor: COLORS.primary + '44',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  rescheduledText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12, flexShrink: 1 },
  noteBubble: { marginTop: 8, flexDirection: 'row', gap: 6, backgroundColor: COLORS.primary + '0A', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: COLORS.primary + '22' },
  noteText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 12, lineHeight: 18 },
  cancelReasonBox: { marginTop: 8, flexDirection: 'row', gap: 6, backgroundColor: COLORS.accent + '0D', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: COLORS.accent + '33' },
  cancelReasonText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 12, lineHeight: 18 },

  cancelBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingVertical: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.accent + '55',
    backgroundColor: COLORS.accent + '0A',
  },
  cancelBtnText: { ...FONTS.bodyMedium, color: COLORS.accent, fontSize: 13 },

  guestCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 24,
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center', marginTop: 10,
  },
  guestTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 10, textAlign: 'center' },
  guestSub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center', fontSize: 13 },
  phoneInput: {
    marginTop: 18, width: '100%',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    ...FONTS.body, color: COLORS.textPrimary,
  },
  loginHint: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },

  guestPhoneBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 10,
    backgroundColor: COLORS.primary + '0D',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.primary + '22',
  },
  guestPhoneText: { ...FONTS.body, color: COLORS.textSecondary, flex: 1, fontSize: 12 },
  guestPhoneSwitch: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 20 },
  modalTitle: { ...FONTS.h3, color: COLORS.textPrimary },
  modalSub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 13 },
  modalLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14, fontSize: 11 },
  reasonInput: {
    marginTop: 6,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 80, textAlignVertical: 'top',
    ...FONTS.body, color: COLORS.textPrimary,
  },
  modalBtn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  modalBtnText: { ...FONTS.bodyMedium, fontSize: 14 },
});
