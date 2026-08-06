/**
 * Wave 3 finish + Wave 4 — API client.
 */
import api from '../api';

// ── O · AI Rx suggest ──────────────────────────────────────────────

export type RxSuggestion = {
  ok: boolean;
  diagnosis: string;
  rationale: string;
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
  warnings: string[];
};

export async function aiSuggestRx(input: {
  diagnosis: string;
  age?: number | null;
  sex?: string | null;
  allergies?: string[];
  notes?: string;
}): Promise<RxSuggestion> {
  const { data } = await api.post('/ai/rx-suggest', input);
  return data as RxSuggestion;
}

// ── P · Inbox triage ────────────────────────────────────────────────

export type TriageResult = {
  id: string;
  tag: 'urgent' | 'routine' | 'admin' | 'question';
  reason: string;
  score: number;
};

export async function aiTriage(items: Array<{ id: string; text: string }>): Promise<TriageResult[]> {
  const { data } = await api.post('/ai/messages/triage', { items });
  return (data?.results || []) as TriageResult[];
}

// ── R / S / T · Analytics ──────────────────────────────────────────

export type DashboardWidgets = {
  ok: boolean;
  month: string;
  widgets: {
    opd_count: number;
    surgery_count: number;
    ipd_count: number;
    new_patients: number;
    revenue: number;
    pending_receivables: number;
    top_procedure: { name: string; count: number };
  };
};

export async function fetchDashboardWidgets(): Promise<DashboardWidgets> {
  const { data } = await api.get('/analytics/widgets');
  return data as DashboardWidgets;
}

export type ReferrerStats = {
  ok: boolean;
  window_months: number;
  total_referred: number;
  top: Array<{ name: string; count: number }>;
  series: Record<string, Array<{ month: string; count: number }>>;
};

export async function fetchReferrers(months = 6): Promise<ReferrerStats> {
  const { data } = await api.get('/analytics/referrers', { params: { months } });
  return data as ReferrerStats;
}

export type OutcomeRow = {
  procedure: string;
  total: number;
  success: number;
  complications: number;
  unknown: number;
  success_rate: number;
  complication_rate: number;
};

export type OutcomeStats = {
  ok: boolean;
  window_months: number;
  procedures: OutcomeRow[];
  total_surgeries: number;
};

export async function fetchOutcomes(months = 12): Promise<OutcomeStats> {
  const { data } = await api.get('/analytics/outcomes-summary', { params: { months } });
  return data as OutcomeStats;
}
