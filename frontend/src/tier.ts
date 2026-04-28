/**
 * useTier — hook to fetch + cache the current user's role-tier flags
 * from `GET /api/me/tier`. Refreshed every 60 s alongside notifications,
 * and on every focus of the screens that depend on it (Profile,
 * Dashboard, Permission Manager).
 *
 * The 4-tier hierarchy:
 *   super_owner   → app.consulturo@gmail.com (platform admin)
 *   primary_owner → senior co-owners (multiple allowed)
 *   partner       → equal admin/clinical powers EXCEPT partner mgmt
 *   {staff,patient} → existing roles
 *
 * Usage:
 *   const tier = useTier();
 *   if (tier.canManagePartners) { ... }
 *   if (tier.isSuperOwner) { ... }
 */
import { useCallback, useEffect, useState } from 'react';
import api from './api';
import { useAuth } from './auth';

export type Tier = {
  role: string | null;
  isSuperOwner: boolean;
  isPrimaryOwner: boolean;
  isPartner: boolean;
  isOwnerTier: boolean;
  canManagePartners: boolean;
  canManagePrimaryOwners: boolean;
  canCreateBlog: boolean;
  dashboardFullAccess: boolean;
  isDemo: boolean;
  loading: boolean;
};

const EMPTY_TIER: Tier = {
  role: null,
  isSuperOwner: false,
  isPrimaryOwner: false,
  isPartner: false,
  isOwnerTier: false,
  canManagePartners: false,
  canManagePrimaryOwners: false,
  canCreateBlog: false,
  dashboardFullAccess: false,
  isDemo: false,
  loading: false,
};

export function useTier(): Tier & { refresh: () => Promise<void> } {
  const { user } = useAuth();
  const [tier, setTier] = useState<Tier>(EMPTY_TIER);

  const refresh = useCallback(async () => {
    if (!user) {
      setTier(EMPTY_TIER);
      return;
    }
    setTier((t) => ({ ...t, loading: true }));
    try {
      const { data } = await api.get('/me/tier');
      setTier({
        role: data?.role || null,
        isSuperOwner: !!data?.is_super_owner,
        isPrimaryOwner: !!data?.is_primary_owner,
        isPartner: !!data?.is_partner,
        isOwnerTier: !!data?.is_owner_tier,
        canManagePartners: !!data?.can_manage_partners,
        canManagePrimaryOwners: !!data?.can_manage_primary_owners,
        canCreateBlog: !!data?.can_create_blog,
        dashboardFullAccess: !!data?.dashboard_full_access,
        isDemo: !!data?.is_demo,
        loading: false,
      });
    } catch {
      // Best-effort: leave the previous value, just clear loading.
      setTier((t) => ({ ...t, loading: false }));
    }
  }, [user]);

  useEffect(() => {
    refresh();
    if (!user) return;
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [user, refresh]);

  return { ...tier, refresh };
}

/** Pretty-print a role string for badges, headers etc. */
export function roleLabel(role: string | null | undefined): string {
  switch (role) {
    case 'super_owner': return 'Super Owner';
    case 'primary_owner': return 'Primary Owner';
    case 'owner': return 'Primary Owner'; // legacy alias
    case 'partner': return 'Partner';
    case 'doctor': return 'Doctor';
    case 'assistant': return 'Assistant';
    case 'reception': return 'Reception';
    case 'nursing': return 'Nursing';
    case 'patient': return 'Patient';
    default: return (role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'User';
  }
}

/** Role-emoji map, used as a 1-glyph badge in headers / cards. */
export function roleEmoji(role: string | null | undefined): string {
  switch (role) {
    case 'super_owner': return '🛡️';
    case 'primary_owner':
    case 'owner': return '👑';
    case 'partner': return '⭐';
    case 'doctor': return '🩺';
    case 'assistant': return '🧑‍⚕️';
    case 'reception': return '📞';
    case 'nursing': return '💉';
    default: return '';
  }
}
