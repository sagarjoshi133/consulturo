import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import api from './api';
import { COLORS, FONTS, RADIUS } from './theme';
import { PrimaryButton, SecondaryButton } from './components';

type Homepage = {
  doctor_photo_url: string;
  cover_photo_url: string;
  doctor_name?: string;
  tagline: string;
  clinic_name?: string;
  clinic_address?: string;
  clinic_phone?: string;
  doctor_degrees?: string;
  doctor_reg_no?: string;
  signature_url?: string;
  clinic_whatsapp?: string;
  clinic_email?: string;
  clinic_map_url?: string;
  clinic_hours?: string;
  emergency_note?: string;
  updated_at?: string;
};

export function HomepagePanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [doctorUrl, setDoctorUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [tagline, setTagline] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [clinicAddress, setClinicAddress] = useState('');
  const [clinicPhone, setClinicPhone] = useState('');
  const [degrees, setDegrees] = useState('');
  const [regNo, setRegNo] = useState('');
  const [signatureUrl, setSignatureUrl] = useState('');
  const [uploadingSig, setUploadingSig] = useState(false);
  const [msg, setMsg] = useState('');
  // --- Help/Contact fields ---
  const [whatsapp, setWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [hours, setHours] = useState('');
  const [emergencyNote, setEmergencyNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/homepage');
      setDoctorUrl(data?.doctor_photo_url || '');
      setCoverUrl(data?.cover_photo_url || '');
      setDoctorName(data?.doctor_name || '');
      setTagline(data?.tagline || '');
      setClinicName(data?.clinic_name || '');
      setClinicAddress(data?.clinic_address || '');
      setClinicPhone(data?.clinic_phone || '');
      setDegrees(data?.doctor_degrees || '');
      setRegNo(data?.doctor_reg_no || '');
      setSignatureUrl(data?.signature_url || '');
      setWhatsapp(data?.clinic_whatsapp || '');
      setContactEmail(data?.clinic_email || '');
      setMapUrl(data?.clinic_map_url || '');
      setHours(data?.clinic_hours || '');
      setEmergencyNote(data?.emergency_note || '');
    } catch {
      setMsg('Could not load current settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.patch('/settings/homepage', {
        doctor_photo_url: doctorUrl.trim(),
        cover_photo_url: coverUrl.trim(),
        doctor_name: doctorName.trim(),
        tagline: tagline.trim(),
        clinic_name: clinicName.trim(),
        clinic_address: clinicAddress.trim(),
        clinic_phone: clinicPhone.trim(),
        doctor_degrees: degrees.trim(),
        doctor_reg_no: regNo.trim(),
        signature_url: signatureUrl.trim(),
        clinic_whatsapp: whatsapp.trim(),
        clinic_email: contactEmail.trim(),
        clinic_map_url: mapUrl.trim(),
        clinic_hours: hours.trim(),
        emergency_note: emergencyNote.trim(),
      });
      setMsg('Saved — patients & prescriptions will pick up the update.');
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    const doIt = () => {
      setDoctorUrl('');
      setCoverUrl('');
      setDoctorName('');
      setTagline('');
      setClinicName('');
      setClinicAddress('');
      setClinicPhone('');
      setDegrees('');
      setRegNo('');
      // keep signature unless user clears explicitly
      setMsg('Tap Save to apply defaults.');
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Reset all profile + clinic settings to defaults? (Signature kept.)')) doIt();
    } else {
      Alert.alert('Reset', 'Reset all profile + clinic settings to defaults? Signature will be kept.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: doIt },
      ]);
    }
  };

  // --- Signature upload ---
  const pickSignature = async () => {
    setUploadingSig(true);
    setMsg('');
    try {
      // On web, use a file input to get a data URL. On native, use ImagePicker.
      if (Platform.OS === 'web') {
        const picked = await pickFileWeb();
        if (picked) {
          setSignatureUrl(picked);
          setMsg('Signature loaded. Tap Save to persist.');
        }
      } else {
        const res = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.8,
          base64: true,
        });
        if (!res.canceled && res.assets?.[0]) {
          const a = res.assets[0];
          const mime = a.mimeType || 'image/png';
          const b64 = a.base64;
          if (b64) {
            // ~500KB check
            if (b64.length > 700_000) {
              Alert.alert('Image too large', 'Please pick a smaller image (under ~500 KB).');
              return;
            }
            setSignatureUrl(`data:${mime};base64,${b64}`);
            setMsg('Signature loaded. Tap Save to persist.');
          }
        }
      }
    } catch (e: any) {
      setMsg(e?.message || 'Could not pick image');
    } finally {
      setUploadingSig(false);
    }
  };

  const clearSignature = () => {
    const doIt = () => { setSignatureUrl(''); setMsg('Signature cleared. Tap Save to persist.'); };
    if (Platform.OS === 'web') {
      if (window.confirm('Remove the saved signature?')) doIt();
    } else {
      Alert.alert('Remove signature?', 'This will remove the signature from future prescriptions.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doIt },
      ]);
    }
  };

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />;

  return (
    <>
      <Text style={styles.h1}>Profile & Clinic</Text>
      <Text style={styles.sub}>
        These fields appear on the patient home screen and in the prescription PDF header / footer.
        Changes sync instantly for every user.
      </Text>

      {/* Live preview */}
      <View style={styles.previewCard}>
        <Text style={styles.previewLbl}>Live preview (patient home)</Text>
        <View style={styles.heroPreviewWrap}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          ) : null}
          <LinearGradient
            colors={['rgba(10,94,107,0.85)', 'rgba(14,124,139,0.82)', 'rgba(22,166,184,0.78)']}
            style={styles.heroPreview}
          >
            <Text style={styles.greet}>Namaste</Text>
            <Text style={styles.brandName}>ConsultUro</Text>
            <View style={styles.previewDocCard}>
              {doctorUrl ? (
                <Image source={{ uri: doctorUrl }} style={styles.previewDocPhoto} />
              ) : (
                <View style={[styles.previewDocPhoto, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Ionicons name="person" size={32} color={COLORS.primary} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.previewDocName}>{doctorName || 'Dr. Sagar Joshi'}</Text>
                <Text style={styles.previewDocSpec}>Consultant Urologist</Text>
                <Text style={styles.previewDocSub} numberOfLines={2}>
                  {tagline || 'Laparoscopic & Transplant Surgeon'}
                </Text>
              </View>
            </View>
          </LinearGradient>
        </View>
      </View>

      <Text style={styles.fieldLabel}>Doctor display name</Text>
      <TextInput
        value={doctorName}
        onChangeText={setDoctorName}
        placeholder="e.g. Dr. Sagar Joshi"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-doctor-name"
        maxLength={80}
      />

      <Text style={styles.fieldLabel}>Main doctor photo URL</Text>
      <TextInput
        value={doctorUrl}
        onChangeText={setDoctorUrl}
        placeholder="Leave empty to use default professional headshot"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        keyboardType="url"
        testID="home-doctor-url"
      />

      <Text style={styles.fieldLabel}>Cover photo URL (background)</Text>
      <TextInput
        value={coverUrl}
        onChangeText={setCoverUrl}
        placeholder="Leave empty for the default OT photo"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        keyboardType="url"
        testID="home-cover-url"
      />

      <Text style={styles.fieldLabel}>Tagline</Text>
      <TextInput
        value={tagline}
        onChangeText={setTagline}
        placeholder="e.g. Laparoscopic & Transplant Surgeon"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-tagline"
        maxLength={140}
      />

      <View style={styles.divider} />
      <Text style={styles.sectionHeading}>Clinic & Prescription Details</Text>
      <Text style={styles.sectionSub}>
        These appear on the prescription PDF header and in appointment confirmations.
      </Text>

      <Text style={styles.fieldLabel}>Clinic name</Text>
      <TextInput
        value={clinicName}
        onChangeText={setClinicName}
        placeholder="e.g. Sterling Hospitals"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-clinic-name"
      />

      <Text style={styles.fieldLabel}>Clinic address</Text>
      <TextInput
        value={clinicAddress}
        onChangeText={setClinicAddress}
        placeholder="Full postal address"
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, { minHeight: 50 }]}
        multiline
        testID="home-clinic-address"
      />

      <Text style={styles.fieldLabel}>Clinic phone</Text>
      <TextInput
        value={clinicPhone}
        onChangeText={setClinicPhone}
        placeholder="+91 ..."
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        keyboardType="phone-pad"
        testID="home-clinic-phone"
      />

      <Text style={styles.fieldLabel}>Doctor degrees</Text>
      <TextInput
        value={degrees}
        onChangeText={setDegrees}
        placeholder="e.g. MBBS · MS · DrNB (Urology)"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-degrees"
      />

      <Text style={styles.fieldLabel}>Medical Council Reg. No.</Text>
      <TextInput
        value={regNo}
        onChangeText={setRegNo}
        placeholder="e.g. G-53149"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-reg-no"
      />

      <View style={styles.divider} />
      <Text style={styles.sectionHeading}>Help & Contact Info</Text>
      <Text style={styles.sectionSub}>
        Shown on the patient-facing Help screen so users can reach you directly.
      </Text>

      <Text style={styles.fieldLabel}>WhatsApp number</Text>
      <TextInput
        value={whatsapp}
        onChangeText={setWhatsapp}
        placeholder="e.g. +918155075669"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        keyboardType="phone-pad"
        testID="home-clinic-whatsapp"
      />

      <Text style={styles.fieldLabel}>Support email</Text>
      <TextInput
        value={contactEmail}
        onChangeText={setContactEmail}
        placeholder="e.g. drsagarjoshi133@gmail.com"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        testID="home-clinic-email"
      />

      <Text style={styles.fieldLabel}>Google Maps link</Text>
      <TextInput
        value={mapUrl}
        onChangeText={setMapUrl}
        placeholder="Paste the clinic's Google Maps share URL"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        testID="home-clinic-map"
      />

      <Text style={styles.fieldLabel}>Working hours</Text>
      <TextInput
        value={hours}
        onChangeText={setHours}
        placeholder="e.g. Mon–Sat 8:00 AM – 8:00 PM"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        testID="home-clinic-hours"
      />

      <Text style={styles.fieldLabel}>Emergency note</Text>
      <TextInput
        value={emergencyNote}
        onChangeText={setEmergencyNote}
        placeholder="e.g. Emergency consultations available on Sundays"
        placeholderTextColor={COLORS.textDisabled}
        style={[styles.input, { minHeight: 50 }]}
        multiline
        testID="home-emergency-note"
      />

      <View style={styles.divider} />
      <Text style={styles.sectionHeading}>Digital Signature</Text>
      <Text style={styles.sectionSub}>
        Uploaded signature appears above "Dr. Sagar Joshi" in the prescription PDF footer.
        Use a transparent PNG or a cropped JPG (ideally under 500 KB).
      </Text>

      <View style={styles.sigBox}>
        {signatureUrl ? (
          <Image
            source={{ uri: signatureUrl }}
            style={styles.sigPreview}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.sigEmpty}>
            <Ionicons name="create-outline" size={32} color={COLORS.textDisabled} />
            <Text style={styles.sigEmptyText}>No signature uploaded</Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity
          onPress={pickSignature}
          disabled={uploadingSig}
          style={styles.sigBtn}
          activeOpacity={0.85}
          testID="home-sig-upload"
        >
          {uploadingSig ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <>
              <Ionicons name="cloud-upload" size={16} color={COLORS.primary} />
              <Text style={styles.sigBtnText}>
                {signatureUrl ? 'Replace signature' : 'Upload signature'}
              </Text>
            </>
          )}
        </TouchableOpacity>
        {signatureUrl ? (
          <TouchableOpacity onPress={clearSignature} style={styles.sigBtnDanger} activeOpacity={0.85} testID="home-sig-clear">
            <Ionicons name="trash" size={14} color={COLORS.accent} />
            <Text style={[styles.sigBtnText, { color: COLORS.accent }]}>Remove</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.fieldLabel}>…or paste a signature image URL</Text>
      <TextInput
        value={signatureUrl.startsWith('data:') ? '' : signatureUrl}
        onChangeText={setSignatureUrl}
        placeholder="https://…/signature.png"
        placeholderTextColor={COLORS.textDisabled}
        style={styles.input}
        autoCapitalize="none"
        keyboardType="url"
        testID="home-sig-url"
      />

      {msg ? <Text style={[styles.msg, msg.startsWith('Saved') && { color: COLORS.success }]}>{msg}</Text> : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <PrimaryButton
          title={saving ? 'Saving…' : 'Save Changes'}
          onPress={save}
          disabled={saving}
          icon={<Ionicons name="save" size={18} color="#fff" />}
          style={{ flex: 1 }}
          testID="home-save"
        />
        <SecondaryButton title="Reset" onPress={resetDefaults} style={{ flex: 0.6 }} />
      </View>

      <View style={styles.tipBox}>
        <Ionicons name="bulb-outline" size={14} color={COLORS.primary} />
        <Text style={styles.tipText}>
          For best results, use a landscape image at least 1200×800 px for the cover and a square 800×800 headshot for
          the doctor photo.
        </Text>
      </View>
    </>
  );
}

// Web-only helper: opens a native file chooser and reads the picked image
// as a data-URL base64 string so we can round-trip it through the same
// signature_url field as other platforms.
async function pickFileWeb(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      if (file.size > 700_000) {
        // eslint-disable-next-line no-alert
        window.alert('Image is too large. Please choose a file under ~500 KB.');
        return resolve(null);
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

const styles = StyleSheet.create({
  h1: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  sub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 18 },

  previewCard: { backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: 14 },
  previewLbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10, marginBottom: 8 },
  heroPreviewWrap: { overflow: 'hidden', borderRadius: RADIUS.md, backgroundColor: COLORS.primaryDark, height: 220 },
  heroPreview: { padding: 16, flex: 1, justifyContent: 'space-between' },
  greet: { ...FONTS.body, color: '#E0F7FA', fontSize: 12 },
  brandName: { ...FONTS.h2, color: '#fff', fontSize: 18 },
  previewDocCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderRadius: RADIUS.md },
  previewDocPhoto: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary + '22' },
  previewDocName: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  previewDocSpec: { ...FONTS.body, color: COLORS.primary, fontSize: 11, marginTop: 1 },
  previewDocSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 10, marginTop: 2 },

  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, marginTop: 14 },
  input: { marginTop: 6, backgroundColor: '#fff', padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  msg: { ...FONTS.body, color: COLORS.accent, fontSize: 12, marginTop: 10 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 24 },
  sectionHeading: { ...FONTS.h4, color: COLORS.primary, fontSize: 15, marginBottom: 4 },
  sectionSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginBottom: 4, lineHeight: 17 },
  tipBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 14, padding: 10, backgroundColor: COLORS.primary + '0D', borderRadius: RADIUS.md },
  tipText: { ...FONTS.body, color: COLORS.primary, fontSize: 11, flex: 1, lineHeight: 17 },

  // Signature
  sigBox: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    padding: 10,
    minHeight: 120,
    alignItems: 'center', justifyContent: 'center',
  },
  sigPreview: { width: '100%', height: 100 },
  sigEmpty: { alignItems: 'center', justifyContent: 'center', padding: 10 },
  sigEmptyText: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 8 },
  sigBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '0F',
    borderWidth: 1, borderColor: COLORS.primary + '40',
  },
  sigBtnDanger: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent + '10',
    borderWidth: 1, borderColor: COLORS.accent + '55',
  },
  sigBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 13 },
});
