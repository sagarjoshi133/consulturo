import React, { useCallback, useState } from 'react';
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
  Linking,
  Modal,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { displayDate, displayDateLong, display12h, parseBackendDate, formatIST } from '../../src/date';
import { ISODateField } from '../../src/date-picker';
import MessageComposer from '../../src/message-composer-lazy';
import { resolvePatientRecipient } from '../../src/message-recipient';
import {
  shouldShowStartCta,
  isVideoBooking,
  getConsultationWindow,
} from '../../src/consultation-window';
import VideoCallActions from '../../src/video-call-actions';
import AttachmentsCard from '../../src/video/AttachmentsCard';
import PayButton from '../../src/pay-button';
import { fetchClinicSettings, type ClinicSettings } from '../../src/clinic-settings';
type Booking = {
  booking_id: string;
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  patient_user_id?: string;
  country_code?: string;
  patient_age?: number;
  patient_gender?: string;
  booking_date?: string;
  booking_time?: string;
  original_date?: string;
  original_time?: string;
  mode?: string;
  status?: string;
  reason?: string;
  registration_no?: string;
  confirmed_by?: string;
  confirmed_by_name?: string;
  confirmed_by_email?: string;
  confirmed_at?: string;
  approver_note?: string;
  doctor_note?: string;
  last_note?: string;
  created_at?: string;
  payment_status?: string;
  paid_amount_inr?: number;
  payment_id?: string;
  paid_offline?: boolean;
  payment_mode?: string;
};

/**
 * Compose a plain E.164-style digit string for WhatsApp / tel: deep links.
 * - If the phone already starts with '+' or has >10 digits, assume it's
 *   already international and strip non-digits.
 * - Otherwise, prefix the stored country_code (default +91).
 */
function toInternationalDigits(countryCode?: string, phone?: string): string {
  if (!phone) return '';
  const raw = phone.trim();
  const digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return digits;
  if (digits.length > 10) return digits;
  const cc = (countryCode || '+91').replace(/\D/g, '');
  return cc + digits;
}

const statusColorFor = (s?: string) =>
  s === 'requested' ? COLORS.warning :
  s === 'confirmed' ? COLORS.success :
  s === 'completed' ? COLORS.primaryDark :
  COLORS.accent;

export default function BookingDetail() {
  // Honour `?embedded=1` so the same route can be loaded inside an
  // iframe (used by the tablet two-pane layout) without showing the
  // TopBar / safe-area gutter.
  const params = useLocalSearchParams<{ embedded?: string }>();
  const isEmbedded = params.embedded === '1' || params.embedded === 'true';
  return <BookingDetailPane embedded={isEmbedded} />;
}

/**
 * Named export — same UI as `BookingDetail` but allows the caller to
 * override the `id` via prop. Used by the tablet two-pane layout in
 * `BookingsPanel` so the right pane can render the selected booking
 * without performing a full route push.
 */
export function BookingDetailPane({ idOverride, embedded }: { idOverride?: string; embedded?: boolean } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const params = useLocalSearchParams<{ id: string; phone?: string; action?: string }>();
  const id = idOverride ?? params.id;
  const { phone, action } = params;
  const isStaff =
    user && (user.role === 'owner' || user.role === 'doctor' ||
             user.role === 'assistant' || user.role === 'staff' ||
             (user as any).can_approve_bookings);

  const [rx, setRx] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [clinicPhone, setClinicPhone] = useState<string>('');
  // Reason modal (for reschedule / reject by staff)
  const [reasonModal, setReasonModal] = useState<null | 'reject' | 'reschedule' | 'cancel'>(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [reasonBusy, setReasonBusy] = useState(false);
  // Reschedule flow: staff picks a new date + time slot + reason
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [rescheduleSlots, setRescheduleSlots] = useState<string[]>([]);
  const [rescheduleSlotsLoading, setRescheduleSlotsLoading] = useState(false);
  // Personal-message composer state.
  const [msgOpen, setMsgOpen] = useState(false);
  const [msgRecipient, setMsgRecipient] = useState<any>(null);
  // Safe-area inset for the ScrollView so action buttons don't sit under
  // the Android gesture bar / iOS home indicator.
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      const params: any = {};
      if (!user && phone) params.phone = phone;
      const { data } = await api.get(`/bookings/${id}`, { params });
      setRx(data);
      setNoteDraft(data?.approver_note || '');
      // Load patient history (staff only — endpoint is staff-gated)
      if (isStaff && data?.patient_phone) {
        try {
          const hx = await api.get('/patients/history', { params: { phone: data.patient_phone } });
          setHistory((hx.data?.bookings || []).filter((b: any) => b.booking_id !== data.booking_id));
        } catch {
          setHistory([]);
        } finally {
          setHistoryLoaded(true);
        }
      }
      // Patient view: fetch clinic phone so Call/WhatsApp buttons dial the
      // clinic rather than the patient's own number.
      if (!isStaff) {
        try {
          const hp = await api.get('/settings/homepage');
          setClinicPhone(hp.data?.clinic_phone || '');
        } catch {
          setClinicPhone('');
        }
      }
    } catch {
      setRx(null);
    } finally {
      setLoading(false);
    }
  }, [id, user, phone, isStaff]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Load clinic settings once for the consultation fee.
  React.useEffect(() => {
    fetchClinicSettings().then(setClinicSettings).catch(() => {});
  }, []);

  const patch = async (body: any) => {
    try {
      const { data } = await api.patch(`/bookings/${id}`, body);
      setRx(data);
      setNoteDraft(data?.approver_note || '');
      setEditingNote(false);
      const label =
        body.status === 'confirmed' ? 'Appointment confirmed' :
        body.status === 'completed' ? 'Marked as done' :
        body.status === 'cancelled' ? 'Appointment cancelled' :
        body.status === 'rejected' ? 'Appointment rejected' :
        body.booking_date || body.booking_time ? 'Appointment rescheduled' :
        'Saved';
      toast.success(label);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not update');
    }
  };

  const openReasonFor = (kind: 'reject' | 'cancel') => {
    setReasonDraft('');
    setReasonModal(kind);
  };

  // When user enters reschedule mode, load available slots for the new date.
  React.useEffect(() => {
    if (reasonModal !== 'reschedule' || !rescheduleDate || !rx) {
      return;
    }
    let abort = false;
    (async () => {
      setRescheduleSlotsLoading(true);
      try {
        const { data } = await api.get('/availability/slots', {
          params: { date: rescheduleDate, mode: rx.mode || 'in-person' },
        });
        if (!abort) setRescheduleSlots(Array.isArray(data?.slots) ? data.slots : []);
      } catch {
        if (!abort) setRescheduleSlots([]);
      } finally {
        if (!abort) setRescheduleSlotsLoading(false);
      }
    })();
    return () => { abort = true; };
  }, [reasonModal, rescheduleDate, rx]);

  const submitReasonAction = async () => {
    if (!reasonModal) return;
    const reason = reasonDraft.trim();
    if (!reason) {
      toast.error('Please provide a reason');
      return;
    }
    if (reasonModal === 'reschedule') {
      if (!rescheduleDate || !rescheduleTime) {
        toast.error('Please pick a new date and time');
        return;
      }
    }
    setReasonBusy(true);
    try {
      if (reasonModal === 'reject') {
        await patch({ status: 'rejected', reason });
      } else if (reasonModal === 'cancel') {
        await patch({ status: 'cancelled', reason });
      } else if (reasonModal === 'reschedule') {
        await patch({
          booking_date: rescheduleDate,
          booking_time: rescheduleTime,
          reason,
          status: 'confirmed', // auto-confirm the rescheduled slot
        });
      }
      setReasonModal(null);
      setReasonDraft('');
      setRescheduleDate('');
      setRescheduleTime('');
      setRescheduleSlots([]);
    } finally {
      setReasonBusy(false);
    }
  };

  const saveNote = () => {
    patch({ status: rx?.status, note: noteDraft });
  };

  // Item 7 — re-render every 30 s so the consultation window stays live.
  // Must be declared BEFORE any early returns (Rules of Hooks).
  const [, setNowTick] = useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setNowTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  if (!rx) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={embedded ? [] : undefined}>
        {!embedded && <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} title="Appointment" />}
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={54} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>Not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sColor = statusColorFor(rx.status);
  const wasRescheduled =
    (rx.original_date && rx.original_date !== rx.booking_date) ||
    (rx.original_time && rx.original_time !== rx.booking_time);

  const showStart = shouldShowStartCta(rx);
  const isVideo = isVideoBooking(rx);
  const winInfo = getConsultationWindow(rx.booking_date, rx.booking_time);
  // When we landed here with ?action=start, expand the live "consultation
  // room" panel automatically so staff can see they've launched it.
  const liveRoomOpen = action === 'start' && rx.status === 'confirmed';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={embedded ? [] : undefined}>
      {!embedded && (
        <TopBar
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/' as any))}
          title="Appointment"
          rightIcon={isStaff ? 'medkit' : undefined}
          onRightPress={isStaff ? () => {
            router.push({
              pathname: '/ot-calendar/schedule',
              params: { booking_id: rx.booking_id },
            } as any);
          } : undefined}
        />
      )}
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 + insets.bottom }}>
        {/* Item 7 — Live consultation panel. Only visible to staff and only
            for confirmed appointments. Shows the green CTA when within
            ±15 min of the slot. When `action=start` is in the URL we
            also render a placeholder "consultation room" until the
            100ms video integration lands (Item 8). */}
        {isStaff && rx.status === 'confirmed' && (showStart || liveRoomOpen) && (
          <View style={styles.startCard}>
            <View style={styles.startCardHead}>
              <View style={[styles.startCardDot, { backgroundColor: showStart ? COLORS.success : '#9CA3AF' }]} />
              <Text style={styles.startCardTitle}>
                {liveRoomOpen ? (isVideo ? 'Tele-consultation in progress' : 'Consultation in progress')
                              : (isVideo ? 'Ready to join video' : 'Ready to start consultation')}
              </Text>
              {!!winInfo.label && (
                <View style={styles.startCardBadge}>
                  <Text style={styles.startCardBadgeText}>{winInfo.label}</Text>
                </View>
              )}
            </View>

            {liveRoomOpen ? (
              <View style={styles.liveRoom}>
                {isVideo ? (
                  <>
                    <Ionicons name="videocam-outline" size={48} color={COLORS.primary} />
                    <Text style={styles.liveRoomTitle}>Video room — coming soon</Text>
                    <Text style={styles.liveRoomBody}>
                      Once the 100ms integration is configured, the live tele-consultation
                      room will appear here with audio/video, screen-share and chat.
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="medkit-outline" size={48} color={COLORS.primary} />
                    <Text style={styles.liveRoomTitle}>Consultation started</Text>
                    <Text style={styles.liveRoomBody}>
                      Open the prescription tab to record the visit and generate the Rx.
                    </Text>
                    <TouchableOpacity
                      style={styles.liveRoomCta}
                      onPress={() => router.push({ pathname: '/prescriptions/new', params: { booking_id: rx.booking_id } } as any)}
                    >
                      <Ionicons name="document-text" size={16} color="#FFFFFF" />
                      <Text style={styles.liveRoomCtaText}>Create prescription</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : (
              <TouchableOpacity
                style={styles.startCardBtn}
                activeOpacity={0.85}
                onPress={() =>
                  router.replace({
                    pathname: '/bookings/[id]',
                    params: { id: rx.booking_id, action: 'start' },
                  } as any)
                }
                testID="bk-detail-start"
              >
                <Ionicons name={isVideo ? 'videocam' : 'play-circle'} size={18} color="#FFFFFF" />
                <Text style={styles.startCardBtnText}>
                  {isVideo ? 'Join video' : 'Start consultation'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Header card */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{rx.patient_name}</Text>
              <Text style={styles.sub}>
                {[rx.patient_age ? `${rx.patient_age} yrs` : '', rx.patient_gender || ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: sColor + '22' }]}>
              <Text style={[styles.statusText, { color: sColor }]}>{rx.status}</Text>
            </View>
          </View>
          <View style={styles.divider} />
          <Row label="Date" value={displayDateLong(rx.booking_date || '')} />
          <Row label="Time" value={display12h(rx.booking_time || '')} />
          {isStaff && rx.patient_phone ? (
            <Row
              label="Mobile"
              value={`${rx.country_code || '+91'} ${rx.patient_phone}`}
            />
          ) : null}
          {rx.mode ? <Row label="Mode" value={rx.mode === 'online' || rx.mode === 'video' ? 'Video' : 'In-person'} /> : null}
          {rx.registration_no ? <Row label="Reg. No." value={rx.registration_no} /> : null}
          {wasRescheduled && rx.status !== 'requested' ? (
            <Row label="Previously" value={`${displayDate(rx.original_date || '')} at ${display12h(rx.original_time || '')}`} valueColor={COLORS.accent} />
          ) : null}
          <Row label="Booking ID" value={rx.booking_id} mono />
          {rx.created_at ? (
            <Row label="Requested on" value={formatIST(parseBackendDate(rx.created_at), {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            })} />
          ) : null}
        </View>

        {/* Payment block — patient pays the consultation fee via Razorpay.
            Auto-hides when Razorpay is not activated (PayButton handles
            that). Owner / staff see the same block but with a "Paid"
            badge once the booking has been settled, so they can verify
            at-a-glance.
            When the booking was opened by staff over the phone, the
            payment is deferred (status: 'pending_offline'). In that
            case we show a clear "Pending payment" chip + a
            staff-only "Mark as paid" button that calls the
            mark-paid-offline endpoint. */}
        {!['rejected', 'cancelled'].includes((rx.status || '').toLowerCase()) && (
          <View style={styles.payCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.payTitle}>Consultation fee</Text>
              <Text style={styles.paySub}>
                {rx.payment_status === 'paid'
                  ? `Paid ₹${(rx.paid_amount_inr ?? clinicSettings?.consultation_fee_inr ?? 0).toFixed(0)} · ${rx.paid_offline ? (rx.payment_mode || 'offline') : 'Razorpay'}`
                  : rx.payment_status === 'pending_offline'
                    ? `₹${(clinicSettings?.consultation_fee_inr ?? 500).toFixed(0)} — to be collected on the day of visit`
                    : `₹${(clinicSettings?.consultation_fee_inr ?? 500).toFixed(0)} — UPI, card, netbanking`}
              </Text>
              {rx.payment_status === 'pending_offline' && (
                <View style={styles.pendingChip}>
                  <Ionicons name="time-outline" size={11} color="#92400E" />
                  <Text style={styles.pendingChipText}>Pending payment (offline)</Text>
                </View>
              )}
            </View>
            {rx.payment_status === 'pending_offline' && isStaff ? (
              <MarkPaidOfflineButton
                bookingId={rx.booking_id}
                defaultAmount={Number(clinicSettings?.consultation_fee_inr ?? 500)}
                onPaid={() => { void load(); }}
              />
            ) : (
              <PayButton
                amount={Number(clinicSettings?.consultation_fee_inr ?? 500)}
                targetKind="consultation"
                targetId={rx.booking_id}
                description={`Consultation · ${rx.patient_name || 'Patient'} · ${rx.booking_date || ''}`}
                paid={rx.payment_status === 'paid'}
                returnTo={`/bookings/${rx.booking_id}`}
                testID="booking-pay"
              />
            )}
          </View>
        )}

        {/* Approver badge + note */}
        {rx.status === 'confirmed' && (rx.confirmed_by_name || rx.confirmed_by) && (
          <View style={styles.approverCard}>
            <View style={styles.approverRow}>
              <View style={styles.approverAvatar}>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.approverTitle}>Confirmed by {rx.confirmed_by_name || 'staff'}</Text>
                {rx.confirmed_by_email ? (
                  <Text style={styles.approverEmail}>{rx.confirmed_by_email}</Text>
                ) : null}
                {rx.confirmed_at ? (
                  <Text style={styles.approverMeta}>
                    {formatIST(parseBackendDate(rx.confirmed_at), {
                      day: '2-digit', month: '2-digit', year: 'numeric',
                      hour: 'numeric', minute: '2-digit', hour12: true,
                    })}
                  </Text>
                ) : null}
              </View>
            </View>
            {editingNote ? (
              <View style={{ marginTop: 12 }}>
                <TextInput
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Note for the patient (e.g. carry past reports)"
                  placeholderTextColor={COLORS.textDisabled}
                  multiline
                  style={styles.noteInput}
                  testID="bk-note-input"
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <TouchableOpacity onPress={saveNote} style={[styles.smallBtn, { backgroundColor: COLORS.primary }]}>
                    <Text style={[styles.smallBtnText, { color: '#fff' }]}>Save note</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setEditingNote(false); setNoteDraft(rx.approver_note || ''); }}
                    style={[styles.smallBtn, { borderColor: COLORS.border, borderWidth: 1 }]}
                  >
                    <Text style={[styles.smallBtnText, { color: COLORS.textSecondary }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : rx.approver_note ? (
              <View style={styles.noteBubble}>
                <Ionicons name="chatbubble-ellipses" size={14} color={COLORS.primary} style={{ marginTop: 2 }} />
                <Text style={styles.noteText}>{rx.approver_note}</Text>
              </View>
            ) : isStaff ? (
              <TouchableOpacity onPress={() => setEditingNote(true)} style={styles.addNoteBtn} testID="bk-add-note">
                <Ionicons name="add" size={14} color={COLORS.primary} />
                <Text style={styles.addNoteText}>Add a note for the patient</Text>
              </TouchableOpacity>
            ) : null}
            {isStaff && rx.approver_note && !editingNote && (
              <TouchableOpacity onPress={() => setEditingNote(true)} style={styles.addNoteBtn} testID="bk-edit-note">
                <Ionicons name="create-outline" size={14} color={COLORS.primary} />
                <Text style={styles.addNoteText}>Edit note</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Reason */}
        {rx.reason ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Reason for visit</Text>
            <Text style={styles.body}>{rx.reason}</Text>
          </View>
        ) : null}

        {/* Phase 3.1 — Schedule Surgery CTA. Confirmed bookings can be
            converted into scheduled OT surgeries, prefilling patient
            details from this booking. Staff only. */}
        {isStaff && rx.status === 'confirmed' && (
          <TouchableOpacity
            style={styles.scheduleSurgeryBtn}
            onPress={() =>
              router.push({
                pathname: '/ot-calendar/schedule',
                params: { booking_id: rx.booking_id },
              } as any)
            }
            activeOpacity={0.85}
            testID="bk-schedule-surgery"
          >
            <Ionicons name="medical" size={18} color="#fff" />
            <Text style={styles.scheduleSurgeryText}>Schedule surgery for this patient</Text>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Reports & images — patient uploads, staff views.
            Available on every confirmed booking (in-person or online)
            so the patient can ship X-rays / USG / lab PDFs ahead of
            the visit. The card itself hides upload buttons for the
            staff role (see /src/video/AttachmentsCard.tsx). */}
        {rx.status === 'confirmed' && rx.booking_id && (
          <AttachmentsCard bookingId={rx.booking_id} isStaff={isStaff} />
        )}

        {/* Same-patient history — staff only */}
        {isStaff && historyLoaded && history.length > 0 && (
          <View style={styles.card} testID="bk-history-card">
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.sectionTitle}>Same patient history ({history.length})</Text>
            </View>
            {history.slice(0, 8).map((h: any) => {
              const hColor =
                h.status === 'requested' ? COLORS.warning :
                h.status === 'confirmed' ? COLORS.success :
                h.status === 'completed' ? COLORS.primaryDark :
                COLORS.accent;
              return (
                <TouchableOpacity
                  key={h.booking_id}
                  style={styles.hxRow}
                  onPress={() => router.push(`/bookings/${h.booking_id}` as any)}
                  testID={`bk-history-row-${h.booking_id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.hxDate}>
                      {displayDateLong(h.booking_date)} · {display12h(h.booking_time)}
                    </Text>
                    {h.reason ? <Text style={styles.hxReason} numberOfLines={1}>{h.reason}</Text> : null}
                  </View>
                  <View style={[styles.hxPill, { backgroundColor: hColor + '22' }]}>
                    <Text style={[styles.hxPillText, { color: hColor }]}>{h.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={COLORS.textDisabled} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              );
            })}
            {history.length > 8 && (
              <Text style={styles.hxMore}>+ {history.length - 8} more</Text>
            )}
          </View>
        )}

        {/* Contact actions */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {(() => {
            // Patient view → show clinic phone. Staff view → patient phone.
            const contactPhone = isStaff ? (rx.patient_phone || '') : (clinicPhone || '');
            const contactLabel = isStaff ? 'Call' : 'Call clinic';
            const waLabel = 'WhatsApp';
            if (!contactPhone) return null;
            // For staff → patient contact, compose with stored country_code so
            // the WhatsApp / tel deep-link always has a valid international
            // prefix (defaults to +91 for legacy records).
            const intlDigits = isStaff
              ? toInternationalDigits(rx.country_code, contactPhone)
              : contactPhone.replace(/\D/g, '');
            const telNumber = isStaff ? `+${intlDigits}` : contactPhone;
            const waMsg = isStaff
              ? (rx.status === 'confirmed'
                  ? `Dear ${rx.patient_name}, your appointment on ${displayDate(rx.booking_date)} at ${display12h(rx.booking_time)} is CONFIRMED with Dr. Sagar Joshi.`
                  : `Hello ${rx.patient_name}, regarding your appointment request on ${displayDate(rx.booking_date)}…`)
              : `Hello, I have a query regarding my appointment on ${displayDate(rx.booking_date)} at ${display12h(rx.booking_time)}. Booking ID: ${rx.booking_id}`;
            return (
              <>
                <TouchableOpacity
                  onPress={() => Linking.openURL(`tel:${telNumber}`)}
                  style={[styles.contactBtn, { borderColor: COLORS.primary }]}
                  testID="bk-call"
                >
                  <Ionicons name="call" size={16} color={COLORS.primary} />
                  <Text style={[styles.contactBtnText, { color: COLORS.primary }]} numberOfLines={1}>{contactLabel}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Linking.openURL(`https://wa.me/${intlDigits}?text=${encodeURIComponent(waMsg)}`)}
                  style={[styles.contactBtn, { borderColor: COLORS.whatsapp }]}
                  testID="bk-wa"
                >
                  <Ionicons name="logo-whatsapp" size={16} color={COLORS.whatsapp} />
                  <Text style={[styles.contactBtnText, { color: COLORS.whatsapp }]} numberOfLines={1}>{waLabel}</Text>
                </TouchableOpacity>
                {isStaff && rx.patient_phone && (
                  <TouchableOpacity
                    onPress={async () => {
                      const r = await resolvePatientRecipient({
                        patient_user_id: (rx as any).patient_user_id,
                        patient_name: rx.patient_name,
                        patient_phone: rx.patient_phone,
                        country_code: rx.country_code,
                        patient_email: (rx as any).patient_email,
                      });
                      if (r.ok) {
                        setMsgRecipient(r.recipient);
                        setMsgOpen(true);
                      } else if (r.reason === 'not_registered') {
                        toast.error(`${rx.patient_name || 'Patient'} hasn't installed the app yet — try WhatsApp instead.`);
                      } else if (r.reason === 'no_phone') {
                        toast.error('No phone on file for this patient');
                      } else {
                        toast.error('Could not look up patient');
                      }
                    }}
                    style={[styles.contactBtn, { borderColor: COLORS.primary }]}
                    testID="bk-msg"
                  >
                    <Ionicons name="paper-plane" size={16} color={COLORS.primary} />
                    <Text style={[styles.contactBtnText, { color: COLORS.primary }]} numberOfLines={1}>Message</Text>
                  </TouchableOpacity>
                )}
              </>
            );
          })()}
        </View>

        {/* Video consultation (100ms) — ONLY for tele-consult /
            "online" bookings. In-person visits never need a video
            room, so the card stays hidden to keep the appointment
            view focused. Also hidden for rejected / cancelled. */}
        {isVideo && !['rejected', 'cancelled'].includes((rx.status || '').toLowerCase()) && (
          <VideoCallActions
            bookingId={rx.booking_id}
            patientName={rx.patient_name}
            patientPhone={rx.patient_phone}
            patientEmail={rx.patient_email}
            isStaff={!!isStaff}
            mode={rx.mode}
            onProvisioned={() => load()}
          />
        )}

        {/* Staff actions */}
        {isStaff && (
          <View style={styles.actionsCard}>
            <Text style={styles.sectionTitle}>Actions</Text>
            {rx.status === 'requested' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <ActionButton icon="checkmark" label="Confirm" color={COLORS.success} onPress={() => patch({ status: 'confirmed' })} />
                <ActionButton icon="calendar" label="Reschedule" color={COLORS.primary} onPress={() => setReasonModal('reschedule')} />
                <ActionButton icon="close" label="Reject" color={COLORS.accent} onPress={() => openReasonFor('reject')} />
              </View>
            )}
            {rx.status === 'confirmed' && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <ActionButton
                  icon="medkit"
                  label="Start Consultation"
                  color={COLORS.primary}
                  onPress={() =>
                    router.push(`/prescriptions/new?bookingId=${rx.booking_id}` as any)
                  }
                />
                <ActionButton icon="checkmark-done" label="Mark Done" color={COLORS.primaryDark} onPress={() => patch({ status: 'completed' })} />
                <ActionButton icon="calendar" label="Reschedule" color={COLORS.primary} onPress={() => setReasonModal('reschedule')} />
                <ActionButton icon="close" label="Cancel" color={COLORS.accent} onPress={() => openReasonFor('cancel')} />
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Reason modal — for staff reject / cancel */}
      <Modal
        visible={!!reasonModal}
        transparent
        animationType="fade"
        onRequestClose={() => !reasonBusy && setReasonModal(null)}
      >
        <Pressable style={rstyles.backdrop} onPress={() => !reasonBusy && setReasonModal(null)}>
          <Pressable style={rstyles.card} onPress={() => {}}>
            <Text style={rstyles.title}>
              {reasonModal === 'reject'
                ? 'Reject appointment'
                : reasonModal === 'reschedule'
                ? 'Reschedule appointment'
                : 'Cancel appointment'}
            </Text>
            <Text style={rstyles.sub}>
              {reasonModal === 'reschedule'
                ? 'Pick a new date, time slot, and share a reason. The patient will be notified.'
                : 'The patient will be notified with your reason.'}
            </Text>

            {reasonModal === 'reschedule' && (
              <>
                <Text style={rstyles.label}>New date *</Text>
                <ISODateField
                  value={rescheduleDate}
                  onChange={setRescheduleDate}
                  placeholder="DD-MM-YYYY"
                  minimumDate={new Date()}
                  testID="bk-resch-date"
                />
                {rescheduleDate.length === 10 && (
                  <>
                    <Text style={rstyles.label}>New time slot *</Text>
                    {rescheduleSlotsLoading ? (
                      <ActivityIndicator color={COLORS.primary} style={{ marginTop: 6 }} />
                    ) : rescheduleSlots.length === 0 ? (
                      <Text style={[rstyles.sub, { marginTop: 6 }]}>
                        No slots available on this day. Pick another date.
                      </Text>
                    ) : (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                        {rescheduleSlots.map((s) => (
                          <TouchableOpacity
                            key={s}
                            onPress={() => setRescheduleTime(s)}
                            style={[
                              rstyles.slotChip,
                              rescheduleTime === s && rstyles.slotChipActive,
                            ]}
                            testID={`bk-resch-slot-${s}`}
                          >
                            <Text
                              style={[
                                rstyles.slotChipText,
                                rescheduleTime === s && { color: '#fff' },
                              ]}
                            >
                              {s}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </>
            )}

            <Text style={rstyles.label}>Reason *</Text>
            <TextInput
              value={reasonDraft}
              onChangeText={setReasonDraft}
              placeholder={
                reasonModal === 'reject'
                  ? 'e.g. Doctor on leave that day; please pick another slot.'
                  : reasonModal === 'reschedule'
                  ? 'e.g. Doctor in surgery; shifted to next available slot.'
                  : 'e.g. Emergency case came up; rescheduling to next week.'
              }
              placeholderTextColor={COLORS.textDisabled}
              multiline
              style={rstyles.input}
              testID="bk-reason-input"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <TouchableOpacity
                onPress={() => setReasonModal(null)}
                disabled={reasonBusy}
                style={[rstyles.btn, { borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' }]}
              >
                <Text style={[rstyles.btnText, { color: COLORS.textSecondary }]}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={submitReasonAction}
                disabled={reasonBusy}
                style={[
                  rstyles.btn,
                  { backgroundColor: reasonModal === 'reschedule' ? COLORS.primary : COLORS.accent },
                ]}
                testID="bk-reason-submit"
              >
                {reasonBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[rstyles.btnText, { color: '#fff' }]}>
                    {reasonModal === 'reject'
                      ? 'Reject'
                      : reasonModal === 'reschedule'
                      ? 'Reschedule'
                      : 'Cancel appointment'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <MessageComposer
        visible={msgOpen}
        onClose={() => setMsgOpen(false)}
        initialRecipient={msgRecipient}
      />
    </SafeAreaView>
  );
}

const rstyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 20 },
  title: { ...FONTS.h3, color: COLORS.textPrimary },
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 13 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14, fontSize: 11 },
  input: {
    marginTop: 6,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    minHeight: 80, textAlignVertical: 'top',
    ...FONTS.body, color: COLORS.textPrimary,
  },
  btn: { flex: 1, paddingVertical: 12, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  btnText: { ...FONTS.bodyMedium, fontSize: 14 },
  slotChip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  slotChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  slotChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
});

function TopBar({ onBack, title, rightIcon, onRightPress, rightTestID }: {
  onBack: () => void;
  title: string;
  rightIcon?: any;
  onRightPress?: () => void;
  rightTestID?: string;
}) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} testID="bk-back">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      {rightIcon && onRightPress ? (
        <TouchableOpacity
          onPress={onRightPress}
          style={styles.headerActionBtn}
          hitSlop={10}
          accessibilityLabel="Schedule OT"
          testID={rightTestID || 'bk-header-schedule-ot'}
        >
          <Ionicons name={rightIcon} size={20} color={COLORS.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Row({ label, value, mono, valueColor }: { label: string; value?: string; mono?: boolean; valueColor?: string }) {
  if (!value) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          mono && { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
          valueColor ? { color: valueColor } : null,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function ActionButton({ icon, label, color, onPress }: any) {
  return (
    <TouchableOpacity style={[styles.actionBtn, { borderColor: color }]} onPress={onPress}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.actionBtnText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  headerActionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary + '14', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary + '30' },
  title: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },

  card: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  payCard: {
    backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 14,
    borderWidth: 1, borderColor: COLORS.primary + '33',
    flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12,
  },
  payTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  paySub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#FEF3C7',
    marginTop: 6,
  },
  pendingChipText: { ...FONTS.bodyMedium, color: '#92400E', fontSize: 10, letterSpacing: 0.3 },
  name: { ...FONTS.h3, color: COLORS.textPrimary },
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  statusText: { ...FONTS.label, fontSize: 11 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },
  row: { flexDirection: 'row', marginTop: 6 },
  rowLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, width: 110 },
  rowValue: { ...FONTS.bodyMedium, color: COLORS.textPrimary, flex: 1, fontSize: 13 },

  approverCard: { backgroundColor: COLORS.success + '0A', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.success + '40', marginBottom: 12 },
  approverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  approverAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.success + '20', alignItems: 'center', justifyContent: 'center' },
  approverTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  approverEmail: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 1 },
  approverMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  noteBubble: { marginTop: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, padding: 10, borderWidth: 1, borderColor: COLORS.border, flexDirection: 'row', gap: 8 },
  noteText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, lineHeight: 20 },
  addNoteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  addNoteText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  noteInput: { backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 12, ...FONTS.body, color: COLORS.textPrimary, minHeight: 72, textAlignVertical: 'top' },

  sectionTitle: { ...FONTS.label, color: COLORS.primary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 },
  body: { ...FONTS.body, color: COLORS.textPrimary, lineHeight: 22 },
  contactBtn: { flex: 1, minWidth: 96, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: RADIUS.md, borderWidth: 1 },
  contactBtnText: { ...FONTS.bodyMedium, fontSize: 13 },

  actionsCard: { backgroundColor: '#fff', borderRadius: RADIUS.lg, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, borderWidth: 1 },
  actionBtnText: { ...FONTS.bodyMedium, fontSize: 13 },
  smallBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: RADIUS.pill, alignItems: 'center' },
  smallBtnText: { ...FONTS.bodyMedium, fontSize: 13 },

  hxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  hxDate: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  hxReason: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  hxPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 8 },
  hxPillText: { ...FONTS.label, fontSize: 10, textTransform: 'uppercase' },
  hxMore: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 8 },

  // Item 7 — "Start Consultation" panel at the top of the booking detail
  startCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.success + '40',
    marginBottom: 12,
  },
  startCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  startCardDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  startCardTitle: {
    ...FONTS.bodyMedium,
    color: COLORS.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  startCardBadge: {
    backgroundColor: COLORS.success + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  startCardBadgeText: {
    ...FONTS.label,
    color: COLORS.success,
    fontSize: 11,
  },
  startCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.success,
    minHeight: 48,
  },
  startCardBtnText: {
    ...FONTS.bodyMedium,
    color: '#FFFFFF',
    fontSize: 15,
  },
  liveRoom: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: COLORS.primary + '0A',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.primary + '20',
    borderStyle: 'dashed',
  },
  liveRoomTitle: {
    ...FONTS.h3,
    color: COLORS.textPrimary,
    marginTop: 12,
    fontSize: 16,
  },
  liveRoomBody: {
    ...FONTS.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    maxWidth: 320,
  },
  liveRoomCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  liveRoomCtaText: {
    ...FONTS.bodyMedium,
    color: '#FFFFFF',
    fontSize: 13,
  },
  scheduleSurgeryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: RADIUS.pill,
    marginBottom: 12,
    minHeight: 48,
  },
  scheduleSurgeryText: {
    ...FONTS.bodyMedium,
    color: '#fff',
    fontSize: 14,
    flex: 1,
  },
});


/* ── Pending-payment helper ─────────────────────────────────────── */

function MarkPaidOfflineButton({
  bookingId,
  defaultAmount,
  onPaid,
}: {
  bookingId: string;
  defaultAmount: number;
  onPaid: () => void;
}) {
  const [modal, setModal] = React.useState(false);
  const [amount, setAmount] = React.useState(String(defaultAmount || 500));
  const [mode, setMode] = React.useState<'cash' | 'upi' | 'card' | 'other'>('cash');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert('Enter a valid amount.');
      return;
    }
    setBusy(true);
    try {
      await api.post(`/bookings/${bookingId}/mark-paid-offline`, {
        amount_inr: amt,
        mode,
        notes: notes.trim(),
      });
      toast.show('Payment recorded', 'success');
      setModal(false);
      onPaid();
    } catch (e: any) {
      Alert.alert('Could not record payment', e?.response?.data?.detail || e?.message || '');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setModal(true)}
        style={offlinePayStyles.btn}
        testID="mark-paid-offline-open"
      >
        <Ionicons name="cash-outline" size={15} color="#fff" />
        <Text style={offlinePayStyles.btnText}>Mark as paid</Text>
      </TouchableOpacity>

      <Modal visible={modal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setModal(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
          <View style={offlinePayStyles.bar}>
            <TouchableOpacity onPress={() => setModal(false)} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={22} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Text style={offlinePayStyles.barTitle}>Record offline payment</Text>
            <View style={{ width: 40 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={offlinePayStyles.helper}>
              Patient paid in person — record the amount and mode below. The booking will flip to "Paid".
            </Text>

            <Text style={offlinePayStyles.label}>Amount (Rs)</Text>
            <TextInput
              style={offlinePayStyles.input}
              keyboardType="numeric"
              value={amount}
              onChangeText={setAmount}
              testID="offlinepay-amount"
            />

            <Text style={offlinePayStyles.label}>Payment mode</Text>
            <View style={offlinePayStyles.modes}>
              {(['cash', 'upi', 'card', 'other'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[offlinePayStyles.modeChip, mode === m && offlinePayStyles.modeChipActive]}
                  onPress={() => setMode(m)}
                  testID={`offlinepay-mode-${m}`}
                >
                  <Text style={[offlinePayStyles.modeText, mode === m && { color: '#fff' }]}>{m.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={offlinePayStyles.label}>Notes (optional)</Text>
            <TextInput
              style={[offlinePayStyles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              multiline
              placeholder="Reference number, who collected, etc."
              placeholderTextColor={COLORS.textDisabled}
              value={notes}
              onChangeText={setNotes}
              testID="offlinepay-notes"
            />

            <TouchableOpacity
              onPress={submit}
              disabled={busy}
              style={[offlinePayStyles.submit, busy && { opacity: 0.6 }]}
              testID="offlinepay-submit"
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="checkmark" size={16} color="#fff" />}
              <Text style={offlinePayStyles.submitText}>{busy ? 'Saving...' : 'Record payment'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const offlinePayStyles = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: '#16A34A', borderRadius: RADIUS.pill,
  },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  barTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 15, flex: 1, textAlign: 'center' },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 14, lineHeight: 17 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14, marginBottom: 6 },
  input: { padding: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, backgroundColor: '#fff', color: COLORS.textPrimary, fontSize: 14 },
  modes: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  modeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff' },
  modeChipActive: { backgroundColor: '#16A34A', borderColor: '#16A34A' },
  modeText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#16A34A', borderRadius: RADIUS.pill, marginTop: 26 },
  submitText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
