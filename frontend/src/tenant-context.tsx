/**
 * TenantContext — multi-clinic state for the whole app.
 *
 * Role:
 *  • Loads the list of clinics the current user belongs to from
 *    `GET /api/clinics`.
 *  • Tracks which clinic the user is currently "viewing as" — the
 *    Tenant Switcher pill in the dashboard header writes to this state.
 *  • Persists the selection to AsyncStorage so reloads / fresh launches
 *    return to the same clinic.
 *  • Synchronises with `src/api.ts` via a small registry hook so every
 *    axios request automatically gets the `X-Clinic-Id` header.
 *
 * super_owner specifics:
 *  • If the user is platform super_owner, the list ALSO contains a
 *    pseudo-clinic with `clinic_id = '__all__'` named "All Clinics".
 *    Selecting it sets `currentClinicId = null` which the api layer
 *    treats as "no header → backend returns all clinics".
 *
 * Patients / unauthenticated:
 *  • For users with no memberships (typically `patient`), the context
 *    silently returns `clinics = []` and `currentClinicId = null`. No
 *    header is sent and existing endpoints work unchanged.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { api, setActiveClinicId } from './api';
import { useAuth } from './auth';

const STORAGE_KEY = 'consulturo:active_clinic_id';
export const ALL_CLINICS_ID = '__all__';

export type ClinicSummary = {
  clinic_id: string;
  slug: string;
  name: string;
  tagline?: string;
  email?: string;
  phone?: string;
  address?: string;
  branding?: Record<string, any>;
  is_active?: boolean;
  /** The current user's role at THIS clinic ('primary_owner', 'doctor',
   *  ..., or the synthetic 'super_owner' for the "All Clinics" pill). */
  role?: string;
};

type TenantContextValue = {
  clinics: ClinicSummary[];
  currentClinicId: string | null;
  currentClinic: ClinicSummary | null;
  isAllClinicsView: boolean;
  loading: boolean;
  /** True when the signed-in user is the platform super_owner. */
  isSuperOwner: boolean;
  /** True if there's at least one membership (or super_owner). */
  hasTenant: boolean;
  setCurrentClinicId: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
};

const TenantContext = createContext<TenantContextValue>({
  clinics: [],
  currentClinicId: null,
  currentClinic: null,
  isAllClinicsView: false,
  loading: false,
  isSuperOwner: false,
  hasTenant: false,
  setCurrentClinicId: async () => {},
  refresh: async () => {},
});

export const useTenant = () => useContext(TenantContext);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const authReady = !authLoading;
  const [clinics, setClinics] = useState<ClinicSummary[]>([]);
  const [currentClinicId, setCurrentClinicIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastUserIdRef = useRef<string | null>(null);

  const isSuperOwner = (user as any)?.role === 'super_owner';

  // ── Apply selection to api layer + persist ────────────────────────
  const applySelection = useCallback(async (id: string | null) => {
    // Tell the axios instance which X-Clinic-Id header to inject. The
    // pseudo-clinic "All Clinics" maps to a NULL header so the
    // super_owner sees all rows.
    const apiClinicId = id && id !== ALL_CLINICS_ID ? id : null;
    setActiveClinicId(apiClinicId);
    setCurrentClinicIdState(id);
    try {
      if (id) await AsyncStorage.setItem(STORAGE_KEY, id);
      else await AsyncStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  // ── Fetch clinics list ────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!authReady) return;
    if (!user) {
      setClinics([]);
      await applySelection(null);
      return;
    }
    setLoading(true);
    try {
      const r = await api.get('/clinics');
      const list: ClinicSummary[] = Array.isArray(r?.data?.clinics)
        ? r.data.clinics
        : [];
      // For super_owner, prepend the "All Clinics" virtual entry so the
      // switcher can offer a "see everything" mode.
      const finalList: ClinicSummary[] = isSuperOwner
        ? [
            {
              clinic_id: ALL_CLINICS_ID,
              slug: 'all',
              name: 'All Clinics',
              tagline: 'Platform-wide view',
              role: 'super_owner',
              is_active: true,
            } as ClinicSummary,
            ...list,
          ]
        : list;
      setClinics(finalList);

      // Restore previous selection from AsyncStorage if it's still
      // present in the list. Otherwise default to:
      //   • super_owner → "All Clinics" (transparent default)
      //   • everyone else → response.default_clinic_id, falling back
      //     to the first item.
      let target: string | null = null;
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored && finalList.some((c) => c.clinic_id === stored)) {
          target = stored;
        }
      } catch {}
      if (!target) {
        if (isSuperOwner) {
          target = ALL_CLINICS_ID;
        } else {
          target =
            r?.data?.default_clinic_id ||
            (finalList[0]?.clinic_id ?? null);
        }
      }
      await applySelection(target);
    } catch (e: any) {
      // 401 means the user is not signed in or not allowed — silent
      // fall back to no-tenant; the rest of the app will keep working
      // for unauthenticated/patient flows.
      // eslint-disable-next-line no-console
      console.warn('[tenant] failed to load clinics:', e?.message || e);
      setClinics([]);
      await applySelection(null);
    } finally {
      setLoading(false);
    }
  }, [user, authReady, isSuperOwner, applySelection]);

  // Re-fetch whenever the signed-in user changes.
  useEffect(() => {
    const uid = (user as any)?.user_id || null;
    if (uid !== lastUserIdRef.current) {
      lastUserIdRef.current = uid;
      void refresh();
    }
  }, [user, refresh]);

  // ── Public setter (validates membership) ──────────────────────────
  const setCurrentClinicId = useCallback(
    async (id: string | null) => {
      // Allow null (no header) only for super_owner; for everyone else
      // we coerce to the first clinic to avoid leaking unscoped queries.
      if (!id && !isSuperOwner) {
        const first = clinics[0]?.clinic_id ?? null;
        await applySelection(first);
        return;
      }
      await applySelection(id);
    },
    [isSuperOwner, clinics, applySelection],
  );

  // ── Derived state ─────────────────────────────────────────────────
  const isAllClinicsView = currentClinicId === ALL_CLINICS_ID || (isSuperOwner && currentClinicId == null);
  const currentClinic = useMemo<ClinicSummary | null>(
    () => clinics.find((c) => c.clinic_id === currentClinicId) || null,
    [clinics, currentClinicId],
  );

  const hasTenant = isSuperOwner || clinics.length > 0;

  const value = useMemo<TenantContextValue>(
    () => ({
      clinics,
      currentClinicId,
      currentClinic,
      isAllClinicsView,
      loading,
      isSuperOwner,
      hasTenant,
      setCurrentClinicId,
      refresh,
    }),
    [
      clinics,
      currentClinicId,
      currentClinic,
      isAllClinicsView,
      loading,
      isSuperOwner,
      hasTenant,
      setCurrentClinicId,
      refresh,
    ],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}
