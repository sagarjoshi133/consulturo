/**
 * Owner-curated banner / announcement type shared between the
 * banner UI, the hook, and the admin management screen.
 */
export type AnnouncementVariant = 'info' | 'success' | 'warning' | 'festive';
export type AnnouncementAudience = 'patients' | 'staff' | 'both';
export type AnnouncementPlacement =
  | 'public_landing'
  | 'patient_home'
  | 'booking_flow'
  | 'dashboard';

export type Announcement = {
  id: string;
  clinic_id?: string;
  title_en: string;
  title_hi?: string;
  title_gu?: string;
  body_en?: string;
  body_hi?: string;
  body_gu?: string;
  variant: AnnouncementVariant;
  icon?: string | null;
  audience: AnnouncementAudience;
  placements: AnnouncementPlacement[];
  cta_label_en?: string;
  cta_label_hi?: string;
  cta_label_gu?: string;
  cta_url?: string;
  pinned: boolean;
  active: boolean;
  start_at?: string | null;
  end_at?: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
};

export const VARIANT_META: Record<AnnouncementVariant, { color: string; bg: string; icon: string }> = {
  info: { color: '#0E7C8B', bg: '#E0F2FE', icon: 'information-circle' },
  success: { color: '#15803D', bg: '#DCFCE7', icon: 'checkmark-circle' },
  warning: { color: '#B45309', bg: '#FEF3C7', icon: 'alert-circle' },
  festive: { color: '#9D174D', bg: '#FCE7F3', icon: 'sparkles' },
};
