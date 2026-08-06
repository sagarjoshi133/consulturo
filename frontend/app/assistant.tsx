/*
 * AssistantChat — Patient-facing AI chatbot screen.
 *
 * UX:
 *   • Branded header with bot avatar + reset button.
 *   • Empty state: friendly intro + 5 trilingual starter chips
 *     (loaded from /api/assistant/suggestions?lang=…).
 *   • Message list: bubbles for user (right, primary) and assistant
 *     (left, surface). Emergency assistant replies get a red border.
 *   • Suggested-action chips below assistant bubbles (deep-link or
 *     tel: link).
 *   • Composer: multiline TextInput + Send button. Keyboard-aware.
 *   • Trilingual — picks up the app's selected language.
 *
 * Storage:
 *   • session_id persisted in AsyncStorage so the conversation
 *     survives app restarts.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import api from '../src/api';
import { COLORS, FONTS, LOGO_URL, RADIUS } from '../src/theme';
import { useI18n } from '../src/i18n';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  actions?: Array<Record<string, any>>;
  is_emergency?: boolean;
  // Inline results from tool-actions executed by the user:
  attached?: { kind: 'search_results' | 'drug_check' | 'wa_template'; data: any };
};

const SESSION_KEY = '@consulturo.assistant.session';

export default function AssistantChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lang } = useI18n();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listRef = useRef<FlatList<Msg>>(null);

  /* ── Load session id + suggestions + history on mount ──── */
  useEffect(() => {
    (async () => {
      try {
        const sid = await AsyncStorage.getItem(SESSION_KEY);
        setSessionId(sid || null);
        if (sid) {
          const r = await api.get(`/assistant/history?session_id=${encodeURIComponent(sid)}`);
          const rows = (r.data?.messages || []) as Array<{ role: string; text: string }>;
          if (rows.length) {
            setMessages(rows.map((m, i) => ({
              id: `${i}-${m.role}`,
              role: m.role === 'user' ? 'user' : 'assistant',
              text: m.text,
            })));
          }
        }
      } catch { /* silent */ }
      // Suggestions for current lang
      try {
        const r = await api.get(`/assistant/suggestions?lang=${lang}`);
        setSuggestions(r.data?.suggestions || []);
      } catch { /* silent */ }
    })();
  }, [lang]);

  /* ── Scroll to end when messages change ────────────────── */
  useEffect(() => {
    if (messages.length) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  /* ── Send a message ─────────────────────────────────────── */
  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setInput('');
    const userMsg: Msg = { id: `${Date.now()}-u`, role: 'user', text: trimmed };
    setMessages((p) => [...p, userMsg]);
    setSending(true);
    try {
      const r = await api.post('/assistant/chat', {
        message: trimmed,
        session_id: sessionId,
        lang,
      }, { timeout: 45000 });
      const reply = r.data || {};
      if (reply.session_id && reply.session_id !== sessionId) {
        setSessionId(reply.session_id);
        await AsyncStorage.setItem(SESSION_KEY, reply.session_id);
      }
      const botMsg: Msg = {
        id: `${Date.now()}-b`,
        role: 'assistant',
        text: reply.reply || '',
        actions: reply.suggested_actions || [],
        is_emergency: !!reply.is_emergency,
      };
      setMessages((p) => [...p, botMsg]);
    } catch (e: any) {
      const errText = e?.response?.data?.detail || e?.message || 'Could not reach the assistant.';
      setMessages((p) => [
        ...p,
        { id: `${Date.now()}-err`, role: 'assistant', text: `⚠️ ${errText}` },
      ]);
    } finally { setSending(false); }
  }, [sending, sessionId, lang]);

  /* ── Clear chat history ─────────────────────────────────── */
  const resetChat = useCallback(() => {
    const title = T(lang, 'Clear chat history?', 'चैट हटाएँ?', 'ચૅટ સાફ કરો?');
    const body = T(lang, 'This will permanently delete this conversation. The assistant will start fresh.',
                          'यह बातचीत स्थायी रूप से हट जाएगी। सहायक नई शुरुआत करेगा।',
                          'આ વાતચીત કાયમ માટે દૂર થશે. સહાયક નવી શરૂઆત કરશે.');
    const doReset = async () => {
      try {
        if (sessionId) {
          await api.post('/assistant/reset', null, { params: { session_id: sessionId } });
        }
      } catch { /* silent */ }
      await AsyncStorage.removeItem(SESSION_KEY);
      setSessionId(null);
      setMessages([]);
    };

    // Native: Alert.alert with destructive button.
    // Web: window.confirm — Alert.alert is a no-op on RN-web and was
    // silently swallowing the user's tap (issue #2 in the user report).
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.confirm(`${title}\n\n${body}`)) {
        void doReset();
      }
      return;
    }
    Alert.alert(title, body, [
      { text: T(lang, 'Cancel', 'रद्द', 'રદ કરો'), style: 'cancel' },
      {
        text: T(lang, 'Clear', 'हटाएँ', 'સાફ કરો'),
        style: 'destructive',
        onPress: doReset,
      },
    ]);
  }, [lang, sessionId]);

  /* ── Render an action chip ──────────────────────────────── */
  const tapAction = useCallback(async (action: Record<string, any>, parentMsgId: string) => {
    const deep = action.deep_link as string;
    if (!deep) return;

    // Internal action handlers — execute backend, attach result to the chat
    if (deep === '_assistant_search_') {
      try {
        const params = new URLSearchParams();
        for (const k of ['surgery_type', 'mode', 'status', 'months_back', 'days_back',
                          'age_gt', 'age_lt', 'sex', 'stone_size_gt_mm', 'stone_size_lt_mm']) {
          if (action[k] !== undefined && action[k] !== '') params.set(k, String(action[k]));
        }
        const r = await api.get(`/assistant/search/bookings?${params.toString()}`);
        setMessages((p) => p.map((m) => m.id === parentMsgId
          ? { ...m, attached: { kind: 'search_results', data: r.data } }
          : m,
        ));
      } catch (e: any) {
        Alert.alert('Search', e?.response?.data?.detail || 'Search failed.');
      }
      return;
    }
    if (deep === '_assistant_drug_check_') {
      try {
        const meds = encodeURIComponent(action.meds || '');
        const r = await api.get(`/assistant/drug-check?meds=${meds}`);
        setMessages((p) => p.map((m) => m.id === parentMsgId
          ? { ...m, attached: { kind: 'drug_check', data: r.data } }
          : m,
        ));
      } catch (e: any) {
        Alert.alert('Drug check', e?.response?.data?.detail || 'Drug check failed.');
      }
      return;
    }
    if (deep === '_assistant_wa_') {
      try {
        const params = new URLSearchParams();
        for (const k of ['kind', 'surgery', 'patient_name']) {
          if (action[k]) params.set(k, String(action[k]));
        }
        const r = await api.get(`/assistant/wa-template?${params.toString()}`);
        setMessages((p) => p.map((m) => m.id === parentMsgId
          ? { ...m, attached: { kind: 'wa_template', data: r.data } }
          : m,
        ));
      } catch (e: any) {
        Alert.alert('Template', e?.response?.data?.detail || 'Template fetch failed.');
      }
      return;
    }

    // Normal deep-links
    if (deep.startsWith('tel:') || deep.startsWith('mailto:') || deep.startsWith('http')) {
      Linking.openURL(deep).catch(() => {});
      return;
    }
    router.push(deep as any);
  }, [router]);

  /* ── Render a single bubble ─────────────────────────────── */
  const renderItem = ({ item }: { item: Msg }) => {
    const isUser = item.role === 'user';
    return (
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
        {!isUser ? (
          <View style={styles.botAvatar}>
            <Image source={{ uri: LOGO_URL }} style={styles.botAvatarImg} />
          </View>
        ) : null}
        <View style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.botBubble,
          item.is_emergency && styles.emergencyBubble,
        ]}>
          <Text style={isUser ? styles.userText : styles.botText}>{item.text}</Text>
          {(item.actions || []).length ? (
            <View style={styles.actionsRow}>
              {(item.actions || []).map((a, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.actionChip, a.kind === 'propose_book' && styles.actionChipPropose]}
                  onPress={() => tapAction(a, item.id)}
                >
                  <Ionicons
                    name={
                      a.kind === 'propose_book' ? 'checkmark-circle'
                      : a.kind === 'search_bookings' ? 'search'
                      : a.kind === 'drug_check' ? 'medkit'
                      : a.kind === 'wa_template' ? 'logo-whatsapp'
                      : (a.deep_link || '').startsWith('tel:') ? 'call'
                      : 'chevron-forward'
                    }
                    size={12}
                    color={a.kind === 'propose_book' ? '#fff' : COLORS.primary}
                  />
                  <Text style={[styles.actionLabel, a.kind === 'propose_book' && { color: '#fff' }]}>
                    {a.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          {/* Inline tool results (search / drug-check / WA template) */}
          {item.attached ? <AttachedBlock kind={item.attached.kind} data={item.attached.data} /> : null}
        </View>
      </View>
    );
  };

  /* ── Empty state ─────────────────────────────────────────── */
  const emptyState = (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyAvatar}>
        <Image source={{ uri: LOGO_URL }} style={styles.emptyAvatarImg} />
      </View>
      <Text style={styles.emptyTitle}>
        {T(lang,
          'Ask ConsultUro Assistant',
          'ConsultUro सहायक से पूछें',
          'ConsultUro સહાયકને પૂછો')}
      </Text>
      <Text style={styles.emptySub}>
        {T(lang,
          'Ask about symptoms, procedures, or book a consultation with Dr. Sagar Joshi. I am not a doctor — for definitive care, please book.',
          'लक्षण, सर्जरी, या डॉ. सागर जोशी से अपॉइंटमेंट के बारे में पूछें। मैं डॉक्टर नहीं हूँ — सटीक उपचार के लिए कृपया बुक करें।',
          'લક્ષણો, સર્જરી, કે ડૉ. સાગર જોશી સાથે મુલાકાત વિશે પૂછો. હું ડૉક્ટર નથી — ચોક્કસ સારવાર માટે કૃપા કરીને બુક કરો.')}
      </Text>
      <View style={styles.chipsWrap}>
        {suggestions.map((s) => (
          <TouchableOpacity key={s} style={styles.chip} onPress={() => send(s)}>
            <Text style={styles.chipText} numberOfLines={2}>{s}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as any))} hitSlop={10} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={COLORS.primaryDark} />
        </TouchableOpacity>
        <View style={styles.topCenter}>
          <View style={styles.topAvatar}>
            <Image source={{ uri: LOGO_URL }} style={styles.topAvatarImg} />
          </View>
          <View>
            <Text style={styles.topTitle}>
              {T(lang, 'ConsultUro Assistant', 'ConsultUro सहायक', 'ConsultUro સહાયક')}
            </Text>
            <Text style={styles.topSub}>
              {T(lang, 'AI · trained on Dr. Joshi’s clinic', 'AI · डॉ. जोशी के क्लिनिक पर प्रशिक्षित', 'AI · ડૉ. જોશીના ક્લિનિક પર તાલીમ')}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={resetChat}
          hitSlop={10}
          style={styles.iconBtn}
          testID="assistant-reset"
          accessibilityLabel={T(lang, 'Clear chat history', 'चैट हटाएँ', 'ચૅટ સાફ કરો')}
        >
          <Ionicons name="trash-outline" size={18} color={COLORS.primaryDark} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 ? (
          emptyState
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, paddingBottom: 12 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
        {sending ? (
          <View style={styles.typingRow}>
            <View style={styles.botAvatar}>
              <Image source={{ uri: LOGO_URL }} style={styles.botAvatarImg} />
            </View>
            <View style={[styles.bubble, styles.botBubble, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.botText}>{T(lang, 'Thinking…', 'सोच रहा हूँ…', 'વિચારી રહ્યો છું…')}</Text>
            </View>
          </View>
        ) : null}

        {/* Composer — paddingBottom keeps the input clear of the
            Android gesture bar / iOS home indicator even when the
            keyboard is dismissed. When the keyboard is on, the
            KeyboardAvoidingView lifts this whole block above it. */}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={T(lang,
              'Type your question…',
              'अपना सवाल लिखें…',
              'તમારો પ્રશ્ન લખો…')}
            placeholderTextColor="#9AAFB3"
            style={styles.input}
            multiline
            maxLength={2000}
            editable={!sending}
            testID="assistant-input"
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => send(input)}
            disabled={!input.trim() || sending}
            testID="assistant-send"
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <Text style={[styles.disclaimer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {T(lang,
            'ConsultUro Assistant is informational only — not medical advice.',
            'ConsultUro सहायक केवल जानकारी के लिए है — चिकित्सीय सलाह नहीं।',
            'ConsultUro સહાયક ફક્ત માહિતી માટે છે — તબીબી સલાહ નથી.')}
        </Text>
      </KeyboardAvoidingView>
    </View>
  );
}

function T(lang: string, en: string, hi: string, gu: string): string {
  if (lang === 'hi') return hi;
  if (lang === 'gu') return gu;
  return en;
}

/* ── Inline tool-result block ────────────────────────────────── */
function AttachedBlock({ kind, data }: { kind: string; data: any }) {
  if (kind === 'search_results') {
    const rows = (data?.results || []) as any[];
    return (
      <View style={styles.attached}>
        <Text style={styles.attachedTitle}>
          {`📋 ${data?.count ?? rows.length} result${rows.length === 1 ? '' : 's'}`}
        </Text>
        {rows.slice(0, 8).map((r, i) => (
          <View key={i} style={styles.searchRow}>
            <Text style={styles.searchName}>{r.patient_name || '—'} <Text style={styles.searchMeta}>· {r.patient_age || '?'}y · {r.patient_sex || '?'}</Text></Text>
            <Text style={styles.searchMeta}>
              {(r.surgery_type || r.diagnosis || r.mode || 'booking')} · {r.booking_date} {r.booking_time || ''}
              {r.stone_size_mm ? ` · ${r.stone_size_mm} mm` : ''}
            </Text>
          </View>
        ))}
        {rows.length === 0 ? <Text style={styles.searchMeta}>No matching bookings yet.</Text> : null}
      </View>
    );
  }
  if (kind === 'drug_check') {
    const ws = (data?.warnings || []) as any[];
    return (
      <View style={styles.attached}>
        <Text style={styles.attachedTitle}>{`💊 Drug check — ${ws.length} warning${ws.length === 1 ? '' : 's'}`}</Text>
        {ws.length === 0 ? (
          <Text style={styles.searchMeta}>No common urology interactions found.</Text>
        ) : ws.map((w, i) => (
          <View key={i} style={styles.drugRow}>
            <Text style={styles.drugPair}>{w.pair}</Text>
            <Text style={styles.searchMeta}>{w.advice}</Text>
          </View>
        ))}
        {data?.disclaimer ? <Text style={styles.disclaimerInline}>{data.disclaimer}</Text> : null}
      </View>
    );
  }
  if (kind === 'wa_template') {
    return (
      <View style={styles.attached}>
        <Text style={styles.attachedTitle}>{`📲 WhatsApp template (${data?.kind})`}</Text>
        <Text style={styles.waMessage}>{data?.message}</Text>
      </View>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 10,
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2ECEC',
  },
  iconBtn: { padding: 4 },
  topCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 6 },
  topAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F4F9FA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#DDEAEE' },
  topAvatarImg: { width: 30, height: 30 },
  topTitle: { ...FONTS.h4, color: COLORS.primaryDark, fontSize: 14 },
  topSub: { color: '#6A8388', fontSize: 10.5, marginTop: 1, letterSpacing: 0.4 },

  emptyWrap: { flex: 1, alignItems: 'center', padding: 24, paddingTop: 40 },
  emptyAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primary + '33', marginBottom: 18, overflow: 'hidden' },
  emptyAvatarImg: { width: 56, height: 56 },
  emptyTitle: { ...FONTS.h2, color: COLORS.primaryDark, fontSize: 18, marginBottom: 8, textAlign: 'center' },
  emptySub: { color: '#5E7C81', fontSize: 12.5, textAlign: 'center', lineHeight: 18, marginBottom: 22, paddingHorizontal: 8 },
  chipsWrap: { gap: 8, width: '100%', maxWidth: 480 },
  chip: { backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: '#DDEAEE' },
  chipText: { color: COLORS.primaryDark, fontSize: 13, lineHeight: 18 },

  row: { flexDirection: 'row', marginBottom: 12, gap: 8 },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  botAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F4F9FA', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDEAEE', overflow: 'hidden' },
  botAvatarImg: { width: 26, height: 26 },
  bubble: { maxWidth: '78%', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 16 },
  userBubble: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  botBubble: { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#E2ECEC' },
  emergencyBubble: { borderColor: COLORS.accent, borderWidth: 1.5, backgroundColor: '#FFF5F5' },
  userText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  botText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },

  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: COLORS.primary + '14', borderWidth: 1, borderColor: COLORS.primary + '44' },
  actionChipPropose: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  actionLabel: { color: COLORS.primary, fontSize: 11.5, fontWeight: '700' },

  /* Inline tool-result block (search / drug-check / WA template) */
  attached: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#F4FBFE', borderWidth: 1, borderColor: COLORS.primary + '33' },
  attachedTitle: { color: COLORS.primaryDark, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, marginBottom: 6 },
  searchRow: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#E2ECEC' },
  searchName: { color: COLORS.textPrimary, fontSize: 13, fontWeight: '700' },
  searchMeta: { color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 15 },
  drugRow: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#E2ECEC' },
  drugPair: { color: '#9A2F2F', fontSize: 12.5, fontWeight: '700' },
  disclaimerInline: { color: COLORS.textSecondary, fontSize: 10, fontStyle: 'italic', marginTop: 8 },
  waMessage: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 18, padding: 6, backgroundColor: '#fff', borderRadius: 6 },

  typingRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },

  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, paddingTop: 8, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2ECEC' },
  input: { flex: 1, backgroundColor: '#F4F9F9', borderRadius: 22, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 8, fontSize: 14, color: COLORS.textPrimary, maxHeight: 120 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#A8C7CC' },

  disclaimer: { color: '#98AAAE', fontSize: 9.5, textAlign: 'center', padding: 6, paddingBottom: 10, backgroundColor: '#fff' },
});
