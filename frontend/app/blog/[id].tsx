import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Share,
  Linking,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import api from '../../src/api';
import { COLORS, FONTS } from '../../src/theme';
import { useI18n } from '../../src/i18n';
import { displayDate } from '../../src/date';

/** A single rendered block extracted from the HTML. */
type Block =
  | { type: 'h'; level: number; content: InlineChunk[] }
  | { type: 'p'; content: InlineChunk[] }
  | { type: 'li'; ordered: boolean; content: InlineChunk[] }
  | { type: 'img'; src: string; alt?: string }
  | { type: 'youtube'; videoId: string }
  | { type: 'hr' }
  | { type: 'quote'; content: InlineChunk[] };

type InlineChunk = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
};

const YT_RE =
  /(?:youtube\.com\/(?:embed\/|watch\?v=|v\/)|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{10,})/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&mdash;/g, '\u2014')
    .replace(/&ndash;/g, '\u2013');
}

/** Parse a snippet of inline HTML into styled chunks. */
function parseInline(html: string): InlineChunk[] {
  const chunks: InlineChunk[] = [];
  let cursor = 0;
  const stack: { bold: number; italic: number; link: string | null } = { bold: 0, italic: 0, link: null };
  const src = html;
  const tagRe = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  let m: RegExpExecArray | null;

  function pushText(raw: string) {
    if (!raw) return;
    const text = decodeEntities(raw);
    if (!text) return;
    chunks.push({
      text,
      bold: stack.bold > 0 || undefined,
      italic: stack.italic > 0 || undefined,
      link: stack.link || undefined,
    });
  }

  while ((m = tagRe.exec(src)) !== null) {
    // Text before this tag
    if (m.index > cursor) {
      pushText(src.slice(cursor, m.index));
    }
    cursor = m.index + m[0].length;
    const tag = m[1].toLowerCase();
    const isClose = m[0].startsWith('</');
    const attrs = m[2] || '';
    if (tag === 'b' || tag === 'strong') {
      if (isClose) stack.bold = Math.max(0, stack.bold - 1);
      else stack.bold += 1;
    } else if (tag === 'i' || tag === 'em') {
      if (isClose) stack.italic = Math.max(0, stack.italic - 1);
      else stack.italic += 1;
    } else if (tag === 'a') {
      if (isClose) {
        stack.link = null;
      } else {
        const href = /href=["']([^"']+)["']/i.exec(attrs);
        stack.link = href ? href[1] : null;
      }
    } else if (tag === 'br') {
      chunks.push({ text: '\n' });
    }
    // Ignore other inline tags (span, font, u, etc.)
  }
  if (cursor < src.length) pushText(src.slice(cursor));
  return chunks;
}

/** Convert a full HTML article into a list of Blocks. */
function parseBlocks(html: string): Block[] {
  if (!html) return [];
  const normalized = html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n');

  const blocks: Block[] = [];
  // Split into top-level blocks
  const blockRe = /<(p|div|h[1-6]|ul|ol|blockquote|figure|iframe|hr|img)([^>]*)>([\s\S]*?)<\/\1>|<(img|hr|iframe)([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(normalized)) !== null) {
    const tag = (m[1] || m[4] || '').toLowerCase();
    const attrs = (m[2] || m[5] || '') as string;
    const inner = (m[3] || '') as string;

    if (tag === 'hr') {
      blocks.push({ type: 'hr' });
      continue;
    }
    if (tag === 'img') {
      const src = /src=["']([^"']+)["']/i.exec(attrs);
      const alt = /alt=["']([^"']*)["']/i.exec(attrs);
      if (src) blocks.push({ type: 'img', src: src[1].replace(/\\\//g, '/'), alt: alt ? alt[1] : '' });
      continue;
    }
    if (tag === 'iframe') {
      const src = /src=["']([^"']+)["']/i.exec(attrs);
      if (src) {
        const yt = YT_RE.exec(src[1]);
        if (yt) blocks.push({ type: 'youtube', videoId: yt[1] });
      }
      continue;
    }
    // Iframe inside a div/figure?
    const iframe = /<iframe[^>]+src=["']([^"']+)["'][^>]*><\/iframe>/i.exec(inner);
    if (iframe) {
      const yt = YT_RE.exec(iframe[1]);
      if (yt) blocks.push({ type: 'youtube', videoId: yt[1] });
    }
    // Image(s) inside the block
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let im: RegExpExecArray | null;
    while ((im = imgRe.exec(inner)) !== null) {
      const s = im[1].replace(/\\\//g, '/');
      if (!blocks.find((b) => (b as any).src === s)) {
        blocks.push({ type: 'img', src: s });
      }
    }

    if (tag === 'ul' || tag === 'ol') {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(inner)) !== null) {
        const txt = li[1].replace(/<img[^>]*>/gi, '').trim();
        if (txt) blocks.push({ type: 'li', ordered: tag === 'ol', content: parseInline(txt) });
      }
      continue;
    }

    if (tag === 'blockquote') {
      const txt = inner.replace(/<img[^>]*>/gi, '').trim();
      if (txt) blocks.push({ type: 'quote', content: parseInline(txt) });
      continue;
    }

    if (/^h[1-6]$/.test(tag)) {
      const level = parseInt(tag[1], 10);
      const txt = inner.replace(/<img[^>]*>/gi, '').trim();
      if (txt) blocks.push({ type: 'h', level, content: parseInline(txt) });
      continue;
    }

    // Paragraph / div — extract text (after images were handled above)
    const stripped = inner.replace(/<img[^>]*>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '').trim();
    if (stripped) {
      blocks.push({ type: 'p', content: parseInline(stripped) });
    }
  }

  if (blocks.length === 0) {
    // Fallback: plain text
    const text = decodeEntities(normalized.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (text) blocks.push({ type: 'p', content: [{ text }] });
  }
  return blocks;
}

/** Responsive image that auto-computes height based on screen width. */
function ArticleImage({ src, maxWidth }: { src: string; maxWidth: number }) {
  const [ratio, setRatio] = useState(16 / 9);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    Image.getSize(
      src,
      (w, h) => {
        if (mounted && w && h) {
          setRatio(w / h);
          setLoaded(true);
        }
      },
      () => {
        if (mounted) setLoaded(true);
      }
    );
    return () => {
      mounted = false;
    };
  }, [src]);

  const w = Math.min(maxWidth, 720);
  const h = w / ratio;
  return (
    <View style={{ alignSelf: 'center', width: w, maxWidth: '100%', marginTop: 16 }}>
      {!loaded && (
        <View style={{ width: w, height: Math.max(180, h || 180), backgroundColor: COLORS.bg, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      )}
      {loaded && (
        <Image
          source={{ uri: src }}
          style={{ width: w, height: h || 200, borderRadius: 12, backgroundColor: COLORS.bg }}
          resizeMode="contain"
        />
      )}
    </View>
  );
}

function YouTubeEmbed({ videoId, maxWidth, label }: { videoId: string; maxWidth: number; label: string }) {
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const w = Math.min(maxWidth, 720);
  const h = (w * 9) / 16;
  const open = () => Linking.openURL(`https://www.youtube.com/watch?v=${videoId}`);
  return (
    <TouchableOpacity onPress={open} activeOpacity={0.85} style={{ alignSelf: 'center', marginTop: 18 }}>
      <View style={{ width: w, height: h, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' }}>
        <Image source={{ uri: thumb }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        <View style={styles.ytOverlay}>
          <View style={styles.ytBtn}>
            <Ionicons name="play" size={30} color="#fff" />
          </View>
          <Text style={styles.ytLabel}>{label}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

function renderInline(chunks: InlineChunk[]) {
  return chunks.map((c, i) => (
    <Text
      key={i}
      onPress={c.link ? () => Linking.openURL(c.link!) : undefined}
      style={[
        c.bold && { fontFamily: 'DMSans_700Bold', fontWeight: '700' },
        c.italic && { fontStyle: 'italic' },
        c.link && { color: COLORS.primary, textDecorationLine: 'underline' },
      ]}
    >
      {c.text}
    </Text>
  ));
}

export default function BlogDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t, lang, setLang } = useI18n();
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, 760) - 48;
  const [p, setP] = useState<any>(null);

  const cycleLang = () => {
    const order: ('en' | 'hi' | 'gu')[] = ['en', 'hi', 'gu'];
    const next = order[(order.indexOf(lang) + 1) % order.length];
    setLang(next);
  };
  const langBadge = lang === 'hi' ? 'हि' : lang === 'gu' ? 'ગુ' : 'EN';

  useEffect(() => {
    api.get(`/blog/${id}`).then((r) => setP(r.data)).catch(() => setP({ error: true }));
  }, [id]);

  const blocks = useMemo(() => parseBlocks(p?.content_html || p?.content || ''), [p]);

  if (!p) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={COLORS.primary} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {p.cover ? <Image source={{ uri: p.cover }} style={styles.cover} /> : <View style={styles.coverFallback} />}
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="blog-detail-back">
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity
              onPress={cycleLang}
              style={[styles.backBtn, { paddingHorizontal: 12, minWidth: 52 }]}
              testID="blog-detail-lang"
              accessibilityLabel={`Language: ${lang}`}
            >
              <Text style={{ color: '#fff', fontSize: 13, fontFamily: 'Manrope_700Bold', letterSpacing: 0.5 }} allowFontScaling={false}>
                {langBadge}
              </Text>
            </TouchableOpacity>
            {p.link ? (
              <TouchableOpacity onPress={() => Linking.openURL(p.link)} style={styles.backBtn} testID="blog-detail-open">
                <Ionicons name="open-outline" size={22} color="#fff" />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() =>
                Share.share(
                  Platform.OS === 'web'
                    ? { message: p.title + (p.link ? ' — ' + p.link : '') }
                    : { message: `${p.title} — ConsultUro`, url: p.link || '' }
                )
              }
              style={styles.backBtn}
              testID="blog-detail-share"
            >
              <Ionicons name="share-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={[styles.body, { maxWidth: 820, marginHorizontal: 'auto', width: '100%' }]}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>{p.category || 'Urology'}</Text>
          </View>
          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.date}>
            {displayDate(p.published_at || p.created_at)} · {t('blog.byline')}
          </Text>

          {p.excerpt ? <Text style={styles.excerpt}>{p.excerpt}</Text> : null}

          <View style={{ marginTop: 12 }}>
            {blocks.map((b, i) => {
              if (b.type === 'img') return <ArticleImage key={i} src={b.src} maxWidth={contentWidth} />;
              if (b.type === 'youtube') return <YouTubeEmbed key={i} videoId={b.videoId} maxWidth={contentWidth} label={t('blog.watchYoutube')} />;
              if (b.type === 'hr') return <View key={i} style={styles.hr} />;
              if (b.type === 'h') {
                const H = b.level <= 2 ? styles.h2 : b.level === 3 ? styles.h3 : styles.h4;
                return (
                  <Text key={i} style={H}>
                    {renderInline(b.content)}
                  </Text>
                );
              }
              if (b.type === 'li') {
                return (
                  <View key={i} style={styles.liRow}>
                    <Text style={styles.liBullet}>{b.ordered ? `${i + 1}.` : '\u2022'}</Text>
                    <Text style={styles.li}>{renderInline(b.content)}</Text>
                  </View>
                );
              }
              if (b.type === 'quote') {
                return (
                  <View key={i} style={styles.quote}>
                    <Text style={styles.quoteText}>{renderInline(b.content)}</Text>
                  </View>
                );
              }
              return (
                <Text key={i} style={styles.para}>
                  {renderInline(b.content)}
                </Text>
              );
            })}
          </View>

          {p.link && (
            <TouchableOpacity onPress={() => Linking.openURL(p.link)} style={styles.openOriginal} testID="blog-open-original-btn">
              <Ionicons name="open-outline" size={16} color={COLORS.primary} />
              <Text style={styles.openOriginalText}>{t('blog.openOriginal')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { width: '100%', height: 280, backgroundColor: COLORS.primary },
  coverFallback: { width: '100%', height: 140, backgroundColor: COLORS.primary },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, padding: 16, flexDirection: 'row', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  body: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, marginTop: -28, padding: 24 },
  pill: { alignSelf: 'flex-start', backgroundColor: COLORS.primary + '18', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  pillText: { ...FONTS.label, color: COLORS.primary, fontSize: 10, textTransform: 'uppercase' },
  title: { ...FONTS.h1, color: COLORS.textPrimary, marginTop: 12, fontSize: 28, lineHeight: 36 },
  date: { ...FONTS.body, color: COLORS.textSecondary, marginTop: 8, fontSize: 12 },
  excerpt: { ...FONTS.bodyLarge, color: COLORS.textSecondary, fontStyle: 'italic', marginTop: 16, lineHeight: 26, fontSize: 16 },
  para: { ...FONTS.bodyLarge, color: COLORS.textPrimary, lineHeight: 28, marginTop: 14, fontSize: 16 },
  h2: { ...FONTS.h2, color: COLORS.textPrimary, marginTop: 28, marginBottom: 6, fontSize: 22, lineHeight: 30 },
  h3: { ...FONTS.h3, color: COLORS.textPrimary, marginTop: 22, marginBottom: 4, fontSize: 19, lineHeight: 26 },
  h4: { ...FONTS.h4, color: COLORS.primary, marginTop: 18, marginBottom: 4, fontSize: 17 },
  liRow: { flexDirection: 'row', marginTop: 8, paddingLeft: 4 },
  liBullet: { ...FONTS.bodyLarge, color: COLORS.primary, minWidth: 22, fontSize: 16, lineHeight: 26 },
  li: { ...FONTS.bodyLarge, color: COLORS.textPrimary, flex: 1, fontSize: 16, lineHeight: 26 },
  quote: { marginTop: 14, padding: 14, backgroundColor: COLORS.primary + '10', borderLeftWidth: 4, borderLeftColor: COLORS.primary, borderRadius: 8 },
  quoteText: { ...FONTS.bodyLarge, color: COLORS.textPrimary, fontStyle: 'italic', lineHeight: 26 },
  hr: { height: 1, backgroundColor: COLORS.border, marginVertical: 20 },
  ytOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  ytBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(229,57,53,0.92)', alignItems: 'center', justifyContent: 'center' },
  ytLabel: { ...FONTS.bodyMedium, color: '#fff', marginTop: 8, fontSize: 12, letterSpacing: 0.5 },
  openOriginal: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 24, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 20 },
  openOriginalText: { ...FONTS.bodyMedium, color: COLORS.primary, fontSize: 12 },
});
