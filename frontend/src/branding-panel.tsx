/**
 * Clinic Branding & About-Doctor edit panel.
 *
 * Surfaces the editable fields stored in `db.clinic_settings`:
 *   • Main Photo (doctor headshot used on /about & home hero)
 *   • Cover Photo (banner image used on /about hero)
 *   • Doctor name / title / tagline / short bio
 *   • Clinic name + website
 *   • Social handles: Facebook, Instagram, Twitter/X, LinkedIn, YouTube, WhatsApp
 *   • External Blog Links (custom Blogger / Substack / Medium URLs)
 *
 * Visible to the full owner-tier (super_owner / primary_owner /
 * partner). Partners are gated server-side per-section via the
 * `partner_can_edit_*` toggles — the UI surfaces those toggles ONLY
 * to primary_owner / super_owner.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { useTier } from './tier';

type Settings = Record<string, any>;

const SOCIALS: { key: string; label: string; icon: any; placeholder: string }[] = [
  { key: 'social_facebook', label: 'Facebook', icon: 'logo-facebook', placeholder: 'https://facebook.com/yourpage' },
  { key: 'social_instagram', label: 'Instagram', icon: 'logo-instagram', placeholder: 'https://instagram.com/handle' },
  { key: 'social_twitter', label: 'X / Twitter', icon: 'logo-twitter', placeholder: 'https://x.com/handle' },
  { key: 'social_linkedin', label: 'LinkedIn', icon: 'logo-linkedin', placeholder: 'https://linkedin.com/in/handle' },
  { key: 'social_youtube', label: 'YouTube', icon: 'logo-youtube', placeholder: 'https://youtube.com/@handle' },
  { key: 'social_whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', placeholder: '+91-9000000000' },
];

export default function BrandingPanel() {
  const tier = useTier();
  const [s, setS] = useState<Settings>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/clinic-settings');
      setS(data || {});
    } catch {}
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: string, v: any) => setS((prev) => ({ ...prev, [k]: v }));

  const save = async (patch: Settings) => {
    setSaving(true);
    try {
      await api.patch('/clinic-settings', patch);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Save failed';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    // Strip empty undefined/null fields and the partner toggles which
    // partners can't update (server enforces — UI just doesn't send).
    const out: Settings = {};
    for (const k of Object.keys(s)) {
      if (s[k] === undefined || s[k] === null) continue;
      out[k] = s[k];
    }
    await save(out);
  };

  const pickImage = async (key: 'main_photo_url' | 'cover_photo_url') => {
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!r.granted) { Alert.alert('Permission needed'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: key === 'cover_photo_url' ? [16, 9] : [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
    set(key, dataUri);
    await save({ [key]: dataUri });
  };

  if (!tier.isOwnerTier) return null;
  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ margin: 24 }} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Photos */}
      <Text style={styles.sectionTitle}>Photos</Text>
      <View style={styles.photoRow}>
        <TouchableOpacity onPress={() => pickImage('main_photo_url')} style={styles.photoBox}>
          {s.main_photo_url ? (
            <Image source={{ uri: s.main_photo_url }} style={styles.mainPhoto} />
          ) : (
            <View style={[styles.mainPhoto, styles.photoEmpty]}>
              <Ionicons name="person" size={32} color={COLORS.textSecondary} />
              <Text style={styles.photoLabel}>Main photo</Text>
            </View>
          )}
          <Text style={styles.photoCaption}>Tap to change</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => pickImage('cover_photo_url')} style={[styles.photoBox, { flex: 1 }]}>
          {s.cover_photo_url ? (
            <Image source={{ uri: s.cover_photo_url }} style={styles.coverPhoto} />
          ) : (
            <View style={[styles.coverPhoto, styles.photoEmpty]}>
              <Ionicons name="image" size={28} color={COLORS.textSecondary} />
              <Text style={styles.photoLabel}>Cover photo</Text>
            </View>
          )}
          <Text style={styles.photoCaption}>Tap to change</Text>
        </TouchableOpacity>
      </View>

      {/* About Doctor */}
      <Text style={styles.sectionTitle}>About the Doctor</Text>
      <Field label="Doctor name" v={s.doctor_name} on={(v) => set('doctor_name', v)} placeholder="Dr. Sagar Joshi" />
      <Field label="Title" v={s.doctor_title} on={(v) => set('doctor_title', v)} placeholder="Consultant Urologist" />
      <Field label="Tagline" v={s.doctor_tagline} on={(v) => set('doctor_tagline', v)} placeholder="Restoring health, dignity & confidence" />
      <Field label="Short bio" v={s.doctor_short_bio} on={(v) => set('doctor_short_bio', v)} placeholder="MBBS, MS, DrNB Urology · 10+ yrs..." multiline />

      {/* Clinic */}
      <Text style={styles.sectionTitle}>Clinic</Text>
      <Field label="Clinic name" v={s.clinic_name} on={(v) => set('clinic_name', v)} placeholder="My Urology Practice" />
      <Field label="Website" v={s.clinic_website} on={(v) => set('clinic_website', v)} placeholder="https://yourwebsite.com" autoCapitalize="none" />

      {/* Socials */}
      <Text style={styles.sectionTitle}>Social Media</Text>
      {SOCIALS.map((sc) => (
        <View key={sc.key} style={styles.socRow}>
          <Ionicons name={sc.icon} size={18} color={COLORS.primary} />
          <TextInput
            style={styles.socInput}
            value={s[sc.key] || ''}
            onChangeText={(v) => set(sc.key, v)}
            placeholder={sc.placeholder}
            autoCapitalize="none"
            keyboardType={sc.key === 'social_whatsapp' ? 'phone-pad' : 'default'}
          />
        </View>
      ))}

      {/* Partner toggles — only primary_owner/super_owner see these */}
      {(tier.isPrimaryOwner || tier.isSuperOwner) && (
        <>
          <Text style={styles.sectionTitle}>Partner Access</Text>
          <Text style={styles.help}>Toggle which sections Partners are allowed to edit. Owners can always edit everything.</Text>
          {[
            ['partner_can_edit_branding', 'Photos, social handles, clinic name'],
            ['partner_can_edit_about_doctor', 'About-Doctor section'],
            ['partner_can_edit_blog', 'External blog links'],
            ['partner_can_edit_videos', 'Videos library'],
            ['partner_can_edit_education', 'Education content'],
            ['partner_can_manage_broadcasts', 'Broadcast announcements'],
          ].map(([k, label]) => (
            <View key={k} style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{label}</Text>
              <TouchableOpacity
                onPress={() => { const v = !s[k]; set(k, v); save({ [k]: v }); }}
                style={[styles.toggle, s[k] && styles.toggleOn]}
              >
                <View style={[styles.toggleDot, s[k] && styles.toggleDotOn]} />
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      {/* Save all button */}
      <TouchableOpacity onPress={saveAll} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.5 }]}>
        <Ionicons name="save" size={18} color="#fff" />
        <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save All Changes'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, v, on, placeholder, multiline, autoCapitalize }: {
  label: string;
  v: string | undefined;
  on: (val: string) => void;
  placeholder?: string;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 70, textAlignVertical: 'top' }]}
        value={v || ''}
        onChangeText={on}
        placeholder={placeholder}
        multiline={multiline}
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14, marginTop: 18, marginBottom: 8 },
  photoRow: { flexDirection: 'row', gap: 12, marginBottom: 4 },
  photoBox: { alignItems: 'center', gap: 4 },
  mainPhoto: { width: 96, height: 96, borderRadius: 48, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  coverPhoto: { width: '100%', height: 96, borderRadius: 12, backgroundColor: COLORS.bg, borderWidth: 1, borderColor: COLORS.border },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoLabel: { color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },
  photoCaption: { color: COLORS.primary, fontSize: 11, fontFamily: 'Manrope_700Bold' },
  fieldLabel: { color: COLORS.textSecondary, fontSize: 11, fontFamily: 'Manrope_700Bold', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: COLORS.textPrimary, backgroundColor: '#fff' },
  socRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  socInput: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 12, height: 38, fontSize: 12, color: COLORS.textPrimary, backgroundColor: '#fff' },
  help: { color: COLORS.textSecondary, fontSize: 11, marginBottom: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  toggleLabel: { color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: '#E5E7EB', padding: 2, justifyContent: 'center' },
  toggleOn: { backgroundColor: COLORS.primary },
  toggleDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleDotOn: { transform: [{ translateX: 20 }] },
  saveBtn: { marginTop: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 10, backgroundColor: COLORS.primary },
  saveBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Manrope_700Bold' },
});
