/**
 * Centralised hook that fetches the current user's referral code
 * + counters. Called from the Refer screen and from the More tile
 * to show stats inline.
 */
import { useCallback, useEffect, useState } from 'react';
import api from '../api';

export type ReferralCode = {
  code: string;
  referrer_name: string;
  referrer_type: 'patient' | 'staff' | 'doctor';
  clinic_id: string;
  invited: number;
  booked: number;
  visited: number;
};

export function useMyReferralCode() {
  const [data, setData] = useState<ReferralCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/me/referral-code');
      setData(r.data as ReferralCode);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load referral code');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}
