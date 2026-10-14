import React from 'react';
import { api } from '../../lib/api';
import { fmtDateTime, label } from '../../lib/format';
import { Avatar, Modal, Table, useFetch } from '../ui';
import type { Announcement, Reader } from './shared';

interface DirEmployee { id: number; department_id?: number | null }

/** Who has read an announcement, with the read rate where the audience size is known (HR). */
export function ReadersModal({ announcement, onClose }: { announcement: Announcement; onClose: () => void }) {
  const readers = useFetch<Reader[]>(() => api.get(`/api/announcements/${announcement.id}/readers`), [announcement.id]);
  const directory = useFetch<DirEmployee[]>(() => api.get('/api/employees/directory/all'), []);
  const rows = readers.data || [];

  // Audience size is only knowable for "everyone" and department posts (approximated by active employees).
  let audience: number | null = null;
  if (directory.data) {
    if (announcement.audience === 'all') audience = directory.data.length;
    else if (announcement.audience.startsWith('department:')) {
      const dept = Number(announcement.audience.slice('department:'.length));
      audience = directory.data.filter((e) => e.department_id === dept).length;
    }
  }
  const pct = audience ? Math.min(100, Math.round((rows.length / audience) * 100)) : null;

  return (
    <Modal open wide title={`Readers: ${announcement.title}`} onClose={onClose} testId="announcement-readers">
      <div className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <strong data-testid="readers-count">{readers.loading && !readers.data ? '…' : rows.length}</strong>{' '}
            {rows.length === 1 ? 'person has' : 'people have'} read this
            {audience != null ? <span className="muted"> out of about {audience} in the audience ({announcement.audience_label})</span> : <span className="muted"> ({announcement.audience_label})</span>}
          </span>
          {pct != null ? <strong data-testid="readers-pct">{pct}% read</strong> : null}
        </div>
        {pct != null ? (
          <div className="hbar-track" aria-hidden><span className="hbar-fill" style={{ width: `${pct}%`, background: 'var(--brand)' }} /></div>
        ) : null}
        {readers.error ? <div className="alert alert-error">{readers.error}</div> : null}
        <Table<Reader>
          dense
          keyField="user_id"
          loading={readers.loading && !readers.data}
          rows={rows}
          empty="Nobody has read this yet."
          columns={[
            { key: 'name', header: 'Reader', render: (r) => <span className="row" style={{ gap: 8 }}><Avatar name={r.name} size={26} /><span><strong data-testid="reader-name">{r.name}</strong>{r.employee_code ? <div className="muted">{r.employee_code}</div> : null}</span></span> },
            { key: 'email', header: 'Email' },
            { key: 'role', header: 'Role', render: (r) => label(r.role) },
            { key: 'read_at', header: 'Read at', render: (r) => fmtDateTime(r.read_at) },
          ]}
        />
      </div>
    </Modal>
  );
}
