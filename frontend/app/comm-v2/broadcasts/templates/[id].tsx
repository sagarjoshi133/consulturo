/**
 * Comm V2 — Broadcast Template create/edit form.
 *
 * Owner-tier only. Reuses the same field set as compose.tsx plus a
 * name (unique) for the template itself.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../../src/api';
import { V2, shared } from '../../../../src/comm-v2/ui-tokens';

const CATEGORIES = ['announcements', 'appointments', 'reminders', 'system', 'marketing'];
const AUDIENCES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'patients', label: 'All patients', hint: 'Every registered patient.' },
  { value: 'staff', label: 'Staff only', hint: 'Reception, nursing, doctors.' },
  { value: 'both', label: 'Patients + staff', hint: 'Everyone.' },
  { value: 'patients_with_future_appointments', label: 'Patients with upcoming appointments',
    hint: 'Patients with at least one confirmed booking in the future.' },
];

export default function TemplateFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string; prefill_title?: string; prefill_body?: string;
    prefill_category?: string; prefill_audience?: string;
  }>();
  const isEdit = !!params.id && params.id !== 'new';
  const editingId = isEdit ? String(params.id) : null;

  const [name, setName] = useState('');
  const [title, setTitle] = useState(String(params.prefill_title || ''));
  const [body, setBody] = useState(String(params.prefill_body || ''));
  const [category, setCategory] = useState(String(params.prefill_category || 'announcements'));
  const [audience, setAudience] = useState(String(params.prefill_audience || 'patients'));
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isEdit || !editingId) return;
    (async () => {
      try {
        const r = await api.get(`/v2/communications/broadcast-templates/${encodeURIComponent(editingId)}`);
        const t = r?.data?.template;
        if (t) {
          setName(t.name || '');
          setTitle(t.title || '');
          setBody(t.body || '');
          setCategory(t.category || 'announcements');
          setAudience(t.audience_mode || 'patients');
        }
      } catch (e: any) {
        Alert.alert('Load failed', e?.response?.data?.detail || e?.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isEdit, editingId]);

  const save = async () => {
    if (!name.trim() || !title.trim() || !body.trim()) {
      Alert.alert('Missing fields', 'Please fill name, title, and body.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), title: title.trim(), body: body.trim(),
        category, audience_mode: audience, action_type: 'open_broadcast',
      };
      if (isEdit && editingId) {
        await api.patch(`/v2/communications/broadcast-templates/${encodeURIComponent(editingId)}`, payload);
      } else {
        await api.post('/v2/communications/broadcast-templates', payload);
      }
      router.replace('/comm-v2/broadcasts/templates' as any);
    } catch (e: any) {
      const d = e?.response?.data?.detail;
      const code = typeof d === 'object' ? d?.error_code : null;
      const msg = code === 'duplicate_name'
        ? 'A template with this name already exists.'
        : (typeof d === 'object' ? d?.message : d) || e?.message || 'unknown';
      Alert.alert('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={shared.screen}>
        <View style={{ paddingVertical: 40 }}><ActivityIndicator color={V2.accent} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>{isEdit ? 'Edit template' : 'New template'}</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          <Section title="Template name">
            <TextInput
              value={name} onChangeText={setName}
              placeholder="e.g. Weekly Monday hours"
              placeholderTextColor={V2.fgHint}
              maxLength={80}
              style={styles.input}
            />
            <Text style={styles.hint}>Shown only to staff. Must be unique.</Text>
          </Section>

          <Section title="Title (patient-facing)">
            <TextInput
              value={title} onChangeText={setTitle}
              placeholder="e.g. Clinic hours this Monday"
              placeholderTextColor={V2.fgHint}
              maxLength={200}
              style={styles.input}
            />
          </Section>

          <Section title="Body">
            <TextInput
              value={body} onChangeText={setBody}
              placeholder="Message body (max 4000 chars)"
              placeholderTextColor={V2.fgHint}
              maxLength={4000}
              multiline
              style={[styles.input, { minHeight: 120, textAlignVertical: 'top' }]}
            />
            <Text style={styles.hint}>{body.length}/4000</Text>
          </Section>

          <Section title="Category">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {CATEGORIES.map((c) => (
                <Pill key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
              ))}
            </View>
          </Section>

          <Section title="Audience">
            {AUDIENCES.map((a) => (
              <Pressable
                key={a.value}
                onPress={() => setAudience(a.value)}
                style={[styles.audienceRow, audience === a.value && styles.audienceRowSelected]}
              >
                <View style={styles.radio}>
                  {audience === a.value ? <View style={styles.radioDot} /> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.audienceLabel}>{a.label}</Text>
                  <Text style={styles.audienceHint}>{a.hint}</Text>
                </View>
              </Pressable>
            ))}
          </Section>

          <Pressable
            onPress={save}
            disabled={saving}
            style={[styles.btn, styles.btnPrimary, { marginTop: 8 }]}
          >
            {saving ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700' }}>
                  {isEdit ? 'Save changes' : 'Save template'}
                </Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
        backgroundColor: selected ? V2.accent : V2.card,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? V2.accent : V2.border,
      }}
    >
      <Text style={{ color: selected ? '#fff' : V2.fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 12, fontWeight: '700', color: V2.fgMuted,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  input: {
    backgroundColor: V2.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: V2.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: V2.fg,
  },
  hint: { fontSize: 11, color: V2.fgHint, marginTop: 4 },
  audienceRow: {
    flexDirection: 'row', gap: 10, padding: 10, borderRadius: 10,
    backgroundColor: V2.card, borderWidth: StyleSheet.hairlineWidth,
    borderColor: V2.border, marginBottom: 8,
  },
  audienceRowSelected: { borderColor: V2.accent, backgroundColor: V2.accentSoft },
  radio: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2,
    borderColor: V2.accent, alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: V2.accent },
  audienceLabel: { fontSize: 14, fontWeight: '700', color: V2.fg },
  audienceHint: { fontSize: 12, color: V2.fgMuted, marginTop: 2 },
  btn: {
    paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnPrimary: { backgroundColor: V2.accent, borderColor: V2.accent },
});
