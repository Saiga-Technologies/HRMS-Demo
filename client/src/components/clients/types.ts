export type ClientStatus = 'prospect' | 'active' | 'inactive';
export type PlacementStatus = 'proposed' | 'active' | 'completed' | 'terminated';
export type RateUnit = 'hour' | 'day' | 'month';

export const CLIENT_STATUSES: ClientStatus[] = ['active', 'prospect', 'inactive'];
export const PLACEMENT_STATUSES: PlacementStatus[] = ['proposed', 'active', 'completed', 'terminated'];
export const RATE_UNITS: RateUnit[] = ['hour', 'day', 'month'];
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = { prospect: 'Prospect', active: 'Active', inactive: 'Inactive' };
export const CLIENT_STATUS_TONE: Record<ClientStatus, 'neutral' | 'success' | 'info'> = { prospect: 'info', active: 'success', inactive: 'neutral' };
export const PLACEMENT_STATUS_LABEL: Record<PlacementStatus, string> = { proposed: 'Proposed', active: 'Active', completed: 'Completed', terminated: 'Terminated' };
export const PLACEMENT_STATUS_TONE: Record<PlacementStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = { proposed: 'warning', active: 'success', completed: 'info', terminated: 'danger' };
export const UNIT_LABEL: Record<RateUnit, string> = { hour: 'per hour', day: 'per day', month: 'per month' };
export const UNIT_SHORT: Record<RateUnit, string> = { hour: '/hr', day: '/day', month: '/mo' };
/** Same normalisation the server uses: hourly x 160, daily x 22. */
export const MONTH_FACTOR: Record<RateUnit, number> = { hour: 160, day: 22, month: 1 };

/** Allowed next statuses from a given status (the UI only offers these transitions). */
export const NEXT_STATUS: Record<PlacementStatus, PlacementStatus[]> = {
  proposed: ['active', 'terminated'],
  active: ['completed', 'terminated'],
  completed: [],
  terminated: [],
};
export const TRANSITION_LABEL: Record<PlacementStatus, string> = { proposed: 'Re-propose', active: 'Activate', completed: 'Complete', terminated: 'Terminate' };

export interface Client {
  id: number;
  name: string;
  code?: string | null;
  industry?: string | null;
  website?: string | null;
  address?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  status: ClientStatus;
  billing_currency: string;
  payment_terms_days: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
  active_placements: number;
  total_placements: number;
  revenue_month: number;
  margin_month: number;
}

export interface Placement {
  id: number;
  client_id: number;
  client_name: string;
  client_code?: string | null;
  billing_currency: string;
  employee_id?: number | null;
  candidate_id?: number | null;
  employee_code?: string | null;
  person_name?: string | null;
  person_type?: 'employee' | 'candidate' | null;
  role_title: string;
  start_date?: string | null;
  end_date?: string | null;
  bill_rate?: number | null;
  pay_rate?: number | null;
  rate_unit: RateUnit;
  placement_fee?: number | null;
  status: PlacementStatus;
  location?: string | null;
  notes?: string | null;
  margin: number;
  margin_pct: number;
  monthly_bill: number;
  monthly_pay: number;
  monthly_margin: number;
  days_to_end?: number | null;
}

export interface MarginSummary { active_placements: number; monthly_billing: number; monthly_pay: number; monthly_margin: number; margin_pct: number; placement_fees: number }
export interface ClientDetail extends Client { placements: Placement[]; margin_summary: MarginSummary }

export interface ClientsSummary {
  clients_by_status: Record<ClientStatus, number>;
  clients_total: number;
  active_placements: number;
  monthly_billing: number;
  monthly_margin: number;
  margin_pct: number;
  ending_soon: Placement[];
  billing_by_client: { client_id: number; client_name: string; billing: number; margin: number; placements: number }[];
  placements_by_status: Record<PlacementStatus, number>;
}

export interface DirEmployee { id: number; employee_code: string; first_name: string; last_name: string; department_name?: string | null; position_title?: string | null }
export interface CandidateLite { id: number; first_name: string; last_name: string; stage: string; vacancy_title?: string | null }
