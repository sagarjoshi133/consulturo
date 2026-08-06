// Reminders — pure device-alarm utility.
//
// Distinct from Notes: no body, no labels, no images. Just a title,
// a date+time, and an optional repeat (none / daily / weekly). Each
// reminder fires a local notification on the device at the chosen
// time (via expo-notifications). Tap a reminder to edit, swipe-style
// trash to delete, or use Snooze to push it 10 / 30 / 60 minutes out.
//
// Available to all roles. Staff/owner/team see an extra "Tag" picker
// (Clinical / Admin / Personal) so the same utility is useful for
// rounds, meetings, OT prep — not just patient self-care.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format, addHours, addDays, isPast, formatDistanceToNow } from 'date-fns';
import { goBackSafe } from '../src/nav';

import { COLORS, FONTS, RADIUS } from '../src/theme';
import { DateField, TimeField } from '../src/date-picker';
import { parseUIDate } from '../src/date';
import { useAuth } from '../src/auth';
import { useResponsive } from '../src/responsive';
import {
  Reminder,
  RepeatKind,
  ReminderTag,
  listReminders,
  addReminder,
  updateReminder,
  deleteReminder,
  snoozeReminder,
} from '../src/reminders-store';

const TAG_META: Record<ReminderTag, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  clinical: { label: 'Clinical', color: '#0E7C8B', icon: 'medkit' },
  admin:    { label: 'Admin',    color: '#7C3AED', icon: 'briefcase' },
  personal: { label: 'Personal', color: '#10B981', icon: 'person' },
};

function fmtWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return format(d, 'dd MMM yyyy · h:mm a');
  } catch {
    return '';
  }
}

export default function RemindersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isWebDesktop } = useResponsive();

  const isStaff = !!user && ['owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'].includes((user.role as string) || '');

  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSeed, setTemplateSeed] = useState<ReminderTemplate | null>(null);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');

  const load = useCallback(async () => {
    setItems(await listReminders());
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'upcoming') return items.filter((r) => !isPast(new Date(r.when_iso)) || r.repeat !== 'none');
    return items.filter((r) => isPast(new Date(r.when_iso)) && r.repeat === 'none');
  }, [items, filter]);

  const counts = useMemo(() => {
    let upcoming = 0; let past = 0;
    items.forEach((r) => {
      if (!isPast(new Date(r.when_iso)) || r.repeat !== 'none') upcoming += 1;
      else past += 1;
    });
    return { upcoming, past, all: items.length };
  }, [items]);

  const confirmDelete = (r: Reminder) => {
    const run = async () => { await deleteReminder(r.id); await load(); };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(`Delete "${r.title}"?`)) run();
    } else {
      Alert.alert('Delete reminder?', `"${r.title}" will be removed.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]);
    }
  };

  const doSnooze = async (r: Reminder, minutes: number) => {
    await snoozeReminder(r.id, minutes);
    await load();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={[styles.hero, { paddingTop: insets.top + 6 }, isWebDesktop && { paddingTop: 12, paddingBottom: 10 }]}>
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.iconBtn} testID="reminders-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={styles.hkicker}>UTILITY</Text>
            <Text style={styles.htitle}>Reminders</Text>
          </View>
          <Ionicons name="alarm" size={22} color="#fff" />
        </View>
      </LinearGradient>

      {/* Tabs */}
      <View style={[styles.tabsRow, isWebDesktop && { maxWidth: 960, width: '100%', alignSelf: 'center', paddingHorizontal: 24 }]}>
        {(['upcoming', 'past', 'all'] as const).map((k) => {
          const active = filter === k;
          const cnt = counts[k];
          const label = k.charAt(0).toUpperCase() + k.slice(1);
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setFilter(k)}
              style={[styles.tabPill, active && styles.tabPillOn]}
              activeOpacity={0.78}
              testID={`reminders-tab-${k}`}
            >
              <Text style={[styles.tabPillText, active && { color: '#fff' }]}>{label}</Text>
              {cnt > 0 && (
                <View style={[styles.tabBadge, active && styles.tabBadgeOn]}>
                  <Text style={[styles.tabBadgeText, active && { color: '#fff' }]}>{cnt}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={[{ padding: 16, paddingBottom: 110 + insets.bottom }, isWebDesktop && { maxWidth: 960, width: '100%', alignSelf: 'center', padding: 24, paddingBottom: 60 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="alarm-outline" size={56} color={COLORS.textDisabled} />
              <Text style={styles.emptyTitle}>
                {filter === 'upcoming' ? 'No upcoming reminders' : filter === 'past' ? 'Nothing in the past' : 'No reminders yet'}
              </Text>
              <Text style={styles.emptySub}>
                Tap the + button to set your first device alarm.
              </Text>
            </View>
          ) : (
            <View style={isWebDesktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } : undefined}>
            {filtered.map((r) => {
              const past = isPast(new Date(r.when_iso));
              const tagMeta = r.role_tag ? TAG_META[r.role_tag] : null;
              return (
                <TouchableOpacity
                  key={r.id}
                  onPress={() => setEditing(r)}
                  activeOpacity={0.78}
                  style={[styles.card, past && r.repeat === 'none' && styles.cardPast, isWebDesktop && { width: '49%', marginBottom: 0 }]}
                  testID={`reminder-${r.id}`}
                >
                  <View style={[styles.alarmIcon, past && r.repeat === 'none' ? { backgroundColor: COLORS.textDisabled + '22' } : null]}>
                    <Ionicons
                      name={r.repeat === 'none' ? 'alarm' : r.repeat === 'daily' ? 'sync-circle' : 'calendar'}
                      size={20}
                      color={past && r.repeat === 'none' ? COLORS.textDisabled : COLORS.accent}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.title} numberOfLines={2}>{r.title}</Text>
                    <Text style={styles.when}>
                      {fmtWhen(r.when_iso)}
                      {r.repeat !== 'none' ? ` · ${r.repeat}` : ''}
                    </Text>
                    {tagMeta ? (
                      <View style={[styles.tag, { backgroundColor: tagMeta.color + '14' }]}>
                        <Ionicons name={tagMeta.icon} size={10} color={tagMeta.color} />
                        <Text style={[styles.tagText, { color: tagMeta.color }]}>{tagMeta.label}</Text>
                      </View>
                    ) : null}
                    {past && r.repeat === 'none' ? (
                      <View style={styles.snoozeRow}>
                        <TouchableOpacity onPress={() => doSnooze(r, 10)} style={styles.snoozeBtn}>
                          <Text style={styles.snoozeText}>+10 min</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => doSnooze(r, 30)} style={styles.snoozeBtn}>
                          <Text style={styles.snoozeText}>+30 min</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => doSnooze(r, 60)} style={styles.snoozeBtn}>
                          <Text style={styles.snoozeText}>+1 h</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>
                  <TouchableOpacity onPress={() => confirmDelete(r)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={styles.delIcon}>
                    <Ionicons name="trash-outline" size={18} color={COLORS.accent} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
            </View>
          )}
        </ScrollView>
      )}

      {/* Templates shortcut + FAB */}
      <TouchableOpacity
        onPress={() => setShowTemplates(true)}
        style={[styles.tplFab, { bottom: 24 + insets.bottom }]}
        testID="reminders-templates"
        activeOpacity={0.85}
      >
        <Ionicons name="copy" size={18} color={COLORS.primary} />
        <Text style={styles.tplFabText}>Templates</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setShowAdd(true)} style={[styles.fab, { bottom: 24 + insets.bottom }]} testID="reminders-fab" activeOpacity={0.85}>
        <Ionicons name="add" size={26} color="#fff" />
      </TouchableOpacity>

      {/* Reminder template picker */}
      <ReminderTemplatePicker
        visible={showTemplates}
        isStaff={isStaff}
        onClose={() => setShowTemplates(false)}
        onPick={(tpl) => {
          setShowTemplates(false);
          setTemplateSeed(tpl);
          setShowAdd(true);
        }}
      />

      {/* Add / Edit modal */}
      <ReminderEditor
        visible={showAdd || !!editing}
        initial={editing}
        seed={templateSeed}
        isStaff={isStaff}
        onClose={() => { setShowAdd(false); setEditing(null); setTemplateSeed(null); }}
        onSaved={async () => { setShowAdd(false); setEditing(null); setTemplateSeed(null); await load(); }}
      />

      {Platform.OS === 'web' && (
        <View style={[styles.webNote, { bottom: 90 + insets.bottom }]} pointerEvents="none">
          <Ionicons name="information-circle" size={13} color={COLORS.primary} />
          <Text style={styles.webNoteText}>Local alarms work on the mobile app. Web previews don&apos;t buzz.</Text>
        </View>
      )}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Editor modal (add + edit)
// ──────────────────────────────────────────────────────────────────────

function ReminderEditor({
  visible,
  initial,
  seed,
  isStaff,
  onClose,
  onSaved,
}: {
  visible: boolean;
  initial: Reminder | null;
  seed?: ReminderTemplate | null;
  isStaff: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState<RepeatKind>('none');
  const [tag, setTag] = useState<ReminderTag | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setTitle(initial.title);
      const d = new Date(initial.when_iso);
      setDate(format(d, 'dd-MM-yyyy'));
      setTime(format(d, 'HH:mm'));
      setRepeat(initial.repeat || 'none');
      setTag(initial.role_tag || null);
    } else if (seed) {
      // Pre-fill from a template — title, repeat, time hint, tag.
      setTitle(seed.title);
      setRepeat(seed.defaultRepeat);
      setTag(seed.tag);
      let when: Date;
      if (seed.defaultRepeat === 'none' && seed.defaultDelayMins) {
        when = new Date(Date.now() + seed.defaultDelayMins * 60_000);
      } else if (typeof seed.defaultHour === 'number') {
        when = new Date();
        when.setHours(seed.defaultHour, seed.defaultMinute ?? 0, 0, 0);
        // If that hour has already passed today, push to tomorrow.
        if (when.getTime() <= Date.now() + 60_000) when = addDays(when, 1);
      } else {
        when = addHours(new Date(), 1);
      }
      setDate(format(when, 'dd-MM-yyyy'));
      setTime(format(when, 'HH:mm'));
    } else {
      setTitle('');
      const d = addHours(new Date(), 1);
      setDate(format(d, 'dd-MM-yyyy'));
      setTime(format(d, 'HH:mm'));
      setRepeat('none');
      setTag(isStaff ? 'clinical' : 'personal');
    }
    setErr('');
  }, [visible, initial, seed, isStaff]);

  const quick = (kind: 'in1h' | 'tomorrow8' | 'tomorrow9') => {
    let d: Date;
    if (kind === 'in1h') d = addHours(new Date(), 1);
    else if (kind === 'tomorrow8') { d = addDays(new Date(), 1); d.setHours(8, 0, 0, 0); }
    else { d = addDays(new Date(), 1); d.setHours(9, 0, 0, 0); }
    setDate(format(d, 'dd-MM-yyyy'));
    setTime(format(d, 'HH:mm'));
  };

  const save = async () => {
    const t = title.trim();
    if (!t) { setErr('Please enter a title'); return; }
    const iso = parseUIDate(date);
    if (!iso) { setErr('Pick a valid date'); return; }
    const when = new Date(`${iso}T${time || '09:00'}:00`);
    if (isNaN(when.getTime())) { setErr('Pick a valid time'); return; }
    if (when.getTime() <= Date.now() + 1000 && repeat === 'none') {
      setErr('Reminder time must be in the future');
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await updateReminder(initial.id, {
          title: t, when_iso: when.toISOString(), repeat, role_tag: tag || undefined,
        });
      } else {
        await addReminder({
          title: t, when_iso: when.toISOString(), repeat, role_tag: tag || undefined,
        });
      }
      onSaved();
    } catch (e: any) {
      setErr('Could not save reminder');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{initial ? 'Edit reminder' : 'New reminder'}</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={COLORS.textSecondary} /></TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={styles.label}>WHAT</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Call patient · Surgery prep · OPD"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.input}
                maxLength={120}
                testID="rem-title"
              />

              <Text style={styles.label}>QUICK PICK</Text>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                <TouchableOpacity onPress={() => quick('in1h')} style={styles.quickChip}>
                  <Ionicons name="time" size={12} color={COLORS.primary} /><Text style={styles.quickChipText}>In 1 hour</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => quick('tomorrow8')} style={styles.quickChip}>
                  <Ionicons name="sunny" size={12} color={COLORS.primary} /><Text style={styles.quickChipText}>Tomorrow 8 AM</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => quick('tomorrow9')} style={styles.quickChip}>
                  <Ionicons name="sunny" size={12} color={COLORS.primary} /><Text style={styles.quickChipText}>Tomorrow 9 AM</Text>
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: 14 }}>
                <DateField label="Date" value={date} onChange={setDate} testID="rem-date" />
                <TimeField label="Time" value={time} onChange={setTime} style={{ marginTop: 10 }} testID="rem-time" />
              </View>

              <Text style={styles.label}>REPEAT</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['none', 'daily', 'weekly'] as RepeatKind[]).map((k) => (
                  <TouchableOpacity
                    key={k}
                    onPress={() => setRepeat(k)}
                    style={[styles.repeatChip, repeat === k && styles.repeatChipOn]}
                  >
                    <Text style={[styles.repeatChipText, repeat === k && { color: '#fff' }]}>
                      {k === 'none' ? 'Once' : k.charAt(0).toUpperCase() + k.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>{isStaff ? 'TAG' : 'CATEGORY'}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                {(Object.keys(TAG_META) as ReminderTag[]).map((k) => {
                  const meta = TAG_META[k];
                  const active = tag === k;
                  // Patients only see 'personal'; staff see all 3.
                  if (!isStaff && k !== 'personal') return null;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setTag(k)}
                      style={[styles.tagChip, active && { backgroundColor: meta.color, borderColor: meta.color }]}
                    >
                      <Ionicons name={meta.icon} size={12} color={active ? '#fff' : meta.color} />
                      <Text style={[styles.tagChipText, { color: active ? '#fff' : meta.color }]}>{meta.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {err ? <Text style={styles.err}>{err}</Text> : null}

              <TouchableOpacity onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="rem-save">
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.saveBtnText}>{initial ? 'Update reminder' : 'Set reminder'}</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 14, paddingBottom: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  hkicker: { ...FONTS.label, color: 'rgba(255,255,255,0.85)', fontSize: 10, letterSpacing: 0.6 },
  htitle: { ...FONTS.h3, color: '#fff', fontSize: 18, marginTop: 1 },

  tabsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  tabPill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
  },
  tabPillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabPillText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  tabBadge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: COLORS.primary + '15', alignItems: 'center', justifyContent: 'center' },
  tabBadgeOn: { backgroundColor: 'rgba(255,255,255,0.28)' },
  tabBadgeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10 },

  empty: { alignItems: 'center', padding: 40, gap: 8 },
  emptyTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardPast: { opacity: 0.7 },
  alarmIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.accent + '14', alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  when: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6,
    marginTop: 6,
  },
  tagText: { ...FONTS.bodyMedium, fontSize: 10, letterSpacing: 0.4 },
  snoozeRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  snoozeBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill, backgroundColor: COLORS.primary + '14' },
  snoozeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  delIcon: { padding: 6 },

  fab: {
    position: 'absolute', right: 18,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: COLORS.primary, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 6 },
    }),
  },
  // Secondary FAB-style "Templates" pill on the left of the primary
  // FAB. Tapping it opens the audience-aware reminder template picker.
  tplFab: {
    position: 'absolute', right: 88,
    height: 44, paddingHorizontal: 14,
    borderRadius: 22,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '55',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 3 },
    }),
  },
  tplFabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  webNote: {
    position: 'absolute', left: 16, right: 90,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.primary + '0E',
    borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  webNoteText: { ...FONTS.body, color: COLORS.primary, fontSize: 11, flex: 1 },

  // Editor modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 22, paddingBottom: 32, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 17 },
  label: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 14, marginBottom: 4, letterSpacing: 0.6, fontSize: 10 },
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    ...FONTS.body, fontSize: 15, color: COLORS.textPrimary,
  },
  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: COLORS.primary + '0F',
    borderWidth: 1, borderColor: COLORS.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  quickChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  repeatChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
    alignItems: 'center',
  },
  repeatChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  repeatChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tagChipText: { ...FONTS.bodyMedium, fontSize: 12 },
  err: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 8 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 18,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  saveBtnText: { color: '#fff', ...FONTS.bodyMedium, fontSize: 14 },
});

// ──────────────────────────────────────────────────────────────────────
// Reminder templates — audience-aware quick suggestions.
//   • STAFF (owner / doctor / team) → Practice-oriented (OPD start,
//     OT prep, ward rounds, billing, follow-up calls, weekly review).
//   • PATIENT → Disease & treatment specific (medication times,
//     hydration for stones, PSA test follow-ups, bladder training,
//     post-op recovery checks).
//
// Each template carries a default delay (in minutes) and a default
// repeat ("daily" for medication, "weekly" for review tasks) so the
// user only needs to confirm.
// ──────────────────────────────────────────────────────────────────────

type ReminderTemplate = {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  category:
    | 'staff_opd' | 'staff_ot' | 'staff_followup'
    | 'pt_stones' | 'pt_prostate' | 'pt_bladder' | 'pt_transplant' | 'pt_general';
  // Default scheduling — minutes-from-now for one-shot, or hour/min
  // hint for recurring (the editor seeds the picker with these).
  defaultRepeat: RepeatKind;
  defaultHour?: number;     // 0–23
  defaultMinute?: number;   // 0–59
  defaultDelayMins?: number;
  tag: ReminderTag;
};

const STAFF_TPL_CATS: { key: ReminderTemplate['category']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'staff_opd',      label: 'OPD',         icon: 'people' },
  { key: 'staff_ot',       label: 'OT',          icon: 'medkit' },
  { key: 'staff_followup', label: 'Follow-up',   icon: 'call' },
];
const PT_TPL_CATS: { key: ReminderTemplate['category']; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'pt_stones',     label: 'Stones',      icon: 'water' },
  { key: 'pt_prostate',   label: 'Prostate',    icon: 'male' },
  { key: 'pt_bladder',    label: 'Bladder',     icon: 'beaker' },
  { key: 'pt_transplant', label: 'Transplant',  icon: 'heart' },
  { key: 'pt_general',    label: 'General',     icon: 'fitness' },
];

const REMINDER_TEMPLATES: ReminderTemplate[] = [
  // ─── STAFF · OPD ───
  { id: 's-opd-start',    title: 'Start OPD',                 icon: 'enter',         category: 'staff_opd', defaultRepeat: 'daily',  defaultHour: 9,  defaultMinute: 0,  tag: 'admin' },
  { id: 's-opd-end',      title: 'OPD wrap-up & follow-ups',  icon: 'exit',          category: 'staff_opd', defaultRepeat: 'daily',  defaultHour: 18, defaultMinute: 0,  tag: 'admin' },
  { id: 's-rounds',       title: 'Ward rounds',               icon: 'people',        category: 'staff_opd', defaultRepeat: 'daily',  defaultHour: 8,  defaultMinute: 0,  tag: 'clinical' },
  { id: 's-stand-up',     title: 'Team huddle / stand-up',    icon: 'chatbubbles',   category: 'staff_opd', defaultRepeat: 'daily',  defaultHour: 8,  defaultMinute: 30, tag: 'admin' },

  // ─── STAFF · OT ───
  { id: 's-ot-prep',      title: 'Pre-op check (next-day OT)', icon: 'medkit',        category: 'staff_ot', defaultRepeat: 'daily',  defaultHour: 17, defaultMinute: 0, tag: 'clinical' },
  { id: 's-ot-equip',     title: 'OT equipment / consumables', icon: 'archive',       category: 'staff_ot', defaultRepeat: 'weekly', defaultHour: 17, defaultMinute: 30, tag: 'admin' },
  { id: 's-ot-fitness',   title: 'Anaesth / fitness clearance check', icon: 'pulse', category: 'staff_ot', defaultRepeat: 'daily',  defaultHour: 16, defaultMinute: 0, tag: 'clinical' },

  // ─── STAFF · Follow-up & admin ───
  { id: 's-fu-call',      title: 'Patient follow-up calls',   icon: 'call',          category: 'staff_followup', defaultRepeat: 'daily',  defaultHour: 16, defaultMinute: 30, tag: 'admin' },
  { id: 's-billing',      title: 'Billing reconciliation',    icon: 'cash',          category: 'staff_followup', defaultRepeat: 'weekly', defaultHour: 18, defaultMinute: 0,  tag: 'admin' },
  { id: 's-inv-check',    title: 'Inventory check',           icon: 'archive',       category: 'staff_followup', defaultRepeat: 'weekly', defaultHour: 17, defaultMinute: 0,  tag: 'admin' },
  { id: 's-report',       title: 'Weekly report submission',  icon: 'document-text', category: 'staff_followup', defaultRepeat: 'weekly', defaultHour: 17, defaultMinute: 30, tag: 'admin' },
  { id: 's-lab-rev',      title: 'Lab / imaging results review', icon: 'pulse',     category: 'staff_followup', defaultRepeat: 'daily',  defaultHour: 11, defaultMinute: 0, tag: 'clinical' },

  // ─── PATIENT · Stones ───
  { id: 'p-stone-water',     title: 'Drink 250 ml water (3 L/day)', icon: 'water',        category: 'pt_stones', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-stone-water-noon', title: 'Hydration check — noon',      icon: 'water',        category: 'pt_stones', defaultRepeat: 'daily', defaultHour: 12, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-stone-tamsulosin', title: 'Take Tamsulosin (stone passage)', icon: 'medical', category: 'pt_stones', defaultRepeat: 'daily', defaultHour: 21, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-stone-strain',    title: 'Strain urine — collect any fragments', icon: 'beaker', category: 'pt_stones', defaultRepeat: 'daily', defaultHour: 7, defaultMinute: 0, tag: 'personal' },
  { id: 'p-stone-stent',     title: 'DJ stent removal check',       icon: 'alert-circle', category: 'pt_stones', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 14, tag: 'personal' },
  { id: 'p-stone-followup',  title: 'Post-RIRS / PCNL follow-up visit', icon: 'medkit',  category: 'pt_stones', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 7,  tag: 'personal' },

  // ─── PATIENT · Prostate ───
  { id: 'p-prost-tamsulosin', title: 'Tamsulosin (BPH) — bedtime',  icon: 'medical',     category: 'pt_prostate', defaultRepeat: 'daily', defaultHour: 21, defaultMinute: 30, tag: 'personal' },
  { id: 'p-prost-dutasteride', title: 'Dutasteride — once daily',  icon: 'medical',     category: 'pt_prostate', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-prost-psa',       title: 'PSA test — every 6 months',    icon: 'pulse',      category: 'pt_prostate', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 180, tag: 'personal' },
  { id: 'p-prost-kegel',     title: 'Pelvic-floor / Kegel exercises', icon: 'fitness',  category: 'pt_prostate', defaultRepeat: 'daily', defaultHour: 19, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-prost-postholep', title: 'Post-HoLEP / TURP — wound check', icon: 'medkit', category: 'pt_prostate', defaultRepeat: 'daily', defaultHour: 9,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-prost-followup',  title: 'Prostate clinic follow-up',    icon: 'calendar',   category: 'pt_prostate', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 30, tag: 'personal' },

  // ─── PATIENT · Bladder ───
  { id: 'p-blad-train',      title: 'Bladder training void',        icon: 'beaker',     category: 'pt_bladder', defaultRepeat: 'daily', defaultHour: 9,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-blad-uti-meds',   title: 'UTI antibiotic course',        icon: 'medical',    category: 'pt_bladder', defaultRepeat: 'daily', defaultHour: 9,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-blad-cath',       title: 'Catheter check & care',        icon: 'medkit',     category: 'pt_bladder', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-blad-diary',      title: 'Log voiding diary entry',      icon: 'create',     category: 'pt_bladder', defaultRepeat: 'daily', defaultHour: 21, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-blad-pelvic',     title: 'Pelvic-floor exercises',       icon: 'fitness',    category: 'pt_bladder', defaultRepeat: 'daily', defaultHour: 19, defaultMinute: 0,  tag: 'personal' },

  // ─── PATIENT · Transplant ───
  { id: 'p-tx-tac-am',       title: 'Tacrolimus — morning',         icon: 'medical',    category: 'pt_transplant', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-tx-tac-pm',       title: 'Tacrolimus — evening',         icon: 'medical',    category: 'pt_transplant', defaultRepeat: 'daily', defaultHour: 20, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-tx-myco',         title: 'Mycophenolate (CellCept)',     icon: 'medical',    category: 'pt_transplant', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-tx-pred',         title: 'Prednisolone — once daily',    icon: 'medical',    category: 'pt_transplant', defaultRepeat: 'daily', defaultHour: 9,  defaultMinute: 0,  tag: 'personal' },
  { id: 'p-tx-bp',           title: 'Check BP & weight (AM)',       icon: 'pulse',      category: 'pt_transplant', defaultRepeat: 'daily', defaultHour: 7,  defaultMinute: 30, tag: 'personal' },
  { id: 'p-tx-labs',         title: 'Routine labs / Tac trough',    icon: 'beaker',     category: 'pt_transplant', defaultRepeat: 'weekly', defaultHour: 8, defaultMinute: 0,  tag: 'personal' },
  { id: 'p-tx-clinic',       title: 'Transplant clinic visit',      icon: 'calendar',   category: 'pt_transplant', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 14, tag: 'personal' },

  // ─── PATIENT · General ───
  { id: 'p-gen-meds',        title: 'Take morning medications',     icon: 'medical',    category: 'pt_general', defaultRepeat: 'daily', defaultHour: 8,  defaultMinute: 0, tag: 'personal' },
  { id: 'p-gen-water',       title: 'Drink water reminder',         icon: 'water',      category: 'pt_general', defaultRepeat: 'daily', defaultHour: 12, defaultMinute: 0, tag: 'personal' },
  { id: 'p-gen-appt',        title: 'Doctor appointment',           icon: 'calendar',   category: 'pt_general', defaultRepeat: 'none',  defaultDelayMins: 60 * 24, tag: 'personal' },
  { id: 'p-gen-walk',        title: 'Take a walk / activity',       icon: 'walk',       category: 'pt_general', defaultRepeat: 'daily', defaultHour: 17, defaultMinute: 0, tag: 'personal' },
  { id: 'p-gen-refill',      title: 'Refill medications',           icon: 'archive',    category: 'pt_general', defaultRepeat: 'none',  defaultDelayMins: 60 * 24 * 25, tag: 'personal' },
];

function ReminderTemplatePicker({
  visible, isStaff, onClose, onPick,
}: {
  visible: boolean;
  isStaff: boolean;
  onClose: () => void;
  onPick: (tpl: ReminderTemplate) => void;
}) {
  const cats = isStaff ? STAFF_TPL_CATS : PT_TPL_CATS;
  const [tab, setTab] = useState<ReminderTemplate['category']>(cats[0].key);
  useEffect(() => { if (visible) setTab(cats[0].key); }, [visible, isStaff]);  // eslint-disable-line
  if (!visible) return null;
  const list = REMINDER_TEMPLATES.filter((t) => t.category === tab);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={remTplStyles.backdrop}>
        <View style={remTplStyles.sheet}>
          <View style={remTplStyles.head}>
            <View style={{ flex: 1 }}>
              <Text style={remTplStyles.title}>Reminder templates</Text>
              <Text style={remTplStyles.sub}>
                {isStaff ? 'Practice-oriented quick reminders' : 'Common reminders for your condition'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={COLORS.textSecondary} /></TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={remTplStyles.tabsRow}
          >
            {cats.map((c) => {
              const active = tab === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  onPress={() => setTab(c.key)}
                  style={[remTplStyles.tab, active && remTplStyles.tabOn]}
                >
                  <Ionicons name={c.icon} size={13} color={active ? '#fff' : COLORS.primary} />
                  <Text style={[remTplStyles.tabText, active && { color: '#fff' }]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <ScrollView style={{ marginTop: 6 }}>
            {list.map((tpl) => {
              const sub = tpl.defaultRepeat === 'daily'
                ? `Daily · ${String(tpl.defaultHour ?? 9).padStart(2, '0')}:${String(tpl.defaultMinute ?? 0).padStart(2, '0')}`
                : tpl.defaultRepeat === 'weekly'
                  ? `Weekly · ${String(tpl.defaultHour ?? 9).padStart(2, '0')}:${String(tpl.defaultMinute ?? 0).padStart(2, '0')}`
                  : tpl.defaultDelayMins && tpl.defaultDelayMins >= 60 * 24
                    ? `In ${Math.round(tpl.defaultDelayMins / 60 / 24)} day(s)`
                    : 'One-shot';
              return (
                <TouchableOpacity key={tpl.id} onPress={() => onPick(tpl)} style={remTplStyles.row} activeOpacity={0.8}>
                  <View style={remTplStyles.icon}>
                    <Ionicons name={tpl.icon} size={20} color={COLORS.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={remTplStyles.rowTitle}>{tpl.title}</Text>
                    <Text style={remTplStyles.rowSub}>{sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const remTplStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 18, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 17 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  tabsRow: { gap: 6, paddingVertical: 10 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary + '14', alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  rowSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
});

void formatDistanceToNow; void SafeAreaView;
