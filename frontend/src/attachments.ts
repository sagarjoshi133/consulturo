// Personal-message attachment helpers
//
// Attachments arrive from the backend as base64 data URLs
// (`data:application/pdf;base64,...`). Most operating systems (Android
// in particular) cannot hand a `data:` URL to a third-party viewer
// app — the OS expects a `file://` / `content://` URI.
//
// This module provides three actions that work cross-platform:
//   • openAttachment(att)     → write the decoded bytes to a cache
//                               file, then launch the system "Open
//                               with…" sheet via expo-sharing.
//   • saveAttachment(att)     → on web, trigger an anchor download.
//                               On native, share-with options that
//                               include "Save to Files / Drive".
//   • shareAttachment(att)    → identical to saveAttachment on native;
//                               on web, fall back to navigator.share
//                               or anchor download.
//
// All three return a {ok, error?} result so callers can show a toast.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type Attachment = {
  id?: string;
  name?: string;
  mime?: string;
  size_bytes?: number;
  data_url?: string;
  kind?: 'image' | 'video' | 'audio' | 'file';
  preview_uri?: string;
};

type Result = { ok: true } | { ok: false; error: string };

// ── Helpers ─────────────────────────────────────────────────────────
const sanitiseName = (n?: string) => {
  const base = (n || 'attachment').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
  return base || 'attachment';
};

const guessExt = (mime?: string, name?: string) => {
  if (name && /\.[A-Za-z0-9]{2,5}$/.test(name)) return ''; // already has extension
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return '.' + m.slice(6).split(';')[0].replace('jpeg', 'jpg');
  if (m.startsWith('video/')) return '.' + m.slice(6).split(';')[0];
  if (m.startsWith('audio/')) return '.' + m.slice(6).split(';')[0];
  if (m === 'application/pdf') return '.pdf';
  if (m === 'application/zip') return '.zip';
  if (m === 'application/json') return '.json';
  if (m === 'text/plain') return '.txt';
  if (m === 'application/msword') return '.doc';
  if (m === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  if (m === 'application/vnd.ms-excel') return '.xls';
  if (m === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
  return '';
};

/**
 * Persist an attachment's data URL to a cache file and return the
 * absolute file URI (suitable for Sharing.shareAsync).
 *
 * Throws if the data URL is missing or malformed.
 */
export async function persistAttachmentToCache(att: Attachment): Promise<string> {
  if (!att?.data_url) throw new Error('Attachment has no data');
  const dataUrl = att.data_url;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0 || !dataUrl.startsWith('data:')) {
    throw new Error('Not a data URL');
  }
  const b64 = dataUrl.slice(commaIdx + 1);
  const baseName = sanitiseName(att.name);
  const ext = guessExt(att.mime, baseName);
  const fname = baseName + ext;
  const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  const uri = dir.endsWith('/') ? `${dir}${fname}` : `${dir}/${fname}`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

// Web-only download via anchor click.
function webDownload(att: Attachment) {
  if (typeof document === 'undefined' || !att?.data_url) return false;
  try {
    const a = document.createElement('a');
    a.href = att.data_url;
    a.download = sanitiseName(att.name) + guessExt(att.mime, att.name);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch {} }, 400);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/** Open the attachment in the system "Open with…" dialog. */
export async function openAttachment(att: Attachment): Promise<Result> {
  if (!att?.data_url) return { ok: false, error: 'Attachment has no data' };
  if (Platform.OS === 'web') {
    // Browsers can navigate directly to the data URL — preview opens
    // in a new tab where the user can save it.
    if (typeof window !== 'undefined') {
      try {
        window.open(att.data_url, '_blank');
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e?.message || 'Could not open' };
      }
    }
    return { ok: false, error: 'Window unavailable' };
  }
  try {
    const uri = await persistAttachmentToCache(att);
    const can = await Sharing.isAvailableAsync();
    if (!can) {
      return { ok: false, error: 'Sharing unavailable on this device' };
    }
    await Sharing.shareAsync(uri, {
      mimeType: att.mime || 'application/octet-stream',
      UTI: att.mime || undefined,
      dialogTitle: `Open ${att.name || 'attachment'} with…`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not open attachment' };
  }
}

/** Save the attachment to the device. */
export async function saveAttachment(att: Attachment): Promise<Result> {
  if (!att?.data_url) return { ok: false, error: 'Attachment has no data' };
  if (Platform.OS === 'web') {
    return webDownload(att) ? { ok: true } : { ok: false, error: 'Download blocked' };
  }
  // On native, the easiest robust path is `Sharing.shareAsync`. The
  // share sheet includes "Save to Files" (iOS), "Save to Downloads /
  // Drive / file manager" (Android) — covering 99 % of save flows
  // without us having to claim WRITE_EXTERNAL_STORAGE permissions.
  try {
    const uri = await persistAttachmentToCache(att);
    const can = await Sharing.isAvailableAsync();
    if (!can) return { ok: false, error: 'Sharing unavailable' };
    await Sharing.shareAsync(uri, {
      mimeType: att.mime || 'application/octet-stream',
      UTI: att.mime || undefined,
      dialogTitle: `Save ${att.name || 'attachment'}`,
    });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not save attachment' };
  }
}

/** Share via system share sheet — alias to save on native; on web,
 *  uses navigator.share when available, else anchor download. */
export async function shareAttachment(att: Attachment): Promise<Result> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share && att?.data_url) {
    try {
      // Best-effort: convert data URL → Blob → File for navigator.share
      // (some browsers refuse `share` without a File). We don't await
      // this strictly — fall back to anchor download on failure.
      const resp = await fetch(att.data_url);
      const blob = await resp.blob();
      const file = new File([blob], sanitiseName(att.name) + guessExt(att.mime, att.name), { type: att.mime || blob.type });
      const data: any = { files: [file], title: att.name };
      if ((navigator as any).canShare && !(navigator as any).canShare(data)) {
        // navigator can't share files of this type — fall through to
        // anchor download.
        return webDownload(att) ? { ok: true } : { ok: false, error: 'Cannot share' };
      }
      await (navigator as any).share(data);
      return { ok: true };
    } catch {
      return webDownload(att) ? { ok: true } : { ok: false, error: 'Cannot share' };
    }
  }
  return saveAttachment(att);
}
