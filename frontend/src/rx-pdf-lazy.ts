/**
 * Lazy wrapper around the heavy `rx-pdf.ts` module.
 *
 * `rx-pdf.ts` is ~1.4 K LoC and pulls in `expo-print`, html2canvas
 * helpers and a large clinic-letterhead template. None of that is
 * needed until the user actually taps "Save & PDF" / "Print" — so we
 * defer the import to the first call.
 *
 * The static `loadClinicSettings()` call is small and used on every
 * Rx screen mount, so we DO re-export it eagerly (it lives at the
 * top of `rx-pdf.ts`, but the runtime cost is negligible — the heavy
 * part is the PDF builder + expo-print init).
 *
 * Usage:
 *   import { downloadPrescriptionPdf } from '../../src/rx-pdf-lazy';
 *   await downloadPrescriptionPdf(rx, settings);
 */
import type { RxDoc, ClinicSettings } from './rx-pdf';

export type { ClinicSettings, RxDoc };

let _mod: typeof import('./rx-pdf') | null = null;
async function _load(): Promise<typeof import('./rx-pdf')> {
  if (!_mod) _mod = await import('./rx-pdf');
  return _mod;
}

export async function downloadPrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  const m = await _load();
  return m.downloadPrescriptionPdf(rx, settings);
}

export async function printPrescription(rx: RxDoc, settings?: ClinicSettings) {
  const m = await _load();
  return m.printPrescription(rx, settings);
}

export async function sharePrescriptionPdf(rx: RxDoc, settings?: ClinicSettings) {
  const m = await _load();
  return m.sharePrescriptionPdf(rx, settings);
}

export async function loadClinicSettings(): Promise<ClinicSettings> {
  const m = await _load();
  return m.loadClinicSettings();
}

export async function fetchRxAndRun<T = void>(
  rxId: string,
  fn: (rx: RxDoc, settings?: ClinicSettings) => Promise<T>,
): Promise<T | undefined> {
  const m = await _load();
  // The real signature is (rxId, action(rx)); we adapt to a 2-arg fn
  // signature for the lazy wrapper to maintain forward-compatibility.
  let captured: T | undefined;
  await m.fetchRxAndRun(rxId, async (rx) => {
    captured = await fn(rx);
  });
  return captured;
}
