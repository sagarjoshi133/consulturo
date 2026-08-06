/**
 * DOC_THEME — single source of truth for document color coding.
 *
 * Each generated document type (Prescription, Receipt, Admission,
 * Discharge Summary, Medical Certificate, Daily Progress Note,
 * Consent) gets a distinct accent colour so users can identify them
 * at a glance — both in the in-app card list AND on the printed
 * PDF (header strip + footer accent).
 *
 * The actual rendering layers (PDF generators, list cards, badges)
 * pull from this constant. To add a new document kind, append a row
 * here and reference `DOC_THEME[kind].accent` in the renderer.
 */
export type DocKind =
  | 'prescription'
  | 'receipt'
  | 'admission'
  | 'discharge'
  | 'medical_certificate'
  | 'daily_progress'
  | 'consent'
  | 'investigation_report';

export type DocThemeEntry = {
  /** Primary accent — used for header strip / top border / icon tint. */
  accent: string;
  /** Subtle tint of accent — used for badges / row strip backgrounds. */
  tintBg: string;
  /** Short label shown on the badge. */
  label: string;
  /** Ionicons name representing the doc kind. */
  icon: string;
};

export const DOC_THEME: Record<DocKind, DocThemeEntry> = {
  prescription:         { accent: '#0E7C8B', tintBg: '#0E7C8B14', label: 'Prescription',         icon: 'document-text' },
  receipt:              { accent: '#16A34A', tintBg: '#16A34A14', label: 'Receipt',              icon: 'cash' },
  admission:            { accent: '#4F46E5', tintBg: '#4F46E514', label: 'Admission',            icon: 'enter' },
  discharge:            { accent: '#7C3AED', tintBg: '#7C3AED14', label: 'Discharge',            icon: 'exit' },
  medical_certificate:  { accent: '#CA8A04', tintBg: '#CA8A0414', label: 'Medical Certificate',  icon: 'ribbon' },
  daily_progress:       { accent: '#0EA5E9', tintBg: '#0EA5E914', label: 'Daily Progress',       icon: 'pulse' },
  consent:              { accent: '#E11D48', tintBg: '#E11D4814', label: 'Consent',              icon: 'checkbox' },
  investigation_report: { accent: '#475569', tintBg: '#47556914', label: 'Investigation',        icon: 'flask' },
};

/** Convenience — returns the accent or a sensible fallback. */
export function docAccent(kind: DocKind | string | undefined): string {
  if (!kind) return '#0E7C8B';
  return (DOC_THEME as any)[kind]?.accent || '#0E7C8B';
}
