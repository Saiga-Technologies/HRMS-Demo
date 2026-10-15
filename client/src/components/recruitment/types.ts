import { apiUrl } from '../../lib/api';
export type Stage = 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
export const STAGES: Stage[] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn'];
/** Kanban columns (withdrawn candidates are shown in the Rejected column). */
export const BOARD_STAGES: Stage[] = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'];
export const STAGE_LABEL: Record<Stage, string> = { new: 'New', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn' };
export const STAGE_COLOR: Record<Stage, string> = { new: '#6366f1', screening: '#0ea5e9', interview: '#eab308', offer: '#f97316', hired: '#16a34a', rejected: '#dc2626', withdrawn: '#64748b' };
export const SOURCES = ['LinkedIn', 'Referral', 'Job board', 'Careers page', 'Agency', 'Walk-in', 'Campus', 'Other'];

export interface ParsedCv {
  emails: string[];
  phones: string[];
  experience_years: number | null;
  experience_sources?: string[];
  education: string[];
  skills: string[];
  title: string | null;
  summary: string | null;
  name_guess?: { first_name: string; last_name: string } | null;
  word_count?: number;
}
export interface ScoreCategory { weight: number; points: number; note: string }
export interface ScoreBreakdown {
  jd_id: number | null;
  jd_title: string | null;
  total?: number;
  note?: string;
  skills?: ScoreCategory & { matched: string[]; missing: string[]; partial: { skill: string; via: string }[] };
  requirements?: ScoreCategory & { covered: string[]; uncovered: string[] };
  experience?: ScoreCategory & { years: number | null; min: number | null; max: number | null };
  education?: ScoreCategory & { degrees: string[] };
  extras?: ScoreCategory & { email: boolean; phone: boolean; length_ok: boolean };
}
export interface CandidateEvent { id: number; candidate_id: number; type: 'stage_change' | 'note' | 'interview' | 'score' | 'hired'; note?: string | null; data?: any; by_user?: number | null; by_email?: string | null; created_at: string }
export interface Candidate {
  id: number;
  first_name: string;
  last_name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  vacancy_id?: number | null;
  position_id?: number | null;
  cv_original_name?: string | null;
  cv_stored_name?: string | null;
  cv_mime?: string | null;
  cv_text?: string | null;
  parsed: ParsedCv;
  score: number | null;
  score_breakdown: ScoreBreakdown;
  stage: Stage;
  rating?: number | null;
  expected_salary?: number | null;
  notice_days?: number | null;
  notes?: string | null;
  hired_employee_id?: number | null;
  hired_employee_code?: string | null;
  created_at: string;
  updated_at: string;
  vacancy_title?: string | null;
  vacancy_status?: string | null;
  position_title?: string | null;
  department_name?: string | null;
  interviews?: number;
  events?: CandidateEvent[];
  vacancy?: any;
  jd?: { id: number; title: string; skills: string[]; requirements: string[]; experience_min?: number | null; experience_max?: number | null; status: string } | null;
}
export interface RecruitingVacancy {
  id: number;
  title: string;
  status: string;
  openings: number;
  hired_count: number;
  position_id?: number | null;
  position_title?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  job_description_id?: number | null;
  jd_title?: string | null;
  jd_status?: string | null;
  opened_at?: string | null;
  candidates: number;
  avg_score?: number | null;
  top_score?: number | null;
  stages: Record<Stage, number>;
}
export interface RecruitmentSummary { stages: Record<Stage, number>; total: number; unassigned: number; avg_score: number | null; scored: number; by_vacancy: { vacancy_id: number; title: string; status: string; openings: number; hired_count: number; stages: Record<Stage, number>; total: number }[] }
export interface HireDefaults { candidate_id: number; first_name: string; last_name: string; email: string; phone: string; position_id: number | null; department_id: number | null; manager_id: number | null; employment_type: string; employee_code: string; join_date: string; status: string; vacancy_id: number | null; vacancy_title: string | null; create_login: boolean; login_role: string; expected_salary?: number | null; notice_days?: number | null }

export const candidateName = (c: { first_name: string; last_name?: string | null }) => [c.first_name, c.last_name].filter(Boolean).join(' ');
export const cvUrl = (id: number, download = false) => apiUrl(`/api/recruitment/candidates/${id}/cv${download ? '?download=1' : ''}`);
