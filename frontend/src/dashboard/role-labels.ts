/**
 * Maps an internal role key (super_owner, primary_owner, …) to a
 * short human-friendly label suitable for the tight role badge
 * inside the dashboard hero card.
 *
 * The RAW role keys are snake_case and up to 13 characters long
 * (PRIMARY_OWNER) which wrap to two lines and overflow into the
 * right-side widgets on narrow phones. We display the mapped label
 * here while every permission check continues to use the canonical
 * user.role value — nothing else changes.
 */
export function roleDisplayLabel(role?: string | null): string {
  if (!role) return '';
  const map: Record<string, string> = {
    super_owner: 'SUPER OWNER',
    primary_owner: 'OWNER',
    owner: 'OWNER',
    partner: 'PARTNER',
    doctor: 'DOCTOR',
    assistant: 'ASSISTANT',
    reception: 'RECEPTION',
    nursing: 'NURSING',
    patient: 'PATIENT',
  };
  return map[role] || role.toUpperCase().replace(/_/g, ' ');
}

/** Static list of roles assignable to a team member. */
export const STAFF = [
  'super_owner',
  'primary_owner',
  'owner',
  'partner',
  'doctor',
  'assistant',
  'reception',
  'nursing',
] as const;

/** Roles that can be assigned from the team-management UI. */
export const ROLES: { id: string; label: string }[] = [
  { id: 'doctor', label: 'Doctor' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'reception', label: 'Reception' },
  { id: 'nursing', label: 'Nursing Staff' },
];
