import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import { parseBackendDate } from '../src/date';
import api from '../src/api';
import { goBackSafe } from '../src/nav';
import { useAuth } from '../src/auth';
import { useToast } from '../src/toast';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { EmptyState } from '../src/empty-state';
import { useI18n } from '../src/i18n';
import { cancelNoteReminder } from '../src/note-reminders';
import {
  getCachedNotesList,
  setCachedNotesList,
  flushQueue,
  pendingCount,
} from '../src/notes-offline';

type Note = {
  note_id: string;
  title?: string;
  body: string;
  reminder_at?: string | null;
  reminder_fired?: boolean;
  labels?: string[];
  created_at: string;
  updated_at: string;
};

export default function NotesScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();
  const { t } = useI18n();

  const [items, setItems] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  // Notes are now a pure note-taking utility — Reminders moved to a
  // dedicated /reminders screen. We still allow filtering by URO-
  // template kind so the staff/team can pick out clinical-only notes
  // from admin/personal ones.
  const [tab, setTab] = useState<'all' | 'clinical' | 'admin' | 'personal'>('all');
  // Show a small badge when offline ops are queued for sync.
  const [queued, setQueued] = useState(0);
  // Whether the current items list came from cache (offline fallback).
  const [fromCache, setFromCache] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      // Try to flush any queued offline writes before re-fetching.
      try {
        const r = await flushQueue();
        setQueued(r.remaining);
      } catch { /* ignore */ }
      const { data } = await api.get('/notes');
      const list = data || [];
      setItems(list);
      setFromCache(false);
      // Cache the list for offline access.
      try { await setCachedNotesList(list); } catch { /* ignore */ }
    } catch {
      // Offline fallback — show the last cached list so the user can
      // still browse their notes without a network.
      try {
        const cached = await getCachedNotesList();
        if (cached && cached.length > 0) {
          setItems(cached as any);
          setFromCache(true);
        } else {
          setItems([]);
        }
      } catch {
        setItems([]);
      }
      try { setQueued(await pendingCount()); } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const confirmDelete = (n: Note) => {
    const msg = 'Delete this note permanently?';
    const run = async () => {
      try {
        await api.delete(`/notes/${n.note_id}`);
        try { await cancelNoteReminder(n.note_id); } catch { /* ignore */ }
        toast.success('Note deleted');
        await load();
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Could not delete');
      }
    };
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) run();
    } else {
      Alert.alert('Delete note?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: run },
      ]);
    }
  };

  // Distinct labels across all the user's notes, ordered by frequency
  const labelBuckets = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((n) => {
      (n.labels || []).forEach((l) => {
        const key = l.trim();
        if (!key) return;
        m.set(key, (m.get(key) || 0) + 1);
      });
    });
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((n) => {
      // Tab filter — derive role tag from labels list. The note editor
      // adds a #clinical / #admin / #personal label whenever a urology
      // template is applied; absence of any => 'all'.
      if (tab !== 'all') {
        const tags = (n.labels || []).map((l) => l.toLowerCase());
        const has = tags.includes(tab);
        if (!has) return false;
      }
      if (activeLabel) {
        const hit = (n.labels || []).some((l) => l.toLowerCase() === activeLabel.toLowerCase());
        if (!hit) return false;
      }
      if (!q) return true;
      if ((n.title || '').toLowerCase().includes(q)) return true;
      if ((n.body || '').toLowerCase().includes(q)) return true;
      if ((n.labels || []).some((l) => l.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [items, search, activeLabel, tab]);

  // Counters for the tab pills — count notes that carry the matching
  // role-tag label.
  const tabCounts = useMemo(() => {
    let clinical = 0; let admin = 0; let personal = 0;
    items.forEach((n) => {
      const tags = (n.labels || []).map((l) => l.toLowerCase());
      if (tags.includes('clinical')) clinical += 1;
      if (tags.includes('admin')) admin += 1;
      if (tags.includes('personal')) personal += 1;
    });
    return { all: items.length, clinical, admin, personal };
  }, [items]);

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
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Notes & Reminders</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyFlex}>
          <EmptyState
            icon="lock-closed-outline"
            title={t('notes.signInTitle')}
            subtitle={t('notes.signInSub')}
            ctaLabel={t('common.signIn')}
            onCta={() => router.push('/(tabs)/more')}
            testID="notes-signin-empty"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => goBackSafe(router)} style={styles.backBtn} testID="notes-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notes</Text>
          <Text style={styles.subtitle}>
            {tab === 'all'
              ? `${items.length} ${items.length === 1 ? 'note' : 'notes'}`
              : `${tabCounts[tab]} ${tab}`}
            {activeLabel ? ` · #${activeLabel}` : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/notes/new')}
          style={styles.newBtn}
          testID="notes-new"
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Offline / queued banner — informs the user that they're
          either viewing cached data or have queued ops waiting to
          sync. */}
      {(fromCache || queued > 0) && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={COLORS.warning} />
          <Text style={styles.offlineText}>
            {fromCache
              ? `Showing offline notes${queued > 0 ? ` · ${queued} pending sync` : ''}`
              : `${queued} offline change${queued === 1 ? '' : 's'} pending sync`}
          </Text>
        </View>
      )}

      {/* Tabs — filter by role-tag label (Clinical / Admin / Personal).
          The 'All' pill shows total count. */}
      <View style={styles.tabsRow}>
        {(['all', 'clinical', 'admin', 'personal'] as const).map((k) => {
          const active = tab === k;
          const cnt = tabCounts[k];
          const label = k.charAt(0).toUpperCase() + k.slice(1);
          const icon =
            k === 'all' ? 'documents'
            : k === 'clinical' ? 'medkit'
            : k === 'admin' ? 'briefcase'
            : 'person';
          return (
            <TouchableOpacity
              key={k}
              onPress={() => setTab(k)}
              style={[styles.tabPill, active && styles.tabPillOn]}
              activeOpacity={0.78}
              testID={`notes-tab-${k}`}
            >
              <Ionicons name={icon as any} size={13} color={active ? '#fff' : COLORS.primary} />
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

      {items.length > 0 && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search notes, labels…"
            placeholderTextColor={COLORS.textDisabled}
            style={{ flex: 1, marginLeft: 8, ...FONTS.body, color: COLORS.textPrimary }}
            testID="notes-search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={COLORS.textDisabled} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {labelBuckets.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.labelRow}
        >
          <TouchableOpacity
            onPress={() => setActiveLabel(null)}
            style={[styles.labelChip, activeLabel === null && styles.labelChipOn]}
            testID="notes-filter-all"
          >
            <Text style={[styles.labelChipText, activeLabel === null && styles.labelChipTextOn]}>
              All
            </Text>
            <View style={[styles.labelChipCount, activeLabel === null && styles.labelChipCountOn]}>
              <Text style={[styles.labelChipCountText, activeLabel === null && { color: '#fff' }]}>
                {items.length}
              </Text>
            </View>
          </TouchableOpacity>
          {labelBuckets.map(({ label, count }) => {
            const active = activeLabel?.toLowerCase() === label.toLowerCase();
            return (
              <TouchableOpacity
                key={label}
                onPress={() => setActiveLabel(active ? null : label)}
                style={[styles.labelChip, active && styles.labelChipOn]}
                testID={`notes-filter-${label}`}
              >
                <Text style={[styles.labelChipText, active && styles.labelChipTextOn]}>
                  {label}
                </Text>
                <View style={[styles.labelChipCount, active && styles.labelChipCountOn]}>
                  <Text style={[styles.labelChipCountText, active && { color: '#fff' }]}>
                    {count}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
      >
        {filtered.length === 0 ? (
          <View style={{ paddingTop: 20 }}>
            <EmptyState
              icon={items.length === 0 ? 'book-outline' : 'search-outline'}
              title={items.length === 0 ? t('notes.emptyTitle') : t('notes.noMatchesTitle')}
              subtitle={
                items.length === 0
                  ? t('notes.emptySub')
                  : activeLabel
                    ? `No notes tagged "${activeLabel}".`
                    : t('notes.noMatchesSub')
              }
              ctaLabel={items.length === 0 ? t('notes.writeFirstNote') : undefined}
              onCta={items.length === 0 ? () => router.push('/notes/new') : undefined}
              testID="notes-empty"
            />
          </View>
        ) : (
          filtered.map((n) => {
            const hasReminder = !!n.reminder_at;
            const reminderPast = hasReminder && isPast(new Date(n.reminder_at!));
            const chipLabels = (n.labels || []).slice(0, 3);
            const extraLabels = (n.labels || []).length - chipLabels.length;
            // Hide raw image data URIs from the card snippet AND strip
            // common markdown syntax (#, **, *, _, `, >, lists, links)
            // so the preview reads as clean plain text rather than the
            // raw `# heading` / `**bold**` markers the editor saves.
            // Full rendering still happens in the note detail view.
            const cleanBody = (n.body || '')
              .replace(/!\[[^\]]*\]\(data:image\/[a-zA-Z]+;base64,[^)\s]+\)/g, '🖼️ image')
              .replace(/\[image:[a-zA-Z0-9_]+\]/g, '🖼️ image')
              // Strip markdown: headings, emphasis, blockquote, list bullets, code, links.
              .replace(/^#{1,6}\s+/gm, '')                                  // # / ## headings
              .replace(/^\s*>\s+/gm, '')                                    // > blockquote
              .replace(/^\s*[-*+]\s+/gm, '• ')                              // bullet lists
              .replace(/^\s*\d+\.\s+/gm, '')                                // numbered lists
              .replace(/\*\*([^*]+)\*\*/g, '$1')                            // **bold**
              .replace(/__([^_]+)__/g, '$1')                                // __bold__
              .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')                    // *italic*
              .replace(/(^|[^_])_([^_\n]+)_/g, '$1$2')                      // _italic_
              .replace(/`([^`]+)`/g, '$1')                                  // `inline code`
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')                      // [text](url) -> text
              .replace(/\n{3,}/g, '\n\n')                                   // collapse extra blank lines
              .trim();
            return (
              <TouchableOpacity
                key={n.note_id}
                style={styles.card}
                onPress={() => router.push(`/notes/${n.note_id}`)}
                activeOpacity={0.75}
                testID={`notes-card-${n.note_id}`}
              >
                {n.title ? <Text style={styles.cardTitle} numberOfLines={2}>{n.title}</Text> : null}
                <Text
                  style={n.title ? styles.cardBody : styles.cardBodyStandalone}
                  numberOfLines={n.title ? 4 : 6}
                >
                  {cleanBody}
                </Text>

                {chipLabels.length > 0 && (
                  <View style={styles.cardLabels}>
                    {chipLabels.map((l) => (
                      <View key={l} style={styles.cardLabelChip}>
                        <Text style={styles.cardLabelChipText} numberOfLines={1}>{l}</Text>
                      </View>
                    ))}
                    {extraLabels > 0 && (
                      <View style={[styles.cardLabelChip, { backgroundColor: COLORS.border }]}>
                        <Text style={styles.cardLabelChipText}>+{extraLabels}</Text>
                      </View>
                    )}
                  </View>
                )}

                {hasReminder ? (
                  <View
                    style={[
                      styles.reminderChip,
                      reminderPast ? styles.reminderChipPast : styles.reminderChipActive,
                    ]}
                  >
                    <Ionicons
                      name={reminderPast ? 'alarm' : 'alarm-outline'}
                      size={12}
                      color={reminderPast ? COLORS.textDisabled : COLORS.accent}
                    />
                    <Text style={[styles.reminderChipText, reminderPast && { color: COLORS.textDisabled }]}>
                      {reminderPast ? 'Reminded ' : 'Reminds '}
                      {format(new Date(n.reminder_at!), 'dd-MM-yyyy, h:mm a')}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.cardFoot}>
                  <Ionicons name="time-outline" size={12} color={COLORS.textDisabled} />
                  <Text style={styles.cardTime}>
                    Updated {formatDistanceToNow(parseBackendDate(n.updated_at), { addSuffix: true })}
                  </Text>
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation(); confirmDelete(n); }}
                    style={styles.deleteIcon}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    testID={`notes-del-${n.note_id}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={COLORS.accent} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  newBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  title: { ...FONTS.h2, color: COLORS.textPrimary },
  subtitle: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },

  // Tabs
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 4, paddingBottom: 6,
    gap: 6,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  tabPillOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabPillText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: COLORS.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeOn: { backgroundColor: 'rgba(255,255,255,0.28)' },
  tabBadgeText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10 },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 20, marginTop: 6,
    backgroundColor: COLORS.warning + '14',
    borderWidth: 1, borderColor: COLORS.warning + '44',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  offlineText: { ...FONTS.bodyMedium, color: COLORS.warning, fontSize: 11, flex: 1 },

  searchBox: {
    marginHorizontal: 20, marginTop: 6, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 24,
    borderWidth: 1, borderColor: COLORS.border,
    paddingHorizontal: 12, height: 40,
  },

  labelRow: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 8,
    flexDirection: 'row',
  },
  labelChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  labelChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  labelChipText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  labelChipTextOn: { color: '#fff' },
  labelChipCount: {
    minWidth: 18, paddingHorizontal: 5,
    height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.border,
  },
  labelChipCountOn: { backgroundColor: 'rgba(255,255,255,0.3)' },
  labelChipCountText: { ...FONTS.bodyMedium, color: COLORS.textSecondary, fontSize: 10 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, marginTop: 40 },
  emptyFlex: { flex: 1, justifyContent: 'center' },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14, textAlign: 'center' },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 6, textAlign: 'center', fontSize: 13, lineHeight: 19 },

  card: {
    backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 12,
  },
  cardTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15, marginBottom: 6 },
  cardBody: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 },
  cardBodyStandalone: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  cardLabels: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  cardLabelChip: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
  },
  cardLabelChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 10.5 },

  cardFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10,
    borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10,
  },
  cardTime: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11 },
  deleteIcon: { marginLeft: 'auto', padding: 4 },

  reminderChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  reminderChipActive: { backgroundColor: COLORS.accent + '12', borderColor: COLORS.accent + '55' },
  reminderChipPast: { backgroundColor: COLORS.textDisabled + '15', borderColor: COLORS.textDisabled + '55' },
  reminderChipText: { ...FONTS.bodyMedium, color: COLORS.accent, fontSize: 11 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.pill,
  },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },
});
