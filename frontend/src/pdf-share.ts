/**
 * Shared PDF share helper — produces a REAL .pdf file (never the OS
 * print dialog) from a given HTML string.
 *
 * Why this exists: `expo-print.printAsync` opens the system print
 * preview, which most users assume is a "preview only" step and
 * close without saving. Doctors want the PDF as a file they can
 * attach to WhatsApp / email straight away.
 *
 * Flow:
 *   · Web   → POST /api/render/pdf (WeasyPrint server-side) → blob
 *             → try Web Share API (mobile browsers) → fallback to
 *             <a download> save-to-Downloads.
 *   · Native → expo-print.printToFileAsync → cache file path →
 *             rename to a clean filename → expo-sharing share sheet.
 *
 * Both branches return without ever touching the print preview.
 */
import { Platform, Alert } from 'react-native';
import api from './api';

const log = (...args: any[]) => { try { console.log('[pdf-share]', ...args); } catch {} };

function showWebAlert(msg: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.alert(msg); return; } catch {}
  }
  try { Alert.alert('Notice', msg); } catch {}
}

function safeMsg(e: any, fallback: string): string {
  return e?.response?.data?.detail || e?.message || fallback;
}

/**
 * Render the given HTML to a real PDF and surface it to the user
 * (download on web, OS share sheet on native).
 *
 * @param html      Complete HTML document (head + body, self-styled).
 * @param filename  Base filename — `.pdf` suffix is appended if absent.
 * @param title     Title shown in the share sheet (native) and the
 *                  download fallback message (web).
 */
export async function sharePdfFromHtml(html: string, filename: string, title?: string): Promise<void> {
  const finalName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;

  // ── Web branch ────────────────────────────────────────────────
  if (Platform.OS === 'web') {
    let blob: Blob | undefined;
    try {
      const resp = await api.post(
        '/render/pdf',
        { html, filename: finalName },
        { responseType: 'blob', timeout: 90_000 },
      );
      blob = resp.data as Blob;
    } catch (e: any) {
      log('render/pdf failed', e?.response?.status, e?.message);
      showWebAlert(safeMsg(e, 'Could not generate PDF. Please retry.'));
      return;
    }
    if (!blob || (blob as any).size === 0) {
      showWebAlert('PDF service returned an empty file. Please retry.');
      return;
    }

    // Try Web Share API first (works on mobile Chrome / Safari).
    try {
      const FileCtor: any = (typeof File !== 'undefined') ? File : null;
      const nav: any = (typeof navigator !== 'undefined') ? navigator : null;
      if (FileCtor && nav && nav.canShare) {
        const file = new FileCtor([blob], finalName, { type: 'application/pdf' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: title || finalName });
          return;
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // user dismissed share sheet
      // continue to download fallback
    }

    // Fallback — trigger a download.
    try {
      // eslint-disable-next-line no-undef
      const url = URL.createObjectURL(blob);
      // eslint-disable-next-line no-undef
      const a = document.createElement('a');
      a.href = url;
      a.download = finalName;
      a.rel = 'noopener';
      // eslint-disable-next-line no-undef
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        try {
          // eslint-disable-next-line no-undef
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch {}
      }, 4000);
      showWebAlert(`Saved "${finalName}" to your Downloads folder.`);
    } catch (e: any) {
      showWebAlert(safeMsg(e, 'Could not download PDF'));
    }
    return;
  }

  // ── Native branch ─────────────────────────────────────────────
  try {
    const Print = await import('expo-print');
    const FileSystem: any = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');

    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (!uri) throw new Error('No PDF file generated');

    // Rename so the share sheet shows a clean name.
    let target = uri;
    try {
      const dir = FileSystem?.cacheDirectory || '';
      const renamed = `${dir}${finalName}`;
      await FileSystem.moveAsync({ from: uri, to: renamed });
      target = renamed;
    } catch {
      // rename failed — keep original temp uri
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(target, {
        mimeType: 'application/pdf',
        dialogTitle: title || `Share ${finalName}`,
        UTI: 'com.adobe.pdf',
      });
    } else {
      Alert.alert('Sharing unavailable', `PDF saved at: ${target}`);
    }
  } catch (e: any) {
    Alert.alert('Could not share PDF', safeMsg(e, 'Unknown error'));
  }
}
