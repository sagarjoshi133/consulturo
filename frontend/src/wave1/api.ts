/**
 * Wave 1 — shared API helpers for Search, Timeline, Rx Templates,
 * Allergies, and Lab Results.
 */
import api from '../api';

export type SearchHit = {
  type: 'patient' | 'booking' | 'prescription' | 'surgery' | 'ipd';
  title: string;
  subtitle?: string;
  phone?: string;
  link?: string | null;
};

export async function globalSearch(q: string, limit = 6): Promise<SearchHit[]> {
  if (!q || q.trim().length < 2) return [];
  const { data } = await api.get('/search', { params: { q: q.trim(), limit } });
  return data?.results || [];
}

export type TimelineEvent = {
  type: 'booking' | 'prescription' | 'surgery' | 'receipt' | 'ipd' | 'medcert' | 'lab' | 'ipss';
  ts?: string | null;
  title: string;
  subtitle?: string;
  meta?: Record<string, any>;
  ref_id?: string;
  link?: string | null;
};

export async function fetchTimeline(phone: string): Promise<TimelineEvent[]> {
  if (!phone) return [];
  const { data } = await api.get('/patients/timeline', { params: { phone } });
  return data?.events || [];
}

export type RxTemplateMed = {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
};

export type RxTemplate = {
  template_id: string;
  name: string;
  diagnosis?: string;
  medicines: RxTemplateMed[];
  investigations?: string;
  advice?: string;
  follow_up?: string;
  updated_at?: string;
};

export async function listRxTemplates(): Promise<RxTemplate[]> {
  const { data } = await api.get('/rx-templates');
  return data?.templates || [];
}

export async function saveRxTemplate(t: Partial<RxTemplate> & { name: string }): Promise<RxTemplate> {
  if (t.template_id) {
    const { data } = await api.patch(`/rx-templates/${t.template_id}`, t);
    return data;
  }
  const { data } = await api.post('/rx-templates', t);
  return data;
}

export async function deleteRxTemplate(template_id: string): Promise<void> {
  await api.delete(`/rx-templates/${template_id}`);
}

export type Allergies = {
  phone: string;
  allergies: string[];
  notes?: string;
  updated_at?: string | null;
};

export async function getAllergies(phone: string): Promise<Allergies> {
  const { data } = await api.get('/patients/allergies', { params: { phone } });
  return data;
}

export async function setAllergies(phone: string, allergies: string[], notes = ''): Promise<void> {
  await api.patch('/patients/allergies', { phone, allergies, notes });
}

export type LabPreset = { key: string; label: string; unit: string; group: string };
export type LabResult = {
  result_id: string;
  phone: string;
  test_name: string;
  test_key: string;
  value: number;
  unit?: string;
  date: string;
  notes?: string;
};

export async function getLabPresets(): Promise<LabPreset[]> {
  const { data } = await api.get('/lab-results/presets');
  return data?.presets || [];
}

export async function listLabResults(phone: string, test_name?: string): Promise<LabResult[]> {
  const { data } = await api.get('/lab-results', { params: { phone, test_name } });
  return data?.results || [];
}

export async function addLabResult(r: {
  phone: string;
  test_name: string;
  value: number;
  unit?: string;
  date?: string;
  notes?: string;
}): Promise<LabResult> {
  const { data } = await api.post('/lab-results', r);
  return data;
}

export async function deleteLabResult(result_id: string): Promise<void> {
  await api.delete(`/lab-results/${result_id}`);
}
