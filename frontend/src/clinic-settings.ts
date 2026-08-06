/**
 * Tiny helper to fetch (and cache, for the duration of a screen mount)
 * the clinic-wide settings document. Used by payment buttons to pull
 * the default consultation fee, etc.
 */
import api from './api';

export type ClinicSettings = {
  doctor_name?: string;
  doctor_title?: string;
  clinic_name?: string;
  consultation_fee_inr?: number;
  ipd_advance_inr?: number;
  payments_enabled?: boolean;
  // ...many more — keep the type open-ended.
  [key: string]: any;
};

let _cache: { at: number; data: ClinicSettings | null } | null = null;

export async function fetchClinicSettings(force = false): Promise<ClinicSettings | null> {
  if (!force && _cache && Date.now() - _cache.at < 5 * 60 * 1000) {
    return _cache.data;
  }
  try {
    const { data } = await api.get('/clinic-settings');
    _cache = { at: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}

export function clearClinicSettingsCache() {
  _cache = null;
}
