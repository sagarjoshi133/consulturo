import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Linking,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, RADIUS, DOCTOR_PHOTO_URL } from '../../src/theme';
import api from '../../src/api';
import { useAuth } from '../../src/auth';
import { useNotifications } from '../../src/notifications';
import { useI18n } from '../../src/i18n';
import { Skeleton } from '../../src/skeleton';
import { useResponsive } from '../../src/responsive';

const WHATSAPP = '+918155075669';

type Disease = { id: string; name: string; icon: string; tagline: string };
type Post = { id: string; title: string; excerpt?: string; cover?: string; category?: string; published_at?: string };
type Video = { id: string; title: string; youtube_id: string; thumbnail: string; category?: string; duration?: string };

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const isStaff = !!user && user.role !== 'patient';
  const { t, lang, setLang, tRaw } = useI18n();
  const { unread, personalUnread } = useNotifications();
  const { isWebDesktop } = useResponsive();
  const [diseases, setDiseases] = useState<Disease[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [homepage, setHomepage] = useState<{ doctor_photo_url: string; cover_photo_url: string; doctor_name?: string; tagline: string } | null>(null);
  // True until the first /diseases /blog /videos /homepage round-trip completes.
  // Drives the skeleton placeholders so the home doesn't look "blank" on cold start.
  const [firstLoad, setFirstLoad] = useState(true);

  // Cycle language on each tap: en → hi → gu → en
  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';

  const load = async () => {
    try {
      const [d, b, v, hp] = await Promise.all([
        api.get('/diseases'),
        api.get('/blog').catch(() => ({ data: [] })),
        api.get('/videos').catch(() => ({ data: [] })),
        api.get('/settings/homepage').catch(() => ({ data: null })),
      ]);
      setDiseases(d.data);
      setPosts((b.data || []).slice(0, 5));
      setVideos((v.data || []).slice(0, 5));
      if (hp.data) setHomepage(hp.data);
    } catch {} finally {
      setFirstLoad(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openWhatsApp = () => {
    const url = `whatsapp://send?phone=${WHATSAPP.replace('+', '')}&text=${encodeURIComponent(
      'Hello Dr. Sagar Joshi, I would like to consult with you.'
    )}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`https://wa.me/${WHATSAPP.replace('+', '')}`)
    );
  };

  const isClinical = !!user && ['primary_owner', 'partner', 'doctor', 'super_owner', 'owner'].includes((user.role as string) || '');
  const isSuperOwner = user?.role === 'super_owner';

  const quickActions = [
    { icon: 'calendar', label: t('home.quickActions.bookVisit'), key: 'bookvisit', route: '/(tabs)/book', color: COLORS.primary, family: 'ion' },
    // Clinical staff get a Consult shortcut here in place of WhatsApp
    // (they are the clinic — they don't need to "WhatsApp the clinic").
    isClinical
      ? { icon: 'medkit', label: 'Consult', key: 'consult', route: '/dashboard?tab=consultations', color: COLORS.success, family: 'ion' as const }
      : { icon: 'logo-whatsapp', label: t('home.quickActions.whatsapp'), key: 'whatsapp', action: openWhatsApp, color: COLORS.whatsapp, family: 'ion' as const },
    { icon: 'calculator-variant', label: t('home.quickActions.ipss'), key: 'ipss', route: '/ipss', color: COLORS.accent, family: 'mci' },
    { icon: 'school', family: 'mci', label: t('home.quickActions.education'), key: 'education', route: '/education', color: '#6D28D9' },
  ];

  // Translate disease names by slug — falls back to backend name if no
  // translation exists for that id.
  const conditionLabel = (d: Disease) => {
    const v = tRaw(`conditions.${d.id}`);
    return typeof v === 'string' && v ? v : d.name;
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Hero with customisable cover photo backdrop + doctor photo card */}
        <View style={styles.heroWrap}>
          {homepage?.cover_photo_url ? (
            <Image
              source={{ uri: homepage.cover_photo_url }}
              style={StyleSheet.absoluteFillObject}
              resizeMode="cover"
            />
          ) : null}
          <LinearGradient
            colors={['rgba(10,94,107,0.85)', 'rgba(14,124,139,0.82)', 'rgba(22,166,184,0.78)']}
            style={styles.hero}
          >
            <SafeAreaView edges={['top']}>
              <View style={styles.heroHeader}>
                <View>
                  <Text style={styles.greeting}>
                    {user ? `${t('home.namaste')}, ${user.name.split(' ')[0]}` : t('home.namaste')}
                  </Text>
                  <Text style={styles.brand}>ConsultUro</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {/* Desktop hero — premium actions in the empty right
                      side. STAFF see 3 shortcut pills (Bookings /
                      Consults / Prescription). Patients still get the
                      single "Book Consultation" pill. Mobile keeps
                      its original action cluster lower down. */}
                  {isWebDesktop && isSuperOwner && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {/* Super-owner desktop hero — platform-admin
                          shortcuts (Inbox / Notes / Reminders /
                          Analytics). Replaces the clinic-oriented
                          Bookings/Consult/Rx pills which are
                          irrelevant to a platform admin. */}
                      <TouchableOpacity
                        onPress={() => router.push('/inbox' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-inbox-super"
                      >
                        <Ionicons name="chatbubbles" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Inbox</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => router.push('/notes' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-notes-super"
                      >
                        <Ionicons name="create" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Notes</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => router.push('/reminders' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-reminders-super"
                      >
                        <Ionicons name="alarm" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Reminders</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => router.push('/admin/primary-owner-analytics' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-analytics-super"
                      >
                        <Ionicons name="analytics" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Analytics</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isWebDesktop && isStaff && !isSuperOwner && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => router.push('/dashboard?tab=bookings' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-bookings"
                      >
                        <Ionicons name="calendar-clear" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Bookings</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => router.push('/dashboard?tab=consultations' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-consults"
                      >
                        <Ionicons name="medkit" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Consult</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => router.push('/dashboard?tab=prescriptions' as any)}
                        style={styles.heroQuickBtn}
                        activeOpacity={0.85}
                        testID="home-hero-rx"
                      >
                        <Ionicons name="document-text" size={14} color="#0E7C8B" />
                        <Text style={styles.heroQuickText}>Prescription</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {isWebDesktop && !isStaff && (
                    <TouchableOpacity
                      onPress={() => router.push('/(tabs)/book')}
                      style={styles.heroBookBtn}
                      activeOpacity={0.85}
                      testID="home-hero-book"
                    >
                      <Ionicons name="calendar" size={16} color="#0E7C8B" />
                      <Text style={styles.heroBookText}>{t('home.bookConsultation')}</Text>
                      <View style={styles.heroBookArrow}>
                        <Ionicons name="arrow-forward" size={14} color="#fff" />
                      </View>
                    </TouchableOpacity>
                  )}
                  {/* On desktop web (sidebar + topbar provide these),
                      we hide the in-hero action cluster to remove
                      duplication and reclaim header space. The mobile
                      and mobile-web layouts continue to render exactly
                      as before. */}
                  {!isWebDesktop && (
                  <TouchableOpacity
                    onPress={cycleLang}
                    style={styles.langCircle}
                    testID="home-lang"
                    accessibilityLabel={`Language: ${lang}`}
                  >
                    <Text style={styles.langBadgeText} allowFontScaling={false}>
                      {langBadge}
                    </Text>
                  </TouchableOpacity>
                  )}
                  {!isWebDesktop && user ? (
                    <TouchableOpacity
                      onPress={() => router.push('/inbox' as any)}
                      style={styles.bellCircle}
                      testID="home-inbox"
                      accessibilityLabel="Personal messages"
                    >
                      <Ionicons name="chatbubbles" size={19} color="#fff" />
                      {personalUnread > 0 && (
                        <View style={styles.bellBadge}>
                          <Text style={styles.bellBadgeText}>
                            {personalUnread > 9 ? '9+' : String(personalUnread)}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : null}
                  {!isWebDesktop && user ? (
                    <TouchableOpacity
                      onPress={() => router.push('/notifications' as any)}
                      style={styles.bellCircle}
                      testID="home-bell"
                    >
                      <Ionicons name="notifications" size={20} color="#fff" />
                      {unread > 0 && (
                        <View style={styles.bellBadge}>
                          <Text style={styles.bellBadgeText}>
                            {unread > 9 ? '9+' : String(unread)}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : null}
                  {!isWebDesktop && (
                  <TouchableOpacity
                    onPress={() => router.push((user ? '/profile' : '/login') as any)}
                    style={styles.avatarCircle}
                    testID="home-profile-button"
                  >
                    {user?.picture ? (
                      <Image source={{ uri: user.picture }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                    ) : (
                      <Ionicons name={user ? 'person' : 'log-in-outline'} size={22} color="#fff" />
                    )}
                  </TouchableOpacity>
                  )}
                </View>
              </View>

              {isSuperOwner ? (
                /* Super-owner: swap the doctor card for ConsultUro
                   app-branding so the home page is purely platform-
                   admin oriented (no clinical / Dr. Sagar identity).
                   Uses the bundled official app icon so the logo
                   renders reliably without depending on a remote URL. */
                <View style={styles.doctorCard}>
                  <View style={styles.appLogoFrame}>
                    <Image
                      source={require('../../assets/icon.png')}
                      style={styles.appLogo}
                      resizeMode="contain"
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 14 }}>
                    <Text style={styles.doctorName}>ConsultUro</Text>
                    <Text style={styles.doctorSpec}>Trilingual urology &amp; clinic-management platform</Text>
                    <Text style={styles.doctorSubtitle}>
                      EN · हिं · ગુ · Bookings · Prescriptions · Surgeries · Backups
                    </Text>
                    <View style={styles.badgeRow}>
                      <View style={styles.badge}>
                        <Ionicons name="shield-checkmark" size={11} color={COLORS.primary} />
                        <Text style={styles.badgeText}>Platform Owner</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ) : (
              <View style={styles.doctorCard}>
                <Image
                  source={{ uri: homepage?.doctor_photo_url || DOCTOR_PHOTO_URL }}
                  style={styles.doctorPhoto}
                />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.doctorName}>{homepage?.doctor_name || 'Dr. Sagar Joshi'}</Text>
                  <Text style={styles.doctorSpec}>{t('home.consultantUrologist')}</Text>
                  <Text style={styles.doctorSubtitle}>
                    {lang === 'en' ? (homepage?.tagline || t('home.doctorTagline')) : t('home.doctorTagline')}
                  </Text>
                  <View style={styles.badgeRow}>
                    <View style={styles.badge}>
                      <Ionicons name="ribbon" size={11} color={COLORS.primary} />
                      <Text style={styles.badgeText}>MBBS · MS · DrNB</Text>
                    </View>
                  </View>
                </View>
              </View>
              )}
            </SafeAreaView>
          </LinearGradient>
        </View>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          {quickActions.map((qa) => (
            <TouchableOpacity
              key={qa.key}
              activeOpacity={0.85}
              onPress={() => {
                if (qa.action) qa.action();
                else router.push(qa.route as any);
              }}
              style={styles.quickItem}
              testID={`home-quick-${qa.key}`}
            >
              <View style={[styles.quickIcon, { backgroundColor: qa.color + '15' }]}>
                {qa.family === 'mci' ? (
                  <MaterialCommunityIcons name={qa.icon as any} size={22} color={qa.color} />
                ) : (
                  <Ionicons name={qa.icon as any} size={22} color={qa.color} />
                )}
              </View>
              <View style={styles.quickLabelWrap}>
                <Text style={styles.quickLabel} numberOfLines={2}>{qa.label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* CTA Card — mobile / mobile-web only. On desktop the same
            "Book Consultation" CTA lives in the hero header to fill
            the empty right side and avoid duplication. */}
        {!isWebDesktop && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push('/(tabs)/book')}
            style={{ marginHorizontal: 20, marginTop: 8 }}
            testID="home-book-consultation-card"
          >
          <LinearGradient
            colors={['#0E7C8B', '#16A6B8']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.ctaCard}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.ctaTitle}>{t('home.bookConsultation')}</Text>
              <Text style={styles.ctaSub}>{t('home.bookCtaSub')}</Text>
              <View style={styles.ctaBtn}>
                <Text style={styles.ctaBtnText}>{t('home.bookNow')}</Text>
                <Ionicons name="arrow-forward" size={16} color={COLORS.primary} />
              </View>
            </View>
            <MaterialCommunityIcons
              name="calendar-heart"
              size={64}
              color="rgba(255,255,255,0.25)"
              style={{ position: 'absolute', right: 8, bottom: 0 }}
            />
          </LinearGradient>
        </TouchableOpacity>
        )}

        {/* Section: Explore Conditions */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>{t('home.commonConditions')}</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/diseases')} testID="home-see-all-diseases">
              <Text style={styles.seeAll}>{t('home.seeAll')}</Text>
            </TouchableOpacity>
          </View>
          {isWebDesktop && diseases.length > 0 ? (
            // Desktop: render Common Conditions as a wrap grid (rather
            // than horizontal scroll). 6 pills typically fit on one
            // row at 1180 px content width.
            <View style={styles.gridRow}>
              {diseases.slice(0, 6).map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => router.push(`/disease/${d.id}` as any)}
                  style={[styles.diseasePill, styles.diseasePillDesktop]}
                  testID={`home-disease-${d.id}`}
                >
                  <View style={styles.diseasePillIcon}>
                    <MaterialCommunityIcons name={(d.icon as any) || 'medical-bag'} size={20} color={COLORS.accent} />
                  </View>
                  <Text style={styles.diseasePillText} numberOfLines={2}>{conditionLabel(d)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
              {firstLoad && diseases.length === 0
                ? Array.from({ length: 6 }).map((_, i) => (
                    <View key={i} style={[styles.diseasePill, { gap: 8 }]}>
                      <Skeleton w={36} h={36} br={12} />
                      <Skeleton w={70} h={12} />
                    </View>
                  ))
                : diseases.slice(0, 6).map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => router.push(`/disease/${d.id}` as any)}
                  style={styles.diseasePill}
                  testID={`home-disease-${d.id}`}
                >
                  <View style={styles.diseasePillIcon}>
                    <MaterialCommunityIcons name={(d.icon as any) || 'medical-bag'} size={20} color={COLORS.accent} />
                  </View>
                  <Text style={styles.diseasePillText} numberOfLines={2}>{conditionLabel(d)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Section: Latest Blogs */}
        {firstLoad && posts.length === 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('home.latestBlogs')}</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[styles.blogCard, { gap: 0, padding: 0 }]}>
                  <Skeleton w="100%" h={120} br={0} />
                  <View style={{ padding: 12, gap: 8 }}>
                    <Skeleton w={50} h={14} br={10} />
                    <Skeleton w="90%" h={14} />
                    <Skeleton w="70%" h={11} />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : posts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('home.latestBlogs')}</Text>
              <TouchableOpacity onPress={() => router.push('/blog')} testID="home-see-all-blogs">
                <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
              </TouchableOpacity>
            </View>
            {isWebDesktop ? (
              // Desktop: wrap cards into a 3-up grid so wide monitors
              // don't waste horizontal space on a single-row carousel.
              <View style={styles.gridRow}>
                {posts.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => router.push(`/blog/${p.id}` as any)}
                    activeOpacity={0.85}
                    style={[styles.blogCard, styles.blogCardDesktop]}
                    testID={`home-blog-${p.id}`}
                  >
                    {p.cover ? (
                      <Image source={{ uri: p.cover }} style={styles.blogCover} />
                    ) : (
                      <View style={[styles.blogCover, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="newspaper" size={32} color={COLORS.primary} />
                      </View>
                    )}
                    <View style={{ padding: 12 }}>
                      {p.category ? (
                        <View style={styles.blogCatPill}>
                          <Text style={styles.blogCatText}>{p.category}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.blogTitle} numberOfLines={2}>{p.title}</Text>
                      {p.excerpt ? (
                        <Text style={styles.blogExcerpt} numberOfLines={2}>{p.excerpt}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                snapToAlignment="start"
                decelerationRate="fast"
              >
                {posts.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    onPress={() => router.push(`/blog/${p.id}` as any)}
                    activeOpacity={0.85}
                    style={styles.blogCard}
                    testID={`home-blog-${p.id}`}
                  >
                    {p.cover ? (
                      <Image source={{ uri: p.cover }} style={styles.blogCover} />
                    ) : (
                      <View style={[styles.blogCover, { backgroundColor: COLORS.primary + '22', alignItems: 'center', justifyContent: 'center' }]}>
                        <Ionicons name="newspaper" size={32} color={COLORS.primary} />
                      </View>
                    )}
                    <View style={{ padding: 12 }}>
                      {p.category ? (
                        <View style={styles.blogCatPill}>
                          <Text style={styles.blogCatText}>{p.category}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.blogTitle} numberOfLines={2}>{p.title}</Text>
                      {p.excerpt ? (
                        <Text style={styles.blogExcerpt} numberOfLines={2}>{p.excerpt}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Section: Latest Videos */}
        {videos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>{t('home.latestVideos')}</Text>
              <TouchableOpacity onPress={() => router.push('/videos')} testID="home-see-all-videos">
                <Text style={styles.seeAll}>{t('common.seeAll')}</Text>
              </TouchableOpacity>
            </View>
            {isWebDesktop ? (
              // Desktop: 4-up grid for video thumbnails — wide
              // monitors fit several without horizontal scroll.
              <View style={styles.gridRow}>
                {videos.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${v.youtube_id}`)}
                    activeOpacity={0.85}
                    style={[styles.videoCard, styles.videoCardDesktop]}
                    testID={`home-video-${v.id}`}
                  >
                    <View style={{ position: 'relative' }}>
                      <Image source={{ uri: v.thumbnail }} style={styles.videoThumb} />
                      <View style={styles.videoPlay}>
                        <Ionicons name="play" size={18} color="#fff" />
                      </View>
                      {v.duration ? (
                        <View style={styles.videoDur}>
                          <Text style={styles.videoDurText}>{v.duration}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.videoTitle} numberOfLines={2}>{v.title}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
                snapToAlignment="start"
                decelerationRate="fast"
              >
                {videos.map((v) => (
                  <TouchableOpacity
                    key={v.id}
                    onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${v.youtube_id}`)}
                    activeOpacity={0.85}
                    style={styles.videoCard}
                    testID={`home-video-${v.id}`}
                  >
                    <View style={{ position: 'relative' }}>
                      <Image source={{ uri: v.thumbnail }} style={styles.videoThumb} />
                      <View style={styles.videoPlay}>
                        <Ionicons name="play" size={18} color="#fff" />
                      </View>
                      {v.duration ? (
                        <View style={styles.videoDur}>
                          <Text style={styles.videoDurText}>{v.duration}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.videoTitle} numberOfLines={2}>{v.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* Social Media */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { paddingHorizontal: 20, marginBottom: 12 }]}>{t('home.connectTitle')}</Text>
          <View style={styles.socialRow}>
            {[
              { icon: 'globe-outline' as const, color: '#0E7C8B', label: 'Website', url: 'https://www.drsagarjoshi.com' },
              { icon: 'logo-youtube' as const, color: '#FF0000', label: 'YouTube', url: 'https://www.youtube.com/@dr_sagar_j' },
              { icon: 'logo-facebook' as const, color: '#1877F2', label: 'Facebook', url: 'https://www.facebook.com/drsagarjoshi1' },
              { icon: 'logo-instagram' as const, color: '#E1306C', label: 'Instagram', url: 'https://www.instagram.com/sagar_joshi133' },
              { icon: 'logo-twitter' as const, color: '#000000', label: 'X', url: 'http://twitter.com/Sagar_j_joshi' },
            ].map((s) => (
              <TouchableOpacity
                key={s.label}
                style={styles.socialItem}
                onPress={() => Linking.openURL(s.url)}
                testID={`home-social-${s.label.toLowerCase()}`}
              >
                <View style={[styles.socialCircle, { backgroundColor: s.color + '15' }]}>
                  <Ionicons name={s.icon} size={22} color={s.color} />
                </View>
                <Text style={styles.socialLabel}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    backgroundColor: COLORS.primaryDark,
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  heroActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  greeting: { ...FONTS.body, color: '#E0F7FA' },
  brand: { ...FONTS.h2, color: '#fff', fontSize: 26 },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bellCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Premium hero "Book Consultation" pill — desktop only.
     Sits in the empty right side of the hero header instead of the
     full-width CTA card so the page reads tighter on a 1440-px web
     viewport. */
  heroBookBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  heroBookText: {
    color: '#0E7C8B',
    fontFamily: FONTS.h2.fontFamily,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  heroBookArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0E7C8B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  heroQuickText: {
    color: '#0E7C8B',
    fontFamily: FONTS.h2.fontFamily,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  langCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 0.5,
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: COLORS.primaryDark,
  },
  bellBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Manrope_700Bold',
  },
  doctorCard: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: RADIUS.lg,
    padding: 14,
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  doctorPhoto: { width: 100, height: 100, borderRadius: 22, backgroundColor: '#fff' },
  appLogoFrame: {
    width: 100,
    height: 100,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  appLogo: { width: '100%', height: '100%' },
  doctorName: { ...FONTS.h3, color: '#fff', fontSize: 19 },
  doctorSpec: { ...FONTS.bodyMedium, color: '#E0F7FA', marginTop: 2 },
  doctorSubtitle: { ...FONTS.body, color: '#B2EBF2', fontSize: 12 },
  badgeRow: { flexDirection: 'row', marginTop: 8 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  badgeText: { ...FONTS.label, color: COLORS.primary, fontSize: 10, letterSpacing: 0.3 },
  quickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: -22,
    marginBottom: 20,
    backgroundColor: '#fff',
    marginHorizontal: 20,
    borderRadius: RADIUS.lg,
    paddingVertical: 18,
    shadowColor: '#0E7C8B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  quickItem: {
    alignItems: 'center',
    flex: 1,
    // Reserve a fixed inner height so all 4 cells align even when one
    // label needs 2 lines (e.g. "Patient Education" / "रोगी शिक्षा")
    // and the others fit on 1 line. Without this, the row looks ragged.
    minHeight: 88,
    paddingHorizontal: 2,
  },
  quickIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickLabelWrap: {
    // Fixed 2-line height for the label area regardless of how many
    // lines the text actually takes — text is centered vertically inside.
    height: 30,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  quickLabel: {
    ...FONTS.body,
    fontSize: 11,
    color: COLORS.textPrimary,
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
    lineHeight: 14,
  },
  ctaCard: {
    borderRadius: RADIUS.lg,
    padding: 20,
    overflow: 'hidden',
    minHeight: 120,
  },
  ctaTitle: { ...FONTS.h3, color: '#fff', fontSize: 20 },
  ctaSub: { ...FONTS.body, color: '#E0F7FA', marginTop: 4 },
  ctaBtn: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  ctaBtnText: { ...FONTS.bodyMedium, color: COLORS.primary, fontFamily: 'Manrope_700Bold' },
  section: { marginTop: 24 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: { ...FONTS.h3, color: COLORS.textPrimary, fontSize: 18 },
  seeAll: { ...FONTS.bodyMedium, color: COLORS.primary },
  diseasePill: {
    width: 130,
    padding: 14,
    borderRadius: RADIUS.md,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  diseasePillDesktop: {
    width: '15.6%',
    minWidth: 130,
  },
  diseasePillIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  diseasePillText: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13 },
  blogCard: { width: 260, backgroundColor: '#fff', borderRadius: RADIUS.lg, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  // Desktop card overrides — flex into a wrap grid (~3 per row at
  // 1180 px content width).
  blogCardDesktop: { width: '32%', minWidth: 260 },
  blogCover: { width: '100%', height: 130, backgroundColor: COLORS.bg },
  blogCatPill: { alignSelf: 'flex-start', backgroundColor: COLORS.primary + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  blogCatText: { ...FONTS.label, color: COLORS.primary, fontSize: 9 },
  blogTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 14, marginTop: 6, lineHeight: 20 },
  blogExcerpt: { ...FONTS.body, color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 16 },
  videoCard: { width: 240 },
  videoCardDesktop: { width: '23.5%', minWidth: 220 },
  // Wrapping flex row used by all desktop grids on the home page.
  // Centered, capped to content width, with even spacing between
  // cards.
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 14,
  },
  videoThumb: { width: '100%', height: 130, borderRadius: RADIUS.md, backgroundColor: '#000' },
  videoPlay: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(229,57,53,0.9)', alignItems: 'center', justifyContent: 'center' },
  videoDur: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  videoDurText: { ...FONTS.body, color: '#fff', fontSize: 10 },
  videoTitle: { ...FONTS.bodyMedium, color: COLORS.textPrimary, fontSize: 13, marginTop: 8, lineHeight: 18 },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 10,
  },
  socialItem: { alignItems: 'center' },
  socialCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  socialLabel: { ...FONTS.body, fontSize: 11, color: COLORS.textSecondary },
});
