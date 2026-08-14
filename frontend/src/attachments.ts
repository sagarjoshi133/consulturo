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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './api';

export type Attachment = {
  id?: string;
  name?: string;
  mime?: string;
  size_bytes?: number;
  data_url?: string;
  /** Phase C — object-storage reference (preferred over data_url). */
  file_id?: string;
  /** Backend-relative download URL, e.g. "/api/files/{file_id}". */
  url?: string;
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

// ── Phase C: object-storage attachments ────────────────────────────

const remoteFileId = (att?: Attachment): string | null => {
  if (att?.file_id) return att.file_id;
  const m = (att?.url || '').match(/\/api\/files\/([A-Za-z0-9-]+)/);
  return m ? m[1] : null;
};

/** True when the attachment has SOME renderable source (inline base64
 *  or an object-storage reference). */
export const hasAttachmentData = (att?: Attachment): boolean =>
  !!(att?.data_url || remoteFileId(att));

/** Absolute download URL carrying a short-lived `?sid=` token — the
 *  only way web <img> tags (which can't send headers) can fetch it. */
async function remoteUrlWithSid(att: Attachment): Promise<string | null> {
  const id = remoteFileId(att);
  if (!id) return null;
  const token = await AsyncStorage.getItem('session_token');
  return `${API_BASE}/files/${id}${token ? `?sid=${encodeURIComponent(token)}` : ''}`;
}

/** Resolve the URI an <Image>/preview should render: inline data URL
 *  when present, else the authenticated object-storage URL. */
export async function getAttachmentDisplayUri(att: Attachment): Promise<string | null> {
  if (att?.data_url) return att.data_url;
  return remoteUrlWithSid(att);
}

/**
 * Persist an attachment's data URL to a cache file and return the
 * absolute file URI (suitable for Sharing.shareAsync).
 *
 * Throws if the data URL is missing or malformed.
 */
export async function persistAttachmentToCache(att: Attachment): Promise<string> {
  const baseName = sanitiseName(att.name);
  const ext = guessExt(att.mime, baseName);
  const fname = baseName + ext;
  const dir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  const uri = dir.endsWith('/') ? `${dir}${fname}` : `${dir}/${fname}`;

  // Inline base64 (legacy shape)
  if (att?.data_url) {
    const dataUrl = att.data_url;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0 || !dataUrl.startsWith('data:')) {
      throw new Error('Not a data URL');
    }
    const b64 = dataUrl.slice(commaIdx + 1);
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    return uri;
  }

  // Phase C: object-storage reference → authenticated download
  const remote = await remoteUrlWithSid(att);
  if (!remote) throw new Error('Attachment has no data');
  const token = await AsyncStorage.getItem('session_token');
  const res = await FileSystem.downloadAsync(
    remote,
    uri,
    token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  );
  if (!res?.uri) throw new Error('Download failed');
  return res.uri;
}

// Web-only download via anchor click (fetches object-storage files
// into a Blob so the download carries the auth token).
async function webDownload(att: Attachment): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  try {
    let href = att?.data_url || '';
    let revoke: string | null = null;
    if (!href) {
      const remote = await remoteUrlWithSid(att);
      if (!remote) return false;
      const resp = await fetch(remote);
      if (!resp.ok) return false;
      const blob = await resp.blob();
      href = URL.createObjectURL(blob);
      revoke = href;
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = sanitiseName(att.name) + guessExt(att.mime, att.name);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch {}
      if (revoke) { try { URL.revokeObjectURL(revoke); } catch {} }
    }, 400);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/** Open the attachment in the system "Open with…" dialog. */
export async function openAttachment(att: Attachment): Promise<Result> {
  if (!hasAttachmentData(att)) return { ok: false, error: 'Attachment has no data' };
  if (Platform.OS === 'web') {
    // Browsers can navigate directly to the URI — preview opens in a
    // new tab where the user can save it.
    if (typeof window !== 'undefined') {
      try {
        const target = att.data_url || (await remoteUrlWithSid(att));
        if (!target) return { ok: false, error: 'Attachment has no data' };
        window.open(target, '_blank');
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
  if (!hasAttachmentData(att)) return { ok: false, error: 'Attachment has no data' };
  if (Platform.OS === 'web') {
    return (await webDownload(att)) ? { ok: true } : { ok: false, error: 'Download blocked' };
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
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).share && hasAttachmentData(att)) {
    try {
      // Best-effort: convert the source → Blob → File for
      // navigator.share (some browsers refuse `share` without a File).
      const src = att.data_url || (await remoteUrlWithSid(att));
      if (!src) return { ok: false, error: 'Attachment has no data' };
      const resp = await fetch(src);
      const blob = await resp.blob();
      const file = new File([blob], sanitiseName(att.name) + guessExt(att.mime, att.name), { type: att.mime || blob.type });
      const data: any = { files: [file], title: att.name };
      if ((navigator as any).canShare && !(navigator as any).canShare(data)) {
        // navigator can't share files of this type — fall through to
        // anchor download.
        return (await webDownload(att)) ? { ok: true } : { ok: false, error: 'Cannot share' };
      }
      await (navigator as any).share(data);
      return { ok: true };
    } catch {
      return (await webDownload(att)) ? { ok: true } : { ok: false, error: 'Cannot share' };
    }
  }
  return saveAttachment(att);
}
