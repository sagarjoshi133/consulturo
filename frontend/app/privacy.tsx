import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';

export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/' as any); }}
              style={styles.backBtn}
              testID="privacy-back"
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.heroTitle}>Privacy Policy</Text>
            <View style={{ width: 40 }} />
          </View>
          <Text style={styles.heroSub}>Last updated: 22 April 2026</Text>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Dr. Sagar Joshi (“we”, “us”) is committed to protecting the privacy of your personal and medical information. This Privacy Policy explains how we collect, use, store, and disclose information about you when you use the ConsultUro mobile application and related services (the “App”).
        </Text>

        <Section title="1. Information We Collect">
          <Bullet><B>Personal Information</B> such as your name, age, gender, phone number, email address and Google account identifier when you sign in, register or schedule an appointment.</Bullet>
          <Bullet><B>Medical Information</B> you voluntarily provide — symptoms, medical history, medications, calculator scores (IPSS, prostate volume, etc.), uploaded reports and prescriptions.</Bullet>
          <Bullet><B>Usage Information</B> such as device model, OS version, app version, crash logs and anonymised interaction events used to improve reliability.</Bullet>
          <Bullet><B>Location Data</B> is NOT collected by this App.</Bullet>
        </Section>

        <Section title="2. How We Use Your Information">
          <Bullet><B>Clinical care:</B> schedule appointments, manage consultations, generate digital prescriptions, keep your health timeline and send reminders.</Bullet>
          <Bullet><B>Communication:</B> contact you about appointments, prescriptions, follow-ups and emergency notices via in-app notifications, WhatsApp or SMS (only if you opt in).</Bullet>
          <Bullet><B>App improvement:</B> analyse non-identifiable usage to fix bugs, monitor uptime and improve user experience.</Bullet>
        </Section>

        <Section title="3. How We Share Information">
          <Text style={styles.p}>
            We do NOT sell your personal or medical information. We share data only in these limited cases:
          </Text>
          <Bullet><B>Clinic Staff:</B> authorised doctors, assistants, reception and nursing staff of the clinic who need access to provide care.</Bullet>
          <Bullet><B>Service Providers:</B> limited technical vendors (cloud hosting, messaging APIs, Google authentication) bound by strict confidentiality obligations and permitted to use your data ONLY to deliver services to us.</Bullet>
          <Bullet><B>Legal Compliance:</B> when required by law, court order, or to protect the rights, property, or safety of the clinic, its patients, or the public.</Bullet>
        </Section>

        <Section title="4. Data Storage & Security">
          <Bullet>Your data is stored on secure servers with encryption in transit (TLS).</Bullet>
          <Bullet>Access is restricted to authorised roles via role-based access control.</Bullet>
          <Bullet>We take reasonable organisational and technical measures to protect your information from unauthorised access, modification, disclosure or destruction.</Bullet>
          <Bullet>No system is 100% secure. You use the App at your own risk and you are responsible for keeping your device and Google account credentials safe.</Bullet>
        </Section>

        <Section title="5. Your Rights & Choices">
          <Bullet><B>Access & correction:</B> you may view or update most of your information from inside the app (My Records, Notes, Profile).</Bullet>
          <Bullet><B>Deletion:</B> you may request deletion of your personal data, subject to legal retention requirements applicable to medical records in India.</Bullet>
          <Bullet><B>Consent withdrawal:</B> you may withdraw marketing consent at any time from the in-app settings; withdrawing data-storage consent will prevent further use of the App.</Bullet>
          <Bullet><B>Portability:</B> upon request, we will provide a copy of your personal health records in a commonly used electronic format.</Bullet>
        </Section>

        <Section title="6. Children’s Data">
          <Text style={styles.p}>
            The App is intended for users aged 18 and above. If a minor requires care, a parent or legal guardian must create and manage the account on their behalf.
          </Text>
        </Section>

        <Section title="7. Compliance">
          <Text style={styles.p}>
            We endeavour to comply with applicable Indian laws governing personal and medical data, including the Digital Personal Data Protection Act, 2023 (DPDP) and the IT (Reasonable Security Practices) Rules, 2011.
          </Text>
        </Section>

        <Section title="8. Changes to this Policy">
          <Text style={styles.p}>
            We may update this Privacy Policy from time to time. Material changes will be notified in-app. Continued use of the App after changes take effect constitutes your acceptance of the updated Policy.
          </Text>
        </Section>

        <Section title="9. Contact">
          <Text style={styles.p}>
            Questions or concerns? Email us at <B>drsagarjoshi133@gmail.com</B> or call <B>+91 81550 75669</B>.
          </Text>
        </Section>

        <Text style={styles.footer}>
          © 2026 Dr. Sagar Joshi. All rights reserved.
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: 'DMSans_700Bold', color: COLORS.textPrimary }}>{children}</Text>;
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 22, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...FONTS.h4, color: '#fff' },
  heroSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', marginTop: 6, textAlign: 'center', fontSize: 12 },
  intro: { ...FONTS.body, color: COLORS.textPrimary, lineHeight: 22, marginBottom: 10 },
  section: { backgroundColor: '#fff', padding: 16, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: 12 },
  sectionTitle: { ...FONTS.h4, color: COLORS.primary, fontSize: 16, marginBottom: 10 },
  p: { ...FONTS.body, color: COLORS.textPrimary, lineHeight: 21 },
  bulletRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary, marginTop: 8 },
  bulletText: { flex: 1, ...FONTS.body, color: COLORS.textPrimary, lineHeight: 21 },
  footer: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 28, fontSize: 12 },
});
