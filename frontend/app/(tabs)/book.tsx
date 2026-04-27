import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { addDays, format } from 'date-fns';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PrimaryButton, SecondaryButton, Card } from '../../src/components';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { displayDateLong, display12h } from '../../src/date';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useI18n } from '../../src/i18n';
import LanguageDropdown from '../../src/language-dropdown';
import { haptics } from '../../src/haptics';
import { addBookingToCalendar } from '../../src/calendar';
import { scheduleBookingReminders, REMINDER_LEADS, ReminderLead, labelFor } from '../../src/booking-reminders';
import { CountryCodePicker, DEFAULT_COUNTRY, Country } from '../../src/country-code-picker';

const FALLBACK_SLOTS = [
  '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UNUSED_FALLBACK = FALLBACK_SLOTS;

export default function Book() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const insets = useSafeAreaInsets();
  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [age, setAge] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other' | ''>('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'in-person' | 'online'>('in-person');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<any>(null);
  // Reminder customisation — after booking is confirmed, show chips so
  // patient can pick lead times for local push reminders.
  const [selectedReminders, setSelectedReminders] = useState<ReminderLead[]>(['1d', '1h']);
  const [remindersScheduled, setRemindersScheduled] = useState<number | null>(null);
  const [schedulingReminders, setSchedulingReminders] = useState(false);
  // Duplicate patient detection
  const [duplicateInfo, setDuplicateInfo] = useState<{ open_count: number; next: any } | null>(null);

  const dates = useMemo(() => Array.from({ length: 90 }, (_, i) => addDays(new Date(), i)), []);
  const [date, setDate] = useState(dates[0]);
  const [slot, setSlot] = useState('10:00');
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  // Set when /availability/slots returns an explicit unavailable_reason
  // (doctor marked the date / time-range off). Lets us render a
  // doctor-specific message instead of the generic "no remaining slots".
  const [unavailReason, setUnavailReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      try {
        const iso = format(date, 'yyyy-MM-dd');
        const { data } = await api.get('/availability/slots', {
          params: { date: iso, mode },
        });
        if (cancelled) return;
        const next: string[] = (data && Array.isArray(data.slots) ? data.slots : []) as string[];
        setAvailableSlots(next);
        setUnavailReason(data?.unavailable_reason || null);
        if (next.length && !next.includes(slot)) {
          setSlot(next[0]);
        }
      } catch {
        if (!cancelled) { setAvailableSlots([]); setUnavailReason(null); }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, mode]);

  // Debounced duplicate-patient check when user enters phone number
  useEffect(() => {
    const digits = (phone || '').replace(/\D/g, '');
    if (digits.length < 6) {
      setDuplicateInfo(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const { data } = await api.get('/bookings/check-duplicate', { params: { phone: digits } });
        if (!cancelled) {
          if ((data?.open_count || 0) > 0) {
            setDuplicateInfo({ open_count: data.open_count, next: data.next });
          } else {
            setDuplicateInfo(null);
          }
        }
      } catch {
        if (!cancelled) setDuplicateInfo(null);
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [phone]);

  const submit = async () => {
    if (!patientName || !phone || !reason) {
      Alert.alert(t('book.missingTitle'), t('book.missingBody'));
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/bookings', {
        patient_name: patientName,
        patient_phone: phone.replace(/\D/g, ''),
        country_code: `+${country.dial}`,
        patient_age: age ? parseInt(age, 10) : undefined,
        patient_gender: gender || undefined,
        reason,
        booking_date: format(date, 'yyyy-MM-dd'),
        booking_time: slot,
        mode,
      });
      setConfirmed(data);
      haptics.success();
      // Persist the phone locally for guests so My Bookings can auto-fetch
      // their history without re-prompting. Authenticated users get their
      // bookings via /bookings/me so this is only needed for anonymous.
      if (!user) {
        try {
          await AsyncStorage.setItem('guest_phone', phone);
          await AsyncStorage.setItem('guest_last_name', patientName);
        } catch {}
      }
    } catch (e: any) {
      haptics.error();
      // Soft block: phone-first signups must add an email before booking.
      const det = e?.response?.data?.detail;
      const code = typeof det === 'object' ? (det as any)?.code : undefined;
      if (code === 'EMAIL_REQUIRED_FOR_BOOKING') {
        const message = (typeof det === 'object' ? (det as any)?.message : '') ||
          'Please add an email address to your profile before booking.';
        Alert.alert(
          t('book.emailNeededTitle') || 'Email required',
          message,
          [
            { text: t('book.cancel') || 'Cancel', style: 'cancel' },
            { text: t('book.addEmail') || 'Add email', onPress: () => router.push('/profile' as any) },
          ],
        );
        return;
      }
      const msg = typeof det === 'string' ? det : (det as any)?.message;
      Alert.alert(t('book.bookingFailed'), msg || t('book.tryAgain'));
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <ScrollView contentContainerStyle={{ padding: 24 }}>
          <View style={styles.successBadge}>
            <Ionicons name="time" size={40} color="#fff" />
          </View>
          <Text style={styles.successTitle}>{t('book.requestedTitle')}</Text>
          <Text style={styles.successSub}>{t('book.awaitingConfirm')}</Text>

          <Card style={{ marginTop: 24 }}>
            <Row label={t('book.bookingId')} value={confirmed.booking_id} />
            <Row label={t('book.patient')} value={confirmed.patient_name} />
            <Row label={t('book.requestedDate')} value={displayDateLong(confirmed.booking_date)} />
            <Row label={t('book.requestedTime')} value={display12h(confirmed.booking_time)} />
            <Row
              label={t('book.modeLabel')}
              value={confirmed.mode === 'online' ? t('book.modeOnlineFull') : t('book.modeInPersonFull')}
            />
            <Row label={t('book.statusLabel')} value={t('book.statusRequested')} last />
          </Card>

          {confirmed.mode === 'online' && (
            <PrimaryButton
              title={t('book.openWhatsApp')}
              onPress={() =>
                Linking.openURL(
                  `whatsapp://send?phone=918155075669&text=${encodeURIComponent(
                    t('book.whatsappMsg', {
                      date: confirmed.booking_date,
                      time: display12h(confirmed.booking_time),
                      id: confirmed.booking_id,
                    })
                  )}`
                )
              }
              icon={<Ionicons name="logo-whatsapp" size={20} color="#fff" />}
              testID="booking-whatsapp-button"
              style={{ marginTop: 16 }}
            />
          )}

          {/* Reminder customisation */}
          <View style={styles.reminderCard} testID="booking-reminder-card">
            <View style={styles.reminderHead}>
              <Ionicons name="alarm-outline" size={18} color={COLORS.primary} />
              <Text style={styles.reminderTitle}>{t('book.reminderTitle')}</Text>
            </View>
            <Text style={styles.reminderSub}>
              {Platform.OS === 'web' ? t('book.reminderSubWeb') : t('book.reminderSubMobile')}
            </Text>
            <View style={styles.reminderChipRow}>
              {REMINDER_LEADS.map((lead) => {
                const active = selectedReminders.includes(lead.key);
                const chipDisabled = Platform.OS === 'web';
                return (
                  <TouchableOpacity
                    key={lead.key}
                    disabled={chipDisabled}
                    onPress={() => {
                      haptics.select();
                      setSelectedReminders((prev) =>
                        active ? prev.filter((k) => k !== lead.key) : [...prev, lead.key]
                      );
                      setRemindersScheduled(null);
                    }}
                    style={[
                      styles.reminderChip,
                      active && styles.reminderChipActive,
                      chipDisabled && { opacity: 0.55 },
                    ]}
                    testID={`booking-reminder-chip-${lead.key}`}
                  >
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={active ? '#fff' : COLORS.primary}
                    />
                    <Text style={[styles.reminderChipText, active && { color: '#fff' }]}>
                      {labelFor(lead.key, lang)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {Platform.OS === 'web' ? (
              <View style={[styles.reminderCta, { backgroundColor: COLORS.textDisabled + '44' }]}>
                <Ionicons name="phone-portrait-outline" size={16} color={COLORS.textSecondary} />
                <Text style={[styles.reminderCtaText, { color: COLORS.textSecondary }]}>
                  {t('book.availableOnMobile')}
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                disabled={schedulingReminders || selectedReminders.length === 0 || remindersScheduled !== null && remindersScheduled > 0}
                onPress={async () => {
                  setSchedulingReminders(true);
                  haptics.tap();
                  try {
                    const n = await scheduleBookingReminders(
                      {
                        booking_id: confirmed.booking_id,
                        booking_date: confirmed.booking_date,
                        booking_time: confirmed.booking_time,
                        patient_name: confirmed.patient_name,
                        mode: confirmed.mode,
                      },
                      selectedReminders
                    );
                    setRemindersScheduled(n);
                    if (n > 0) {
                      haptics.success();
                      Alert.alert(
                        t('book.remindersSavedTitle'),
                        selectedReminders.length > 1
                          ? t('book.remindersSavedBodyMany', { n: selectedReminders.length })
                          : t('book.remindersSavedBodyOne')
                      );
                    } else {
                      haptics.warning();
                      Alert.alert(
                        t('book.remindersFailedTitle'),
                        t('book.remindersFailedBody'),
                        [{ text: 'OK' }]
                      );
                    }
                  } catch (e: any) {
                    haptics.error();
                    Alert.alert(t('book.errorTitle'), e?.message || t('book.genericError'));
                  } finally {
                    setSchedulingReminders(false);
                  }
                }}
                style={[
                  styles.reminderCta,
                  (schedulingReminders ||
                    selectedReminders.length === 0 ||
                    (remindersScheduled !== null && remindersScheduled > 0)) && { opacity: 0.65 },
                  remindersScheduled !== null && remindersScheduled > 0 && { backgroundColor: COLORS.success },
                ]}
                testID="booking-reminder-save"
                activeOpacity={0.85}
              >
                {schedulingReminders ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : remindersScheduled !== null && remindersScheduled > 0 ? (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color="#fff" />
                    <Text style={styles.reminderCtaText}>
                      {remindersScheduled > 1
                        ? t('book.reminderSetMany', { n: remindersScheduled })
                        : t('book.reminderSetOne', { n: remindersScheduled })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="notifications" size={16} color="#fff" />
                    <Text style={styles.reminderCtaText}>
                      {selectedReminders.length === 0
                        ? t('book.pickAtLeastOne')
                        : selectedReminders.length > 1
                        ? t('book.setReminderMany', { n: selectedReminders.length })
                        : t('book.setReminderOne', { n: selectedReminders.length })}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>

          <SecondaryButton
            title={t('book.addToCalendar')}
            onPress={async () => {
              const ok = await addBookingToCalendar({
                booking_id: confirmed.booking_id,
                booking_date: confirmed.booking_date,
                booking_time: confirmed.booking_time,
                patient_name: confirmed.patient_name,
                mode: confirmed.mode,
                reason: confirmed.reason,
              });
              if (ok) haptics.success();
            }}
            icon={<Ionicons name="calendar-outline" size={18} color={COLORS.primary} />}
            style={{ marginTop: confirmed.mode === 'online' ? 10 : 16 }}
            testID="booking-add-to-calendar"
          />

          <SecondaryButton
            title={t('book.viewMyBookings')}
            onPress={() => router.push('/my-bookings')}
            icon={<Ionicons name="calendar-outline" size={18} color={COLORS.primary} />}
            style={{ marginTop: 10 }}
            testID="booking-view-mine"
          />

          <SecondaryButton
            title={t('book.bookAnother')}
            onPress={() => {
              setConfirmed(null);
              setPatientName('');
              setPhone('');
              setAge('');
              setReason('');
            }}
            style={{ marginTop: 12 }}
            testID="booking-new-button"
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 + insets.bottom }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <Text style={styles.title}>{t('book.title')}</Text>
            <LanguageDropdown testID="book-lang" />
          </View>
          <Text style={styles.subtitle}>{t('book.subtitleAlt')}</Text>

          {!user && (
            <View style={styles.guestBanner} testID="booking-guest-banner">
              <View style={styles.guestIconWrap}>
                <Ionicons name="information-circle" size={22} color={COLORS.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.guestTitle}>{t('book.guestTitle')}</Text>
                <Text style={styles.guestSub}>{t('book.guestSub')}</Text>
                <TouchableOpacity
                  onPress={() => router.push('/(tabs)/more')}
                  style={styles.guestBtn}
                  testID="booking-signin-cta"
                >
                  <Ionicons name="log-in-outline" size={14} color={COLORS.primary} />
                  <Text style={styles.guestBtnText}>{t('book.signIn')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Mode */}
          <View style={styles.modeRow}>
            {(['in-person', 'online'] as const).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modePill, mode === m && styles.modePillActive]}
                onPress={() => { haptics.select(); setMode(m); }}
                testID={`booking-mode-${m}`}
              >
                <Ionicons
                  name={m === 'in-person' ? 'medical' : 'logo-whatsapp'}
                  size={16}
                  color={mode === m ? '#fff' : COLORS.primary}
                />
                <Text style={[styles.modeText, mode === m && { color: '#fff' }]}>
                  {m === 'in-person' ? t('book.inPersonPill') : t('book.onlinePill')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Date Picker Horizontal */}
          <Text style={styles.sectionLabel}>{t('book.selectDate')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 10 }}>
            {dates.map((d, idx) => {
              const selected = format(d, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd');
              const isToday = idx === 0;
              return (
                <TouchableOpacity
                  key={d.toISOString()}
                  onPress={() => { haptics.select(); setDate(d); }}
                  style={[styles.dateCard, selected && styles.dateCardActive, isToday && !selected && { borderColor: COLORS.primary, borderWidth: 1.5 }]}
                  testID={`booking-date-${format(d, 'yyyy-MM-dd')}`}
                >
                  <Text style={[styles.dateDay, selected && { color: '#fff' }, isToday && !selected && { color: COLORS.primary, fontWeight: '700' }]}>
                    {isToday ? t('book.today') : format(d, 'EEE')}
                  </Text>
                  <Text style={[styles.dateNum, selected && { color: '#fff' }]}>{format(d, 'dd')}</Text>
                  <Text style={[styles.dateMon, selected && { color: '#fff' }]}>{format(d, 'MMM')}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Slot Picker */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{t('book.selectSlot')}</Text>
          {slotsLoading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginTop: 10 }} />
          ) : availableSlots.length === 0 ? (
            <View style={{ marginTop: 10, padding: 14, backgroundColor: COLORS.warning + '18', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.warning + '55' }}>
              <Text style={{ ...FONTS.body, color: COLORS.warning, fontSize: 13 }}>
                {unavailReason
                  ? `Doctor is unavailable: ${unavailReason}`
                  : format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')
                  ? t('book.noSlotsToday', { mode: mode === 'online' ? t('book.modeOnlineWord') : t('book.modeInPersonWord') })
                  : t('book.noSlots', { mode: mode === 'online' ? t('book.modeOnlineWord') : t('book.modeInPersonWord') })}
              </Text>
            </View>
          ) : (
            <View style={styles.slotGrid}>
              {availableSlots.map((s) => {
                const selected = s === slot;
                return (
                  <TouchableOpacity
                    key={s}
                    onPress={() => { haptics.select(); setSlot(s); }}
                    style={[styles.slot, selected && styles.slotActive]}
                    testID={`booking-slot-${s}`}
                  >
                    <Text style={[styles.slotText, selected && { color: '#fff' }]}>{display12h(s)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Form Fields */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{t('book.patientDetails')}</Text>
          <Input label={t('book.fullNameLabel')} value={patientName} onChangeText={setPatientName} testID="booking-name" />

          {/* Phone with country-code picker — compact, tight spacing */}
          <View style={{ marginTop: 12 }}>
            <Text style={styles.fieldLabel}>{t('book.phoneLabel')}</Text>
            <View style={styles.phoneRow}>
              <CountryCodePicker value={country} onChange={setCountry} testID="booking-country" />
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder={t('book.mobilePh')}
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="phone-pad"
                style={[styles.input, { flex: 1, marginTop: 0 }]}
                testID="booking-phone"
              />
            </View>
          </View>
          {duplicateInfo && (
            <View style={styles.dupBanner} testID="booking-duplicate-banner">
              <Ionicons name="warning" size={18} color={COLORS.warning} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.dupTitle}>
                  {duplicateInfo.open_count === 1
                    ? t('book.dupOne')
                    : t('book.dupMany', { n: duplicateInfo.open_count })}
                </Text>
                {duplicateInfo.next ? (
                  <Text style={styles.dupSub}>
                    {t('book.dupNext', {
                      date: displayDateLong(duplicateInfo.next.booking_date),
                      time: display12h(duplicateInfo.next.booking_time),
                      status: duplicateInfo.next.status,
                    })}
                  </Text>
                ) : null}
                <TouchableOpacity onPress={() => router.push('/my-bookings')}>
                  <Text style={styles.dupLink}>{t('book.viewMyBookingsArrow')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Input label={t('book.ageLabel')} value={age} onChangeText={setAge} keyboardType="number-pad" testID="booking-age" />
            </View>
          </View>
          <View style={{ marginTop: 10 }}>
            <Text style={styles.fieldLabel}>{t('book.genderLabel')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              {(['Male', 'Female', 'Other'] as const).map((g) => (
                <TouchableOpacity
                  key={g}
                  onPress={() => { haptics.select(); setGender(g); }}
                  style={[
                    styles.genderChip,
                    gender === g && { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                  ]}
                  testID={`booking-gender-${g.toLowerCase()}`}
                >
                  <Text style={[styles.genderText, gender === g && { color: '#fff' }]}>
                    {g === 'Male' ? t('book.genderMale') : g === 'Female' ? t('book.genderFemale') : t('book.genderOther')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Input
            label={t('book.reasonLabel')}
            value={reason}
            onChangeText={setReason}
            multiline
            testID="booking-reason"
          />

          <PrimaryButton
            title={submitting ? t('book.submitting') : availableSlots.length === 0 ? t('book.notAvailable') : t('book.submit')}
            onPress={submit}
            testID="booking-submit-button"
            style={{ marginTop: 24 }}
            icon={<Ionicons name="checkmark-circle" size={20} color="#fff" />}
            disabled={submitting || availableSlots.length === 0}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Input(props: any) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, props.multiline && { height: 80, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.detailRow, !last && { borderBottomWidth: 1, borderBottomColor: COLORS.border }]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 2 },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
    flex: 1,
    justifyContent: 'center',
  },
  modePillActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  modeText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 12 },
  dateCard: {
    width: 64,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dateCardActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateDay: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary, textTransform: 'uppercase' },
  dateNum: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 22, marginTop: 2 },
  dateMon: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary, marginTop: 2 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  slot: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  slotActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  slotText: { ...FONTS.bodyMedium, color: COLORS.textPrimary },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary },
  input: {
    marginTop: 6,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...FONTS.body,
    color: COLORS.textPrimary,
  },
  genderChip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
    flex: 1,
    alignItems: 'center',
  },
  // Phone row: country pill sits snug next to the input (6px gap).
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  genderText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 13 },
  successBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.warning,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 30,
  },
  successTitle: { ...FONTS.h1, color: COLORS.textPrimary, textAlign: 'center', marginTop: 16 },
  successSub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 4 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  detailLabel: { ...FONTS.body, color: COLORS.textSecondary },
  detailValue: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1, textAlign: 'right', marginLeft: 10 },
  guestBanner: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    marginTop: 16,
    backgroundColor: COLORS.warning + '14',
    borderWidth: 1,
    borderColor: COLORS.warning + '55',
    borderRadius: RADIUS.md,
  },
  guestIconWrap: { marginTop: 1 },
  guestTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  guestSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  guestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
  },
  guestBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  dupBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 12,
    marginTop: 10,
    backgroundColor: COLORS.warning + '18',
    borderWidth: 1,
    borderColor: COLORS.warning + '55',
    borderRadius: RADIUS.md,
  },
  dupTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  dupSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  dupLink: { ...FONTS.bodyMedium, color: COLORS.primary, marginTop: 6, fontSize: 12 },

  // Reminder customisation card (post-confirm)
  reminderCard: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.primary + '33',
    shadowColor: '#0E7C8B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  reminderHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15, flex: 1 },
  reminderSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  reminderChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  reminderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.primary + '44',
    backgroundColor: '#fff',
  },
  reminderChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  reminderChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  reminderCta: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  reminderCtaText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  reminderNote: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 10,
    fontStyle: 'italic',
    lineHeight: 15,
  },
});
