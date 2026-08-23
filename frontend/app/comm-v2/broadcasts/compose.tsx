/**
 * Comm V2 — Broadcast composer (create OR edit draft/rejected).
 *
 * Fields per spec: title, body, category, audience_mode
 * (+ scheduled_at chosen on the detail screen after approval).
 */
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../../src/api';
import { V2, shared } from '../../../src/comm-v2/ui-tokens';

const CATEGORIES = ['announcements', 'appointments', 'reminders', 'system', 'marketing'];
const AUDIENCES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'patients', label: 'All patients', hint: 'Every registered patient.' },
  { value: 'staff', label: 'Staff only', hint: 'Reception, nursing, doctors.' },
  { value: 'both', label: 'Patients + staff', hint: 'Everyone.' },
  { value: 'patients_with_future_appointments', label: 'Patients with upcoming appointments',
    hint: 'Patients with at least one confirmed booking in the future.' },
];

export default function BroadcastCompose() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('announcements');
  const [audience, setAudience] = useState('patients');
  const [saving, setSaving] = useState(false);

  const save = async (submit: boolean) => {
    if (!title.trim() || !body.trim()) {
      Alert.alert('Missing fields', 'Please fill title and body.');
      return;
    }
    setSaving(true);
    try {
      let id = edit;
      if (edit) {
        await api.patch(`/v2/communications/broadcasts/${encodeURIComponent(String(edit))}`, {
          title: title.trim(), body: body.trim(), category, audience_mode: audience,
        });
      } else {
        const r = await api.post('/v2/communications/broadcasts', {
          title: title.trim(), body: body.trim(), category, audience_mode: audience,
        });
        id = r?.data?.broadcast?.id;
      }
      if (submit && id) {
        await api.post(`/v2/communications/broadcasts/${encodeURIComponent(String(id))}/submit`);
      }
      router.replace((id ? `/comm-v2/broadcasts/${id}` : '/comm-v2/broadcasts') as any);
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail?.message
        || e?.response?.data?.detail || e?.message || 'unknown');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={shared.screen}>
      <View style={shared.headerRow}>
        <Pressable onPress={() => router.back()} style={shared.headerBtn} hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={V2.fg} />
        </Pressable>
        <Text style={shared.headerTitle}>{edit ? 'Edit broadcast' : 'New broadcast'}</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>

          <Section title="Title">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Clinic closed on Nov 12–14"
              placeholderTextColor={V2.fgHint}
              maxLength={200}
              style={styles.input}
            />
          </Section>

          <Section title="Body">
            <TextInput
              value={body}
              onChangeText={setBody}
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

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Pressable
              onPress={() => save(false)}
              disabled={saving}
              style={[styles.btn, styles.btnGhost, { flex: 1 }]}
            >
              <Text style={{ color: V2.accent, fontWeight: '700' }}>Save draft</Text>
            </Pressable>
            <Pressable
              onPress={() => save(true)}
              disabled={saving}
              style={[styles.btn, styles.btnPrimary, { flex: 1 }]}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit for approval</Text>}
            </Pressable>
          </View>
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
  hint: { fontSize: 11, color: V2.fgHint, textAlign: 'right', marginTop: 4 },
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
  btnGhost: { backgroundColor: V2.card, borderColor: V2.accent },
});
