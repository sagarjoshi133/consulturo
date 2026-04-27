import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { format } from 'date-fns';
import api from '../src/api';
import { useAuth } from '../src/auth';
import { COLORS, FONTS, RADIUS } from '../src/theme';
import { PrimaryButton, SecondaryButton } from '../src/components';
import { useI18n } from '../src/i18n';
import { displayDate, displayDateLong, displayDateTime, display12h } from '../src/date';

export default function MyRecords() {
  const router = useRouter();
  const { user, refresh } = useAuth() as any;
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [tab, setTab] = useState<'overview' | 'appointments' | 'prescriptions' | 'surgeries' | 'scores'>('overview');
  const [phoneEdit, setPhoneEdit] = useState(false);
  const [phone, setPhone] = useState(user?.phone || '');
  const [savingPhone, setSavingPhone] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await api.get('/records/me');
      setData(data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Safe back: when the user opened My Records via a deep link (e.g.
  // notification or QR code) there's no navigation history, so
  // router.back() silently does nothing. Fall back to the home tab.
  // IMPORTANT: declared at the top level of the component (never after a
  // conditional early-return) to keep hook-order stable across renders.
  const goBack = useCallback(() => {
    try {
      if ((router as any).canGoBack && (router as any).canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    }
  }, [router]);

  const savePhone = async () => {
    setSavingPhone(true);
    try {
      await api.patch('/auth/me', { phone });
      setPhoneEdit(false);
      if (refresh) await refresh();
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Could not save phone';
      Platform.OS === 'web'
        ? typeof window !== 'undefined' && window.alert(msg)
        : Alert.alert('Error', msg);
    } finally {
      setSavingPhone(false);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <TopBar router={router} />
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyInline
            icon="lock-closed-outline"
            title={t('records.signInTitle')}
            text={t('records.signInSub')}
            ctaLabel={t('common.signIn')}
            onCta={() => router.push('/(tabs)/more')}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }}>
        <TopBar router={router} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const summary = data?.summary || { appointments: 0, prescriptions: 0, surgeries: 0, ipss_entries: 0 };
  const appointments: any[] = data?.appointments || [];
  const prescriptions: any[] = data?.prescriptions || [];
  const surgeries: any[] = data?.surgeries || [];
  const ipss: any[] = data?.ipss_history || [];
  const conditions: any[] = data?.urology_conditions || [];
  const prostateReadings: any[] = data?.prostate_readings || [];
  const latestProstate = prostateReadings[0] || null;
  const toolLatest: Record<string, any> = data?.tool_scores_latest || {};
  const hasPhone = !!(user?.phone || phone);

  /**
   * Unified "My Vitals" tile set — drives the grid on the Overview tab.
   * Each vital reads from one of several data sources (dedicated
   * collection OR tool_scores[tool_id]) and renders as a compact pressable
   * card. Add a new vital by appending one row to this list; no styling
   * changes needed.
   */
  const vitals = [
    {
      key: 'prostate',
      label: 'Prostate volume',
      icon: 'human-male' as const,
      iconLib: 'mci' as const,
      value: latestProstate ? `${latestProstate.volume_ml?.toFixed?.(1) ?? latestProstate.volume_ml}` : null,
      unit: 'mL',
      hint: latestProstate
        ? `${latestProstate.source || 'USG'} · ${latestProstate.measured_on ? format(new Date(latestProstate.measured_on), 'dd-MM-yyyy') : '—'}`
        : 'Log your first reading',
      href: '/prostate-volume',
    },
    {
      key: 'ipss',
      label: 'IPSS',
      icon: 'pulse' as const,
      iconLib: 'ion' as const,
      value: toolLatest.ipss?.score != null ? String(toolLatest.ipss.score) : (ipss[0]?.total_score != null ? String(ipss[0].total_score) : null),
      unit: '/35',
      hint: toolLatest.ipss?.label || (ipss[0] ? (ipss[0].severity || 'Latest score') : 'Symptom score'),
      href: '/(tabs)/tools',
    },
    {
      key: 'psa',
      label: 'PSA',
      icon: 'water' as const,
      iconLib: 'ion' as const,
      value: toolLatest.psa?.score != null ? String(toolLatest.psa.score) : null,
      unit: 'ng/mL',
      hint: toolLatest.psa?.label || 'Prostate screen',
      href: '/(tabs)/tools',
    },
    {
      key: 'iief5',
      label: 'IIEF-5',
      icon: 'heart' as const,
      iconLib: 'ion' as const,
      value: toolLatest.iief5?.score != null ? String(toolLatest.iief5.score) : null,
      unit: '/25',
      hint: toolLatest.iief5?.label || 'Erectile function',
      href: '/(tabs)/tools',
    },
    {
      key: 'egfr',
      label: 'eGFR',
      icon: 'speedometer' as const,
      iconLib: 'ion' as const,
      value: toolLatest.egfr?.score != null ? String(Math.round(toolLatest.egfr.score)) : null,
      unit: 'mL/min',
      hint: toolLatest.egfr?.label || 'Kidney function',
      href: '/(tabs)/tools',
    },
    {
      key: 'bmi',
      label: 'BMI',
      icon: 'body' as const,
      iconLib: 'ion' as const,
      value: toolLatest.bmi?.score != null ? String(toolLatest.bmi.score.toFixed ? toolLatest.bmi.score.toFixed(1) : toolLatest.bmi.score) : null,
      unit: 'kg/m²',
      hint: toolLatest.bmi?.label || 'Body mass index',
      href: '/(tabs)/tools',
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <LinearGradient colors={COLORS.heroGradient} style={styles.hero}>
        <SafeAreaView edges={['top']}>
          <View style={styles.topRow}>
            <TouchableOpacity onPress={goBack} style={styles.backBtn} testID="records-back">
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>My Records</Text>
            <View style={{ width: 40 }} />
          </View>
          <Text style={styles.heroName}>{user.name}</Text>
          <Text style={styles.heroSub}>
            Your consolidated urology history with Dr. Sagar Joshi
          </Text>
        </SafeAreaView>
      </LinearGradient>

      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {[
            { id: 'overview', label: 'Overview', icon: 'stats-chart' as const },
            { id: 'appointments', label: `Visits (${summary.appointments})`, icon: 'calendar' as const },
            { id: 'prescriptions', label: `Rx (${summary.prescriptions})`, icon: 'document-text' as const },
            { id: 'surgeries', label: `Surgeries (${summary.surgeries})`, icon: 'medkit' as const },
            { id: 'scores', label: `Scores (${summary.ipss_entries})`, icon: 'pulse' as const },
          ].map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => setTab(t.id as any)}
              style={[styles.tabBtn, tab === t.id && styles.tabBtnActive]}
              testID={`records-tab-${t.id}`}
            >
              <Ionicons name={t.icon} size={14} color={tab === t.id ? '#fff' : COLORS.primary} />
              <Text style={[styles.tabText, tab === t.id && { color: '#fff' }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        >
          {/* Phone link banner */}
          {!hasPhone && (
            <View style={styles.phoneBanner}>
              <Ionicons name="information-circle" size={20} color={COLORS.warning} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.phoneTitle}>Link your phone number</Text>
                <Text style={styles.phoneSub}>
                  Prescriptions & surgeries created offline will auto-link to your account when your phone matches.
                </Text>
              </View>
            </View>
          )}

          {phoneEdit ? (
            <View style={styles.phoneEditCard}>
              <Text style={styles.fieldLabel}>Your phone number</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 91234 56789"
                placeholderTextColor={COLORS.textDisabled}
                keyboardType="phone-pad"
                style={styles.input}
                testID="records-phone-input"
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <PrimaryButton
                  title={savingPhone ? 'Saving…' : 'Save Phone'}
                  onPress={savePhone}
                  disabled={savingPhone}
                  style={{ flex: 1 }}
                  testID="records-phone-save"
                />
                <SecondaryButton
                  title="Cancel"
                  onPress={() => {
                    setPhoneEdit(false);
                    setPhone(user?.phone || '');
                  }}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.phoneRow}
              onPress={() => {
                setPhone(user?.phone || '');
                setPhoneEdit(true);
              }}
              testID="records-phone-edit"
            >
              <Ionicons name="call" size={16} color={COLORS.primary} />
              <Text style={styles.phoneRowText}>
                {hasPhone ? `Linked phone: ${user.phone || phone}` : 'Add my phone number'}
              </Text>
              <Ionicons name="create-outline" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}

          {tab === 'overview' && (
            <>
              <View style={styles.summaryGrid}>
                <StatCard label="Appointments" value={summary.appointments} icon="calendar" color={COLORS.primary} />
                <StatCard label="Prescriptions" value={summary.prescriptions} icon="document-text" color={COLORS.primaryDark} />
                <StatCard label="Surgeries" value={summary.surgeries} icon="medkit" color={COLORS.accent} />
                <StatCard label="Score Entries" value={summary.ipss_entries} icon="pulse" color={COLORS.success} />
              </View>

              {/* Health timeline shortcut */}
              <TouchableOpacity
                onPress={() => router.push('/timeline')}
                activeOpacity={0.85}
                style={styles.timelineCta}
                testID="records-timeline-cta"
              >
                <View style={styles.timelineIcon}>
                  <Ionicons name="git-commit" size={22} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineTitle}>Health Timeline</Text>
                  <Text style={styles.timelineSub}>
                    Every visit, prescription and score in one chronological story.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#fff" />
              </TouchableOpacity>

              {conditions.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Urology Conditions</Text>
                  <View style={styles.chipsWrap}>
                    {conditions.map((c, idx) => (
                      <View key={idx} style={styles.conditionChip}>
                        <MaterialCommunityIcons name="stethoscope" size={14} color={COLORS.primaryDark} />
                        <Text style={styles.conditionText}>{c.diagnosis}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* My Vitals — unified grid of latest calculator / reading data */}
              <View style={styles.vitalsHead}>
                <Text style={styles.sectionTitle}>My Vitals</Text>
                <Text style={styles.vitalsHeadHint}>Latest saved values</Text>
              </View>
              <View style={styles.vitalsGrid}>
                {vitals.map((v) => {
                  const hasValue = v.value != null && v.value !== '';
                  const IconComp = v.iconLib === 'mci' ? MaterialCommunityIcons : Ionicons;
                  return (
                    <TouchableOpacity
                      key={v.key}
                      onPress={() => router.push(v.href as any)}
                      activeOpacity={0.85}
                      style={[styles.vitalTile, !hasValue && styles.vitalTileEmpty]}
                      testID={`vital-${v.key}`}
                    >
                      <View style={styles.vitalTileHead}>
                        <View style={[styles.vitalTileIcon, hasValue && styles.vitalTileIconActive]}>
                          <IconComp
                            name={v.icon as any}
                            size={15}
                            color={hasValue ? COLORS.primary : COLORS.textSecondary}
                          />
                        </View>
                        <Text style={styles.vitalTileLabel} numberOfLines={1}>{v.label}</Text>
                      </View>
                      {hasValue ? (
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 2 }}>
                          <Text style={styles.vitalTileValue}>{v.value}</Text>
                          <Text style={styles.vitalTileUnit}> {v.unit}</Text>
                        </View>
                      ) : (
                        <Text style={styles.vitalTileNoValue}>— —</Text>
                      )}
                      <Text style={styles.vitalTileHint} numberOfLines={1}>
                        {v.hint}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.sectionTitle}>Recent Activity</Text>
              {[...appointments.slice(0, 3).map((a) => ({ ...a, _kind: 'visit' as const })),
                ...prescriptions.slice(0, 3).map((p) => ({ ...p, _kind: 'rx' as const })),
                ...surgeries.slice(0, 3).map((s) => ({ ...s, _kind: 'surgery' as const })),
              ]
                .sort((a: any, b: any) => {
                  const da = a.booking_date || a.visit_date || a.date || a.created_at;
                  const db = b.booking_date || b.visit_date || b.date || b.created_at;
                  return (db || '').toString().localeCompare((da || '').toString());
                })
                .slice(0, 6)
                .map((item: any, i) => (
                  <ActivityRow key={i} item={item} router={router} />
                ))}

              {appointments.length + prescriptions.length + surgeries.length === 0 && (
                <EmptyInline
                  icon="sparkles-outline"
                  title="You're all set"
                  text={t('records.emptyRecords')}
                  ctaLabel={t('records.bookFirstVisit')}
                  onCta={() => router.push('/(tabs)/book')}
                />
              )}
            </>
          )}

          {tab === 'appointments' && (
            <>
              {appointments.length === 0 ? (
                <EmptyInline
                  icon="calendar-outline"
                  title={t('records.emptyApptsTitle')}
                  text={t('records.emptyApptsSub')}
                  ctaLabel={t('records.bookFirstVisit')}
                  onCta={() => router.push('/(tabs)/book')}
                />
              ) : (
                appointments.map((b) => (
                  <TouchableOpacity
                    key={b.booking_id}
                    onPress={() => router.push(`/bookings/${b.booking_id}` as any)}
                    activeOpacity={0.8}
                    testID={`records-appt-${b.booking_id}`}
                  >
                    <AppointmentCard b={b} />
                  </TouchableOpacity>
                ))
              )}
            </>
          )}

          {tab === 'prescriptions' && (
            <>
              {prescriptions.length === 0 ? (
                <EmptyInline
                  icon="document-text-outline"
                  title={t('records.emptyRxTitle')}
                  text={t('records.emptyRxSub')}
                />
              ) : (
                prescriptions.map((rx) => (
                  <TouchableOpacity
                    key={rx.prescription_id}
                    onPress={() => router.push(`/prescriptions/${rx.prescription_id}` as any)}
                    activeOpacity={0.8}
                    testID={`records-rx-${rx.prescription_id}`}
                  >
                    <PrescriptionCard rx={rx} />
                  </TouchableOpacity>
                ))
              )}
            </>
          )}

          {tab === 'surgeries' && (
            <>
              {surgeries.length === 0 ? (
                <EmptyInline
                  icon="medkit-outline"
                  title={t('records.emptySxTitle')}
                  text={t('records.emptySxSub')}
                />
              ) : (
                surgeries.map((s) => <SurgeryCard key={s.surgery_id} s={s} />)
              )}
            </>
          )}

          {tab === 'scores' && (
            <>
              {ipss.length === 0 ? (
                <EmptyInline
                  icon="calculator-outline"
                  title={t('records.emptyScoresTitle')}
                  text={t('records.emptyScoresSub')}
                  ctaLabel="Open Tools"
                  onCta={() => router.push('/(tabs)/tools' as any)}
                />
              ) : (
                ipss.map((s) => (
                  <TouchableOpacity
                    key={s.record_id || s._id || s.created_at}
                    onPress={() => router.push('/(tabs)/tools' as any)}
                    activeOpacity={0.8}
                  >
                    <ScoreCard s={s} />
                  </TouchableOpacity>
                ))
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function TopBar({ router }: any) {
  // Same safe-back fallback for the signed-out state.
  const goBackTop = () => {
    try {
      if ((router as any).canGoBack && (router as any).canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    }
  };
  return (
    <View style={styles.plainTop}>
      <TouchableOpacity onPress={goBackTop} style={styles.backBtnPlain} testID="records-back">
        <Ionicons name="arrow-back" size={22} color={COLORS.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.plainTitle}>My Records</Text>
    </View>
  );
}

function StatCard({ label, value, icon, color }: any) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.statVal, { color }]}>{value}</Text>
      <Text style={styles.statLbl}>{label}</Text>
    </View>
  );
}

function AppointmentCard({ b }: { b: any }) {
  const statusColor =
    b.status === 'requested' ? COLORS.warning :
    b.status === 'confirmed' ? COLORS.success :
    b.status === 'completed' ? COLORS.primaryDark :
    COLORS.accent;
  const dateStr = b.booking_date ? displayDateLong(b.booking_date) : '';
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{dateStr}</Text>
          <Text style={styles.cardMeta}>{b.booking_time ? display12h(b.booking_time) : ''} · {b.mode === 'online' ? 'Online (WhatsApp)' : 'In-person'}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{b.status}</Text>
        </View>
      </View>
      {b.reason ? <Text style={styles.cardBody}>{b.reason}</Text> : null}
    </View>
  );
}

function PrescriptionCard({ rx }: { rx: any }) {
  const dateStr = rx.visit_date ? displayDate(rx.visit_date) : (rx.created_at ? displayDate(rx.created_at) : '');
  const medCount = (rx.medicines || []).length;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{rx.diagnosis || 'Prescription'}</Text>
          <Text style={styles.cardMeta}>{dateStr}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: COLORS.primary + '18' }]}>
          <Ionicons name="document-text" size={12} color={COLORS.primary} />
        </View>
      </View>
      {rx.chief_complaints ? <Text style={styles.cardBody}>{rx.chief_complaints}</Text> : null}
      <Text style={styles.cardFootMeta}>
        {medCount} medicine{medCount === 1 ? '' : 's'}{rx.advice ? ` · advice noted` : ''}
      </Text>
    </View>
  );
}

function SurgeryCard({ s }: { s: any }) {
  const dateStr = s.date ? displayDate(s.date) : (s.created_at ? displayDate(s.created_at) : '');
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{s.surgery_name}</Text>
          <Text style={styles.cardMeta}>{dateStr}{s.hospital ? ` · ${s.hospital}` : ''}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: COLORS.accent + '18' }]}>
          <Ionicons name="medkit" size={12} color={COLORS.accent} />
        </View>
      </View>
      {s.notes ? <Text style={styles.cardBody}>{s.notes}</Text> : null}
    </View>
  );
}

function ScoreCard({ s }: { s: any }) {
  const dateStr = s.created_at ? displayDateTime(s.created_at) : '';
  const score = s.total_score ?? s.score ?? 0;
  const severity =
    score <= 7 ? { label: 'Mild', color: COLORS.success } :
    score <= 19 ? { label: 'Moderate', color: COLORS.warning } :
    { label: 'Severe', color: COLORS.accent };
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>IPSS Score · {score}/35</Text>
          <Text style={styles.cardMeta}>
            {dateStr}{s.qol_score != null ? ` · QoL ${s.qol_score}/6` : ''}
          </Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: severity.color + '22' }]}>
          <Text style={[styles.statusText, { color: severity.color }]}>{severity.label}</Text>
        </View>
      </View>
    </View>
  );
}

function ActivityRow({ item, router }: { item: any; router: any }) {
  // All activity items are pressable and deep-link to the relevant detail
  // screen. If a row has no matching detail (e.g. a surgery without a
  // dedicated patient-visible page), we simply render a plain card.
  if (item._kind === 'visit') {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push(`/bookings/${item.booking_id}` as any)}
        testID={`records-activity-visit-${item.booking_id}`}
      >
        <AppointmentCard b={item} />
      </TouchableOpacity>
    );
  }
  if (item._kind === 'rx') {
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push(`/prescriptions/${item.prescription_id}` as any)}
        testID={`records-activity-rx-${item.prescription_id}`}
      >
        <PrescriptionCard rx={item} />
      </TouchableOpacity>
    );
  }
  if (item._kind === 'surgery') return <SurgeryCard s={item} />;
  return null;
}

function EmptyInline({
  text,
  title,
  icon = 'folder-open',
  ctaLabel,
  onCta,
}: {
  text: string;
  title?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 32 }}>
      <View style={{
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: COLORS.primary + '12',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 10,
      }}>
        <Ionicons name={icon} size={32} color={COLORS.primary} />
      </View>
      {title ? (
        <Text style={{ ...FONTS.h4, color: COLORS.textPrimary, textAlign: 'center', marginBottom: 4 }}>
          {title}
        </Text>
      ) : null}
      <Text style={{
        ...FONTS.body,
        color: COLORS.textSecondary,
        textAlign: 'center',
        marginTop: title ? 0 : 4,
        paddingHorizontal: 24,
        lineHeight: 20,
      }}>
        {text}
      </Text>
      {ctaLabel && onCta ? (
        <TouchableOpacity
          onPress={onCta}
          activeOpacity={0.85}
          style={{
            marginTop: 16,
            backgroundColor: COLORS.primary,
            paddingHorizontal: 22,
            paddingVertical: 11,
            borderRadius: RADIUS.pill,
          }}
          testID="records-empty-cta"
        >
          <Text style={{ color: '#fff', ...FONTS.bodyMedium, fontSize: 14 }}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: 16, paddingBottom: 26, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...FONTS.h4, color: '#fff' },
  heroName: { ...FONTS.h3, color: '#fff', marginTop: 14 },
  heroSub: { ...FONTS.body, color: '#E0F7FA', marginTop: 4, fontSize: 12 },

  plainTop: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  backBtnPlain: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  plainTitle: { ...FONTS.h3, color: COLORS.textPrimary },

  tabBar: { marginTop: -16, paddingVertical: 6 },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: '#fff', borderWidth: 1, borderColor: COLORS.border, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: '#fff', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  phoneRowText: { ...FONTS.body, color: COLORS.textPrimary, flex: 1, fontSize: 13 },
  phoneBanner: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, backgroundColor: COLORS.warning + '15', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.warning + '44', marginBottom: 10 },
  phoneTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  phoneSub: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  phoneEditCard: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  input: { marginTop: 6, backgroundColor: COLORS.bg, padding: 12, borderRadius: RADIUS.md, ...FONTS.body, color: COLORS.textPrimary, borderWidth: 1, borderColor: COLORS.border },
  fieldLabel: { ...FONTS.label, color: COLORS.textSecondary },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flexBasis: '48%', flexGrow: 1, backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, borderLeftWidth: 3, borderWidth: 1, borderColor: COLORS.border },
  statVal: { ...FONTS.h2, fontSize: 24, marginTop: 6 },
  statLbl: { ...FONTS.label, color: COLORS.textSecondary, fontSize: 10 },

  sectionTitle: { ...FONTS.h4, color: COLORS.textPrimary, marginTop: 20, marginBottom: 10 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  conditionChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.primary + '14', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill },
  conditionText: { ...FONTS.bodyMedium, color: COLORS.primaryDark, fontSize: 12 },

  card: { backgroundColor: '#fff', padding: 14, borderRadius: RADIUS.md, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 15 },
  cardMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  cardBody: { ...FONTS.body, color: COLORS.textPrimary, marginTop: 8, fontSize: 13 },
  cardFootMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 6 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { ...FONTS.label, fontSize: 10, textTransform: 'uppercase' },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 14 },
  emptySub: { ...FONTS.body, color: COLORS.textSecondary, textAlign: 'center', marginTop: 6 },

  vitalCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 14,
    gap: 12,
    marginBottom: 8,
  },
  vitalIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.primary + '14',
  },
  vitalLabel: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14 },
  vitalMeta: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  vitalValue: { ...FONTS.h3, color: COLORS.primaryDark, fontSize: 18 },
  vitalUnit: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  vitalAddPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.primary + '14',
  },
  vitalAddText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },

  // New vitals grid
  vitalsHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, marginBottom: 10,
  },
  vitalsHeadHint: { ...FONTS.body, color: COLORS.textDisabled, fontSize: 11 },
  vitalsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 10,
  },
  vitalTile: {
    // Two per row: (100% - 10px gap) / 2 ≈ 48%; using flexBasis for resilience.
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    padding: 12,
    minHeight: 96,
  },
  vitalTileEmpty: {
    backgroundColor: '#FBFCFC',
    borderStyle: 'dashed',
  },
  vitalTileHead: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 6,
  },
  vitalTileIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.textSecondary + '14',
  },
  vitalTileIconActive: { backgroundColor: COLORS.primary + '1F' },
  vitalTileLabel: {
    ...FONTS.label, color: COLORS.textSecondary,
    fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase',
    flex: 1,
  },
  vitalTileValue: { ...FONTS.h2, color: COLORS.textPrimary, fontSize: 22, lineHeight: 26 },
  vitalTileUnit: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11 },
  vitalTileNoValue: {
    ...FONTS.h2, color: COLORS.textDisabled, fontSize: 22, lineHeight: 26,
  },
  vitalTileHint: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 11, marginTop: 4 },

  timelineCta: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginTop: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  timelineIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  timelineTitle: { ...FONTS.bodyMedium, color: '#fff', fontSize: 15 },
  timelineSub: { ...FONTS.body, color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2, lineHeight: 17 },
});
