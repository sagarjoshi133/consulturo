/**
 * Consultations panel — dashboard tab dedicated to upcoming confirmed
 * appointments, grouped by date (earliest first). Each row offers a
 * quick "Start Consultation" action (deep-links into the Rx composer
 * pre-filled from the booking) and an expandable doctor's note that
 * is persisted on the booking document but NEVER rendered on the Rx
 * PDF — it's for the doctor's private recall only.
 *
 * Syncs with:
 *  - /api/bookings/all (staff-only list used across dashboard).
 *  - PATCH /api/bookings/{id} with `doctor_note` field.
 *  - `/prescriptions/new?bookingId=` flow which already pre-fills Rx
 *    from the booking (see prescriptions/new.tsx).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { addDays, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { usePanelRefresh } from './panel-refresh';
import { displayDateLong, display12h } from './date';
import { haptics } from './haptics';
import { useToast } from './toast';
import { useAuth } from './auth';
import { resolvePatientRecipient } from './message-recipient';

type Booking = {
  booking_id: string;
  patient_name?: string;
  patient_phone?: string;
  patient_email?: string;
  patient_user_id?: string;
  country_code?: string;
  patient_age?: number;
  patient_gender?: string;
  booking_date: string;   // YYYY-MM-DD
  booking_time: string;   // HH:mm
  status: string;
  mode?: string;
  reason?: string;
  registration_no?: string;
  doctor_note?: string;
  draft_rx_id?: string;
  draft_started_by?: string;
};

type MessageRecipient = {
  user_id: string;
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
};

type Filter = 'today' | 'week' | 'all';

function prettyGroupLabel(dateStr: string): string {
  try {
    const d = startOfDay(parseISO(dateStr));
    const today = startOfDay(new Date());
    if (isSameDay(d, today)) return `Today · ${format(d, 'EEE, dd MMM')}`;
    if (isSameDay(d, addDays(today, 1))) return `Tomorrow · ${format(d, 'EEE, dd MMM')}`;
    return format(d, 'EEEE, dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

export function ConsultationsPanel({
  onMessagePatient,
}: {
  onMessagePatient?: (recipient: MessageRecipient) => void;
} = {}) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const isPrescriber = user?.role === 'owner' || user?.role === 'doctor';
  const [items, setItems] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('today');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/bookings/all');
      const todayStr = format(startOfDay(new Date()), 'yyyy-MM-dd');
      // Only upcoming confirmed (today or later).
      const filtered: Booking[] = (Array.isArray(data) ? data : [])
        .filter(
          (b: Booking) =>
            b.status === 'confirmed' &&
            typeof b.booking_date === 'string' &&
            b.booking_date >= todayStr
        )
        // earliest first — sort by date then time
        .sort((a: Booking, b: Booking) => {
          const d = a.booking_date.localeCompare(b.booking_date);
          if (d !== 0) return d;
          return (a.booking_time || '').localeCompare(b.booking_time || '');
        });
      setItems(filtered);
      // seed note drafts
      const nextDraft: Record<string, string> = {};
      filtered.forEach((b) => {
        nextDraft[b.booking_id] = b.doctor_note || '';
      });
      setNoteDraft(nextDraft);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Pull-to-refresh integration with the dashboard's ContentPager
  usePanelRefresh('consultations', async () => {
    await load(true);
  });

  // Group by booking_date (already sorted)
  const grouped = useMemo(() => {
    // Apply filter (today / this week / all)
    const todayStart = startOfDay(new Date());
    const weekEnd = addDays(todayStart, 7);
    const visible = items.filter((b) => {
      if (filter === 'all') return true;
      const d = startOfDay(parseISO(b.booking_date));
      if (filter === 'today') return isSameDay(d, todayStart);
      if (filter === 'week') return d >= todayStart && d < weekEnd;
      return true;
    });
    const map: { date: string; rows: Booking[] }[] = [];
    visible.forEach((b) => {
      const last = map[map.length - 1];
      if (last && last.date === b.booking_date) {
        last.rows.push(b);
      } else {
        map.push({ date: b.booking_date, rows: [b] });
      }
    });
    return map;
  }, [items, filter]);

  const totalVisible = useMemo(
    () => grouped.reduce((n, g) => n + g.rows.length, 0),
    [grouped]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    haptics.tap();
    await load(true);
    toast.success('Refreshed');
  };

  const saveNote = async (bookingId: string) => {
    const text = (noteDraft[bookingId] || '').trim();
    setSavingId(bookingId);
    try {
      await api.patch(`/bookings/${bookingId}`, { doctor_note: text });
      haptics.success();
      toast.success('Note saved');
      setItems((prev) =>
        prev.map((b) => (b.booking_id === bookingId ? { ...b, doctor_note: text } : b))
      );
      setExpanded((prev) => ({ ...prev, [bookingId]: false }));
    } catch (e: any) {
      haptics.error();
      toast.error(e?.response?.data?.detail || 'Could not save note');
    } finally {
      setSavingId(null);
    }
  };

  const markDone = async (b: Booking) => {
    if (!isPrescriber) {
      toast.error('Only doctor can mark consultation as done');
      return;
    }
    Alert.alert(
      'Mark consultation as done?',
      `Close ${b.patient_name}'s visit without generating a prescription?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Done',
          style: 'default',
          onPress: async () => {
            setBusyId(b.booking_id);
            try {
              await api.patch(`/bookings/${b.booking_id}`, { status: 'completed' });
              haptics.success();
              toast.success('Marked done');
              // Remove from list (it's no longer "confirmed upcoming")
              setItems((prev) => prev.filter((x) => x.booking_id !== b.booking_id));
            } catch (e: any) {
              haptics.error();
              toast.error(e?.response?.data?.detail || 'Could not mark done');
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  };

  const openConsultation = (b: Booking) => {
    haptics.tap();
    // Resume existing draft if present; else start fresh from booking
    if (b.draft_rx_id) {
      router.push(`/prescriptions/new?rxId=${b.draft_rx_id}` as any);
    } else {
      router.push(`/prescriptions/new?bookingId=${b.booking_id}` as any);
    }
  };

  if (loading) {
    return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />;
  }

  const filterChips: { id: Filter; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'all', label: 'All' },
  ];

  const HeaderBar = (
    <>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.header}>Upcoming Consultations</Text>
          <Text style={styles.sub}>
            Confirmed visits grouped by day. Tap any card to start / resume a consultation.
          </Text>
        </View>
        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.refreshBtn}
          testID="consult-refresh"
          disabled={refreshing}
          activeOpacity={0.7}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons name="refresh" size={18} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>
      <View style={styles.filterRow}>
        {filterChips.map((c) => {
          const active = filter === c.id;
          return (
            <TouchableOpacity
              key={c.id}
              onPress={() => { haptics.select(); setFilter(c.id); }}
              style={[styles.filterChip, active && styles.filterChipActive]}
              testID={`consult-filter-${c.id}`}
            >
              <Text style={[styles.filterChipText, active && { color: '#fff' }]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <Text style={styles.countText}>{totalVisible} visit{totalVisible === 1 ? '' : 's'}</Text>
      </View>
    </>
  );

  if (totalVisible === 0) {
    return (
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {HeaderBar}
        <View style={styles.empty} testID="consults-empty">
          <Ionicons name="calendar-outline" size={40} color={COLORS.textDisabled} />
          <Text style={styles.emptyTitle}>
            {filter === 'today' ? 'No consultations today' : filter === 'week' ? 'No consultations this week' : 'No upcoming consultations'}
          </Text>
          <Text style={styles.emptySub}>
            {filter === 'today'
              ? 'Try "This week" or "All" to see further ahead.'
              : 'Confirmed appointments for today and the days ahead will appear here, sorted earliest-first.'}
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
    >
      {HeaderBar}

      {grouped.map((g) => (
        <View key={g.date} style={{ marginTop: 18 }}>
          <View style={styles.dateHeaderRow}>
            <View style={styles.dateDot} />
            <Text style={styles.dateHeader}>{prettyGroupLabel(g.date)}</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{g.rows.length}</Text>
            </View>
          </View>

          {g.rows.map((b) => {
            const isOpen = !!expanded[b.booking_id];
            const hasNote = !!(b.doctor_note && b.doctor_note.trim().length);
            const hasDraft = !!b.draft_rx_id;
            return (
              <View key={b.booking_id} style={styles.card} testID={`consult-card-${b.booking_id}`}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => router.push(`/bookings/${b.booking_id}` as any)}
                  style={styles.cardHead}
                  testID={`consult-open-${b.booking_id}`}
                >
                  <View style={styles.timePill}>
                    <Ionicons name="time-outline" size={14} color={COLORS.primary} />
                    <Text style={styles.timeText}>{display12h(b.booking_time)}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.name} numberOfLines={1}>{b.patient_name || '—'}</Text>
                      {hasDraft && (
                        <View style={styles.draftBadge} testID={`consult-draft-badge-${b.booking_id}`}>
                          <Ionicons name="bookmark" size={10} color={COLORS.warning} />
                          <Text style={styles.draftBadgeText}>Draft</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.meta} numberOfLines={1}>
                      {[
                        b.patient_age ? `${b.patient_age}y` : '',
                        b.patient_gender || '',
                        b.mode === 'online' ? 'Video' : 'In-person',
                        b.registration_no ? `#${b.registration_no}` : '',
                      ].filter(Boolean).join(' · ')}
                    </Text>
                    {!!b.reason && (
                      <Text style={styles.reason} numberOfLines={1}>
                        <Text style={{ color: COLORS.primary }}>Reason: </Text>
                        {b.reason}
                      </Text>
                    )}
                    {hasDraft && !!b.draft_started_by && (
                      <Text style={styles.draftStartedBy} numberOfLines={1}>
                        Draft started by {b.draft_started_by}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                </TouchableOpacity>

                {hasNote && !isOpen && (
                  <View style={styles.noteChip}>
                    <Ionicons name="bookmark" size={12} color={COLORS.primaryDark} />
                    <Text style={styles.noteChipText} numberOfLines={2}>
                      {b.doctor_note}
                    </Text>
                  </View>
                )}

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => openConsultation(b)}
                    testID={`consult-start-${b.booking_id}`}
                    disabled={busyId === b.booking_id}
                  >
                    <Ionicons name={hasDraft ? 'play-forward' : 'medkit'} size={13} color="#fff" />
                    <Text style={styles.primaryBtnText} numberOfLines={1}>{hasDraft ? 'Resume' : 'Start'}</Text>
                  </TouchableOpacity>

                  {isPrescriber && (
                    <TouchableOpacity
                      style={[styles.iconActionBtn, busyId === b.booking_id && { opacity: 0.5 }]}
                      onPress={() => markDone(b)}
                      disabled={busyId === b.booking_id}
                      testID={`consult-done-${b.booking_id}`}
                    >
                      {busyId === b.booking_id ? (
                        <ActivityIndicator size="small" color={COLORS.success} />
                      ) : (
                        <Ionicons name="checkmark-done" size={16} color={COLORS.success} />
                      )}
                    </TouchableOpacity>
                  )}

                  {!!b.patient_phone && (
                    <TouchableOpacity
                      style={styles.iconActionBtn}
                      onPress={() => {
                        haptics.select();
                        const cc = (b.country_code || '+91').replace(/\D/g, '');
                        const digits = (b.patient_phone || '').replace(/\D/g, '');
                        const intl = digits.length > 10 ? digits : cc + digits;
                        Linking.openURL(`https://wa.me/${intl}`);
                      }}
                      testID={`consult-wa-${b.booking_id}`}
                    >
                      <Ionicons name="logo-whatsapp" size={16} color={COLORS.whatsapp} />
                    </TouchableOpacity>
                  )}

                  {!!b.patient_phone && onMessagePatient && (
                    <TouchableOpacity
                      style={styles.iconActionBtn}
                      onPress={async () => {
                        haptics.select();
                        const r = await resolvePatientRecipient({
                          patient_user_id: b.patient_user_id,
                          patient_name: b.patient_name,
                          patient_phone: b.patient_phone,
                          country_code: b.country_code,
                          patient_email: b.patient_email,
                        });
                        if (r.ok) {
                          onMessagePatient(r.recipient);
                        } else if (r.reason === 'not_registered') {
                          toast.error(`${b.patient_name || 'Patient'} hasn't installed the app yet — try WhatsApp instead.`);
                        } else if (r.reason === 'no_phone') {
                          toast.error('No phone on file for this patient');
                        } else {
                          toast.error('Could not look up patient');
                        }
                      }}
                      testID={`consult-msg-${b.booking_id}`}
                    >
                      <Ionicons name="paper-plane" size={15} color={COLORS.primary} />
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.iconActionBtn, isOpen && { backgroundColor: COLORS.primary + '18' }]}
                    onPress={() => {
                      haptics.select();
                      setExpanded((prev) => ({ ...prev, [b.booking_id]: !prev[b.booking_id] }));
                    }}
                    testID={`consult-note-toggle-${b.booking_id}`}
                  >
                    <Ionicons
                      name={hasNote ? 'bookmark' : 'bookmark-outline'}
                      size={16}
                      color={COLORS.primary}
                    />
                  </TouchableOpacity>
                </View>

                {isOpen && (
                  <View style={styles.noteBox}>
                    <Text style={styles.noteLabel}>Doctor's private note</Text>
                    <Text style={styles.noteHint}>
                      Stays on this consultation. Not visible to patient and not printed on the Rx.
                    </Text>
                    <TextInput
                      value={noteDraft[b.booking_id] || ''}
                      onChangeText={(v) =>
                        setNoteDraft((prev) => ({ ...prev, [b.booking_id]: v }))
                      }
                      multiline
                      placeholder="e.g. review USG films; re-check urine culture next visit."
                      placeholderTextColor={COLORS.textDisabled}
                      style={styles.noteInput}
                      testID={`consult-note-input-${b.booking_id}`}
                    />
                    <View style={styles.noteBtnRow}>
                      <TouchableOpacity
                        onPress={() => {
                          setExpanded((prev) => ({ ...prev, [b.booking_id]: false }));
                          setNoteDraft((prev) => ({
                            ...prev,
                            [b.booking_id]: b.doctor_note || '',
                          }));
                        }}
                        style={styles.noteCancelBtn}
                      >
                        <Text style={styles.noteCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => saveNote(b.booking_id)}
                        disabled={savingId === b.booking_id}
                        style={[
                          styles.noteSaveBtn,
                          savingId === b.booking_id && { opacity: 0.6 },
                        ]}
                        testID={`consult-note-save-${b.booking_id}`}
                      >
                        {savingId === b.booking_id ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={14} color="#fff" />
                            <Text style={styles.noteSaveText}>Save note</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  header: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 4, fontSize: 12 },
  refreshBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '44',
    alignItems: 'center', justifyContent: 'center',
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  countText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  draftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: COLORS.warning + '22',
  },
  draftBadgeText: { ...FONTS.label, color: COLORS.warning, fontSize: 9 },
  draftStartedBy: { ...FONTS.body, color: COLORS.warning, fontSize: 10, marginTop: 2, fontStyle: 'italic' },

  empty: {
    alignItems: 'center',
    padding: 30,
    borderRadius: RADIUS.lg,
    backgroundColor: '#fff',
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 8 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 6, fontSize: 12 },

  dateHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dateDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary },
  dateHeader: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  countPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '18',
  },
  countPillText: { ...FONTS.label, color: COLORS.primary, fontSize: 11 },

  card: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    padding: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: COLORS.primary + '12',
  },
  timeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  name: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  meta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 1 },
  reason: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 11, marginTop: 3 },

  noteChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
    padding: 6,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary + '10',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  noteChipText: { ...FONTS.body, color: COLORS.textPrimary, fontSize: 11, flex: 1 },

  actionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    minHeight: 32,
  },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },
  // Compact icon-only button (used for done/whatsapp/note toggle)
  iconActionBtn: {
    width: 36,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
  },
  ghostBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  noteBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noteLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  noteHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  noteInput: {
    marginTop: 8,
    minHeight: 80,
    padding: 10,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#fff',
    ...FONTS.body,
    color: COLORS.textPrimary,
    textAlignVertical: 'top',
  },
  noteBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  noteCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noteCancelText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 12 },
  noteSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary,
    minWidth: 110,
    justifyContent: 'center',
  },
  noteSaveText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 12 },
});
