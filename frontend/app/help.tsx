import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import api from '../src/api';
import { COLORS, FONTS, RADIUS } from '../src/theme';

type ClinicContact = {
  clinic_name?: string;
  clinic_address?: string;
  clinic_phone?: string;
  clinic_whatsapp?: string;
  clinic_email?: string;
  clinic_map_url?: string;
  clinic_hours?: string;
  emergency_note?: string;
  doctor_photo_url?: string;
};

export default function HelpScreen() {
  const router = useRouter();
  const [c, setC] = useState<ClinicContact | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/settings/homepage');
      setC(data);
    } catch {
      setC({});
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const call = () => {
    const n = (c?.clinic_phone || '').replace(/\s/g, '');
    if (n) Linking.openURL(`tel:${n}`);
  };
  const whatsapp = () => {
    const n = (c?.clinic_whatsapp || '').replace(/[^\d]/g, '');
    if (n) Linking.openURL(`https://wa.me/${n}?text=${encodeURIComponent('Hello Dr. Joshi, I need assistance.')}`);
  };
  const email = () => {
    if (c?.clinic_email) Linking.openURL(`mailto:${c.clinic_email}?subject=${encodeURIComponent('ConsultUro — Query')}`);
  };
  const map = () => {
    if (c?.clinic_map_url) Linking.openURL(c.clinic_map_url);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/' as any); }}
              style={styles.backBtn}
              testID="help-back"
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.heroTitle}>Help & Contact</Text>
            <View style={{ width: 40 }} />
          </View>
          <Text style={styles.heroSub}>We’re here for you — reach out anytime.</Text>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Doctor card */}
        <View style={styles.docCard}>
          {!!c?.doctor_photo_url && (
            <Image source={{ uri: c.doctor_photo_url }} style={styles.docAvatar} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.docName}>Dr. Sagar Joshi</Text>
            <Text style={styles.docSub}>Consultant Urologist</Text>
            <Text style={styles.docSub}>{c?.clinic_name || 'Sterling Hospital'}</Text>
          </View>
        </View>

        {/* Quick action row */}
        <View style={styles.quickRow}>
          <QuickAction icon="call" label="Call" color={COLORS.primary} onPress={call} disabled={!c?.clinic_phone} testID="help-call" />
          <QuickAction icon="logo-whatsapp" label="WhatsApp" color={COLORS.whatsapp} onPress={whatsapp} disabled={!c?.clinic_whatsapp} testID="help-whatsapp" />
          <QuickAction icon="mail" label="Email" color={COLORS.primaryDark} onPress={email} disabled={!c?.clinic_email} testID="help-email" />
          <QuickAction icon="map" label="Map" color={COLORS.accent} onPress={map} disabled={!c?.clinic_map_url} testID="help-map" />
        </View>

        {/* Info rows */}
        <InfoRow icon="call-outline" label="Phone" value={c?.clinic_phone || '—'} onPress={call} />
        <InfoRow icon="logo-whatsapp" label="WhatsApp" value={c?.clinic_whatsapp || '—'} onPress={whatsapp} />
        <InfoRow icon="mail-outline" label="Email" value={c?.clinic_email || '—'} onPress={email} />
        <InfoRow icon="time-outline" label="Working Hours" value={c?.clinic_hours || 'Mon–Sat'} />
        {!!c?.emergency_note && (
          <View style={styles.emergencyCard}>
            <Ionicons name="medkit" size={18} color={COLORS.accent} />
            <Text style={styles.emergencyText}>{c.emergency_note}</Text>
          </View>
        )}
        <InfoRow icon="location-outline" label="Address" value={c?.clinic_address || '—'} onPress={map} multiline />

        <Text style={styles.sectionLabel}>Legal</Text>
        <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/privacy' as any)} testID="help-privacy">
          <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.primary} />
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/terms' as any)} testID="help-terms">
          <Ionicons name="document-text-outline" size={20} color={COLORS.primary} />
          <Text style={styles.linkText}>Terms of Use</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          For clinical emergencies, please visit the nearest hospital immediately.
        </Text>
      </ScrollView>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress, disabled, testID }: { icon: any; label: string; color: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[styles.quickAction, disabled && { opacity: 0.4 }]}
      testID={testID}
    >
      <View style={[styles.quickIcon, { backgroundColor: color + '1A', borderColor: color + '33' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function InfoRow({ icon, label, value, onPress, multiline }: { icon: any; label: string; value: string; onPress?: () => void; multiline?: boolean }) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} activeOpacity={0.75} style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={18} color={COLORS.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={multiline ? 4 : 2}>{value}</Text>
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={18} color={COLORS.textDisabled} />}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 22, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...FONTS.h4, color: '#fff' },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center' },
  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, gap: 14 },
  docAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.bg },
  docName: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 17 },
  docSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 13 },
  quickRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  quickAction: { flex: 1, alignItems: 'center', gap: 6 },
  quickIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  quickLabel: { ...FONTS.bodyMedium, fontSize: 12, color: COLORS.textPrimary },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: 10 },
  infoIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COLORS.primary + '12', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginTop: 2 },
  emergencyCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: COLORS.accent + '12', borderWidth: 1, borderColor: COLORS.accent + '33', padding: 12, borderRadius: RADIUS.md, marginTop: 10 },
  emergencyText: { flex: 1, ...FONTS.bodyMedium, color: COLORS.accent, fontSize: 13 },
  sectionLabel: { ...FONTS.label, color: COLORS.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  linkText: { flex: 1, ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  footerNote: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 24, lineHeight: 18 },
});
