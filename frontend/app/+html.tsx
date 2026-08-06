/**
 * Expo Router static HTML template — runs ONLY on web at build/SSR time.
 *
 * This file customises the `<head>` that wraps every Expo-Router web
 * page. We use it to inject:
 *   • PWA manifest link (so Chrome/Edge fire the "Install app" prompt
 *     when the install criteria are met).
 *   • Apple-touch-icon + apple-mobile-web-app meta tags (so iOS
 *     Safari "Add to Home Screen" produces a properly-themed icon
 *     and standalone launch behaviour).
 *   • Theme color, color-scheme, and SEO meta tags (open-graph + twitter
 *     card) so shared links render with the brand identity.
 *   • A tiny inline boot script that registers `/sw.js` after the
 *     page is interactive — required for the Chrome A2HS prompt and
 *     for offline fallback.
 *
 * Notes:
 *   • This file is NEVER rendered on native (iOS / Android). It's
 *     only used by the Metro web exporter / dev server.
 *   • The body must include `<ScrollViewStyleReset />` per the
 *     official Expo Router docs (without it, Metro web pages don't
 *     scroll on iOS Safari).
 */
import React from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';

const FAVICON_LINKS = (
  <>
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png" />
    <link rel="shortcut icon" href="/favicon-32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  </>
);

const PWA_BOOT_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Defer registration until after first interaction / idle so it
  // never competes with the first paint on a flaky 4G connection.
  var go = function () {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(function () { /* ignore — PWA is best-effort */ });
  };
  if (document.readyState === 'complete') {
    setTimeout(go, 1500);
  } else {
    window.addEventListener('load', function () { setTimeout(go, 1500); });
  }
})();
`;

export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />

        {/* ── PWA core ─────────────────────────────────────────── */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="application-name" content="ConsultUro" />
        <meta name="theme-color" content="#0E7C8B" />
        <meta name="color-scheme" content="light dark" />

        {/* ── iOS standalone PWA (Add to Home Screen) ─────────── */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="ConsultUro" />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />

        {/* ── Favicons / Apple touch icons ─────────────────────── */}
        {FAVICON_LINKS}

        {/* ── SEO / OpenGraph (brand-quality link previews) ─── */}
        <meta
          name="description"
          content="ConsultUro — book a consultation with Dr. Sagar Joshi (Consultant Urologist, Laparoscopic & Transplant Surgeon)."
        />
        <meta property="og:title" content="ConsultUro" />
        <meta
          property="og:description"
          content="Your personal urology care companion."
        />
        <meta property="og:type" content="website" />
        <meta property="og:image" content="/icons/icon-512.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="/icons/icon-512.png" />

        {/* Required Expo Router reset for web scrolling. */}
        <ScrollViewStyleReset />

        {/* PWA service-worker registration — runs once after load.
            Inlining keeps it tiny and avoids an extra round-trip. */}
        <script dangerouslySetInnerHTML={{ __html: PWA_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
