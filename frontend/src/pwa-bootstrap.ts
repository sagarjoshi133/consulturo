/**
 * PWA bootstrap — runs ONCE at module load on web.
 *
 * Why this file exists:
 *   • `app/+html.tsx` customises the static HTML wrapper during
 *     `expo export --platform web`, but the dev server (Metro) uses
 *     a different default template, so PWA <link> / <meta> tags are
 *     missing in development.
 *   • A small handful of older Expo / Metro setups also skip +html.tsx
 *     in production unless `web.output: "static"` is explicitly set.
 *
 * To make installable-PWA behaviour 100% reliable across dev AND
 * production, this module also injects the same set of tags at
 * runtime — idempotently — and registers the service worker.
 *
 * Native: hard no-op (Platform.OS guard).
 */
import { Platform } from 'react-native';

let installed = false;

export function installPwaBootstrap(): void {
  if (installed) return;
  if (Platform.OS !== 'web') return;
  if (typeof document === 'undefined') return;
  installed = true;

  const head = document.head;
  if (!head) return;

  // Helper: insert a tag only if no equivalent already exists.
  const upsertLink = (rel: string, attrs: Record<string, string>) => {
    const selector = `link[rel="${rel}"]` + (
      attrs.sizes ? `[sizes="${attrs.sizes}"]` : ''
    );
    if (head.querySelector(selector)) return;
    const el = document.createElement('link');
    el.rel = rel;
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    head.appendChild(el);
  };
  const upsertMeta = (name: string, content: string, useProperty = false) => {
    const attr = useProperty ? 'property' : 'name';
    if (head.querySelector(`meta[${attr}="${name}"]`)) return;
    const el = document.createElement('meta');
    el.setAttribute(attr, name);
    el.setAttribute('content', content);
    head.appendChild(el);
  };

  // ── Viewport — must include viewport-fit=cover for iOS notch handling
  const vp = head.querySelector('meta[name="viewport"]');
  if (vp) {
    vp.setAttribute(
      'content',
      'width=device-width, initial-scale=1, viewport-fit=cover',
    );
  } else {
    upsertMeta('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
  }

  // ── Manifest (the gate for Chrome's "Install app" prompt)
  upsertLink('manifest', { href: '/manifest.webmanifest' });

  // ── Theme + brand
  upsertMeta('theme-color', '#0E7C8B');
  upsertMeta('color-scheme', 'light dark');
  upsertMeta('application-name', 'ConsultUro');

  // ── iOS standalone (Add to Home Screen)
  upsertMeta('apple-mobile-web-app-capable', 'yes');
  upsertMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  upsertMeta('apple-mobile-web-app-title', 'ConsultUro');
  upsertMeta('mobile-web-app-capable', 'yes');
  upsertMeta('format-detection', 'telephone=no');

  // ── Favicons / Apple-touch-icon
  upsertLink('apple-touch-icon', { sizes: '180x180', href: '/apple-touch-icon.png' });
  upsertLink('icon', { type: 'image/png', sizes: '16x16', href: '/favicon-16.png' });
  upsertLink('icon', { type: 'image/png', sizes: '32x32', href: '/favicon-32.png' });
  upsertLink('icon', { type: 'image/png', sizes: '48x48', href: '/favicon-48.png' });

  // ── PRELOAD the splash logo so the animated splash never paints
  // a blank square. The image is ~15 KB and starts downloading in
  // parallel with the JS bundle, so by the time React mounts the
  // <AnimatedSplash> the image is already in the browser cache.
  if (!head.querySelector('link[rel="preload"][as="image"][href="/splash-logo.png"]')) {
    const pre = document.createElement('link');
    pre.rel = 'preload';
    pre.as = 'image';
    pre.href = '/splash-logo.png';
    // High priority hint (Chrome / Edge honour this for hero images).
    pre.setAttribute('fetchpriority', 'high');
    head.appendChild(pre);
  }

  // ── Open Graph / Twitter card (brand-quality link previews)
  upsertMeta('description',
    'ConsultUro — book a consultation with Dr. Sagar Joshi (Consultant Urologist, Laparoscopic & Transplant Surgeon).');
  upsertMeta('og:title', 'ConsultUro', true);
  upsertMeta('og:description', 'Your personal urology care companion.', true);
  upsertMeta('og:type', 'website', true);
  upsertMeta('og:image', '/icons/icon-512.png', true);
  upsertMeta('twitter:card', 'summary_large_image');
  upsertMeta('twitter:image', '/icons/icon-512.png');

  // ── Service worker registration (Chrome requires SW for A2HS).
  // Defer until after first paint to avoid contending with the
  // initial Metro bundle download on slow connections.
  if ('serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .catch(() => {/* PWA is best-effort */});
    };
    if (document.readyState === 'complete') {
      window.setTimeout(register, 1500);
    } else {
      window.addEventListener('load', () => window.setTimeout(register, 1500));
    }
  }
}
