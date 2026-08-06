import { useCallback, useEffect, useState } from 'react';
import api from './api';

export type ToolId =
  | 'ipss'
  | 'prostate_volume'
  | 'psa'
  | 'bladder_diary'
  | 'iief5'
  | 'stone_risk'
  | 'bmi'
  | 'creatinine'
  | 'crcl'
  | 'egfr';

export type ToolScore = {
  score_id: string;
  tool_id: ToolId;
  score?: number | null;
  label?: string | null;
  details?: Record<string, any>;
  created_at: string;
};

/**
 * Unified history hook for any calculator / tracker.
 * Returns { history, loading, saveScore, removeScore, refresh }.
 * Silently no-ops (and returns empty history) when the user is not signed in.
 *
 * Optional `patientContext` lets staff tag the score with a patient
 * phone / name so it shows up under that patient's profile too.
 */
export function useToolHistory(
  toolId: ToolId,
  patientContext?: { patient_phone?: string; patient_name?: string }
) {
  const [history, setHistory] = useState<ToolScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/tools/scores/${toolId}`);
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [toolId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveScore = useCallback(
    async (score: number | null, label: string, details: Record<string, any> = {}) => {
      setSaving(true);
      try {
        const payload: any = {
          tool_id: toolId,
          score,
          label,
          details,
        };
        if (patientContext?.patient_phone) payload.patient_phone = patientContext.patient_phone;
        if (patientContext?.patient_name) payload.patient_name = patientContext.patient_name;
        const { data } = await api.post('/tools/scores', payload);
        setHistory((prev) => [data, ...prev]);
        return data;
      } finally {
        setSaving(false);
      }
    },
    [toolId, patientContext?.patient_phone, patientContext?.patient_name]
  );

  const removeScore = useCallback(
    async (score_id: string) => {
      try {
        await api.delete(`/tools/scores/${score_id}`);
        setHistory((prev) => prev.filter((h) => h.score_id !== score_id));
      } catch {}
    },
    []
  );

  return { history, loading, saving, saveScore, removeScore, refresh };
}
