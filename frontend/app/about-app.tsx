import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { useAuth } from '../src/auth';

const STAFF_ROLES = new Set(['super_owner', 'primary_owner', 'owner', 'partner', 'doctor', 'assistant', 'reception', 'nursing']);

const PATIENT_HIGHLIGHTS: { icon: any; title: string; body: string }[] = [
  { icon: 'calendar-outline', title: 'Book consultations', body: 'Schedule appointments at your convenience — view real-time availability and confirm in seconds.' },
  { icon: 'medkit-outline', title: 'Digital prescriptions', body: 'Receive Rx instantly on your phone — view, download, share with pharmacy, or print.' },
  { icon: 'chatbubbles-outline', title: 'Direct chat with clinic', body: 'WhatsApp-style messaging with read receipts — your message is always heard.' },
  { icon: 'school-outline', title: 'Trusted education', body: 'Doctor-curated articles, blogs and videos in plain language across English / हिंदी / ગુજરાતી.' },
  { icon: 'notifications-outline', title: 'Smart reminders', body: 'Appointment alerts, medication times, and clinic updates so nothing slips through.' },
  { icon: 'lock-closed-outline', title: 'Privacy first', body: 'Encrypted at rest and in transit. Only you and your doctor see your records.' },
];

const TEAM_HIGHLIGHTS: { icon: any; title: string; body: string }[] = [
  { icon: 'grid-outline', title: 'Doctor\'s Dashboard', body: 'Today\'s appointments, surgeries, KPIs & analytics — at a glance.' },
  { icon: 'people-outline', title: 'Role-based access', body: 'Owner / Primary Owner / Partner / Doctor / Assistant / Reception / Nursing — granular permission manager.' },
  { icon: 'medkit-outline', title: 'Rx generation', body: 'Pre-loaded templates · One-tap PDF / Print / Share · Fully on-device rendering — no waiting.' },
  { icon: 'chatbox-outline', title: 'Patient + internal messaging', body: 'Personal Inbox with read receipts. Lookup by phone. Audit-ready.' },
  { icon: 'megaphone-outline', title: 'Broadcasts', body: 'Owner-approved push announcements to all patients. Templates included.' },
  { icon: 'cloud-upload-outline', title: 'Backups & data vault', body: 'Daily MongoDB snapshots. One-tap restore. Ownership stays with the practice.' },
  { icon: 'globe-outline', title: 'Cross-platform', body: 'Same data, same powers on Android APK and consulturo.com web. Real-time sync.' },
  { icon: 'language-outline', title: 'Trilingual', body: 'English · हिंदी · ગુજરાતી · switch any time.' },
];

export default function AboutAppPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isStaff = !!user && STAFF_ROLES.has((user.role as string) || '');
  const list = isStaff ? TEAM_HIGHLIGHTS : PATIENT_HIGHLIGHTS;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>About ConsultUro</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <LinearGradient colors={COLORS.heroGradient} style={styles.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Text style={styles.heroTitle}>ConsultUro</Text>
          <Text style={styles.heroSub}>{isStaff ? 'Your urology practice — connected.' : 'Your urology care companion.'}</Text>
          <Text style={styles.heroBlurb}>
            {isStaff
              ? 'A complete clinical and administrative workspace for modern urology practices. Built for owners, partners and care teams.'
              : 'A trusted bridge between you and your urologist. Book, consult, learn — all in one place, in your language.'}
          </Text>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.bodyHead}>{isStaff ? 'For your team' : 'What you can do'}</Text>
          {list.map((h, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={h.icon} size={22} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{h.title}</Text>
                <Text style={styles.cardBody}>{h.body}</Text>
              </View>
            </View>
          ))}

          <View style={styles.footerNote}>
            <Ionicons name="ribbon" size={16} color={COLORS.primary} />
            <Text style={styles.footerText}>
              {isStaff
                ? 'Built by Dr. Sagar Joshi · MS, MCh (Urology). Designed with practising urologists.'
                : 'Brought to you by ConsultUro — caring for urology patients across India.'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: '#fff' },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  title: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 15 },
  hero: { padding: 22, marginHorizontal: 16, marginTop: 16, borderRadius: RADIUS.lg },
  heroTitle: { color: '#fff', fontSize: 26, fontFamily: 'Manrope_800ExtraBold' },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontFamily: 'Manrope_700Bold', marginTop: 4 },
  heroBlurb: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginTop: 10, lineHeight: 18 },
  body: { padding: 16 },
  bodyHead: { ...FONTS.h4, color: COLORS.textPrimary, fontSize: 14, marginBottom: 10 },
  card: { flexDirection: 'row', gap: 12, padding: 14, backgroundColor: '#fff', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, marginBottom: 10 },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary + '14', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...FONTS.h4, fontSize: 13, color: COLORS.textPrimary },
  cardBody: { ...FONTS.body, fontSize: 12, color: COLORS.textSecondary, marginTop: 2 },
  footerNote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.primary + '08', padding: 12, borderRadius: RADIUS.md, marginTop: 8 },
  footerText: { color: COLORS.textSecondary, fontSize: 11, flex: 1 },
});
