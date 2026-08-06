/**
 * LinkifiedText — renders a text body where any URL (http/https) or
 * email/phone-tel hyperlink is tappable. On web it opens a new tab; on
 * native it uses `Linking.openURL` which routes via the system default
 * browser / dialer / mail app.
 *
 * Drop-in replacement for `<Text>{body}</Text>` — pass the body string
 * via the `text` prop and inherit styles via `style`/`linkStyle`.
 */
import React, { useMemo } from 'react';
import { Linking, Platform, Text, TextStyle, StyleProp } from 'react-native';
import { COLORS } from './theme';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
  selectable?: boolean;
  numberOfLines?: number;
};

// Matches URLs, www.* hosts, emails. Capturing group required for split.
const URL_RX =
  /(\b(?:https?:\/\/|www\.)[^\s<>()"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function normalizeUrl(token: string): string {
  if (token.includes('@') && !token.startsWith('http')) return `mailto:${token}`;
  if (token.startsWith('www.')) return `https://${token}`;
  return token;
}

async function openHref(href: string) {
  try {
    if (Platform.OS === 'web') {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    const ok = await Linking.canOpenURL(href);
    if (ok) await Linking.openURL(href);
    else await Linking.openURL(href).catch(() => {});
  } catch {
    /* swallow — better silent than crash */
  }
}

export default function LinkifiedText({
  text,
  style,
  linkStyle,
  selectable,
  numberOfLines,
}: Props) {
  const parts = useMemo(() => {
    if (!text) return [] as Array<{ kind: 'text' | 'link'; value: string; href?: string }>;
    const out: Array<{ kind: 'text' | 'link'; value: string; href?: string }> = [];
    // Reset regex state by creating a fresh one each render.
    const rx = new RegExp(URL_RX.source, 'g');
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const idx = m.index;
      if (idx > cursor) {
        out.push({ kind: 'text', value: text.slice(cursor, idx) });
      }
      const token = m[0];
      // Trim trailing punctuation that often sits next to URLs in copy.
      const cleaned = token.replace(/[)\].,!?;:]+$/g, '');
      const dropped = token.slice(cleaned.length);
      out.push({ kind: 'link', value: cleaned, href: normalizeUrl(cleaned) });
      if (dropped) out.push({ kind: 'text', value: dropped });
      cursor = idx + token.length;
    }
    if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) });
    return out;
  }, [text]);

  return (
    <Text style={style} selectable={selectable} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        p.kind === 'link' ? (
          <Text
            key={`l-${i}`}
            onPress={() => p.href && openHref(p.href)}
            style={[{ color: COLORS.primary, textDecorationLine: 'underline' }, linkStyle]}
            accessibilityRole="link"
            accessibilityLabel={p.value}
          >
            {p.value}
          </Text>
        ) : (
          <Text key={`t-${i}`}>{p.value}</Text>
        ),
      )}
    </Text>
  );
}
