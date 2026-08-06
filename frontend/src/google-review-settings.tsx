/**
 * GoogleReviewSettingsPanel — Primary owner panel for Google review
 * auto-nudge configuration (Phase 5 quick win, June 2026).
 *
 * Lets the clinic owner:
 *   • Paste the Google Maps / GMB review URL (any g.page / maps.app.goo.gl link).
 *   • Toggle the auto-nudge on/off.
 *   • Pick the delay (0h → immediate, 24h default, up to 7d).
 *   • Choose which events fire a nudge (booking_completed | rx_final | discharge).
 *   • Customise the WhatsApp / push message template
 *     (supports {first_name}, {clinic_name}, {review_url} placeholders).
 *   • Preview the rendered message.
 *   • Send a test nudge to a specific phone (manual trigger).
 *   • View the last 20 review-request rows + their status (pending/sent/dismissed/failed).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from 'react-native';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { useToast } from './toast';

type Trigger = 'booking_completed' | 'rx_final' | 'discharge';

const ALL_TRIGGERS: { key: Trigger; label: string; sublabel: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'booking_completed', label: 'After consultation', sublabel: 'When a visit is marked complete', icon: 'checkmark-done-circle' },
  { key: 'rx_final',          label: 'After prescription', sublabel: 'When a final Rx is issued', icon: 'document-text' },
  { key: 'discharge',         label: 'After discharge',     sublabel: 'When a surgery is closed with discharge date', icon: 'medkit' },
];

const DELAY_PRESETS = [
  { key: 0,   label: 'Right away' },
  { key: 1,   label: '1 hour later' },
  { key: 6,   label: '6 hours later' },
  { key: 24,  label: '24 hours later' },
  { key: 72,  label: '3 days later' },
  { key: 168, label: '7 days later' },
];

type Settings = {
  google_review_url?: string;
  google_review_request_enabled?: boolean;
  google_review_delay_hours?: number;
  google_review_triggers?: Trigger[];
  google_review_message_template?: string;
  clinic_name?: string;
  // ── Google Places auto-pull (Phase 5.15) ─────────────────────
  // The API key itself is server-side-only — backend returns only
  // the presence flag so we can show "Key configured" without
  // leaking the secret to the client.
  google_places_api_key_set?: boolean;
  google_places_place_id?: string;
  google_maps_profile_url?: string;
  // Post-PDF WhatsApp prompt master toggle (Phase 5.20).
  whatsapp_auto_prompt_enabled?: boolean;
  country_code?: string;
};

type ReviewRow = {
  id: string;
  user_id?: string | null;
  phone?: string | null;
  name?: string | null;
  trigger: string;
  status: string;
  created_at?: string;
  sent_at?: string | null;
  review_url?: string;
  message?: string;
};

const DEFAULT_TEMPLATE =
  'Hi {first_name}, thank you for visiting {clinic_name}! 🙏 If we made a difference, would you mind sharing your experience on Google? It takes 30 seconds and means the world to a small clinic.\n\n{review_url}';

export default function GoogleReviewSettingsPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState<boolean>(false);

  const [testPhone, setTestPhone] = useState<string>('');
  const [testName, setTestName] = useState<string>('Test User');
  const [sendingTest, setSendingTest] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/clinic-settings');
      setSettings(r.data || {});
    } catch (e: any) {
      toast.error('Could not load clinic settings.');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try {
      const r = await api.get('/review-requests?limit=20');
      setRows(r.data?.items || []);
    } catch {
      setRows([]);
    } finally {
      setRowsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRows();
  }, [load, loadRows]);

  const patch = useCallback(
    async (partial: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...partial }));
      setSaving(true);
      try {
        await api.patch('/clinic-settings', partial);
        toast.success('Saved.');
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Save failed.');
        await load();
      } finally {
        setSaving(false);
      }
    },
    [toast, load],
  );

  const toggleTrigger = useCallback(
    (key: Trigger) => {
      const cur = new Set<Trigger>(settings.google_review_triggers || []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      void patch({ google_review_triggers: Array.from(cur) });
    },
    [settings.google_review_triggers, patch],
  );

  const preview = useMemo(() => {
    const tpl = (settings.google_review_message_template || DEFAULT_TEMPLATE).trim();
    const clinic = (settings.clinic_name || 'the clinic').trim();
    const url = (settings.google_review_url || '<your review link>').trim();
    return tpl
      .replace(/\{first_name\}/g, 'Sarah')
      .replace(/\{clinic_name\}/g, clinic)
      .replace(/\{review_url\}/g, url);
  }, [settings.google_review_message_template, settings.clinic_name, settings.google_review_url]);

  const sendTest = useCallback(async () => {
    if (!testPhone || testPhone.replace(/\D/g, '').length < 10) {
      Alert.alert('Phone required', 'Enter a 10-digit phone to send a test review nudge.');
      return;
    }
    if (!(settings.google_review_url || '').trim()) {
      Alert.alert('Set the link first', 'Paste your Google review URL above before sending a test.');
      return;
    }
    setSendingTest(true);
    try {
      const r = await api.post('/review-requests/manual', {
        patient_name: testName || 'Test User',
        phone: testPhone,
        send_now: true,
        trigger: 'manual',
      });
      toast.success('Test nudge sent.');
      // Open WhatsApp on the staff side for convenience.
      const wa = r.data?.wa_link;
      if (wa) {
        try { await Linking.openURL(wa); } catch {}
      }
      await loadRows();
    } catch (e: any) {
      Alert.alert('Send failed', e?.response?.data?.detail || 'Unknown error');
    } finally {
      setSendingTest(false);
    }
  }, [testPhone, testName, settings.google_review_url, toast, loadRows]);

  const dismissRow = useCallback(
    async (rowId: string) => {
      try {
        await api.post(`/review-requests/${rowId}/dismiss`);
        await loadRows();
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Could not dismiss.');
      }
    },
    [loadRows, toast],
  );

  const sendNow = useCallback(
    async (rowId: string) => {
      try {
        await api.post(`/review-requests/${rowId}/send-now`);
        toast.success('Sent.');
        await loadRows();
      } catch (e: any) {
        toast.error(e?.response?.data?.detail || 'Could not send now.');
      }
    },
    [loadRows, toast],
  );

  if (loading) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }

  const triggers = new Set<Trigger>(settings.google_review_triggers || []);
  const enabled = !!settings.google_review_request_enabled;
  const delay = Number(settings.google_review_delay_hours ?? 24);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Hero card */}
      <View style={styles.heroCard}>
        <View style={styles.heroIconWrap}>
          <Ionicons name="star" size={22} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Google Review Auto-Nudge</Text>
          <Text style={styles.heroSub}>
            Send a friendly “please leave a review” message to patients after their visit. Configure once, runs automatically.
          </Text>
        </View>
      </View>

      {/* Enable toggle */}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Auto-send enabled</Text>
          <Text style={styles.helper}>
            When ON, nudges are scheduled automatically on the events you select below.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(v) => patch({ google_review_request_enabled: v })}
          trackColor={{ true: COLORS.primary, false: '#cbd5e1' }}
          testID="review-enabled-toggle"
        />
      </View>

      {/* Post-PDF WhatsApp follow-up prompt toggle (Phase 5.20).
          When ON, after every Rx / Discharge Summary / Medical
          Certificate PDF is shared, a small dialog asks the doctor
          if they want to also open the patient's WhatsApp chat with
          a pre-filled follow-up note. Saves ~30 sec per consult and
          eliminates "I never got my Rx" support tickets. */}
      <View style={[styles.row, { marginTop: 4 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Auto-prompt WhatsApp after PDFs</Text>
          <Text style={styles.helper}>
            After sharing a Rx / Discharge / Med Cert PDF, prompt me to also open the patient's WhatsApp chat with a pre-filled message.
          </Text>
        </View>
        <Switch
          value={settings.whatsapp_auto_prompt_enabled !== false}
          onValueChange={(v) => patch({ whatsapp_auto_prompt_enabled: v } as any)}
          trackColor={{ true: '#22c55e', false: '#cbd5e1' }}
          testID="wa-autoprompt-toggle"
        />
      </View>

      {/* Review URL */}
      <Text style={styles.label}>Google Review Link</Text>
      <Text style={styles.helper}>
        Open Google Business Profile → “Get more reviews” → copy the short link (g.page/r/… or maps.app.goo.gl/…).
      </Text>
      <TextInput
        style={styles.input}
        value={settings.google_review_url || ''}
        placeholder="https://g.page/r/..."
        placeholderTextColor={COLORS.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(t) => setSettings((s) => ({ ...s, google_review_url: t }))}
        onEndEditing={() => patch({ google_review_url: (settings.google_review_url || '').trim() })}
        testID="review-url-input"
      />
      {(settings.google_review_url || '').trim() ? (
        <TouchableOpacity
          style={styles.linkRow}
          onPress={() => Linking.openURL((settings.google_review_url || '').trim())}
        >
          <Ionicons name="open-outline" size={14} color={COLORS.primary} />
          <Text style={styles.linkText}>Open in browser</Text>
        </TouchableOpacity>
      ) : null}

      {/* ── Google Places auto-pull section (Phase 5.15) ──────── */}
      <GooglePlacesBlock settings={settings} setSettings={setSettings} patch={patch} reload={load} />

      {/* Triggers */}
      <Text style={[styles.label, { marginTop: 16 }]}>When to nudge</Text>
      <View style={{ gap: 8 }}>
        {ALL_TRIGGERS.map((t) => {
          const on = triggers.has(t.key);
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.triggerRow, on && styles.triggerRowOn]}
              onPress={() => toggleTrigger(t.key)}
              testID={`review-trigger-${t.key}`}
            >
              <Ionicons name={t.icon} size={20} color={on ? COLORS.primary : COLORS.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.triggerLabel, on && { color: COLORS.primary }]}>{t.label}</Text>
                <Text style={styles.triggerSub}>{t.sublabel}</Text>
              </View>
              <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={on ? COLORS.primary : '#cbd5e1'} />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Delay */}
      <Text style={[styles.label, { marginTop: 16 }]}>How soon after the event</Text>
      <View style={styles.delayRow}>
        {DELAY_PRESETS.map((p) => {
          const on = delay === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.delayChip, on && styles.delayChipOn]}
              onPress={() => patch({ google_review_delay_hours: p.key })}
              testID={`review-delay-${p.key}`}
            >
              <Text style={[styles.delayChipText, on && { color: '#fff' }]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Message template */}
      <Text style={[styles.label, { marginTop: 16 }]}>Message template</Text>
      <Text style={styles.helper}>
        Placeholders: <Text style={styles.code}>{'{first_name}'}</Text>, <Text style={styles.code}>{'{clinic_name}'}</Text>, <Text style={styles.code}>{'{review_url}'}</Text>
      </Text>
      <TextInput
        style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
        multiline
        value={settings.google_review_message_template || DEFAULT_TEMPLATE}
        onChangeText={(t) => setSettings((s) => ({ ...s, google_review_message_template: t }))}
        testID="review-template-input"
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TouchableOpacity
          style={[styles.btnPrimary, { flex: 1, marginTop: 0 }, saving && { opacity: 0.6 }]}
          onPress={() => patch({ google_review_message_template: (settings.google_review_message_template || DEFAULT_TEMPLATE).trim() })}
          disabled={saving}
          testID="review-template-save"
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={16} color="#fff" />}
          <Text style={styles.btnPrimaryText}>{saving ? 'Saving…' : 'Save template'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnSecondary]}
          onPress={() => {
            setSettings((s) => ({ ...s, google_review_message_template: DEFAULT_TEMPLATE }));
            void patch({ google_review_message_template: DEFAULT_TEMPLATE });
          }}
          disabled={saving}
          testID="review-template-reset"
        >
          <Ionicons name="refresh" size={14} color={COLORS.primary} />
          <Text style={styles.btnSecondaryText}>Reset</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, { marginTop: 12 }]}>Preview</Text>
      <View style={styles.previewBox}>
        <Text style={styles.previewText}>{preview}</Text>
      </View>

      {/* Test send */}
      <Text style={[styles.label, { marginTop: 18 }]}>Send a test nudge</Text>
      <Text style={styles.helper}>
        Push + bell notification will appear for any patient matched by phone. We’ll also open WhatsApp on this device so you can review the staff-side share link.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={testName}
          placeholder="Test name"
          placeholderTextColor={COLORS.textTertiary}
          onChangeText={setTestName}
          testID="review-test-name"
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={testPhone}
          placeholder="10-digit phone"
          placeholderTextColor={COLORS.textTertiary}
          keyboardType="number-pad"
          onChangeText={setTestPhone}
          testID="review-test-phone"
        />
      </View>
      <TouchableOpacity
        style={[styles.btnPrimary, sendingTest && { opacity: 0.6 }]}
        onPress={sendTest}
        disabled={sendingTest}
        testID="review-test-send"
      >
        {sendingTest ? <ActivityIndicator color="#fff" /> : <Ionicons name="paper-plane" size={16} color="#fff" />}
        <Text style={styles.btnPrimaryText}>{sendingTest ? 'Sending…' : 'Send test'}</Text>
      </TouchableOpacity>

      {/* History */}
      <View style={styles.historyHeader}>
        <Text style={styles.label}>Recent nudges</Text>
        <TouchableOpacity onPress={loadRows} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="refresh" size={16} color={COLORS.primary} />
        </TouchableOpacity>
      </View>
      {rowsLoading ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>No nudges yet. They’ll appear here once an event fires.</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {rows.map((r) => (
            <View key={r.id} style={styles.histRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.histName} numberOfLines={1}>
                  {r.name || r.phone || r.user_id || 'Patient'}{' · '}
                  <Text style={styles.histTrigger}>{r.trigger}</Text>
                </Text>
                <Text style={styles.histTime}>
                  {(r.created_at || '').replace('T', ' ').slice(0, 16)}
                </Text>
              </View>
              <View style={[
                styles.statusPill,
                r.status === 'sent' && { backgroundColor: '#dcfce7' },
                r.status === 'pending' && { backgroundColor: '#fef9c3' },
                r.status === 'dismissed' && { backgroundColor: '#e2e8f0' },
                r.status === 'failed' && { backgroundColor: '#fee2e2' },
              ]}>
                <Text style={[
                  styles.statusText,
                  r.status === 'sent' && { color: '#166534' },
                  r.status === 'pending' && { color: '#854d0e' },
                  r.status === 'dismissed' && { color: '#334155' },
                  r.status === 'failed' && { color: '#991b1b' },
                ]}>{r.status}</Text>
              </View>
              {r.status === 'pending' ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity onPress={() => sendNow(r.id)} style={styles.miniBtn}>
                    <Ionicons name="send" size={12} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => dismissRow(r.id)} style={[styles.miniBtn, { backgroundColor: '#94a3b8' }]}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {saving ? (
        <View style={styles.savingBar}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.savingText}>Saving…</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────
// GooglePlacesBlock — admin UI for the API key + Place ID +
// "Pull reviews now" button. Lets the owner wire up Google reviews
// auto-pull without touching the database.
// ─────────────────────────────────────────────────────────────────
type BlockProps = {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  patch: (partial: Partial<Settings> & Record<string, any>) => Promise<void>;
  reload: () => Promise<void>;
};

function GooglePlacesBlock({ settings, setSettings, patch, reload }: BlockProps) {
  const toast = useToast();
  const [apiKeyDraft, setApiKeyDraft] = useState<string>('');
  const [savingKey, setSavingKey] = useState<boolean>(false);
  const [showKey, setShowKey] = useState<boolean>(false);
  const [resolving, setResolving] = useState<boolean>(false);
  const [resolvedPreview, setResolvedPreview] = useState<{
    place_id?: string; place_name?: string; rating?: number; total_ratings?: number;
    place_url?: string; formatted_address?: string;
    alternatives?: Array<{ place_id: string; place_name?: string; rating?: number;
                          total_ratings?: number; formatted_address?: string }>;
  } | null>(null);
  const [pullBusy, setPullBusy] = useState<boolean>(false);
  const [pullResult, setPullResult] = useState<any | null>(null);
  // Manual Place ID entry — escape hatch when the share-link resolver
  // picks a duplicate Google Business listing with 0 reviews.
  const [manualPidDraft, setManualPidDraft] = useState<string>('');
  const [manualBusy, setManualBusy] = useState<boolean>(false);
  const keySet = !!settings.google_places_api_key_set;

  const saveApiKey = async () => {
    const k = apiKeyDraft.trim();
    if (!k) {
      Alert.alert('Empty key', 'Paste your Google Places API key first.');
      return;
    }
    setSavingKey(true);
    try {
      await patch({ google_places_api_key: k } as any);
      setApiKeyDraft('');
      toast.success('API key saved.');
      await reload();
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Could not save the key.');
    } finally {
      setSavingKey(false);
    }
  };

  const clearApiKey = async () => {
    Alert.alert(
      'Remove API key?',
      'This will stop the auto-pull from Google Reviews. You can re-enter it any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSavingKey(true);
            try {
              await patch({ google_places_api_key: '' } as any);
              toast.success('API key removed.');
              await reload();
            } catch (e: any) {
              Alert.alert('Remove failed', e?.response?.data?.detail || 'Unknown error');
            } finally {
              setSavingKey(false);
            }
          },
        },
      ],
    );
  };

  const resolvePlace = async () => {
    if (!keySet) {
      Alert.alert('Set the API key first', 'Save your Google Places API key above before resolving a Place ID.');
      return;
    }
    setResolving(true);
    setResolvedPreview(null);
    try {
      const body = {
        maps_url: (settings.google_maps_profile_url || '').trim(),
        query: (settings.clinic_name || '').trim(),
      };
      const r = await api.post('/featured-reviews/resolve-place', body);
      setResolvedPreview(r.data || null);
    } catch (e: any) {
      Alert.alert('Resolve failed', e?.response?.data?.detail || 'Could not resolve the Place ID.');
    } finally {
      setResolving(false);
    }
  };

  const acceptResolved = async (override?: {
    place_id: string; place_name?: string; place_url?: string;
  }) => {
    const target = override
      ? { place_id: override.place_id, place_url: override.place_url || '' }
      : resolvedPreview?.place_id
        ? { place_id: resolvedPreview.place_id, place_url: resolvedPreview.place_url || '' }
        : null;
    if (!target?.place_id) return;
    await patch({
      google_places_place_id: target.place_id,
      google_maps_profile_url: target.place_url || settings.google_maps_profile_url || '',
    } as any);
    toast.success(`Place ID saved: ${target.place_id.slice(0, 14)}…`);
    setResolvedPreview(null);
  };

  // Manual Place ID — submitted via the resolve-place endpoint with
  // `place_id` in the body so the backend skips URL guessing and
  // honours the user's pasted ID directly.
  const saveManualPlaceId = async () => {
    const pid = manualPidDraft.trim();
    if (!pid.startsWith('ChIJ')) {
      Alert.alert('Invalid Place ID', 'Google Place IDs start with "ChIJ". Get yours at developers.google.com/maps/documentation/places/web-service/place-id');
      return;
    }
    if (!keySet) {
      Alert.alert('Set the API key first');
      return;
    }
    setManualBusy(true);
    try {
      const r = await api.post('/featured-reviews/resolve-place', { place_id: pid });
      setResolvedPreview(r.data || null);
      setManualPidDraft('');
    } catch (e: any) {
      Alert.alert('Verification failed', e?.response?.data?.detail || 'Could not verify this Place ID.');
    } finally {
      setManualBusy(false);
    }
  };

  const pullNow = async () => {
    if (!keySet) {
      Alert.alert('Set the API key first');
      return;
    }
    setPullBusy(true);
    setPullResult(null);
    try {
      const r = await api.post('/featured-reviews/pull-google', {});
      setPullResult(r.data || null);
      toast.success(`Imported ${r.data?.inserted ?? 0} new + ${r.data?.updated ?? 0} updated review(s).`);
    } catch (e: any) {
      Alert.alert('Pull failed', e?.response?.data?.detail || 'Unknown error');
    } finally {
      setPullBusy(false);
    }
  };

  return (
    <View style={gpStyles.wrap}>
      <View style={gpStyles.header}>
        <Ionicons name="logo-google" size={18} color="#0E7C8B" />
        <Text style={gpStyles.headerText}>Google Places — auto-pull reviews</Text>
        <View style={[gpStyles.dot, keySet ? gpStyles.dotOn : gpStyles.dotOff]} />
      </View>
      <Text style={gpStyles.helper}>
        Pull live Google reviews into your dashboard so you can curate which ones go on the patient home carousel + receipt PDF QR.
      </Text>

      {/* API Key */}
      <Text style={gpStyles.label}>Google Places API key</Text>
      {keySet && apiKeyDraft.length === 0 ? (
        <View style={gpStyles.row}>
          <View style={[gpStyles.tag, { backgroundColor: '#dcfce7' }]}>
            <Ionicons name="checkmark-circle" size={14} color="#166534" />
            <Text style={[gpStyles.tagText, { color: '#166534' }]}>Key configured</Text>
          </View>
          <TouchableOpacity onPress={() => setApiKeyDraft('')} style={[gpStyles.btnGhost]}>
            <Ionicons name="create-outline" size={14} color={COLORS.primary} />
            <Text style={gpStyles.btnGhostText}>Replace</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={clearApiKey} style={[gpStyles.btnGhost]}>
            <Ionicons name="trash-outline" size={14} color="#dc2626" />
            <Text style={[gpStyles.btnGhostText, { color: '#dc2626' }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            style={[gpStyles.input, { flex: 1 }]}
            value={apiKeyDraft}
            placeholder="AIzaSy…"
            placeholderTextColor={COLORS.textTertiary}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApiKeyDraft}
            testID="gplaces-apikey"
          />
          <TouchableOpacity onPress={() => setShowKey(!showKey)} style={gpStyles.eyeBtn}>
            <Ionicons name={showKey ? 'eye-off' : 'eye'} size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={saveApiKey}
            style={[gpStyles.btnPrimary, savingKey && { opacity: 0.6 }]}
            disabled={savingKey}
            testID="gplaces-apikey-save"
          >
            {savingKey ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={14} color="#fff" />}
            <Text style={gpStyles.btnPrimaryText}>Save</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={gpStyles.subHelper}>
        Get one at console.cloud.google.com → APIs &amp; Services → Credentials. Restrict it to the "Places API".
      </Text>

      {/* Maps URL → Place ID */}
      <Text style={[gpStyles.label, { marginTop: 14 }]}>Clinic on Google Maps</Text>
      <TextInput
        style={gpStyles.input}
        value={settings.google_maps_profile_url || ''}
        placeholder="https://share.google/... or https://maps.app.goo.gl/..."
        placeholderTextColor={COLORS.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(t) => setSettings((s) => ({ ...s, google_maps_profile_url: t }))}
        onEndEditing={() => patch({ google_maps_profile_url: (settings.google_maps_profile_url || '').trim() } as any)}
        testID="gplaces-mapsurl"
      />
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
        <TouchableOpacity
          onPress={resolvePlace}
          style={[gpStyles.btnSecondary, (!keySet || resolving) && { opacity: 0.6 }]}
          disabled={!keySet || resolving}
          testID="gplaces-resolve"
        >
          {resolving ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="search" size={14} color={COLORS.primary} />}
          <Text style={gpStyles.btnSecondaryText}>{resolving ? 'Resolving…' : 'Resolve Place ID'}</Text>
        </TouchableOpacity>
        {settings.google_places_place_id ? (
          <View style={[gpStyles.tag, { backgroundColor: '#eff6ff' }]}>
            <Ionicons name="location" size={12} color="#1d4ed8" />
            <Text style={[gpStyles.tagText, { color: '#1d4ed8', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]} numberOfLines={1}>
              {settings.google_places_place_id.slice(0, 18)}…
            </Text>
          </View>
        ) : null}
      </View>

      {/* Resolved preview */}
      {resolvedPreview ? (
        <View style={gpStyles.previewCard}>
          <Text style={gpStyles.previewName} numberOfLines={2}>{resolvedPreview.place_name}</Text>
          {resolvedPreview.formatted_address ? (
            <Text style={gpStyles.previewAddr} numberOfLines={2}>{resolvedPreview.formatted_address}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Ionicons name="star" size={13} color="#f59e0b" />
            <Text style={gpStyles.previewRating}>
              {resolvedPreview.rating ?? '—'} · {resolvedPreview.total_ratings ?? 0} reviews
            </Text>
          </View>

          {/* Warn + offer alternatives when the resolved listing has
              zero reviews (typical "duplicate Google Business profile"
              case — the user has two listings and the URL resolved to
              the new/unverified one). */}
          {(!resolvedPreview.total_ratings || resolvedPreview.total_ratings === 0)
            && Array.isArray(resolvedPreview.alternatives)
            && resolvedPreview.alternatives.length > 0 ? (
            <View style={gpStyles.altCard}>
              <Text style={gpStyles.altWarn} numberOfLines={3}>
                ⚠️ This listing has 0 reviews on Google. You probably meant one of these other listings of your clinic:
              </Text>
              {resolvedPreview.alternatives.slice(0, 3).map((alt) => (
                <TouchableOpacity
                  key={alt.place_id}
                  style={gpStyles.altRow}
                  onPress={() => acceptResolved({
                    place_id: alt.place_id,
                    place_name: alt.place_name,
                    place_url: '',
                  })}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={gpStyles.altName} numberOfLines={1}>{alt.place_name}</Text>
                    {alt.formatted_address ? (
                      <Text style={gpStyles.altAddr} numberOfLines={1}>{alt.formatted_address}</Text>
                    ) : null}
                    <Text style={gpStyles.altRating}>
                      ★ {alt.rating ?? '—'} · {alt.total_ratings ?? 0} reviews
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={COLORS.primary} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
            <TouchableOpacity onPress={() => acceptResolved()} style={gpStyles.btnPrimary}>
              <Ionicons name="checkmark" size={14} color="#fff" />
              <Text style={gpStyles.btnPrimaryText}>Use this Place ID</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setResolvedPreview(null)} style={gpStyles.btnGhost}>
              <Text style={gpStyles.btnGhostText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Manual Place ID entry — escape hatch when URL resolution
          repeatedly picks the wrong listing. Pasted ID is verified
          against Google Places before being saved, so a bad ID can't
          silently brick the integration. */}
      <Text style={[gpStyles.label, { marginTop: 14 }]}>Or paste the Place ID directly</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TextInput
          style={[gpStyles.input, { flex: 1, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) }]}
          value={manualPidDraft}
          placeholder="ChIJ8x5PeMfHXzkRTRJ-5w0zHyU"
          placeholderTextColor={COLORS.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setManualPidDraft}
          testID="gplaces-manual-pid"
        />
        <TouchableOpacity
          onPress={saveManualPlaceId}
          style={[gpStyles.btnSecondary, (manualBusy || !manualPidDraft.trim()) && { opacity: 0.5 }]}
          disabled={manualBusy || !manualPidDraft.trim()}
          testID="gplaces-manual-pid-save"
        >
          {manualBusy ? <ActivityIndicator color={COLORS.primary} /> : <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />}
          <Text style={gpStyles.btnSecondaryText}>Verify &amp; preview</Text>
        </TouchableOpacity>
      </View>
      <Text style={gpStyles.subHelper}>
        Use this when the Maps URL resolves to the wrong listing (e.g. clinic has multiple Google profiles). Find your Place ID at developers.google.com/maps/documentation/places/web-service/place-id.
      </Text>

      {/* Pull now */}
      <TouchableOpacity
        onPress={pullNow}
        style={[gpStyles.pullBtn, (!keySet || pullBusy) && { opacity: 0.6 }]}
        disabled={!keySet || pullBusy}
        testID="gplaces-pull-now"
      >
        {pullBusy ? <ActivityIndicator color="#fff" /> : <Ionicons name="cloud-download" size={16} color="#fff" />}
        <Text style={gpStyles.pullBtnText}>
          {pullBusy ? 'Pulling reviews…' : 'Pull Google reviews now'}
        </Text>
      </TouchableOpacity>

      {pullResult ? (
        <View style={gpStyles.pullResultCard}>
          <Text style={gpStyles.pullResultTitle}>
            ✓ {pullResult.place_name || 'Clinic'} · {pullResult.rating ?? '—'}★ ({pullResult.total_ratings ?? 0})
          </Text>
          <Text style={gpStyles.pullResultLine}>
            Fetched {pullResult.fetched} · Inserted {pullResult.inserted} new · Updated {pullResult.updated} · Skipped {pullResult.skipped}
          </Text>
          <Text style={gpStyles.pullResultHint}>
            Open Dashboard → Branding → Featured Reviews to curate which ones go on the patient home carousel.
          </Text>
          {pullResult.google_api_cap_note ? (
            <Text style={[gpStyles.pullResultHint, { fontStyle: 'normal', marginTop: 6, color: '#0f766e' }]}>
              ℹ️ {pullResult.google_api_cap_note}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const gpStyles = StyleSheet.create({
  wrap: {
    marginTop: 18,
    padding: 14,
    backgroundColor: '#f8fafc',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: '#22c55e' },
  dotOff: { backgroundColor: '#cbd5e1' },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 6, marginBottom: 8 },
  subHelper: { ...FONTS.body, color: COLORS.textTertiary, fontSize: 10.5, marginTop: 6, lineHeight: 14 },
  label: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12.5, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill },
  tagText: { fontSize: 11, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.input,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 9 : 7,
    backgroundColor: '#fff',
    color: COLORS.textPrimary,
    fontSize: 13,
  },
  eyeBtn: {
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input, backgroundColor: '#fff',
  },
  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: RADIUS.button,
  },
  btnPrimaryText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.button,
    borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff',
  },
  btnSecondaryText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '700' },
  btnGhost: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill,
    backgroundColor: 'transparent',
  },
  btnGhostText: { color: COLORS.primary, fontSize: 12, fontWeight: '700' },
  previewCard: {
    marginTop: 10, padding: 10, backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  previewName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  previewAddr: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 2 },
  previewRating: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  altCard: {
    marginTop: 10, padding: 8, backgroundColor: '#fff7ed',
    borderRadius: RADIUS.card, borderWidth: 1, borderColor: '#fed7aa',
  },
  altWarn: { ...FONTS.body, color: '#9a3412', fontSize: 11.5, lineHeight: 16, marginBottom: 6 },
  altRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 8,
    backgroundColor: '#fff', borderRadius: RADIUS.input,
    marginTop: 6, borderWidth: 1, borderColor: '#fed7aa',
  },
  altName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 12 },
  altAddr: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10.5, marginTop: 1 },
  altRating: { ...FONTS.bodyMedium, color: '#9a3412', fontSize: 11, marginTop: 2 },
  pullBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#0E7C8B', paddingVertical: 11, borderRadius: RADIUS.button,
    marginTop: 14,
  },
  pullBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pullResultCard: {
    marginTop: 10, padding: 10, backgroundColor: '#ecfdf5',
    borderRadius: RADIUS.card, borderWidth: 1, borderColor: '#a7f3d0',
  },
  pullResultTitle: { ...FONTS.bodyMedium, color: '#065f46', fontSize: 12.5 },
  pullResultLine: { ...FONTS.body, color: '#065f46', fontSize: 11, marginTop: 4 },
  pullResultHint: { ...FONTS.body, color: '#047857', fontSize: 10.5, marginTop: 6, fontStyle: 'italic' },
});

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    padding: 14,
    backgroundColor: '#fff7ed',
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: '#fed7aa',
    marginBottom: 16,
  },
  heroIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#f97316',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { ...FONTS.h3, color: '#9a3412' },
  heroSub: { ...FONTS.body, color: '#9a3412', marginTop: 4, fontSize: 12.5, lineHeight: 18 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  label: { ...FONTS.bodyMedium, color: COLORS.textPrimary, marginBottom: 6, marginTop: 4 },
  helper: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginBottom: 8, lineHeight: 16 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.input,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    backgroundColor: '#fff', color: COLORS.textPrimary, fontSize: 14,
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  linkText: { color: COLORS.primary, fontSize: 12 },

  triggerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.card, backgroundColor: '#fff',
  },
  triggerRowOn: { backgroundColor: '#ecfeff', borderColor: COLORS.primary },
  triggerLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13.5 },
  triggerSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11.5, marginTop: 2 },

  delayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  delayChip: {
    paddingVertical: 6, paddingHorizontal: 10, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff',
  },
  delayChipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  delayChipText: { fontSize: 12, color: COLORS.textPrimary },

  code: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 11, backgroundColor: '#f1f5f9', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4 },

  previewBox: {
    backgroundColor: '#f8fafc', borderRadius: RADIUS.card, padding: 12,
    borderWidth: 1, borderColor: COLORS.border,
  },
  previewText: { color: COLORS.textPrimary, fontSize: 13, lineHeight: 19 },

  btnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: RADIUS.button, marginTop: 10,
  },
  btnPrimaryText: { color: '#fff', ...FONTS.bodyMedium },
  btnSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16, borderRadius: RADIUS.button,
    borderWidth: 1, borderColor: COLORS.primary, backgroundColor: '#fff',
  },
  btnSecondaryText: { color: COLORS.primary, ...FONTS.bodyMedium, fontSize: 13 },

  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 6 },
  empty: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12.5, padding: 12, textAlign: 'center' },
  histRow: {
    flexDirection: 'row', gap: 8, alignItems: 'center',
    padding: 10, backgroundColor: '#fff', borderRadius: RADIUS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  histName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  histTrigger: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '400' },
  histTime: { color: COLORS.textTertiary, fontSize: 10.5, marginTop: 2 },
  statusPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: '#e2e8f0',
  },
  statusText: { fontSize: 10, fontWeight: '700' },
  miniBtn: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary,
  },

  savingBar: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  savingText: { color: COLORS.textSecondary, fontSize: 12 },
});
