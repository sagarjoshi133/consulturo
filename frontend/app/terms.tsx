import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS } from '../src/theme';

export default function TermsScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/' as any); }}
              style={styles.backBtn}
              testID="terms-back"
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.heroTitle}>Terms of Use</Text>
            <View style={{ width: 40 }} />
          </View>
          <Text style={styles.heroSub}>Last updated: 22 April 2026</Text>
        </SafeAreaView>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Welcome to the ConsultUro mobile application operated by Dr. Sagar Joshi (“we”, “us”). These Terms of Use (the “Terms”) govern your access to and use of the App and related services. By accessing or using the App, you agree to be bound by these Terms. Please read them carefully.
        </Text>

        <Section title="1. Eligibility">
          <Bullet>You must be at least 18 years old, or a legal guardian acting for a minor, to use this App.</Bullet>
          <Bullet>You agree to provide accurate, current, and complete information and to keep it up to date.</Bullet>
        </Section>

        <Section title="2. Medical Disclaimer">
          <Bullet>The information, tools, calculators and educational content in the App are for general information and patient education only. They are NOT a substitute for professional medical advice, diagnosis or treatment.</Bullet>
          <Bullet>Always seek the advice of your qualified healthcare provider for any questions you may have regarding a medical condition.</Bullet>
          <Bullet>Never disregard professional medical advice or delay in seeking it because of something you have read or entered in the App.</Bullet>
          <Bullet>In emergencies, call your local emergency number or visit the nearest hospital immediately — do NOT rely on the App.</Bullet>
        </Section>

        <Section title="3. Consultation & Appointments">
          <Bullet>Booking an appointment through the App is a request that becomes confirmed only once the clinic explicitly accepts it. We may reschedule or reject requests based on availability and clinical judgement.</Bullet>
          <Bullet>Cancellation, no-show and fee policies of the clinic apply to all confirmed appointments.</Bullet>
          <Bullet>Prescriptions issued through the App are valid only when generated and digitally signed by the treating physician.</Bullet>
        </Section>

        <Section title="4. Your Account">
          <Bullet>You are responsible for maintaining the confidentiality of your Google account credentials and for all activities under your account.</Bullet>
          <Bullet>You agree to notify us immediately of any unauthorised use.</Bullet>
          <Bullet>We reserve the right to suspend or terminate accounts that violate these Terms or applicable law.</Bullet>
        </Section>

        <Section title="5. Acceptable Use">
          <Text style={styles.p}>You agree NOT to:</Text>
          <Bullet>Use the App for any unlawful, harmful, or fraudulent purpose.</Bullet>
          <Bullet>Attempt to access, interfere with, or disrupt the App, its servers, or networks.</Bullet>
          <Bullet>Upload viruses, malware, or any other malicious code.</Bullet>
          <Bullet>Impersonate another person or misrepresent your affiliation.</Bullet>
          <Bullet>Scrape, copy, or resell the content of the App without prior written consent.</Bullet>
        </Section>

        <Section title="6. Intellectual Property">
          <Text style={styles.p}>
            All text, graphics, logos, images, calculators, educational articles and software (the “Content”) are owned by or licensed to Dr. Sagar Joshi and are protected by copyright and trademark laws. You may not use the Content for any commercial purpose without written permission.
          </Text>
        </Section>

        <Section title="7. Third-Party Services">
          <Text style={styles.p}>
            The App may link to third-party services (e.g. Google authentication, WhatsApp, YouTube). We are not responsible for the content, policies or practices of these third parties.
          </Text>
        </Section>

        <Section title="8. Limitation of Liability">
          <Text style={styles.p}>
            To the maximum extent permitted by law, in no event will Dr. Sagar Joshi or his clinic be liable for any indirect, incidental, consequential, special or punitive damages arising out of or in connection with your use of the App.
          </Text>
        </Section>

        <Section title="9. Changes to the Terms">
          <Text style={styles.p}>
            We may update these Terms from time to time. Material changes will be notified in-app. Your continued use of the App after changes constitutes acceptance of the updated Terms.
          </Text>
        </Section>

        <Section title="10. Governing Law">
          <Text style={styles.p}>
            These Terms are governed by and construed in accordance with the laws of the State of Gujarat, India, without regard to its conflict-of-law principles. Courts in Vadodara, Gujarat shall have exclusive jurisdiction over any disputes.
          </Text>
        </Section>

        <Section title="11. Contact">
          <Text style={styles.p}>
            Questions about these Terms? Email us at <B>drsagarjoshi133@gmail.com</B> or call <B>+91 81550 75669</B>.
          </Text>
        </Section>

        <Text style={styles.footer}>© 2026 Dr. Sagar Joshi. All rights reserved.</Text>
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
