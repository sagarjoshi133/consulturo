/**
 * Wave 5 — Compliance / 2FA / DPDP / Audit API client.
 */
import api from '../api';

export type TotpSetup = {
  ok: boolean;
  secret: string;
  otpauth_url: string;
  instructions: string;
};

export type TotpStatus = {
  enabled: boolean;
  pending: boolean;
  enabled_at?: string | null;
};

export async function totpSetup(label?: string): Promise<TotpSetup> {
  const { data } = await api.post('/security/2fa/setup', { label });
  return data as TotpSetup;
}

export async function totpVerify(code: string): Promise<{ ok: boolean; enabled: boolean }> {
  const { data } = await api.post('/security/2fa/verify', { code });
  return data;
}

export async function totpStatus(): Promise<TotpStatus> {
  const { data } = await api.get('/security/2fa/status');
  return data as TotpStatus;
}

export async function totpDisable(): Promise<{ ok: boolean; enabled: boolean }> {
  const { data } = await api.post('/security/2fa/disable');
  return data;
}

/** Builds a downloadable URL for the DPDP export endpoint.
 *  The browser will stream the JSON as `consulturo-export-…json`. */
export function dpdpExportUrl(phone?: string): string {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/$/, '');
  const q = phone ? `?phone=${encodeURIComponent(phone)}` : '';
  return `${base}/api/dpdp/export${q}`;
}
