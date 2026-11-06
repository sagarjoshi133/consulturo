/**
 * Branding → About Page editor.
 *
 * Lets the owner edit the public About page — headline, bio, highlights,
 * education, experience, services, memberships and contact — stored in
 * clinic_settings.about_overrides and merged over the defaults by
 * GET /api/doctor.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, FONTS, RADIUS } from './theme';
import api from './api';
import { clearClinicSettingsCache } from './clinic-settings';

type Qual = { degree?: string; institute?: string; year?: string; note?: string };
type Exp = { role?: string; place?: string };
type Stat = { label?: string; value?: string };
type Contact = { phone?: string; whatsapp?: string; email?: string; website?: string };

export default function AboutEditorPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [photo, setPhoto] = useState('');
  const [stats, setStats] = useState<Stat[]>([]);
  const [bio, setBio] = useState('');
  const [statement, setStatement] = useState('');
  const [highlights, setHighlights] = useState<string[]>([]);
  const [quals, setQuals] = useState<Qual[]>([]);
  const [exp, setExp] = useState<Exp[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [contact, setContact] = useState<Contact>({});

  useEffect(() => {
    (async () => {
      try {
        const [{ data: doc }, { data: cs }] = await Promise.all([
          api.get('/doctor'),
          api.get('/clinic-settings'),
        ]);
        const ov = (cs?.about_overrides && typeof cs.about_overrides === 'object') ? cs.about_overrides : {};
        const m = { ...doc, ...ov };
        setTitle(m.title || '');
        setTagline(m.tagline || '');
        setPhoto(m.photo_url || '');
        setStats(Array.isArray(m.stats) ? m.stats : []);
        setBio(m.short_bio || '');
        setStatement(m.personal_statement || '');
        setHighlights(Array.isArray(m.highlights) ? m.highlights : []);
        setQuals(Array.isArray(m.qualifications) ? m.qualifications : []);
        setExp(Array.isArray(m.past_experience) ? m.past_experience : []);
        // Services: prefer flat list; else flatten categories.
        let svc: string[] = Array.isArray(m.services) ? m.services : [];
        if (!svc.length && Array.isArray(m.service_categories)) {
          svc = m.service_categories.flatMap((c: any) => c.items || []);
        }
        setServices(svc);
        setMemberships(Array.isArray(m.memberships) ? m.memberships.map((x: any) => (typeof x === 'string' ? x : x.name)).filter(Boolean) : []);
        setContact(m.contact && typeof m.contact === 'object' ? m.contact : {});
      } catch { /* defaults */ }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const overrides: any = {
      title: title.trim(),
      tagline: tagline.trim(),
      photo_url: photo.trim(),
      stats: stats.filter((s) => (s.label || s.value)),
      short_bio: bio.trim(),
      personal_statement: statement.trim(),
      highlights: highlights.filter((h) => h.trim()),
      qualifications: quals.filter((q) => (q.degree || q.institute)),
      past_experience: exp.filter((e) => (e.role || e.place)),
      services: services.filter((s) => s.trim()),
      memberships: memberships.filter((x) => x.trim()).map((name) => ({ name, icon: 'ribbon' })),
      contact,
    };
    // Mirror the flat services into a single category so the About
    // page's category renderer displays the edited list.
    if (overrides.services.length) {
      overrides.service_categories = [{ title: 'Services', icon: 'medkit', items: overrides.services }];
    }
    try {
      await api.patch('/clinic-settings', { about_overrides: overrides });
      clearClinicSettingsCache();
      Alert.alert('Saved', 'Your About page has been updated.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.response?.data?.detail || 'Could not save. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>;

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to upload.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, base64: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const uri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
    if (uri.length > 2_500_000) { Alert.alert('Image too large', 'Please pick a smaller / more compressed photo.'); return; }
    setPhoto(uri);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
      <Group label="Profile photo">
        <View style={styles.photoRow}>
          <View style={styles.photoBox}>
            {photo ? <Image source={{ uri: photo }} style={styles.photoImg} resizeMode="cover" /> : <Ionicons name="person" size={32} color={COLORS.textDisabled} />}
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <TouchableOpacity onPress={pickPhoto} style={styles.photoBtn} testID="about-pick-photo">
              <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
              <Text style={styles.photoBtnTxt}>{photo ? 'Replace photo' : 'Upload photo'}</Text>
            </TouchableOpacity>
            {photo ? (
              <TouchableOpacity onPress={() => setPhoto('')} style={{ alignItems: 'center', paddingVertical: 6 }}>
                <Text style={{ ...FONTS.body, color: COLORS.textSecondary, fontSize: 12 }}>Use default photo</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </Group>

      <Group label="Headline numbers">
        <ObjList
          items={stats}
          setItems={setStats}
          addLabel="Add stat"
          blank={{ label: '', value: '' }}
          fields={[
            { key: 'value', label: 'Value', ph: '3000+' },
            { key: 'label', label: 'Label', ph: 'Surgeries performed' },
          ]}
          titleOf={(s) => s.value || s.label || 'Stat'}
        />
      </Group>

      <Group label="Headline">
        <Field label="Title / Specialty" value={title} onChangeText={setTitle} placeholder="Consultant Urologist & Transplant Surgeon" />
        <Field label="Tagline" value={tagline} onChangeText={setTagline} placeholder="Short line under your name" />
      </Group>

      <Group label="About me">
        <Field label="Short bio" value={bio} onChangeText={setBio} placeholder="A couple of sentences about you" multiline />
        <Field label="Personal statement (quote)" value={statement} onChangeText={setStatement} placeholder="Your care philosophy in one line" multiline />
      </Group>

      <Group label="Highlights">
        <StringList items={highlights} setItems={setHighlights} placeholder="e.g. 3000+ surgeries performed" addLabel="Add highlight" />
      </Group>

      <Group label="Education">
        <ObjList
          items={quals}
          setItems={setQuals}
          addLabel="Add qualification"
          blank={{ degree: '', institute: '', year: '', note: '' }}
          fields={[
            { key: 'degree', label: 'Degree', ph: 'MBBS' },
            { key: 'year', label: 'Year', ph: '2014' },
            { key: 'institute', label: 'Institute', ph: 'College / Hospital' },
            { key: 'note', label: 'Note', ph: 'Optional', multiline: true },
          ]}
          titleOf={(q) => q.degree || 'Qualification'}
        />
      </Group>

      <Group label="Past experience">
        <ObjList
          items={exp}
          setItems={setExp}
          addLabel="Add experience"
          blank={{ role: '', place: '' }}
          fields={[
            { key: 'role', label: 'Role', ph: 'Senior Resident — Urology' },
            { key: 'place', label: 'Place', ph: 'Hospital, City' },
          ]}
          titleOf={(e) => e.role || 'Experience'}
        />
      </Group>

      <Group label="Services">
        <StringList items={services} setItems={setServices} placeholder="e.g. Kidney Stone Treatment" addLabel="Add service" />
        <Text style={styles.note}>Editing services shows them as one simple list on the About page.</Text>
      </Group>

      <Group label="Memberships">
        <StringList items={memberships} setItems={setMemberships} placeholder="e.g. Urological Society of India" addLabel="Add membership" />
      </Group>

      <Group label="Contact">
        <Field label="Phone" value={contact.phone || ''} onChangeText={(v) => setContact({ ...contact, phone: v })} placeholder="+91…" />
        <Field label="WhatsApp" value={contact.whatsapp || ''} onChangeText={(v) => setContact({ ...contact, whatsapp: v })} placeholder="+91…" />
        <Field label="Email" value={contact.email || ''} onChangeText={(v) => setContact({ ...contact, email: v })} placeholder="name@clinic.com" />
        <Field label="Website" value={contact.website || ''} onChangeText={(v) => setContact({ ...contact, website: v })} placeholder="https://…" />
      </Group>

      <TouchableOpacity onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} testID="about-save">
        {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="save" size={18} color="#fff" />}
        <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save About page'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Group({ label, children }: any) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Field({ label, ...props }: any) {
  return (
    <View style={{ marginTop: 8 }}>
      {!!label && <Text style={styles.fieldLabel}>{label}</Text>}
      <TextInput
        {...props}
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, props.multiline && { minHeight: 60, textAlignVertical: 'top' }]}
      />
    </View>
  );
}

function StringList({ items, setItems, placeholder, addLabel }: { items: string[]; setItems: (v: string[]) => void; placeholder: string; addLabel: string }) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir; if (j < 0 || j >= items.length) return;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; setItems(next);
  };
  return (
    <View style={{ marginTop: 6 }}>
      {items.map((it, i) => (
        <View key={i} style={styles.rowItem}>
          <View style={styles.arrows}>
            <TouchableOpacity onPress={() => move(i, -1)} disabled={i === 0}><Ionicons name="chevron-up" size={15} color={i === 0 ? COLORS.textDisabled : COLORS.textPrimary} /></TouchableOpacity>
            <TouchableOpacity onPress={() => move(i, 1)} disabled={i === items.length - 1}><Ionicons name="chevron-down" size={15} color={i === items.length - 1 ? COLORS.textDisabled : COLORS.textPrimary} /></TouchableOpacity>
          </View>
          <TextInput
            value={it}
            onChangeText={(v) => { const n = [...items]; n[i] = v; setItems(n); }}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textDisabled}
            style={[styles.input, { flex: 1 }]}
            multiline
          />
          <TouchableOpacity onPress={() => setItems(items.filter((_, k) => k !== i))} style={styles.del}><Ionicons name="close" size={16} color={COLORS.accent} /></TouchableOpacity>
        </View>
      ))}
      <TouchableOpacity onPress={() => setItems([...items, ''])} style={styles.addRow}>
        <Ionicons name="add" size={15} color={COLORS.primary} />
        <Text style={styles.addRowTxt}>{addLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ObjList<T extends Record<string, any>>({ items, setItems, addLabel, blank, fields, titleOf }: {
  items: T[]; setItems: (v: T[]) => void; addLabel: string; blank: T;
  fields: { key: string; label: string; ph?: string; multiline?: boolean }[];
  titleOf: (it: T) => string;
}) {
  return (
    <View style={{ marginTop: 6 }}>
      {items.map((it, i) => (
        <View key={i} style={styles.objCard}>
          <View style={styles.objTop}>
            <Text style={styles.objTitle} numberOfLines={1}>{titleOf(it)}</Text>
            <TouchableOpacity onPress={() => setItems(items.filter((_, k) => k !== i))}><Ionicons name="trash-outline" size={16} color={COLORS.accent} /></TouchableOpacity>
          </View>
          {fields.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              value={(it as any)[f.key] || ''}
              onChangeText={(v: string) => { const n = [...items]; (n[i] as any)[f.key] = v; setItems([...n]); }}
              placeholder={f.ph}
              multiline={f.multiline}
            />
          ))}
        </View>
      ))}
      <TouchableOpacity onPress={() => setItems([...items, { ...blank }])} style={styles.addRow}>
        <Ionicons name="add" size={15} color={COLORS.primary} />
        <Text style={styles.addRowTxt}>{addLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: 18 },
  groupLabel: { ...FONTS.label, color: COLORS.primary, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: Platform.OS === 'ios' ? 10 : 7, fontSize: 13, color: COLORS.textPrimary, backgroundColor: '#FCFEFE' },
  rowItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  arrows: { flexDirection: 'column' },
  del: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addRowTxt: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
  objCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: 10, marginBottom: 10, backgroundColor: '#fff' },
  objTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  objTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  note: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  photoRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 4 },
  photoBox: { width: 72, height: 72, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#F7F9FA', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImg: { width: '100%', height: '100%' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: COLORS.primary, paddingVertical: 10, borderRadius: RADIUS.sm },
  photoBtnTxt: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COLORS.primary, paddingVertical: 14, borderRadius: RADIUS.md, marginTop: 6 },
  saveTxt: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15 },
});
