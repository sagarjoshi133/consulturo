import { Share, Platform } from 'react-native';
import { API_BASE } from './api';

/**
 * Rich link sharing. Instead of sharing a bare in-app URL (which shows
 * no preview when pasted into WhatsApp / social apps), we share a
 * backend "share" URL that serves Open Graph + Twitter Card meta tags —
 * so the recipient sees a proper preview card (title + description +
 * image). A human who taps the link is instantly redirected to the real
 * in-app page.
 *
 * The share sheet message ALSO carries the title + description as plain
 * text, so even apps that don't unfurl links still show context.
 */
export type ShareKind =
  | 'home'
  | 'book'
  | 'clinic'
  | 'blog'
  | 'guide'
  | 'video'
  | 'videos'
  | 'education'
  | 'refer';

export interface ShareOpts {
  kind: ShareKind;
  /** slug / id / key for the specific item (clinic slug, blog id, guide key…). */
  ident?: string;
  title: string;
  description?: string;
  /** Absolute https image URL for the preview card (optional). */
  image?: string;
  /** Referral code — preserved on the canonical redirect (clinic pages). */
  ref?: string;
}

/** Build the crawler-friendly share URL that serves OG meta tags. */
export function buildShareUrl(opts: ShareOpts): string {
  const { kind, ident, title, description, image, ref } = opts;
  const params = new URLSearchParams();
  if (title) params.set('t', title);
  if (description) params.set('d', description);
  if (image) params.set('img', image);
  if (ref) params.set('ref', ref);
  const q = params.toString();
  const path = ident ? `${kind}/${encodeURIComponent(ident)}` : kind;
  return `${API_BASE}/share/${path}${q ? `?${q}` : ''}`;
}

/** Open the native share sheet (or Web Share API) with rich metadata. */
export async function shareLink(opts: ShareOpts): Promise<void> {
  const url = buildShareUrl(opts);
  const { title, description } = opts;
  const text = description ? `${title} — ${description}` : title;
  const message = `${text}\n${url}`;

  try {
    if (
      Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      (navigator as any).share
    ) {
      await (navigator as any).share({ title, text, url });
      return;
    }
    // iOS shows the `url` as the shareable link; `message` carries the
    // context text. Android bundles everything into `message` (which
    // already includes the url).
    await Share.share(
      Platform.OS === 'ios'
        ? { url, message: text, title }
        : { message, title },
    );
  } catch {
    // user cancelled or share unavailable — silent
  }
}
