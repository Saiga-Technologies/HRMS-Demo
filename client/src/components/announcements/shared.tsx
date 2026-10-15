import React from 'react';
import { Badge } from '../ui';

export type AnnouncementState = 'live' | 'scheduled' | 'expired';
export interface Announcement {
  id: number;
  title: string;
  body: string;
  audience: string;
  audience_label: string;
  department_name?: string | null;
  pinned: number;
  publish_at: string | null;
  expires_at: string | null;
  created_by: number | null;
  author_name?: string | null;
  created_at: string;
  updated_at: string;
  state: AnnouncementState;
  /** Feed only. */
  is_read?: number;
  read_at?: string | null;
  /** HR list only. */
  read_count?: number;
}
export interface Reader { user_id: number; read_at: string; email: string; role: string; name: string; employee_code?: string | null }
export interface Department { id: number; name: string; active?: number }

const STATE_TONE: Record<AnnouncementState, 'success' | 'info' | 'neutral'> = { live: 'success', scheduled: 'info', expired: 'neutral' };
export function StateChip({ state }: { state: AnnouncementState }) {
  return <Badge tone={STATE_TONE[state] || 'neutral'}>{state}</Badge>;
}

/** Plain-text body: blank lines split paragraphs, single newlines become line breaks. Never renders HTML. */
export function AnnouncementBody({ text }: { text: string }) {
  const paras = String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="stack" style={{ gap: 10, lineHeight: 1.6, color: 'var(--text)' }} data-testid="announcement-body">
      {paras.map((p, i) => (
        <p key={i} style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p}</p>
      ))}
    </div>
  );
}

/** When the post went (or goes) live. */
export const postedAt = (a: Announcement) => a.publish_at || a.created_at;
