/**
 * ipd-panel.tsx — thin re-export for backward compatibility.
 *
 * The IPD module has been refactored into per-component / per-tab
 * files under `src/ipd/`. This file preserves the original import
 * path so callers (e.g. dashboard tab routing, deep links) keep
 * working without changes.
 *
 * New module layout (June 2026 refactor):
 *   src/ipd/types.ts            — Bed, Admission, Stats, TabKey types
 *   src/ipd/styles.ts           — shared StyleSheet for the entire module
 *   src/ipd/components.tsx      — Field, Row, ActionRow, KpiTile, etc.
 *   src/ipd/dashboard.tsx       — main IPD dashboard (KPI + beds + list)
 *   src/ipd/admission-detail.tsx — drawer (hero + tab router)
 *   src/ipd/transfer-modal.tsx  — Bed Transfer modal (bound to /ipd/beds)
 *   src/ipd/tabs/{overview,rounds,vitals,meds,consents,discharge}-tab.tsx
 */
export { default } from './ipd/dashboard';
