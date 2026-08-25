/**
 * Wave 3 — AI feature API client.
 *
 * Wraps the three endpoints in /api/ai/* with safe error handling
 * and small UX niceties (timeout copy, error normalization).
 */
import api from '../api';

// ── M · Voice-to-Rx ────────────────────────────────────────────────

export type VoiceToRxResult = {
  ok: boolean;
  transcript: string;
  parsed: {
    diagnosis: string;
    medicines: Array<{
      name: string;
      dose?: string;
      frequency?: string;
      duration?: string;
      instructions?: string;
    }>;
    investigations: string;
    advice: string;
    follow_up: string;
  };
  model: string;
  stt_model: string;
};

/**
 * Send a recorded audio file (m4a/wav/webm) to the server for
 * Whisper-1 transcription + Claude structured-parsing.
 *
 * `audioUri` should be a local file URI from expo-audio or a Blob URL
 * on the web.
 */
export async function uploadDictation<T = any>(
  endpoint: string,
  audioUri: string,
  options: { language?: string; filename?: string } = {},
): Promise<T> {
  const language = options.language || 'en';
  const filename = options.filename || `dictation.m4a`;
  const ext = filename.split('.').pop() || 'm4a';
  const mime =
    ext === 'wav' ? 'audio/wav' :
    ext === 'webm' ? 'audio/webm' :
    ext === 'mp3' ? 'audio/mpeg' :
    ext === 'mp4' ? 'audio/mp4' :
    'audio/m4a';

  const form = new FormData();
  // React-Native FormData expects an object with uri/name/type for
  // file uploads; web FormData expects a Blob. Build a shape that
  // satisfies whichever runtime is active.
  if (typeof window !== 'undefined' && audioUri.startsWith('blob:')) {
    const blob = await fetch(audioUri).then((r) => r.blob());
    form.append('audio', new File([blob], filename, { type: mime }));
  } else {
    // React Native: file descriptor object
    form.append('audio', {
      // @ts-ignore — RN FormData accepts this shape.
      uri: audioUri,
      name: filename,
      type: mime,
    } as any);
  }
  form.append('language', language);

  const { data } = await api.post(endpoint, form, {
    timeout: 60_000,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data as T;
}

export async function voiceToRx(
  audioUri: string,
  options: { language?: string; filename?: string } = {},
): Promise<VoiceToRxResult> {
  return uploadDictation<VoiceToRxResult>('/ai/voice-to-rx', audioUri, options);
}

// ── N · AI Patient Gist ────────────────────────────────────────────

export type PatientGist = {
  phone: string;
  gist: string;
  cached: boolean;
  generated_at?: string;
};

export async function getPatientGist(phone: string, refresh = false): Promise<PatientGist> {
  const { data } = await api.get('/ai/patient-gist', { params: { phone, refresh } });
  return data;
}

// ── Q · Lab OCR ────────────────────────────────────────────────────

export type LabOcrResult = {
  ok: boolean;
  phone: string;
  report_date: string;
  results: Array<{ test_name: string; value: number; unit?: string; ref_range?: string }>;
  saved: string[];
  saved_count: number;
  model: string;
};

export async function labOcr(opts: {
  imageUri: string;
  phone?: string;
  autoSave?: boolean;
  filename?: string;
}): Promise<LabOcrResult> {
  const filename = opts.filename || 'lab.jpg';
  const ext = filename.split('.').pop() || 'jpg';
  const mime =
    ext === 'png' ? 'image/png' :
    ext === 'webp' ? 'image/webp' :
    'image/jpeg';

  const form = new FormData();
  if (typeof window !== 'undefined' && opts.imageUri.startsWith('blob:')) {
    const blob = await fetch(opts.imageUri).then((r) => r.blob());
    form.append('image', new File([blob], filename, { type: mime }));
  } else {
    form.append('image', {
      // @ts-ignore
      uri: opts.imageUri,
      name: filename,
      type: mime,
    } as any);
  }
  if (opts.phone) form.append('phone', opts.phone);
  form.append('auto_save', opts.autoSave ? 'true' : 'false');

  const { data } = await api.post('/ai/lab-ocr', form, {
    timeout: 60_000,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data as LabOcrResult;
}
