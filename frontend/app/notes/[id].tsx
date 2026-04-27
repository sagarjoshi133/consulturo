import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { format, addHours, addDays } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useToast } from '../../src/toast';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { DateField, TimeField } from '../../src/date-picker';
import { parseUIDate } from '../../src/date';
import { scheduleNoteReminder, cancelNoteReminder } from '../../src/note-reminders';
import {
  getCachedNote,
  cacheNote,
  saveDraft,
  getDraft,
  clearDraft,
  enqueueCreate,
  enqueueUpdate,
  enqueueDelete,
  flushQueue,
  pendingCount,
} from '../../src/notes-offline';

type Note = {
  note_id: string;
  title?: string;
  body: string;
  reminder_at?: string | null;
  reminder_fired?: boolean;
  labels?: string[];
};

export default function NoteEditor() {
  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [reminderOn, setReminderOn] = useState(false);
  const [remDate, setRemDate] = useState(''); // DD-MM-YYYY
  const [remTime, setRemTime] = useState(''); // HH:mm
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  // Editor — track selection so toolbar buttons insert at the cursor
  // and not at the end of the text.
  const bodyRef = useRef<TextInput>(null);
  const [bodySel, setBodySel] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  // Inline image attachments — base64 thumbnails kept locally and
  // serialised into the body as ![image](data:image/...) blocks. We
  // also track them as objects so we can render previews in the
  // editor without parsing the body.
  const [images, setImages] = useState<{ id: string; uri: string }[]>([]);

  // Template picker visibility — separate sheet so users can apply
  // a urology-oriented body template without crowding the toolbar.
  const [showTemplates, setShowTemplates] = useState(false);
  const isStaff = !!user && ['owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing'].includes((user.role as string) || '');

  // Offline draft state
  const draftKey = isNew ? 'new' : String(id);
  const [pendingOps, setPendingOps] = useState(0);
  const [draftRestored, setDraftRestored] = useState(false);

  // Fetch the note + the user's existing labels (for suggestions)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Always fetch label suggestions
        try {
          const { data: sug } = await api.get('/notes/labels');
          if (!cancelled && Array.isArray(sug)) {
            setSuggestions(sug.map((r: any) => r.label).filter(Boolean));
          }
        } catch { /* ignore */ }

        if (!isNew) {
          let found: Note | undefined;
          try {
            const { data } = await api.get('/notes');
            found = (data || []).find((n: any) => n.note_id === id);
            // Cache the freshest copy so the next offline open is fast.
            if (found) {
              try { await cacheNote(found as any); } catch { /* ignore */ }
            }
          } catch {
            // Offline / API failure → fall back to local cache so the
            // user can keep reading & editing the note.
            try {
              const cached = await getCachedNote(String(id));
              if (cached) found = cached as any;
            } catch { /* ignore */ }
          }
          if (found && !cancelled) {
            setTitle(found.title || '');
            // Parse out any embedded markdown image data URIs so the
            // editor can render them in the strip and the body text
            // stays clean. We replace them with `[image:id]` tokens.
            let raw = found.body || '';
            const imgs: { id: string; uri: string }[] = [];
            // Match ![alt?](data:image/...;base64,...) tokens. The
            // alt portion is ignored. We allow a trailing newline to
            // be consumed so we don't leave double-blank lines.
            raw = raw.replace(/!\[[^\]]*\]\((data:image\/[a-zA-Z]+;base64,[^)\s]+)\)/g, (_m, uri) => {
              const id = `img_${imgs.length}_${Math.random().toString(36).slice(2, 6)}`;
              imgs.push({ id, uri });
              return `[image:${id}]`;
            });
            setBody(raw);
            setImages(imgs);
            setLabels(Array.isArray(found.labels) ? found.labels : []);
            if (found.reminder_at) {
              const d = new Date(found.reminder_at);
              setReminderOn(true);
              setRemDate(format(d, 'dd-MM-yyyy'));
              setRemTime(format(d, 'HH:mm'));
            }
          }
        }

        // Restore any unsaved draft for this note (overrides the
        // server snapshot when newer). Only show the draft if it
        // differs from the server copy.
        try {
          const draft = await getDraft(draftKey);
          if (draft && !cancelled) {
            const draftAge = Date.now() - new Date(draft.saved_at).getTime();
            // Only restore drafts that are < 30 days old.
            if (draftAge < 30 * 24 * 60 * 60 * 1000) {
              if (draft.title || draft.body) {
                if (isNew || (draft.body && draft.body.length > 0)) {
                  setTitle(draft.title || '');
                  // Best-effort body restore — keeps `[image:id]`
                  // tokens intact.
                  setBody(draft.body || '');
                  if (Array.isArray(draft.labels)) setLabels(draft.labels);
                  setDraftRestored(true);
                }
              }
            }
          }
        } catch { /* ignore */ }

        // Try to flush any queued offline ops on entry.
        try {
          const r = await flushQueue();
          if (r.remaining > 0) setPendingOps(r.remaining);
        } catch { /* ignore */ }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, isNew, draftKey]);

  const markDirty = useCallback(() => setDirty(true), []);

  // Auto-save the current editor state as a local draft (debounced).
  // Always runs — even when offline — so the user never loses work.
  useEffect(() => {
    if (loading) return;
    if (!dirty) return;
    const t = setTimeout(() => {
      saveDraft({
        key: draftKey,
        title,
        body,
        labels,
        reminder_at: reminderOn ? `${remDate}T${remTime || '09:00'}` : null,
        saved_at: new Date().toISOString(),
      }).catch(() => { /* ignore */ });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body, labels, reminderOn, remDate, remTime, dirty, loading, draftKey]);

  const computeReminderIso = (): string | null => {
    if (!reminderOn) return null;
    const iso = parseUIDate(remDate);
    if (!iso) return null;
    const t = remTime || '09:00';
    const d = new Date(`${iso}T${t}:00`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  };

  const addLabel = (raw: string) => {
    const s = raw.trim().slice(0, 24);
    if (!s) return;
    if (labels.some((l) => l.toLowerCase() === s.toLowerCase())) {
      setLabelInput('');
      return;
    }
    if (labels.length >= 12) {
      toast.error('Maximum 12 labels per note');
      return;
    }
    setLabels([...labels, s]);
    setLabelInput('');
    markDirty();
  };

  const removeLabel = (label: string) => {
    setLabels(labels.filter((l) => l !== label));
    markDirty();
  };

  // Filter suggestions: hide ones already selected, match prefix if typing
  const visibleSuggestions = useMemo(() => {
    const q = labelInput.trim().toLowerCase();
    const selected = new Set(labels.map((l) => l.toLowerCase()));
    const filtered = suggestions.filter((s) => {
      if (selected.has(s.toLowerCase())) return false;
      if (!q) return true;
      return s.toLowerCase().includes(q);
    });
    return filtered.slice(0, 8);
  }, [labelInput, labels, suggestions]);

  // ── Toolbar: insert list-marker prefixes at the start of the
  // current line (or every selected line). For numbered lists we
  // auto-increment based on the previous line's number. ──
  const insertPrefix = (kind: 'bullet' | 'number' | 'todo') => {
    const start = bodySel.start;
    const end = bodySel.end;
    // Find the start of the current/first line in the selection.
    const before = body.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const inSel = body.slice(lineStart, end);
    const lines = inSel.split('\n');
    const startIsBlank = lineStart === start || /^\s*$/.test(lines[0] || '');
    let n = 1;
    // For numbered lists, look one line up to continue the count.
    if (kind === 'number' && lineStart > 0) {
      const prevLine = body.slice(0, lineStart - 1).split('\n').slice(-1)[0] || '';
      const m = prevLine.match(/^\s*(\d+)\.\s/);
      if (m) n = parseInt(m[1], 10) + 1;
    }
    const transformed = lines.map((ln) => {
      const tag = kind === 'bullet' ? '• ' : kind === 'todo' ? '☐ ' : `${n++}. `;
      // Don't double-prefix lines that already have a marker.
      if (/^\s*(•|☐|☑|\d+\.)\s/.test(ln)) return ln;
      return tag + ln;
    }).join('\n');
    const next = body.slice(0, lineStart) + transformed + body.slice(end);
    setBody(next);
    markDirty();
    // If the editor was empty before, also append a newline so the
    // user can start writing on the next line right away.
    if (startIsBlank && lines.length === 1 && !lines[0]) {
      // no-op, the new prefix is enough
    }
    // Move the cursor to the end of the inserted block.
    const newEnd = lineStart + transformed.length;
    setTimeout(() => {
      bodyRef.current?.setNativeProps?.({ selection: { start: newEnd, end: newEnd } });
      setBodySel({ start: newEnd, end: newEnd });
    }, 30);
  };

  // Toggle a todo line's checkbox between ☐ and ☑.
  const toggleTodo = (lineIdx: number) => {
    const lines = body.split('\n');
    const ln = lines[lineIdx];
    if (!ln) return;
    if (/^\s*☐\s/.test(ln)) lines[lineIdx] = ln.replace(/☐/, '☑');
    else if (/^\s*☑\s/.test(ln)) lines[lineIdx] = ln.replace(/☑/, '☐');
    setBody(lines.join('\n'));
    markDirty();
  };

  // Insert text at the current cursor position (or wrap selected text
  // when `wrapWith` is provided). Bumps the cursor to land after the
  // inserted block.
  const insertAtCursor = (text: string, wrapWith?: string) => {
    const start = bodySel.start;
    const end = bodySel.end;
    let inserted = text;
    let cursor = start + text.length;
    if (wrapWith && start !== end) {
      // wrap selection between two markers
      const sel = body.slice(start, end);
      inserted = `${wrapWith}${sel}${wrapWith}`;
      cursor = start + inserted.length;
    }
    const next = body.slice(0, start) + inserted + body.slice(end);
    setBody(next);
    markDirty();
    setTimeout(() => {
      bodyRef.current?.setNativeProps?.({ selection: { start: cursor, end: cursor } });
      setBodySel({ start: cursor, end: cursor });
    }, 30);
  };

  // Prepend a heading marker (# / ##) to the current line.
  const insertHeading = (level: 1 | 2) => {
    const start = bodySel.start;
    const before = body.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEnd = body.indexOf('\n', start);
    const ln = body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd);
    const stripped = ln.replace(/^\s*#{1,6}\s+/, '');
    const tag = level === 1 ? '# ' : '## ';
    const updated = tag + stripped;
    const next = body.slice(0, lineStart) + updated + body.slice((lineEnd === -1 ? body.length : lineEnd));
    setBody(next);
    markDirty();
  };

  // Insert today's date or time at the cursor.
  const insertTimestamp = (kind: 'date' | 'time' | 'datetime') => {
    const now = new Date();
    let s = '';
    if (kind === 'date') s = format(now, 'EEE, dd MMM yyyy');
    else if (kind === 'time') s = format(now, 'HH:mm');
    else s = format(now, 'dd MMM yyyy · HH:mm');
    insertAtCursor(s);
  };

  // Horizontal divider on its own line.
  const insertDivider = () => {
    const start = bodySel.start;
    const before = body.slice(0, start);
    const needsLead = before.length > 0 && !before.endsWith('\n');
    insertAtCursor(`${needsLead ? '\n' : ''}─────────────\n`);
  };

  // Quote / callout — prepend "> " to current/selected lines.
  const insertQuote = () => {
    const start = bodySel.start;
    const end = bodySel.end;
    const before = body.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const inSel = body.slice(lineStart, end);
    const lines = inSel.split('\n');
    const transformed = lines.map((ln) => (/^\s*>\s/.test(ln) ? ln : `> ${ln}`)).join('\n');
    const next = body.slice(0, lineStart) + transformed + body.slice(end);
    setBody(next);
    markDirty();
  };

  // Clear formatting from current/selected lines (strips list markers,
  // headings, todo boxes, quotes).
  const clearFormatting = () => {
    const start = bodySel.start;
    const end = bodySel.end;
    const before = body.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const inSel = body.slice(lineStart, end > start ? end : (body.indexOf('\n', start) === -1 ? body.length : body.indexOf('\n', start)));
    const lines = inSel.split('\n');
    const transformed = lines.map((ln) =>
      ln
        .replace(/^\s*(•|☐|☑|>|#{1,6})\s+/, '')
        .replace(/^\s*\d+\.\s+/, ''),
    ).join('\n');
    const next = body.slice(0, lineStart) + transformed + body.slice(lineStart + inSel.length);
    setBody(next);
    markDirty();
  };

  // Undo / redo using a tiny in-memory history stack.
  const historyRef = useRef<{ stack: string[]; cursor: number }>({ stack: [''], cursor: 0 });
  useEffect(() => {
    // Push to history when body changes (debounced via React render).
    const h = historyRef.current;
    if (h.stack[h.cursor] === body) return;
    // Trim any redo branch
    h.stack = h.stack.slice(0, h.cursor + 1);
    h.stack.push(body);
    if (h.stack.length > 50) h.stack.shift();
    h.cursor = h.stack.length - 1;
  }, [body]);
  const undo = () => {
    const h = historyRef.current;
    if (h.cursor <= 0) return;
    h.cursor -= 1;
    setBody(h.stack[h.cursor]);
    markDirty();
  };
  const redo = () => {
    const h = historyRef.current;
    if (h.cursor >= h.stack.length - 1) return;
    h.cursor += 1;
    setBody(h.stack[h.cursor]);
    markDirty();
  };

  const attachImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        toast.error('Please grant photo access to attach images');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.Images || ('images' as any),
        quality: 0.7,
        base64: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      const ext = (a.mimeType || 'image/jpeg').split('/')[1] || 'jpeg';
      const dataUri = a.base64
        ? `data:image/${ext};base64,${a.base64}`
        : a.uri;
      const id = `img_${Date.now().toString(36)}`;
      setImages((cur) => [...cur, { id, uri: dataUri }]);
      // Also insert a placeholder token at the cursor so the order
      // is preserved in the body text.
      const start = bodySel.start;
      const token = `\n[image:${id}]\n`;
      const next = body.slice(0, start) + token + body.slice(start);
      setBody(next);
      markDirty();
    } catch (e) {
      toast.error('Could not attach image');
    }
  };

  const save = async () => {
    const t = title.trim();
    let b = body.trim();
    // Serialise images: replace [image:id] tokens with markdown
    // `![](data:...)` blocks so the data URI persists in the body.
    if (images.length > 0) {
      images.forEach((img) => {
        const tok = new RegExp(`\\[image:${img.id}\\]`, 'g');
        b = b.replace(tok, `![](${img.uri})`);
      });
    }
    if (!b) {
      toast.error('Note body cannot be empty');
      return;
    }
    // Auto-commit any pending text in the label input
    const committedLabels = [...labels];
    const pending = labelInput.trim().slice(0, 24);
    if (pending && !committedLabels.some((l) => l.toLowerCase() === pending.toLowerCase())) {
      committedLabels.push(pending);
    }

    let reminderIso: string | null = null;
    if (reminderOn) {
      reminderIso = computeReminderIso();
      if (!reminderIso) {
        toast.error('Please pick a valid date & time for the reminder');
        return;
      }
      if (new Date(reminderIso).getTime() <= Date.now()) {
        toast.error('Reminder time is in the past');
        return;
      }
    }

    setSaving(true);
    try {
      let savedId: string | undefined;
      const payload = {
        title: t,
        body: b,
        reminder_at: reminderIso,
        labels: committedLabels,
      };
      try {
        if (isNew) {
          const { data } = await api.post('/notes', payload);
          savedId = data?.note_id;
          // Mirror to local cache so subsequent offline opens work.
          if (savedId) {
            try { await cacheNote({ note_id: savedId, ...payload }); } catch { /* ignore */ }
          }
          toast.success('Note saved');
        } else {
          await api.patch(`/notes/${id}`, payload);
          savedId = String(id);
          try { await cacheNote({ note_id: savedId, ...payload }); } catch { /* ignore */ }
          toast.success('Note updated');
        }
      } catch (e: any) {
        const isNetwork = !e?.response || e?.code === 'ERR_NETWORK';
        if (!isNetwork) throw e;
        // Offline → queue and confirm to the user. The note is also
        // available in the local draft cache so reopening still shows
        // their changes.
        if (isNew) {
          const tmpId = await enqueueCreate(payload);
          savedId = tmpId;
        } else {
          await enqueueUpdate(String(id), payload);
          savedId = String(id);
          try { await cacheNote({ note_id: String(id), ...payload }); } catch { /* ignore */ }
        }
        toast.success('Saved offline · will sync');
      }

      // Schedule (or cancel) the local OS alarm so the user gets a
      // notification even if the app is closed.
      if (savedId && !savedId.startsWith('local_')) {
        try {
          await scheduleNoteReminder(savedId, t || 'Note reminder', b, reminderIso);
        } catch { /* never block save on scheduler errors */ }
      }

      // Clear the local draft now that it's been committed (online or queued).
      try { await clearDraft(draftKey); } catch { /* ignore */ }

      setDirty(false);
      router.back();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (isNew) { router.back(); return; }
    const msg = 'Delete this note permanently?';
    const run = async () => {
      try {
        try {
          await api.delete(`/notes/${id}`);
        } catch (e: any) {
          const isNetwork = !e?.response || e?.code === 'ERR_NETWORK';
          if (!isNetwork) throw e;
          // Queue for sync when back online
          await enqueueDelete(String(id));
          toast.success('Deletion queued · will sync');
        }
        try { await cancelNoteReminder(String(id)); } catch { /* ignore */ }
        try { await clearDraft(draftKey); } catch { /* ignore */ }
        toast.success('Note deleted');
        router.back();
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

  const confirmLeave = () => {
    if (!dirty) { router.back(); return; }
    const msg = 'You have unsaved changes. Leave anyway?';
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(msg)) router.back();
    } else {
      Alert.alert('Unsaved changes', msg, [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => router.back() },
      ]);
    }
  };

  const quickReminder = (kind: 'in1h' | 'tomorrow9' | 'nextweek') => {
    const now = new Date();
    let d: Date;
    if (kind === 'in1h') d = addHours(now, 1);
    else if (kind === 'tomorrow9') { d = addDays(now, 1); d.setHours(9, 0, 0, 0); }
    else { d = addDays(now, 7); d.setHours(9, 0, 0, 0); }
    setReminderOn(true);
    setRemDate(format(d, 'dd-MM-yyyy'));
    setRemTime(format(d, 'HH:mm'));
    markDirty();
  };

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Ionicons name="lock-closed-outline" size={48} color={COLORS.textDisabled} />
        <Text style={styles.signTitle}>Sign in to keep notes</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/more')} style={styles.primaryBtn}>
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={confirmLeave} style={styles.iconBtn} testID="note-back">
            <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topTitle}>{isNew ? 'New Note' : 'Edit Note'}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {!isNew && (
              <TouchableOpacity onPress={confirmDelete} style={styles.iconBtn} testID="note-delete">
                <Ionicons name="trash-outline" size={20} color={COLORS.accent} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={save}
              disabled={saving || !body.trim()}
              style={[styles.saveBtn, !body.trim() && { opacity: 0.5 }]}
              testID="note-save"
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={16} color="#fff" />
                  <Text style={styles.saveBtnText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <TextInput
            value={title}
            onChangeText={(v) => { setTitle(v); markDirty(); }}
            placeholder="Title"
            placeholderTextColor={COLORS.textDisabled}
            style={styles.titleInput}
            maxLength={120}
            testID="note-title"
          />

          {/* Draft restored / pending sync banner */}
          {(draftRestored || pendingOps > 0) && (
            <View style={styles.draftBanner}>
              <Ionicons
                name={pendingOps > 0 ? 'cloud-offline-outline' : 'document-text-outline'}
                size={13}
                color={COLORS.warning}
              />
              <Text style={styles.draftBannerText}>
                {pendingOps > 0
                  ? `${pendingOps} note${pendingOps === 1 ? '' : 's'} pending sync`
                  : 'Restored unsaved draft'}
              </Text>
            </View>
          )}

          {/* Labels editor */}
          <View style={styles.labelsBlock}>
            <View style={styles.labelsRow}>
              <Ionicons name="pricetags-outline" size={15} color={COLORS.textSecondary} />
              <Text style={styles.labelsHeader}>Labels</Text>
              {labels.length > 0 && (
                <Text style={styles.labelsCount}>{labels.length}/12</Text>
              )}
            </View>

            {/* Selected chips */}
            {labels.length > 0 && (
              <View style={styles.chipWrap}>
                {labels.map((l) => (
                  <View key={l} style={styles.chipSelected}>
                    <Text style={styles.chipSelectedText}>{l}</Text>
                    <TouchableOpacity
                      onPress={() => removeLabel(l)}
                      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                      testID={`note-label-remove-${l}`}
                    >
                      <Ionicons name="close" size={14} color={COLORS.primary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Free-text input */}
            <View style={styles.labelInputRow}>
              <TextInput
                value={labelInput}
                onChangeText={setLabelInput}
                placeholder="Type a label and press enter"
                placeholderTextColor={COLORS.textDisabled}
                style={styles.labelInput}
                onSubmitEditing={() => addLabel(labelInput)}
                returnKeyType="done"
                blurOnSubmit={false}
                maxLength={24}
                testID="note-label-input"
              />
              {labelInput.trim().length > 0 && (
                <TouchableOpacity
                  onPress={() => addLabel(labelInput)}
                  style={styles.labelAddBtn}
                  testID="note-label-add"
                >
                  <Ionicons name="add" size={18} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            {/* Suggestions from previously used labels */}
            {visibleSuggestions.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.suggestLabel}>
                  {labelInput.trim() ? 'Matches' : 'Recent'}
                </Text>
                <View style={styles.chipWrap}>
                  {visibleSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => addLabel(s)}
                      style={styles.chipSuggestion}
                      testID={`note-label-suggest-${s}`}
                    >
                      <Ionicons name="add-circle-outline" size={12} color={COLORS.textSecondary} />
                      <Text style={styles.chipSuggestionText}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* ── Toolbar — markdown-style helpers. Inserts bullet, numbered or todo
              markers at the start of the current line (or every selected line);
              the image button picks a photo from the library and embeds it as
              base64 directly in the note body. The Template button opens a
              urology-oriented template picker. ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbar}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity onPress={() => setShowTemplates(true)} style={[styles.toolBtn, { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '14' }]} testID="note-tool-template">
              <Ionicons name="copy" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Template</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity onPress={() => insertHeading(1)} style={styles.toolBtn} testID="note-tool-h1">
              <Text style={[styles.toolBtnText, { fontSize: 14, fontWeight: '700' }]}>H1</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertHeading(2)} style={styles.toolBtn} testID="note-tool-h2">
              <Text style={[styles.toolBtnText, { fontSize: 13, fontWeight: '700' }]}>H2</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertAtCursor('', '**')} style={styles.toolBtn} testID="note-tool-bold">
              <Text style={[styles.toolBtnText, { fontWeight: '900' }]}>B</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertAtCursor('', '_')} style={styles.toolBtn} testID="note-tool-italic">
              <Text style={[styles.toolBtnText, { fontStyle: 'italic' }]}>I</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity onPress={() => insertPrefix('bullet')} style={styles.toolBtn} testID="note-tool-bullet">
              <Ionicons name="list" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>•</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertPrefix('number')} style={styles.toolBtn} testID="note-tool-number">
              <Ionicons name="reorder-three" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>1.</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertPrefix('todo')} style={styles.toolBtn} testID="note-tool-todo">
              <Ionicons name="checkbox-outline" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Todo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={insertQuote} style={styles.toolBtn} testID="note-tool-quote">
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Quote</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity onPress={() => insertTimestamp('date')} style={styles.toolBtn} testID="note-tool-date">
              <Ionicons name="calendar-outline" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Date</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => insertTimestamp('time')} style={styles.toolBtn} testID="note-tool-time">
              <Ionicons name="time-outline" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Time</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={insertDivider} style={styles.toolBtn} testID="note-tool-divider">
              <Ionicons name="remove-outline" size={20} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Divider</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={attachImage} style={styles.toolBtn} testID="note-tool-image">
              <Ionicons name="image-outline" size={18} color={COLORS.primary} />
              <Text style={styles.toolBtnText}>Img</Text>
            </TouchableOpacity>
            <View style={styles.toolDivider} />
            <TouchableOpacity onPress={clearFormatting} style={styles.toolBtn} testID="note-tool-clear">
              <Ionicons name="brush-outline" size={18} color={COLORS.warning} />
              <Text style={[styles.toolBtnText, { color: COLORS.warning }]}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={undo} style={styles.toolBtn} testID="note-tool-undo">
              <Ionicons name="arrow-undo" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={redo} style={styles.toolBtn} testID="note-tool-redo">
              <Ionicons name="arrow-redo" size={18} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </ScrollView>

          {/* Body */}
          <TextInput
            ref={bodyRef}
            value={body}
            onChangeText={(v) => { setBody(v); markDirty(); }}
            onSelectionChange={(e) => setBodySel(e.nativeEvent.selection)}
            placeholder="Start writing… use the toolbar above for bullets, numbered lists, to-dos and images."
            placeholderTextColor={COLORS.textDisabled}
            style={styles.bodyInput}
            multiline
            maxLength={20000}
            textAlignVertical="top"
            autoFocus={isNew}
            testID="note-body"
          />

          {/* Inline image preview strip — tap a thumbnail to remove the
              attachment. The corresponding `[image:id]` token is also
              stripped from the body. */}
          {images.length > 0 && (
            <View style={styles.imageStrip}>
              {images.map((img) => (
                <TouchableOpacity
                  key={img.id}
                  onPress={() => {
                    setImages((cur) => cur.filter((x) => x.id !== img.id));
                    setBody((b) => b.replace(new RegExp(`\\n?\\[image:${img.id}\\]\\n?`, 'g'), ''));
                    markDirty();
                  }}
                  activeOpacity={0.78}
                >
                  <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                  <View style={styles.imageRemove}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.charCount}>{body.length} characters</Text>

          {/* Need a real alarm? Reminders are now their own utility. */}
          <TouchableOpacity
            onPress={() => router.push('/reminders' as any)}
            style={styles.reminderShortcut}
            activeOpacity={0.78}
          >
            <View style={styles.alarmBadge}>
              <Ionicons name="alarm" size={18} color={COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reminderTitle}>Need an alarm?</Text>
              <Text style={styles.reminderSub}>
                Reminders are a separate utility — set a device alarm.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Template picker modal */}
      <TemplatePicker
        visible={showTemplates}
        isStaff={isStaff}
        onClose={() => setShowTemplates(false)}
        onPick={(tpl) => {
          // Append template body and add the role-tag label.
          if (!title.trim()) setTitle(tpl.title);
          setBody((cur) => (cur.trim() ? `${cur}\n\n${tpl.body}` : tpl.body));
          // Ensure the role-tag label + any disease labels are present
          // (used by the Notes list filter pills + future search).
          setLabels((cur) => {
            const next = new Set(cur.map((l) => l.toLowerCase()));
            next.add(tpl.tag);
            (tpl.labels || []).forEach((l) => next.add(l.toLowerCase()));
            return Array.from(next);
          });
          markDirty();
          setShowTemplates(false);
          toast.success(`Applied template · ${tpl.title}`);
        }}
      />
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Urology-oriented templates — audience-aware:
//   • STAFF (owner / doctor / team) → "Clinical" + "Practice" tabs.
//   • PATIENT → categorized by disease (Stones / Prostate / Bladder /
//     Transplant / General) so they pick a template that matches their
//     condition. Each patient template auto-attaches a disease label
//     so the note shows up under matching filter pills in the list.
// ──────────────────────────────────────────────────────────────────────

type TemplateTag = 'clinical' | 'admin' | 'personal';
type TemplateCategory =
  | 'staff_clinical' | 'staff_admin'
  | 'pt_stones' | 'pt_prostate' | 'pt_bladder' | 'pt_transplant' | 'pt_general';
type Template = {
  id: string;
  title: string;
  body: string;
  category: TemplateCategory;
  tag: TemplateTag;     // role-tag label that gets added to the note
  icon: keyof typeof Ionicons.glyphMap;
  // Optional disease label automatically attached to the note so the
  // patient can later filter by disease in their Notes list.
  labels?: string[];
};

const STAFF_CATEGORIES: { key: 'staff_clinical' | 'staff_admin'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'staff_clinical', label: 'Clinical',  icon: 'medkit' },
  { key: 'staff_admin',    label: 'Practice',  icon: 'briefcase' },
];
const PATIENT_CATEGORIES: { key: Exclude<TemplateCategory, 'staff_clinical' | 'staff_admin'>; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'pt_stones',     label: 'Stones',     icon: 'water' },
  { key: 'pt_prostate',   label: 'Prostate',   icon: 'male' },
  { key: 'pt_bladder',    label: 'Bladder',    icon: 'beaker' },
  { key: 'pt_transplant', label: 'Transplant', icon: 'heart' },
  { key: 'pt_general',    label: 'General',    icon: 'fitness' },
];

const TEMPLATES: Template[] = [
  // ─────── STAFF · Clinical (patient-encounter notes) ───────
  {
    id: 'soap',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'clipboard',
    title: 'SOAP note',
    body: `S — Subjective
• Chief complaint:
• HPI:
• Past urological history:
• Medications / allergies:

O — Objective
• Vitals (BP / HR / Temp):
• Abdomen / flank exam:
• Genital / DRE:
• Urinalysis:
• Imaging:

A — Assessment
•

P — Plan
• Investigations:
• Medications:
• Procedure / surgery:
• Follow-up:`,
  },
  {
    id: 'opd',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'medical',
    title: 'OPD consultation',
    body: `Patient name / Reg #:
Age / sex:

Presenting complaint:
Duration:

LUTS — IPSS score:
QoL:

PSA / Creatinine / USG:
Diagnosis:

Plan:
• Medications
• Investigations
• Surgery (if any)
Follow-up date:`,
  },
  {
    id: 'preop',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'medkit',
    title: 'Pre-op checklist',
    body: `Procedure:
Date / OT slot:
Surgeon / Asst:

☐ Consent signed
☐ Fitness — Cardio / Anaesth / Physician
☐ NPO since
☐ Antibiotic prophylaxis
☐ DVT prophylaxis
☐ Consent for blood / cell-saver
☐ Site marked
☐ Imaging / scope on table

Notes:`,
  },
  {
    id: 'postop',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'fitness',
    title: 'Post-op note',
    body: `Procedure performed:
Findings:
Specimens sent:

Drains / catheters:
Estimated blood loss:
Complications:

Post-op orders:
• IV fluids / antibiotics
• Analgesia
• Diet
• Mobilisation
• Drain removal criteria
• Follow-up imaging / labs`,
  },
  {
    id: 'rxplan',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'document-text',
    title: 'Discharge / Rx plan',
    body: `Diagnosis:
Procedure (if any):

Medications on discharge:
1.
2.
3.

Wound / catheter care:

Red-flag symptoms (return to ER):
• Fever > 38.5 °C
• Heavy haematuria with clots
• Severe pain unrelieved by meds
• Inability to void

Follow-up: ___ days at OPD
Phone:`,
  },
  {
    id: 'mdt',
    category: 'staff_clinical',
    tag: 'clinical',
    icon: 'people-circle',
    title: 'MDT / tumour board note',
    body: `Patient / Reg #:
Age / sex / comorbids:

Diagnosis & stage:
Pathology:
Imaging summary (CT / MRI / PSMA):

Discussion points:
•

Recommendation (consensus):
☐ Surveillance
☐ Surgery —
☐ Radiation —
☐ Systemic therapy —
☐ Trial enrollment

Next step / responsible person:`,
  },

  // ─────── STAFF · Practice (admin / management) ───────
  {
    id: 'rounds',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'people',
    title: 'Ward rounds',
    body: `Date:
Beds covered:

Bed __ — Name / Reg #
Diagnosis:
Today's plan:
☐ Investigations
☐ Medications
☐ Procedure / OT
☐ Discharge planning
Notes:

(repeat per bed)`,
  },
  {
    id: 'meeting',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'briefcase',
    title: 'Team meeting minutes',
    body: `Date / Time:
Attendees:

Agenda:
1.
2.

Decisions:
•

Action items (owner — due):
☐
☐
☐

Next meeting:`,
  },
  {
    id: 'inventory',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'archive',
    title: 'Inventory / consumables',
    body: `Stock check — Date:

Consumables:
☐ DJ stents (4.7 / 6 Fr)
☐ Foley (16 / 18 / 20 Fr)
☐ Suction tubing
☐ Diathermy tips
☐ Laser fibres
☐ Endoscopes — service status

Medications low on stock:
•

Equipment service due:
•

Vendor calls to make:
•`,
  },
  {
    id: 'ot-schedule',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'calendar',
    title: 'OT day schedule',
    body: `OT Date:
Theatre / Anaesth team:

Case 1 — Time __
• Patient · Reg #
• Procedure
• Implants / consumables
• Special needs

Case 2 — Time __
•
•

Hand-overs / on-call:
Notes:`,
  },
  {
    id: 'follow-call',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'call',
    title: 'Follow-up call log',
    body: `Date:
Caller (staff):

Patients to call (Reg # — reason):
1.
2.
3.

Outcome / next action:
•

Patients to escalate to doctor:
•`,
  },
  {
    id: 'billing',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'cash',
    title: 'Billing / accounts',
    body: `Period:

Outstanding invoices:
• Patient · Amount · Aging

Cash collected today:
Card / UPI collected today:
Refunds:

Pending insurance pre-auth:
•

Notes:`,
  },
  {
    id: 'duty',
    category: 'staff_admin',
    tag: 'admin',
    icon: 'time',
    title: 'Duty / on-call roster',
    body: `Week of:

Mon — Day / Night:
Tue —
Wed —
Thu —
Fri —
Sat —
Sun —

Swap requests:
•

Cover required:`,
  },

  // ─────── PATIENT · Kidney stones ───────
  {
    id: 'pt-stone-diary',
    category: 'pt_stones',
    tag: 'personal',
    icon: 'water',
    title: 'Stone-pain & hydration diary',
    body: `Date:
Pain (0–10) — morning / evening:
Side:
Pain medications taken:

Water intake (litres):
Urine colour (pale / yellow / dark):
Times you passed urine:
Did you pass any stone fragment?  ☐ Yes  ☐ No

Diet today:
• Salt (low / normal):
• Oxalate-rich foods (spinach, nuts, chocolate):
• Animal protein (meat / eggs):

Doctor advised:
☐ ≥ 3 L water/day
☐ Low-salt diet
☐ Citrate / potassium supplement
☐ Strain urine`,
    labels: ['stones'],
  },
  {
    id: 'pt-stone-postop',
    category: 'pt_stones',
    tag: 'personal',
    icon: 'medkit',
    title: 'After RIRS / PCNL — recovery',
    body: `Procedure date:
Procedure (RIRS / PCNL / ESWL):
Stent placed?  ☐ Yes — remove on ____
Antibiotics dose & duration:

Symptoms log:
• Burning while passing urine — yes/no
• Blood-tinged urine — colour:
• Pain level (0–10):
• Fever — temp:

Red flags — call clinic:
• Fever > 38.5 °C
• Heavy red urine with clots
• Cannot pass urine
• Severe flank pain

Follow-up date:`,
    labels: ['stones', 'post-op'],
  },

  // ─────── PATIENT · Prostate (BPH / cancer) ───────
  {
    id: 'pt-bph-symptoms',
    category: 'pt_prostate',
    tag: 'personal',
    icon: 'male',
    title: 'BPH symptom diary (IPSS)',
    body: `Date:

Score 0 (none) → 5 (almost always) for the past month:

1. Incomplete emptying:
2. Frequency:
3. Intermittency (stop & start):
4. Urgency:
5. Weak stream:
6. Straining:
7. Nocturia (× per night):

Quality of life (0 delighted → 6 terrible):

Medications taken (Tamsulosin / Dutasteride etc.):
Side-effects:
Notes:`,
    labels: ['prostate', 'bph'],
  },
  {
    id: 'pt-psa',
    category: 'pt_prostate',
    tag: 'personal',
    icon: 'pulse',
    title: 'PSA tracker',
    body: `My PSA values (ng/mL):

Date · Value · Lab · Notes
1.
2.
3.
4.

Doctor's advice:
☐ Repeat in __ months
☐ MRI if PSA rises by ___
☐ Biopsy threshold: ___

Family history of prostate cancer:`,
    labels: ['prostate'],
  },
  {
    id: 'pt-prostate-postop',
    category: 'pt_prostate',
    tag: 'personal',
    icon: 'fitness',
    title: 'After HoLEP / TURP — recovery',
    body: `Procedure date:
Catheter removed on:

Recovery diary:
• Stream (good / improving / weak):
• Burning while passing urine:
• Blood in urine — colour:
• Urgency / leaks:

Pelvic-floor exercises (Kegel) — sets/day:

Red flags — call clinic:
• Cannot pass urine
• Heavy bleeding with clots
• Fever > 38.5 °C

Follow-up date:`,
    labels: ['prostate', 'post-op'],
  },

  // ─────── PATIENT · Bladder ───────
  {
    id: 'pt-void-diary',
    category: 'pt_bladder',
    tag: 'personal',
    icon: 'beaker',
    title: 'Bladder / voiding diary',
    body: `Date:

Time · Volume passed (ml) · Urgency 0–4 · Leak (Y/N) · Fluid drank (ml)
06:00 ·
09:00 ·
12:00 ·
15:00 ·
18:00 ·
21:00 ·

Total fluid intake (ml):
Total urine output (ml):
Number of voids:
Number of leaks:
Pads used:`,
    labels: ['bladder'],
  },
  {
    id: 'pt-uti',
    category: 'pt_bladder',
    tag: 'personal',
    icon: 'thermometer',
    title: 'UTI / infection log',
    body: `Date symptoms started:

Symptoms (tick):
☐ Burning urination
☐ Frequent urge
☐ Cloudy / smelly urine
☐ Lower abdominal pain
☐ Fever / chills
☐ Blood in urine

Antibiotic prescribed:
Start / end date:
Side-effects:

Repeat urine culture date:
Hydration today (litres):`,
    labels: ['bladder', 'uti'],
  },

  // ─────── PATIENT · Transplant ───────
  {
    id: 'pt-tx-meds',
    category: 'pt_transplant',
    tag: 'personal',
    icon: 'medical',
    title: 'Transplant medication tracker',
    body: `Transplant date:
Donor (live / deceased):

Daily medications:
• Tacrolimus / Cyclosporine — dose · time:
• Mycophenolate (CellCept / Myfortic) — dose:
• Steroid (Prednisolone) — dose:
• Antiviral / antibacterial prophylaxis:
• BP / sugar / lipid meds:

Recent trough levels:
Date · Drug · Level
1.
2.

Side-effects today:`,
    labels: ['transplant'],
  },
  {
    id: 'pt-tx-vitals',
    category: 'pt_transplant',
    tag: 'personal',
    icon: 'pulse',
    title: 'Transplant vitals & labs',
    body: `Date:

BP (morning / evening):
Pulse:
Weight (kg):
Temperature:
Urine output (ml / 24 h):

Labs:
• Creatinine:
• eGFR:
• Tacrolimus level:
• Hb / WBC / Plt:
• BK / CMV viral load:

Notes / symptoms:
Next clinic visit:`,
    labels: ['transplant'],
  },

  // ─────── PATIENT · General ───────
  {
    id: 'pt-questions',
    category: 'pt_general',
    tag: 'personal',
    icon: 'help-circle',
    title: 'Questions for next visit',
    body: `Visit on:
Doctor: Dr. Sagar Joshi

Things to ask:
1.
2.
3.
4.
5.

Reports / x-rays to bring:
☐ Latest USG / CT / MRI
☐ Recent blood reports
☐ Previous prescriptions
☐ Insurance card / ID`,
  },
  {
    id: 'pt-meds-general',
    category: 'pt_general',
    tag: 'personal',
    icon: 'medical',
    title: 'My medication list',
    body: `Updated on:

Medication · Dose · Time(s) · Started on
1.
2.
3.
4.

Allergies:
Refill due:
Pharmacy phone:`,
  },
  {
    id: 'pt-symptoms',
    category: 'pt_general',
    tag: 'personal',
    icon: 'heart',
    title: 'General symptom diary',
    body: `Today's date:

How did you feel?  ☐ Better  ☐ Same  ☐ Worse

Urinary symptoms:
• Frequency:
• Urgency:
• Burning:
• Blood in urine:

Pain:
• Where:
• Severity (0–10):

Medications taken today:
•

Notes / questions for doctor:`,
  },
];

function TemplatePicker({
  visible, isStaff, onClose, onPick,
}: {
  visible: boolean;
  isStaff: boolean;
  onClose: () => void;
  onPick: (tpl: Template) => void;
}) {
  const cats = isStaff ? STAFF_CATEGORIES : PATIENT_CATEGORIES;
  const [tab, setTab] = useState<TemplateCategory>(cats[0].key);
  useEffect(() => { if (visible) setTab(cats[0].key); }, [visible, isStaff]);  // eslint-disable-line
  const list = TEMPLATES.filter((t) => t.category === tab);
  if (!visible) return null;
  return (
    <View style={tplStyles.backdrop}>
      <View style={tplStyles.sheet}>
        <View style={tplStyles.head}>
          <View style={{ flex: 1 }}>
            <Text style={tplStyles.title}>Use a template</Text>
            <Text style={tplStyles.sub}>
              {isStaff ? 'Practice & clinical templates' : 'Pick a template that matches your condition'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={COLORS.textSecondary} /></TouchableOpacity>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={tplStyles.tabsRow}
        >
          {cats.map((c) => {
            const active = tab === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => setTab(c.key)}
                style={[tplStyles.tab, active && tplStyles.tabOn]}
              >
                <Ionicons name={c.icon} size={13} color={active ? '#fff' : COLORS.primary} />
                <Text style={[tplStyles.tabText, active && { color: '#fff' }]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ScrollView style={{ marginTop: 6 }} contentContainerStyle={{ paddingBottom: 6 }}>
          {list.map((tpl) => (
            <TouchableOpacity key={tpl.id} onPress={() => onPick(tpl)} style={tplStyles.row} activeOpacity={0.8}>
              <View style={tplStyles.icon}>
                <Ionicons name={tpl.icon} size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={tplStyles.rowTitle}>{tpl.title}</Text>
                <Text style={tplStyles.rowSub} numberOfLines={2}>
                  {tpl.body.split('\n').slice(0, 2).join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textDisabled} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const tplStyles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', padding: 18, paddingBottom: 28, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '78%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 17 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 1 },
  tabsRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 8, borderRadius: RADIUS.pill,
    backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border,
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

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...FONTS.h3, flex: 1, color: COLORS.textPrimary, fontSize: 17 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: COLORS.primary, borderRadius: RADIUS.pill,
  },
  saveBtnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },

  titleInput: {
    ...FONTS.h2, fontSize: 22, color: COLORS.textPrimary,
    paddingVertical: 6,
    borderBottomWidth: 0,
  },

  labelsBlock: {
    marginTop: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  labelsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  labelsHeader: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 },
  labelsCount: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },

  chipSelected: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
    borderWidth: 1, borderColor: COLORS.primary + '44',
  },
  chipSelectedText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  chipSuggestion: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
  },
  chipSuggestionText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },

  labelInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8,
  },
  labelInput: {
    flex: 1,
    height: 38,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    ...FONTS.body, color: COLORS.textPrimary, fontSize: 13,
  },
  labelAddBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  suggestLabel: { ...FONTS.label, color: COLORS.textDisabled, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },

  bodyInput: {
    marginTop: 14,
    ...FONTS.body, fontSize: 15, lineHeight: 22, color: COLORS.textPrimary,
    minHeight: 260,
    paddingVertical: 8,
  },
  charCount: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11, alignSelf: 'flex-end', marginTop: 2 },

  // Toolbar — horizontally scrollable; each button inserts a marker at
  // the cursor. Use a horizontal scroll because we now have ~14 actions.
  toolbar: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 6,
    backgroundColor: COLORS.primary + '0C',
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary + '33',
    minWidth: 36,
  },
  toolBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },
  toolDivider: {
    width: 1, height: 18,
    backgroundColor: COLORS.border,
    marginHorizontal: 4,
  },

  draftBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8,
    backgroundColor: COLORS.warning + '14',
    borderWidth: 1, borderColor: COLORS.warning + '44',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.md,
  },
  draftBannerText: { ...FONTS.bodyMedium, color: COLORS.warning, fontSize: 11, flex: 1 },

  // Image attachment strip
  imageStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  imageThumb: { width: 78, height: 78, borderRadius: RADIUS.md, backgroundColor: COLORS.bg },
  imageRemove: {
    position: 'absolute',
    top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  reminderShortcut: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginTop: 18,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: 14,
  },
  reminderSection: {
    marginTop: 22,
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 16,
  },
  reminderHead: { flexDirection: 'row', alignItems: 'center' },
  alarmBadge: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.textSecondary + '1A',
  },
  alarmBadgeOn: { backgroundColor: COLORS.accent },
  reminderTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  reminderSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },

  toggle: {
    width: 46, height: 26, borderRadius: 13,
    backgroundColor: '#E2ECEC',
    justifyContent: 'center',
    padding: 2,
  },
  toggleOn: { backgroundColor: COLORS.accent },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },

  smallLabel: { ...FONTS.label, color: COLORS.textDisabled, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 },

  quickChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '0F',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  quickChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  remindPreview: {
    marginTop: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.success + '10',
    borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  remindPreviewText: { ...FONTS.bodyMedium, color: COLORS.success, fontSize: 12 },

  webNote: {
    marginTop: 10,
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: '#F4F8F8',
    borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  webNoteText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, flex: 1, lineHeight: 16 },

  signTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14, marginBottom: 16 },
  primaryBtn: { paddingHorizontal: 20, paddingVertical: 12, backgroundColor: COLORS.primary, borderRadius: RADIUS.pill },
  primaryBtnText: { ...FONTS.bodyMedium, color: '#fff' },
});
