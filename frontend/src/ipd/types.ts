/**
 * Shared types for the IPD module.
 */

export type Bed = {
  id: string;
  ward: string;
  bed_no: string;
  notes?: string | null;
  status?: 'available' | 'occupied';
  current_admission?: { id: string; ipd_no: string; patient_name: string } | null;
};

export type Admission = {
  id: string;
  ipd_no: string;
  patient_name: string;
  patient_phone?: string | null;
  patient_age?: number | null;
  patient_sex?: string | null;
  patient_gender?: string | null;
  diagnosis?: string;
  planned_procedure?: string;
  bed_id?: string | null;
  ward?: string;
  status: 'active' | 'discharged';
  admitted_at?: string;
  discharged_at?: string | null;
  private_note?: string | null;
  past_history?: string | null;
  investigations_summary?: string | null;
  presenting_complaints?: string | null;
  consulting_doctor?: string | null;
  booking_id?: string | null;
  discharge_summary?: any;
};

export type Stats = {
  active_admissions: number;
  today_admitted: number;
  today_discharged: number;
  total_beds: number;
  free_beds: number;
};

export type TabKey = 'overview' | 'rounds' | 'vitals' | 'meds' | 'consents' | 'discharge';

export type DischargeForm = {
  final_diagnosis: string;
  procedures_done: string;
  operative_notes: string;     // Phase 6.3 — AI-fillable detailed op note
  course_in_hospital: string;
  condition_at_discharge: string;
  discharge_meds: string;
  diet_advice: string;
  follow_up_plan: string;
  follow_up_date: string;
  advice: string;
};
