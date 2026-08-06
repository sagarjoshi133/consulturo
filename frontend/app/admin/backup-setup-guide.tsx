/**
 * Google Drive Backup — In-app Setup Guide
 *
 * Renders the same 5-minute walkthrough that lives at
 * /app/scripts/GDRIVE_OAUTH_GUIDE.md but inside the app so clinic
 * owners on the road can follow along without copy-pasting a server
 * file path that doesn't exist on their device.
 *
 * Linked from:
 *   • Dashboard → Backups card → "Setup guide" pill
 *   • <GoogleDriveWizard /> help popover → "Open full guide"
 *
 * Pure-presentational, no API calls — safe to render on any
 * platform (web preview & native). Uses `Linking` for the two
 * external hops (Google Cloud Console) so the user can deep-link
 * in one tap.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Linking,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, FONTS, RADIUS } from '../../src/theme';
import { useToast } from '../../src/toast';
import { useSafeBack } from '../../src/use-safe-back';

type StepProps = {
  index: number;
  title: string;
  children: React.ReactNode;
};

type TipProps = {
  kind?: 'tip' | 'warn' | 'info';
  children: React.ReactNode;
};

const REDIRECT_URI_HINT =
  'https://<your-backend-url>/api/admin/backup/mirror/oauth/callback';

const CONSOLE_URL = 'https://console.cloud.google.com/';
const CONSENT_URL = 'https://console.cloud.google.com/apis/credentials/consent';
const CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';
const DRIVE_API_URL =
  'https://console.cloud.google.com/apis/library/drive.googleapis.com';

export default function BackupSetupGuide() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const safeBack = useSafeBack('/admin' as any);

  const [expanded, setExpanded] = useState<Record<number, boolean>>({
    1: true, 2: true, 3: true, 4: true, 5: true, 6: true,
  });
  const toggle = (n: number) => setExpanded((m) => ({ ...m, [n]: !m[n] }));

  const open = useCallback(async (url: string, label?: string) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) throw new Error('cannot-open');
      await Linking.openURL(url);
    } catch {
      toast.error(label ? `Could not open ${label}` : 'Could not open link');
    }
  }, [toast]);

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Copy failed');
    }
  }, [toast]);

  const shareGuide = useCallback(async () => {
    try {
      const url = Platform.OS === 'web' ? window.location.href : 'https://consulturo.app/admin/backup-setup-guide';
      await Share.share({
        title: 'ConsultUro — Drive Backup Setup',
        message:
          `Drive backup setup guide for ConsultUro:\n${url}\n\nFollow the 6 steps to enable daily auto-backup to your clinic Google Drive.`,
      });
    } catch { /* user cancelled */ }
  }, []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={safeBack} style={styles.iconBtn} testID="guide-back">
          <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Drive Backup — Setup Guide</Text>
        <TouchableOpacity onPress={shareGuide} style={styles.iconBtn} testID="guide-share">
          <Ionicons name="share-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.heroCard}>
          <View style={styles.heroBadge}>
            <Ionicons name="cloud-upload" size={26} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Google Drive Backup</Text>
          <Text style={styles.heroSub}>
            One-time setup, ~5 minutes. After this, ConsultUro pushes an
            encrypted MongoDB snapshot to your clinic Drive every night.
            Free tier is plenty — uses ~5–20 MB/day.
          </Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}><Ionicons name="time" size={12} color={COLORS.primary} /><Text style={styles.chipText}> 5 minutes</Text></View>
            <View style={styles.chip}><Ionicons name="lock-closed" size={12} color={COLORS.primary} /><Text style={styles.chipText}> No card needed</Text></View>
            <View style={styles.chip}><Ionicons name="repeat" size={12} color={COLORS.primary} /><Text style={styles.chipText}> Daily auto</Text></View>
          </View>
        </View>

        <Tip kind="info">
          Sign in to Google Cloud Console with the <Text style={styles.b}>clinic-owned Google account</Text>
          {' '}— not a personal Gmail. This makes handovers easier when a new
          owner takes over.
        </Tip>

        <Step index={1} title="Create / pick a Google Cloud project" expanded={!!expanded[1]} onToggle={() => toggle(1)}>
          <Bullet>Open the Google Cloud Console and sign in with the clinic-owned Google account.</Bullet>
          <Bullet>Top-bar dropdown → <Text style={styles.b}>New Project</Text>.</Bullet>
          <Bullet>Project name: <Text style={styles.code}>ConsultUro Backups</Text>. Location: <Text style={styles.b}>No organization</Text> (or your Workspace if any).</Bullet>
          <Bullet>Tap <Text style={styles.b}>Create</Text>, wait ~10 seconds, then make sure the new project is selected in the top bar.</Bullet>
          <LinkBtn onPress={() => open(CONSOLE_URL, 'Google Cloud Console')} icon="open-outline" label="Open Cloud Console" />
        </Step>

        <Step index={2} title="Enable the Drive API" expanded={!!expanded[2]} onToggle={() => toggle(2)}>
          <Bullet>Side-nav → <Text style={styles.b}>APIs &amp; Services → Library</Text>.</Bullet>
          <Bullet>Search box: type <Text style={styles.code}>Google Drive API</Text>.</Bullet>
          <Bullet>Tap the result → <Text style={styles.b}>Enable</Text>. Wait for the green "API Enabled" chip (~5 seconds).</Bullet>
          <LinkBtn onPress={() => open(DRIVE_API_URL, 'Drive API page')} icon="open-outline" label="Open Drive API page" />
        </Step>

        <Step index={3} title="Configure the OAuth consent screen" expanded={!!expanded[3]} onToggle={() => toggle(3)}>
          <Bullet>Side-nav → <Text style={styles.b}>APIs &amp; Services → OAuth consent screen</Text>.</Bullet>
          <Bullet>Choose <Text style={styles.b}>External</Text> → <Text style={styles.b}>Create</Text>.</Bullet>
          <Bullet>App information — App name: <Text style={styles.code}>ConsultUro</Text>. Support email: clinic Gmail. Logo: optional.</Bullet>
          <Bullet>Developer contact: clinic Gmail. <Text style={styles.b}>Save and continue</Text>.</Bullet>
          <Bullet>Scopes — <Text style={styles.b}>Add or remove scopes</Text>, filter <Text style={styles.code}>drive</Text>, tick <Text style={styles.code}>.../auth/drive</Text> → <Text style={styles.b}>Update → Save and continue</Text>.</Bullet>
          <Bullet>Test users — add the email of every person who will authorise the backup (usually just the clinic owner) → <Text style={styles.b}>Save and continue</Text>.</Bullet>
          <Tip>
            The app stays in <Text style={styles.b}>Testing</Text> mode — that's fine. Test users
            can authorise without going through Google's verification. Verified
            status is only needed if you publish the app publicly (we don't).
          </Tip>
          <LinkBtn onPress={() => open(CONSENT_URL, 'OAuth consent screen')} icon="open-outline" label="Open OAuth consent screen" />
        </Step>

        <Step index={4} title="Create the OAuth Client" expanded={!!expanded[4]} onToggle={() => toggle(4)}>
          <Bullet>Side-nav → <Text style={styles.b}>APIs &amp; Services → Credentials</Text>.</Bullet>
          <Bullet>Top bar → <Text style={styles.b}>+ Create Credentials → OAuth client ID</Text>.</Bullet>
          <Bullet>Application type: <Text style={styles.code}>Web application</Text>.</Bullet>
          <Bullet>Name: <Text style={styles.code}>ConsultUro Backup Wizard</Text>.</Bullet>
          <Bullet>
            Authorized redirect URIs → <Text style={styles.b}>Add URI</Text> and paste the EXACT URL
            from the wizard. It looks like:
          </Bullet>
          <View style={styles.codeBox}>
            <Text style={styles.codeBoxText} selectable numberOfLines={2}>{REDIRECT_URI_HINT}</Text>
            <TouchableOpacity onPress={() => copyText(REDIRECT_URI_HINT, 'Example URI')} style={styles.copyChip} testID="guide-copy-uri">
              <Ionicons name="copy-outline" size={14} color={COLORS.primary} />
              <Text style={styles.copyChipText}>Copy</Text>
            </TouchableOpacity>
          </View>
          <Tip kind="warn">
            The URI must match <Text style={styles.b}>byte-for-byte</Text> — including <Text style={styles.code}>https://</Text> and the full path.
            Open the wizard, tap the copy icon next to the redirect URI box,
            and paste straight in.
          </Tip>
          <Bullet>Tap <Text style={styles.b}>Create</Text>.</Bullet>
          <LinkBtn onPress={() => open(CREDENTIALS_URL, 'Credentials page')} icon="open-outline" label="Open Credentials page" />
        </Step>

        <Step index={5} title="Copy Client ID + Secret into the wizard" expanded={!!expanded[5]} onToggle={() => toggle(5)}>
          <Bullet>Google shows a popup with two long strings — <Text style={styles.code}>Client ID</Text> (ends with <Text style={styles.code}>.apps.googleusercontent.com</Text>) and <Text style={styles.code}>Client secret</Text> (starts with <Text style={styles.code}>GOCSPX-</Text>).</Bullet>
          <Bullet>Tap <Text style={styles.b}>Download JSON</Text> for safekeeping (store in your password manager).</Bullet>
          <Bullet>Back in ConsultUro: <Text style={styles.b}>Dashboard → Backups → Set up Google Drive</Text>.</Bullet>
          <Bullet>Paste the Client ID and Client Secret. Tap <Text style={styles.b}>Save &amp; continue</Text>.</Bullet>
          <Bullet>Tap <Text style={styles.b}>Authorize Google Drive</Text> → sign in with the same clinic account → <Text style={styles.b}>Allow</Text>.</Bullet>
          <Bullet>You'll see a "✓ Google Drive connected" page. Return to ConsultUro — the Backups card now reads <Text style={styles.b}>Mirror: Active</Text>.</Bullet>
        </Step>

        <Step index={6} title="Verify the first backup" expanded={!!expanded[6]} onToggle={() => toggle(6)}>
          <Bullet>The next nightly run pushes a snapshot to <Text style={styles.code}>consulturo-backups/</Text> in your clinic Drive.</Bullet>
          <Bullet>On the Backups card, tap <Text style={styles.b}>Run mirror now</Text> to trigger an immediate test push.</Bullet>
          <Bullet>Open Drive → <Text style={styles.code}>consulturo-backups/</Text> → confirm a new <Text style={styles.code}>.tar.gz</Text> file landed there in the last minute.</Bullet>
          <Tip>
            Recommended retention: 30 daily + 12 monthly archives. ConsultUro
            keeps the last 30 in Drive automatically; older ones are pruned
            to save space.
          </Tip>
        </Step>

        <Section title="Troubleshooting">
          <Trouble q='Google: "redirect_uri_mismatch"'
            a="The URI in step 4 doesn't match what the wizard shows. Re-copy from the wizard and paste exactly. Order matters — http ≠ https." />
          <Trouble q='"This app is blocked"'
            a="You haven't added yourself as a test user. Re-do step 3 → Test users → Add yourself." />
          <Trouble q='"invalid_client" in browser'
            a="You typed the secret wrong, or it's reversed. Re-do step 5 — paste from the JSON file, not from memory." />
          <Trouble q="Token expires after 7 days"
            a="Normal for apps in Testing mode. Either re-authorise weekly, or publish the app (no verification needed if you only use it yourself — Google waives it for personal-use apps)." />
          <Trouble q={'Wizard says "client_id doesn\'t look like..."'}
            a="Your client ID must end with .apps.googleusercontent.com. If it doesn't, you created the wrong credential type — go back and pick Web application." />
          <Trouble q="Backup screen still red after Authorize"
            a="Check /api/admin/backup/mirror/info — configured should be true. If not, ping support — the rclone.conf write may have failed." />
        </Section>

        <Section title="Security checklist">
          <Bullet><Text style={styles.b}>☐</Text> Used the clinic-owned Google account, not a personal Gmail.</Bullet>
          <Bullet><Text style={styles.b}>☐</Text> Client Secret saved in the clinic password manager.</Bullet>
          <Bullet><Text style={styles.b}>☐</Text> Test users list includes only people authorised to manage backups.</Bullet>
          <Bullet><Text style={styles.b}>☐</Text> Quarterly: review OAuth Consent Screen → Permissions, revoke ex-staff.</Bullet>
          <Bullet><Text style={styles.b}>☐</Text> Annually: rotate the client secret (Credentials → Reset Secret), then re-run the wizard.</Bullet>
        </Section>

        <View style={{ height: 16 }} />
        <TouchableOpacity
          onPress={() => router.push('/dashboard?tab=backups' as any)}
          style={[styles.btn, styles.btnPrimary]}
          testID="guide-open-backups"
        >
          <Ionicons name="cloud-upload" size={16} color="#fff" />
          <Text style={styles.btnText}>  Open Backups now</Text>
        </TouchableOpacity>
        <View style={{ height: 8 }} />
        <TouchableOpacity
          onPress={() => open(CONSOLE_URL, 'Google Cloud Console')}
          style={[styles.btn, styles.btnGhost]}
          testID="guide-open-console"
        >
          <Ionicons name="open-outline" size={16} color={COLORS.primary} />
          <Text style={[styles.btnText, { color: COLORS.primary }]}>  Open Google Cloud Console</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Step({ index, title, expanded, onToggle, children }: StepProps & { expanded: boolean; onToggle: () => void }) {
  return (
    <View style={styles.stepCard}>
      <TouchableOpacity
        onPress={onToggle}
        style={styles.stepHead}
        accessibilityRole="button"
        accessibilityLabel={`Step ${index}: ${title}, ${expanded ? 'collapse' : 'expand'}`}
        testID={`guide-step-${index}-toggle`}
      >
        <View style={styles.stepNum}><Text style={styles.stepNumText}>{index}</Text></View>
        <Text style={styles.stepTitle} numberOfLines={2}>{title}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.textSecondary}
        />
      </TouchableOpacity>
      {expanded ? <View style={styles.stepBody}>{children}</View> : null}
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

function Tip({ kind = 'tip', children }: TipProps) {
  const palette = useMemo(() => {
    if (kind === 'warn') return { bg: '#FEF3C7', border: '#FBBF24', fg: '#92400E', icon: 'warning' as const };
    if (kind === 'info') return { bg: '#DBEAFE', border: '#60A5FA', fg: '#1E3A8A', icon: 'information-circle' as const };
    return { bg: '#ECFDF5', border: '#34D399', fg: '#065F46', icon: 'bulb' as const };
  }, [kind]);
  return (
    <View style={[styles.tipCard, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Ionicons name={palette.icon} size={16} color={palette.fg} style={{ marginTop: 1 }} />
      <Text style={[styles.tipText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

function LinkBtn({ onPress, icon, label }: { onPress: () => void; icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.linkBtn}>
      <Ionicons name={icon} size={14} color={COLORS.primary} />
      <Text style={styles.linkBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Trouble({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity onPress={() => setOpen(o => !o)} style={styles.troubleRow} activeOpacity={0.7}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={14}
          color={COLORS.textSecondary}
        />
        <Text style={styles.troubleQ}>{q}</Text>
      </View>
      {open ? <Text style={styles.troubleA}>{a}</Text> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#fff',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h2, color: COLORS.textPrimary, flex: 1, textAlign: 'center', fontSize: 17 },

  heroCard: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  heroBadge: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  heroTitle: { ...FONTS.h2, color: '#fff', marginBottom: 4, textAlign: 'center' },
  heroSub: { ...FONTS.body, color: '#E0F2F5', textAlign: 'center', fontSize: 13, lineHeight: 19 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, justifyContent: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  chipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  stepCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  stepHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  stepNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 13 },
  stepTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, flex: 1 },
  stepBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginVertical: 3 },
  bulletDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: COLORS.primary, marginTop: 7,
  },
  bulletText: { ...FONTS.body, fontSize: 13, color: COLORS.textPrimary, flex: 1, lineHeight: 19 },

  tipCard: {
    flexDirection: 'row', gap: 8,
    borderWidth: 1, borderRadius: RADIUS.md,
    padding: 10,
    marginTop: 8, marginBottom: 4,
  },
  tipText: { ...FONTS.body, fontSize: 12.5, flex: 1, lineHeight: 18 },

  codeBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: RADIUS.md, marginTop: 6, marginBottom: 6,
  },
  codeBoxText: { color: '#E2E8F0', fontSize: 12, flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  copyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#fff',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    marginLeft: 6,
  },
  copyChipText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 11 },

  linkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1, borderColor: COLORS.primary,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, marginTop: 8,
  },
  linkBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 10,
  },
  sectionTitle: {
    ...FONTS.bodyMedium,
    fontSize: 12,
    color: COLORS.primary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  troubleRow: { paddingVertical: 6 },
  troubleQ: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, flex: 1 },
  troubleA: {
    ...FONTS.body, fontSize: 12.5, color: COLORS.textSecondary,
    paddingLeft: 22, marginTop: 4, lineHeight: 18,
  },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    minHeight: 44,
  },
  btnPrimary: { backgroundColor: COLORS.primary },
  btnGhost: { backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.primary },
  btnText: { ...FONTS.bodyMedium, color: '#fff', fontSize: 14 },

  b: { fontWeight: '700', color: COLORS.textPrimary },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12.5,
    color: COLORS.primary,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});
