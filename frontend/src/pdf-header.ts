// Shared, per-document PDF header configuration.
//
// The owner configures, PER document type, under Branding → Document
// Headers:
//   • a left-side logo image (replaces the default logo),
//   • which line is the big title (clinic name OR doctor name),
//   • the order, visibility and text of every header line.
//
// Each PDF builder keeps its OWN outer wrapper + CSS classes and just
// asks this helper to render the inner header lines (and resolve the
// logo), so every document stays visually on-brand while becoming
// fully editable.

export type DocHeaderType =
  | 'prescription'
  | 'receipt'
  | 'discharge'
  | 'consent'
  | 'medical_certificate'
  | 'encounter';

export const DOC_HEADER_TYPES: { key: DocHeaderType; label: string }[] = [
  { key: 'prescription', label: 'Prescription' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'discharge', label: 'Discharge Summary' },
  { key: 'consent', label: 'Consent Form' },
  { key: 'medical_certificate', label: 'Medical Certificate' },
  { key: 'encounter', label: 'Encounter / Visit Summary' },
];

// The seven canonical header lines a clinic can surface.
export type HeaderLineKey =
  | 'clinic_name'
  | 'doctor_name'
  | 'doctor_title'
  | 'doctor_degrees'
  | 'clinic_address'
  | 'clinic_phone'
  | 'doctor_reg_no';

export const HEADER_LINE_DEFS: { key: HeaderLineKey; label: string }[] = [
  { key: 'clinic_name', label: 'Clinic / Hospital name' },
  { key: 'doctor_name', label: 'Doctor name' },
  { key: 'doctor_title', label: 'Title / Specialty' },
  { key: 'doctor_degrees', label: 'Degrees' },
  { key: 'clinic_address', label: 'Clinic address' },
  { key: 'clinic_phone', label: 'Phone' },
  { key: 'doctor_reg_no', label: 'Reg. No.' },
];

export type HeaderLine = {
  key: HeaderLineKey;
  visible: boolean;
  text?: string; // override; empty → use the resolved clinic field value
  order: number;
};

export type DocHeaderCfg = {
  logo_b64?: string;
  title_source: 'clinic' | 'doctor';
  lines: HeaderLine[];
};

// Per-document defaults — chosen so each document keeps its current
// look until the owner customises it. Receipt leads with the clinic
// name as the title (per the clinic's request); the rest lead with the
// doctor name.
function defaultLines(order: HeaderLineKey[], hidden: HeaderLineKey[] = []): HeaderLine[] {
  return order.map((key, i) => ({ key, visible: !hidden.includes(key), order: i }));
}

const DEFAULTS: Record<DocHeaderType, DocHeaderCfg> = {
  prescription: {
    title_source: 'doctor',
    lines: defaultLines(
      ['doctor_name', 'doctor_degrees', 'doctor_title', 'clinic_name', 'clinic_phone', 'doctor_reg_no', 'clinic_address'],
      ['clinic_address'],
    ),
  },
  receipt: {
    title_source: 'clinic',
    lines: defaultLines(
      ['clinic_name', 'doctor_name', 'doctor_degrees', 'doctor_title', 'clinic_phone', 'doctor_reg_no', 'clinic_address'],
      ['clinic_address'],
    ),
  },
  encounter: {
    title_source: 'doctor',
    lines: defaultLines(
      ['doctor_name', 'doctor_degrees', 'clinic_name', 'clinic_phone', 'doctor_reg_no', 'doctor_title', 'clinic_address'],
      ['doctor_title', 'clinic_address'],
    ),
  },
  discharge: {
    title_source: 'doctor',
    lines: defaultLines(
      ['doctor_name', 'doctor_degrees', 'clinic_name', 'clinic_address', 'clinic_phone', 'doctor_reg_no', 'doctor_title'],
      ['doctor_title'],
    ),
  },
  medical_certificate: {
    title_source: 'doctor',
    lines: defaultLines(
      ['doctor_name', 'doctor_degrees', 'clinic_name', 'clinic_address', 'clinic_phone', 'doctor_reg_no', 'doctor_title'],
      ['doctor_title'],
    ),
  },
  consent: {
    title_source: 'doctor',
    lines: defaultLines(
      ['doctor_name', 'doctor_degrees', 'doctor_reg_no', 'clinic_name', 'clinic_address', 'clinic_phone', 'doctor_title'],
      ['doctor_title'],
    ),
  },
};

export function defaultDocHeaderCfg(docType: DocHeaderType): DocHeaderCfg {
  const d = DEFAULTS[docType];
  return { title_source: d.title_source, logo_b64: '', lines: d.lines.map((l) => ({ ...l })) };
}

/** Merge a stored per-doc config (from clinic_settings.doc_headers) with
 *  the defaults so missing keys/lines are always filled in. */
export function getDocHeaderCfg(docHeaders: any, docType: DocHeaderType): DocHeaderCfg {
  const base = defaultDocHeaderCfg(docType);
  const stored = docHeaders && typeof docHeaders === 'object' ? docHeaders[docType] : null;
  if (!stored || typeof stored !== 'object') return base;
  const title_source = stored.title_source === 'clinic' || stored.title_source === 'doctor'
    ? stored.title_source
    : base.title_source;
  let lines: HeaderLine[] = Array.isArray(stored.lines) && stored.lines.length
    ? stored.lines
        .filter((l: any) => l && HEADER_LINE_DEFS.some((d) => d.key === l.key))
        .map((l: any, i: number) => ({
          key: l.key as HeaderLineKey,
          visible: l.visible !== false,
          text: typeof l.text === 'string' ? l.text : '',
          order: typeof l.order === 'number' ? l.order : i,
        }))
    : base.lines;
  // Ensure every canonical line is present (append any missing at end,
  // hidden) so the editor always shows the full set.
  for (const def of HEADER_LINE_DEFS) {
    if (!lines.some((l) => l.key === def.key)) {
      lines.push({ key: def.key, visible: false, text: '', order: lines.length });
    }
  }
  lines = [...lines].sort((a, b) => a.order - b.order);
  return { title_source, logo_b64: typeof stored.logo_b64 === 'string' ? stored.logo_b64 : '', lines };
}

const TITLE_KEY: Record<'clinic' | 'doctor', HeaderLineKey> = {
  clinic: 'clinic_name',
  doctor: 'doctor_name',
};

export function headerLogoSrc(cfg: DocHeaderCfg, fallback: string): string {
  const b = (cfg.logo_b64 || '').trim();
  return b || fallback;
}

type RenderTags = {
  title: (txt: string) => string;
  subtitle: (txt: string) => string;
  degrees: (txt: string) => string;
  reg: (txt: string) => string;
  line: (txt: string) => string;
  esc: (s: any) => string;
};

/** Render the ordered, visible header lines. `values` supplies the
 *  resolved clinic field values; a per-line `text` override wins when
 *  present. The title_source line is emitted via `tags.title`; the OTHER
 *  primary name (clinic/doctor) is emitted via `tags.subtitle` so it
 *  stays prominent — one visual step below the main title. */
export function renderHeaderInner(
  cfg: DocHeaderCfg,
  values: Partial<Record<HeaderLineKey, string>>,
  tags: RenderTags,
): string {
  const titleKey = TITLE_KEY[cfg.title_source];
  const subtitleKey: HeaderLineKey = titleKey === 'clinic_name' ? 'doctor_name' : 'clinic_name';
  const parts: string[] = [];
  for (const ln of cfg.lines) {
    if (!ln.visible) continue;
    const raw = (ln.text && ln.text.trim()) ? ln.text.trim() : (values[ln.key] || '');
    if (!raw) continue;
    const txt = tags.esc(raw);
    if (ln.key === titleKey) parts.push(tags.title(txt));
    else if (ln.key === subtitleKey) parts.push(tags.subtitle(txt));
    else if (ln.key === 'doctor_degrees') parts.push(tags.degrees(txt));
    else if (ln.key === 'doctor_reg_no') parts.push(tags.reg(txt));
    else parts.push(tags.line(txt));
  }
  // Safety: if nothing visible produced a title, emit the title value
  // so the header is never empty.
  if (!parts.length) {
    const t = values[titleKey] || values.clinic_name || values.doctor_name || '';
    if (t) parts.push(tags.title(tags.esc(t)));
  }
  return parts.join('\n');
}
