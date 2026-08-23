/**
 * Comm V2 UI — shared design tokens & tiny helpers.
 *
 * Kept intentionally minimal so every V2 screen inherits the same
 * clinical/utility look. When we cut over from legacy, everything
 * else swaps naturally.
 */
import { StyleSheet } from 'react-native';

export const V2 = {
  bg: '#F7F9FA',
  card: '#FFFFFF',
  border: '#E5EAED',
  divider: '#F1F4F5',
  fg: '#0E3A45',
  fgMuted: '#5A7883',
  fgHint: '#8AA0AB',
  accent: '#0E7C8B',
  accentSoft: '#D6ECF0',
  danger: '#C0362C',
  dangerSoft: '#FDE8E8',
  warning: '#B26A00',
  warningSoft: '#FFF4E1',
  success: '#128A47',
  successSoft: '#E9F7EE',
  unread: '#0E7C8B',
} as const;

export const categoryLabel: Record<string, string> = {
  appointments: 'Appointments',
  care_updates: 'Care',
  reminders: 'Reminders',
  announcements: 'Announcements',
  system: 'System',
  security: 'Security',
  marketing: 'Marketing',
};

export const stateLabel: Record<string, string> = {
  open: 'Open',
  awaiting_clinic: 'Awaiting clinic',
  awaiting_patient: 'Awaiting patient',
  escalated_to_doctor: 'Escalated',
  resolved: 'Resolved',
  archived: 'Archived',
  // broadcast
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  dispatching: 'Dispatching',
  completed: 'Completed',
  partially_failed: 'Partial failure',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const stateTint: Record<string, { bg: string; fg: string }> = {
  awaiting_clinic:     { bg: V2.warningSoft, fg: V2.warning },
  awaiting_patient:    { bg: V2.accentSoft, fg: V2.accent },
  escalated_to_doctor: { bg: V2.dangerSoft, fg: V2.danger },
  resolved:            { bg: V2.successSoft, fg: V2.success },
  archived:            { bg: V2.divider, fg: V2.fgMuted },
  open:                { bg: V2.divider, fg: V2.fgMuted },
  // broadcast
  draft:               { bg: V2.divider, fg: V2.fgMuted },
  pending_approval:    { bg: V2.warningSoft, fg: V2.warning },
  approved:            { bg: V2.accentSoft, fg: V2.accent },
  scheduled:           { bg: V2.accentSoft, fg: V2.accent },
  dispatching:         { bg: V2.warningSoft, fg: V2.warning },
  completed:           { bg: V2.successSoft, fg: V2.success },
  partially_failed:    { bg: V2.dangerSoft, fg: V2.danger },
  rejected:            { bg: V2.dangerSoft, fg: V2.danger },
  cancelled:           { bg: V2.divider, fg: V2.fgMuted },
};

export function relTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  const d = Date.now() - t;
  if (isNaN(d)) return '';
  const s = Math.round(d / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.round(h / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
    year: day > 365 ? '2-digit' : undefined,
  });
}

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: V2.bg },
  headerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: V2.card, borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: V2.border,
  },
  headerTitle: {
    fontSize: 17, fontWeight: '700', color: V2.fg, flex: 1,
  },
  headerBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: V2.card,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: V2.border,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 999,
  },
  chipTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  empty: {
    padding: 32, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: V2.fg, marginBottom: 4 },
  emptyBody: { fontSize: 13, color: V2.fgMuted, textAlign: 'center' },
});
