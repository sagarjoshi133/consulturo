/**
 * Shared utility components used across the IPD module.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../api';
import { COLORS } from '../theme';
import { useToast } from '../toast';
import { ipdStyles as styles } from './styles';

export function Field({ label, value, onChange, multiline, keyboard, placeholder, onBlur }: any) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        value={value || ''}
        onChangeText={onChange}
        onBlur={onBlur}
        multiline={!!multiline}
        keyboardType={keyboard || 'default'}
        placeholder={placeholder || ''}
        placeholderTextColor={COLORS.textTertiary}
      />
    </View>
  );
}

/**
 * Phase 6.3 — Field with a "✨ Generate with AI" button to the right
 * of the label. Tap → calls the IPD discharge-field AI endpoint with
 * the current admission_id + field key. If the field already has
 * content, asks for confirmation before overwriting (option a).
 *
 * Renders identically to <Field /> otherwise so existing styling
 * stays consistent across the discharge form.
 */
export function AiField({
  label, value, onChange, multiline, placeholder,
  admissionId, fieldKey, busyAi, setBusyAi, testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  admissionId: string;
  fieldKey: 'course_in_hospital' | 'condition_at_discharge' | 'discharge_meds' | 'diet_advice' | 'follow_up_plan' | 'operative_notes';
  busyAi: string | null;
  setBusyAi: (b: string | null) => void;
  testID?: string;
}) {
  const toast = useToast();
  const busy = busyAi === fieldKey;
  const anyBusy = busyAi !== null;

  const onGenerate = useCallback(async () => {
    if (anyBusy) return;
    const run = async () => {
      setBusyAi(fieldKey);
      try {
        // AI drafts can take 30-45s on Claude Sonnet 4.5 — override
        // the default axios timeout (15s) so the request never aborts
        // mid-generation and the screen stays put on success/failure.
        const r = await api.post(
          `/ai/ipd/${admissionId}/discharge-field`,
          { field: fieldKey },
          { timeout: 90000 },
        );
        const txt = (r.data?.text || '').trim();
        if (!txt) {
          toast.error('AI returned an empty draft.');
          return;
        }
        onChange(txt);
        toast.success(`Drafted "${label.replace(/\s*\*$/, '')}"`);
      } catch (e: any) {
        // Robust error extraction — never display raw HTML (Cloudflare
        // error pages used to leak into toast & looked like the screen
        // had "reloaded"). Restrict to short, friendly strings.
        let msg: string =
          (e?.response?.data && typeof e.response.data === 'object' && e.response.data.detail) ||
          e?.message ||
          'AI draft failed.';
        if (typeof msg !== 'string') msg = 'AI draft failed.';
        if (msg.length > 200 || /<html|<body/i.test(msg)) msg = 'AI service is busy. Please try again.';
        if (e?.code === 'ECONNABORTED') msg = 'AI took too long to respond. Please try again.';
        toast.error(msg);
      } finally {
        setBusyAi(null);
      }
    };

    // Phase 6.3 — replace-with-confirm (option a from the user).
    // Uses confirmAction so the dialog works on BOTH native AND web
    // (RN's Alert.alert is a silent no-op on react-native-web).
    if ((value || '').trim().length > 0) {
      const { confirmAction } = require('../cross-alert');
      confirmAction({
        title: 'Replace current text?',
        message: 'AI will replace the existing content of this field. You can still edit afterwards.',
        confirmText: 'Replace',
        destructive: true,
        onConfirm: () => { void run(); },
      });
    } else {
      await run();
    }
  }, [admissionId, fieldKey, value, anyBusy, label, onChange, setBusyAi, toast]);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Text style={[styles.fieldLabel, { marginTop: 0, flex: 1 }]}>{label}</Text>
        <TouchableOpacity
          onPress={onGenerate}
          disabled={anyBusy}
          style={[
            {
              flexDirection: 'row', alignItems: 'center', gap: 4,
              paddingHorizontal: 10, paddingVertical: 5,
              borderRadius: 999, backgroundColor: COLORS.primary + (busy ? '40' : '15'),
              borderWidth: 1, borderColor: COLORS.primary + (busy ? '60' : '40'),
            },
            anyBusy && !busy && { opacity: 0.4 },
          ]}
          testID={testID ? `${testID}-ai` : undefined}
        >
          <Ionicons
            name={busy ? 'hourglass' : 'sparkles'}
            size={12}
            color={COLORS.primary}
          />
          <Text style={{ color: COLORS.primary, fontSize: 11, fontWeight: '600' }}>
            {busy ? 'Generating…' : 'Generate with AI'}
          </Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={[styles.input, multiline && { minHeight: 92, textAlignVertical: 'top' }]}
        value={value || ''}
        onChangeText={onChange}
        multiline={!!multiline}
        placeholder={placeholder || ''}
        placeholderTextColor={COLORS.textTertiary}
        editable={!busy}
        testID={testID}
      />
    </View>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
      <Text style={{ color: COLORS.textSecondary, width: 130, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: COLORS.textPrimary, flex: 1, fontSize: 12.5 }}>{value || '—'}</Text>
    </View>
  );
}

export function ActionRow({
  icon, color, label, sub, onPress, testID,
}: {
  icon: any; color: string; label: string; sub: string; onPress: () => void; testID?: string;
}) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.actionRow} testID={testID} activeOpacity={0.8}>
      <View style={[styles.actionIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={COLORS.textSecondary} />
    </TouchableOpacity>
  );
}

export function SmallField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ width: '48%' }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value || ''}
        onChangeText={onChange}
        placeholderTextColor={COLORS.textSecondary}
      />
    </View>
  );
}

export function VitalInput({ label, value, onChange }: { label: string; value: any; onChange: (v: string) => void }) {
  return (
    <View style={{ width: '32%' }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={value != null ? String(value) : ''}
        onChangeText={onChange}
      />
    </View>
  );
}

export function KpiTile({ label, value, color, icon }: { label: string; value: number | string; color: string; icon: any }) {
  return (
    <View style={[styles.kpiTile, { borderLeftColor: color }]}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.kpiVal}>{value}</Text>
      <Text style={styles.kpiLbl}>{label}</Text>
    </View>
  );
}

export function PrivateNoteField({ admissionId, initial }: { admissionId: string; initial: string }) {
  const toast = useToast();
  const [text, setText] = useState(initial || '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const debounceRef = useRef<any>(null);

  useEffect(() => { setText(initial || ''); }, [initial]);

  const persist = useCallback(async (val: string) => {
    setSaving(true);
    try {
      await api.patch(`/ipd/admissions/${admissionId}/private-note`, { private_note: val });
      setSavedAt(Date.now());
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [admissionId, toast]);

  return (
    <View>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => persist(v), 700);
        }}
        placeholder="Private notes for self-use (not shown to patient). e.g. surgical findings, family dynamics, intra-op concerns…"
        placeholderTextColor={COLORS.textSecondary}
        multiline
        numberOfLines={4}
        style={[styles.input, { minHeight: 96, textAlignVertical: 'top', paddingTop: 10 }]}
        testID="ipd-private-note"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
        <Ionicons name={saving ? 'sync' : savedAt ? 'checkmark-circle' : 'cloud-outline'} size={12} color={COLORS.textSecondary} />
        <Text style={{ color: COLORS.textSecondary, fontSize: 11, marginLeft: 4 }}>
          {saving ? 'Saving…' : savedAt ? 'Saved just now · auto-save on' : 'Type to start — auto-saved'}
        </Text>
      </View>
    </View>
  );
}
