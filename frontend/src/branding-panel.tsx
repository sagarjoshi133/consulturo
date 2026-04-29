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

export default function BrandingPanel({ category = 'full' }: { category?: 'full' | 'rx' } = {}) {
  const tier = useTier();
  const [s, setS] = useState<Settings>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // When `category === 'rx'` the panel renders ONLY the Prescription
  // Letterhead + Patient-Education + Need-Help sections, so it can
  // be embedded inside the consolidated Branding panel as the "Rx"
  // category without dragging in About-Doctor / Photos / Socials.
  const rxOnly = category === 'rx';

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

  const pickImage = async (key: 'main_photo_url' | 'cover_photo_url' | 'letterhead_image_b64') => {
    const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!r.granted) { Alert.alert('Permission needed'); return; }
    // Letterhead is a wide banner that replaces the entire prescription
    // header strip — a 5:1 (banner) crop reads best in our A4 layout.
    // Main = square avatar, Cover = 16:9 hero photo.
    const aspect: [number, number] =
      key === 'cover_photo_url' ? [16, 9]
      : key === 'letterhead_image_b64' ? [5, 1]
      : [1, 1];
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect,
      // Letterheads need higher fidelity for text/logo crispness in
      // the printed PDF — bump quality vs. the avatar/cover photos.
      quality: key === 'letterhead_image_b64' ? 0.9 : 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const a = result.assets[0];
    const dataUri = a.base64 ? `data:image/jpeg;base64,${a.base64}` : a.uri;
    // Soft size guard for letterhead — keeps the clinic_settings doc
    // from ballooning. ~700 KB lets a 5:1 banner at decent quality
    // through; anything larger is almost certainly an unoptimised
    // photograph rather than a real letterhead.
    if (key === 'letterhead_image_b64' && dataUri.length > 700_000) {
      const proceed = Platform.OS === 'web'
        ? window.confirm('This letterhead image is large (>700 KB). Crisp printing is fine, but PDF size will grow. Continue?')
        : true;
      if (!proceed) return;
    }
    set(key, dataUri);
    await save({ [key]: dataUri });
  };

  if (!tier.isOwnerTier) return null;
  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ margin: 24 }} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }} showsVerticalScrollIndicator={false}>
      {/* Photos */}
      {!rxOnly && (() => {
        // Partner UI gate: hide each section if the partner toggle is off.
        // Owners always see everything. We compute here for inline use below.
        const isPartner = tier.isPartner;
        const showMain = !isPartner || s.partner_can_edit_main_photo !== false && (s.partner_can_edit_main_photo !== undefined || s.partner_can_edit_branding !== false);
        const showCover = !isPartner || s.partner_can_edit_cover_photo !== false && (s.partner_can_edit_cover_photo !== undefined || s.partner_can_edit_branding !== false);
        if (!showMain && !showCover) return null;
        return (
          <>
            <Text style={styles.sectionTitle}>Photos</Text>
            <View style={styles.photoRow}>
              {showMain && (
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
              )}
              {showCover && (
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
              )}
            </View>
          </>
        );
      })()}

      {/* About Doctor — partners gated via partner_can_edit_about_doctor */}
      {!rxOnly && (!tier.isPartner || s.partner_can_edit_about_doctor !== false) && (
        <>
          <Text style={styles.sectionTitle}>About the Doctor</Text>
          <Field label="Doctor name" v={s.doctor_name} on={(v) => set('doctor_name', v)} placeholder="Dr. Sagar Joshi" />
          <Field label="Title" v={s.doctor_title} on={(v) => set('doctor_title', v)} placeholder="Consultant Urologist" />
          <Field label="Tagline" v={s.doctor_tagline} on={(v) => set('doctor_tagline', v)} placeholder="Restoring health, dignity & confidence" />
          <Field label="Short bio" v={s.doctor_short_bio} on={(v) => set('doctor_short_bio', v)} placeholder="MBBS, MS, DrNB Urology · 10+ yrs..." multiline />
        </>
      )}

      {/* Clinic info — partners gated via partner_can_edit_clinic_info */}
      {!rxOnly && (!tier.isPartner || s.partner_can_edit_clinic_info !== false && (s.partner_can_edit_clinic_info !== undefined || s.partner_can_edit_branding !== false)) && (
        <>
          <Text style={styles.sectionTitle}>Clinic</Text>
          <Field label="Clinic name" v={s.clinic_name} on={(v) => set('clinic_name', v)} placeholder="My Urology Practice" />
          <Field label="Website" v={s.clinic_website} on={(v) => set('clinic_website', v)} placeholder="https://yourwebsite.com" autoCapitalize="none" />
        </>
      )}

      {/* Socials — partners gated via partner_can_edit_socials */}
      {!rxOnly && (!tier.isPartner || s.partner_can_edit_socials !== false && (s.partner_can_edit_socials !== undefined || s.partner_can_edit_branding !== false)) && (
        <>
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
        </>
      )}

      {/* Prescription Letterhead — branding for the Rx PDF. Visible to
          full owner-tier (super_owner / primary_owner / partner). The
          letterhead, when enabled, REPLACES the entire app-logo /
          clinic-name / contact strip at the top of every Rx page. The
          two text fields override the default Patient Education and
          Need Help blocks rendered inside the PDF. */}
      {(!tier.isPartner || s.partner_can_edit_branding !== false) && (
        <>
          <Text style={styles.sectionTitle}>Prescription Letterhead</Text>
          <Text style={styles.help}>
            Upload a banner image (recommended ~5:1 ratio — e.g. 1500 × 300 px).
            When the toggle below is on, this image will REPLACE the default
            clinic header at the top of every prescription. A permanent
            "Generated on ConsultUro Platform" footer is always preserved.
          </Text>

          <TouchableOpacity
            onPress={() => pickImage('letterhead_image_b64')}
            style={styles.letterheadBox}
            testID="branding-pick-letterhead"
          >
            {s.letterhead_image_b64 ? (
              <Image source={{ uri: s.letterhead_image_b64 }} style={styles.letterheadImg} resizeMode="contain" />
            ) : (
              <View style={[styles.letterheadImg, styles.photoEmpty]}>
                <Ionicons name="document-attach" size={28} color={COLORS.textSecondary} />
                <Text style={styles.photoLabel}>Tap to upload letterhead</Text>
              </View>
            )}
            <Text style={styles.photoCaption}>
              {s.letterhead_image_b64 ? 'Tap to replace' : 'Tap to choose image'}
            </Text>
          </TouchableOpacity>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Use letterhead on Rx PDF</Text>
              <Text style={[styles.help, { marginTop: 2, marginBottom: 0 }]}>
                When off, the default branded header is used.
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                const v = !s.use_letterhead;
                set('use_letterhead', v);
                save({ use_letterhead: v });
              }}
              style={[styles.toggle, !!s.use_letterhead && styles.toggleOn]}
              testID="branding-toggle-letterhead"
            >
              <View style={[styles.toggleDot, !!s.use_letterhead && styles.toggleDotOn]} />
            </TouchableOpacity>
          </View>

          {s.letterhead_image_b64 ? (
            <TouchableOpacity
              onPress={() => {
                const doClear = () => { set('letterhead_image_b64', ''); save({ letterhead_image_b64: '', use_letterhead: false }); set('use_letterhead', false); };
                if (Platform.OS === 'web') {
                  if (window.confirm('Remove the current letterhead image?')) doClear();
                } else {
                  Alert.alert('Remove letterhead?', 'This clears the uploaded banner image.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: doClear },
                  ]);
                }
              }}
              style={styles.dangerInlineBtn}
              testID="branding-clear-letterhead"
            >
              <Ionicons name="trash" size={14} color="#B91C1C" />
              <Text style={styles.dangerInlineBtnText}>Remove letterhead</Text>
            </TouchableOpacity>
          ) : null}

          <Text style={[styles.sectionTitle, { fontSize: 13, marginTop: 18 }]}>Patient Education (Rx PDF)</Text>
          <Text style={styles.help}>
            Custom education tips shown on every prescription. Plain text or
            simple HTML (e.g. &lt;ul&gt;&lt;li&gt;...&lt;/li&gt;&lt;/ul&gt;).
            Leave blank to keep the built-in defaults.
          </Text>
          <TextInput
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            value={s.patient_education_html || ''}
            onChangeText={(v) => set('patient_education_html', v)}
            placeholder="• Hydrate · 2–3 L water/day&#10;• Bladder discipline — void by clock&#10;• Diet — low salt, less spicy"
            placeholderTextColor={COLORS.textDisabled}
            multiline
            testID="branding-patient-edu"
          />

          <Text style={[styles.sectionTitle, { fontSize: 13, marginTop: 18 }]}>Need Help? (Rx PDF)</Text>
          <Text style={styles.help}>
            Replaces the default contact / hours block on every prescription.
            Leave blank to use the auto-generated phone &amp; clinic info.
          </Text>
          <TextInput
            style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
            value={s.need_help_html || ''}
            onChangeText={(v) => set('need_help_html', v)}
            placeholder="📞 +91 81550 75669&#10;🏥 ConsultUro · Vadodara&#10;🕐 Mon–Sat · 10 AM – 8 PM"
            placeholderTextColor={COLORS.textDisabled}
            multiline
            testID="branding-need-help"
          />
        </>
      )}

      {/* Partner toggles — only primary_owner/super_owner see these */}
      {!rxOnly && (tier.isPrimaryOwner || tier.isSuperOwner) && (
        <>
          <Text style={styles.sectionTitle}>Partner Access</Text>
          <Text style={styles.help}>Toggle which sections Partners are allowed to edit. Owners can always edit everything.</Text>
          {[
            ['partner_can_edit_main_photo', 'Main photo'],
            ['partner_can_edit_cover_photo', 'Cover photo'],
            ['partner_can_edit_clinic_info', 'Clinic name & website'],
            ['partner_can_edit_socials', 'Social media handles'],
            ['partner_can_edit_about_doctor', 'About-Doctor section'],
            ['partner_can_edit_blog', 'External blog links'],
            ['partner_can_edit_videos', 'Videos library'],
            ['partner_can_edit_education', 'Education content'],
            ['partner_can_manage_broadcasts', 'Broadcast announcements'],
          ].map(([k, label]) => {
            // Default ON if the granular flag isn't yet set in the doc
            // (matches backend fallback to partner_can_edit_branding=true).
            const cur = s[k];
            const on = cur === undefined ? true : !!cur;
            return (
              <View key={k} style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{label}</Text>
                <TouchableOpacity
                  onPress={() => { const v = !on; set(k, v); save({ [k]: v }); }}
                  style={[styles.toggle, on && styles.toggleOn]}
                >
                  <View style={[styles.toggleDot, on && styles.toggleDotOn]} />
                </TouchableOpacity>
              </View>
            );
          })}
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

  // Letterhead picker
  letterheadBox: {
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: Platform.OS === 'web' ? 'dashed' : 'solid',
    padding: 10,
    marginBottom: 8,
  },
  letterheadImg: {
    width: '100%',
    aspectRatio: 5,
    borderRadius: 8,
    backgroundColor: COLORS.bg,
  },
  dangerInlineBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    marginTop: 4,
    marginBottom: 6,
  },
  dangerInlineBtnText: { color: '#B91C1C', fontSize: 11, fontFamily: 'Manrope_700Bold' },
});
