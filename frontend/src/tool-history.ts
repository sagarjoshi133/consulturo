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
 */
export function useToolHistory(toolId: ToolId) {
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
        const { data } = await api.post('/tools/scores', {
          tool_id: toolId,
          score,
          label,
          details,
        });
        setHistory((prev) => [data, ...prev]);
        return data;
      } finally {
        setSaving(false);
      }
    },
    [toolId]
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
