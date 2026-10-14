import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { Button, Card, Pill, Table, useConfirm, useToast } from '../ui';
import { Icon } from '../Icons';
import { StateChip, postedAt, type Announcement, type AnnouncementState } from './shared';

/** HR list of every announcement, including scheduled and expired ones. */
export function Manage({ rows, loading, error, onEdit, onReaders, onChanged }: {
  rows: Announcement[];
  loading: boolean;
  error?: string | null;
  onEdit: (a: Announcement) => void;
  onReaders: (a: Announcement) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [state, setState] = useState<'' | AnnouncementState>('');
  const shown = state ? rows.filter((r) => r.state === state) : rows;
  const countOf = (s: AnnouncementState) => rows.filter((r) => r.state === s).length;

  const remove = async (a: Announcement) => {
    if (!(await confirm('Delete announcement?', `"${a.title}" will be removed for everyone, along with its read receipts.`))) return;
    try {
      await api.delete(`/api/announcements/${a.id}`);
      toast.success('Announcement deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };
  const togglePin = async (a: Announcement) => {
    try {
      await api.put(`/api/announcements/${a.id}`, { pinned: !a.pinned });
      toast.success(a.pinned ? 'Unpinned' : 'Pinned to the top of the feed');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <div className="toolbar">
        <Pill active={!state} onClick={() => setState('')}>All ({rows.length})</Pill>
        <Pill active={state === 'live'} onClick={() => setState('live')}>Live ({countOf('live')})</Pill>
        <Pill active={state === 'scheduled'} onClick={() => setState('scheduled')}>Scheduled ({countOf('scheduled')})</Pill>
        <Pill active={state === 'expired'} onClick={() => setState('expired')}>Expired ({countOf('expired')})</Pill>
      </div>
      <Card padded={false} tour="announcements-manage">
        {error ? <div className="alert alert-error" style={{ margin: 12 }}>{error}</div> : null}
        <Table<Announcement>
          loading={loading && !rows.length}
          rows={shown}
          empty={state ? `No ${state} announcements.` : 'No announcements yet. Post the first one.'}
          columns={[
            {
              key: 'title', header: 'Announcement', render: (a) => (
                <span data-testid="manage-row">
                  <span className="row" style={{ gap: 6 }}>
                    {a.pinned ? <span style={{ color: 'var(--brand)' }} title="Pinned"><Icon name="pin" size={14} /></span> : null}
                    <strong data-testid="manage-title">{a.title}</strong>
                  </span>
                  <div className="muted">{a.author_name || '—'}</div>
                </span>
              ),
            },
            { key: 'audience_label', header: 'Audience' },
            { key: 'state', header: 'State', render: (a) => <StateChip state={a.state} /> },
            { key: 'publish_at', header: 'Published', render: (a) => fmtDateTime(postedAt(a)) },
            { key: 'expires_at', header: 'Expires', render: (a) => (a.expires_at ? fmtDate(a.expires_at) : <span className="muted">Never</span>) },
            {
              key: 'read_count', header: 'Reads', align: 'right', render: (a) => (
                <Button size="sm" variant="link" onClick={() => onReaders(a)} data-testid="announcement-readers-btn" title="See who read this">
                  <Icon name="eye" size={14} /> {a.read_count ?? 0}
                </Button>
              ),
            },
            {
              key: 'actions', header: '', align: 'right', width: '150px', render: (a) => (
                <span className="row" style={{ gap: 4, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                  <Button size="sm" variant="ghost" onClick={() => togglePin(a)} aria-label={a.pinned ? 'Unpin' : 'Pin'} title={a.pinned ? 'Unpin' : 'Pin'} data-testid="announcement-pin-toggle"><Icon name="pin" size={15} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => onEdit(a)} aria-label="Edit" title="Edit" data-testid="announcement-edit"><Icon name="edit" size={15} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(a)} aria-label="Delete" title="Delete" data-testid="announcement-delete"><Icon name="trash" size={15} /></Button>
                </span>
              ),
            },
          ]}
        />
      </Card>
      {dialog}
    </>
  );
}
