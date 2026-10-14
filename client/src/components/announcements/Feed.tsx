import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { fmtDateTime, fmtDate } from '../../lib/format';
import { Badge, Button, Card, EmptyState, Pill, Spinner, useToast } from '../ui';
import { Icon } from '../Icons';
import { AnnouncementBody, postedAt, type Announcement } from './shared';

/**
 * The notice board for the signed-in user: pinned posts first, unread ones highlighted. Opening an
 * unread post marks it read; it can be marked unread again.
 */
export function Feed({ rows, loading, error, openId, onOpenChange, onChanged }: {
  rows: Announcement[];
  loading: boolean;
  error?: string | null;
  openId: number | null;
  onOpenChange: (id: number | null) => void;
  /** Called after any change to read state (reload the feed and the counters). */
  onChanged: (patch?: { id: number; is_read: number }) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);
  const pendingRead = useRef<Set<number>>(new Set());
  const unread = rows.filter((r) => !r.is_read).length;
  const visible = filter === 'unread' ? rows.filter((r) => !r.is_read || r.id === openId) : rows;

  const markRead = async (a: Announcement) => {
    if (a.is_read || pendingRead.current.has(a.id)) return;
    pendingRead.current.add(a.id);
    try {
      await api.post(`/api/announcements/${a.id}/read`);
      onChanged({ id: a.id, is_read: 1 });
    } catch (err) {
      toast.error(err);
    } finally {
      pendingRead.current.delete(a.id);
    }
  };

  // Opening (including via a deep link) marks the post read, once per opening, so "Mark unread"
  // is not immediately undone while the post is still expanded.
  const autoReadFor = useRef<number | null>(null);
  useEffect(() => {
    if (openId == null) { autoReadFor.current = null; return; }
    if (autoReadFor.current === openId) return;
    const a = rows.find((r) => r.id === openId);
    if (!a) return; // deep link before the feed has loaded
    autoReadFor.current = openId;
    if (!a.is_read) markRead(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, rows]);

  const toggle = (a: Announcement) => onOpenChange(openId === a.id ? null : a.id);

  const markUnread = async (a: Announcement) => {
    try {
      await api.post(`/api/announcements/${a.id}/unread`);
      toast.success('Marked as unread');
      autoReadFor.current = a.id;
      onOpenChange(null);
      onChanged({ id: a.id, is_read: 0 });
    } catch (err) {
      toast.error(err);
    }
  };
  const markAll = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ marked: number; total: number }>('/api/announcements/read-all');
      toast.success(r.marked ? `Marked ${r.marked} announcement${r.marked === 1 ? '' : 's'} as read` : 'Everything is already read');
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="toolbar" data-tour="announcements-toolbar">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All ({rows.length})</Pill>
        <Pill active={filter === 'unread'} onClick={() => setFilter('unread')}>Unread ({unread})</Pill>
        <Button size="sm" style={{ marginLeft: 'auto' }} onClick={markAll} loading={busy} disabled={!unread} data-testid="announcements-read-all">
          <Icon name="check" size={15} /> Mark all read
        </Button>
      </div>

      <Card padded={false} tour="announcements-feed">
        {error ? <div className="alert alert-error" style={{ margin: 12 }}>{error}</div> : null}
        {loading && !rows.length ? <Spinner /> : !visible.length ? (
          <EmptyState title={filter === 'unread' ? 'You are all caught up' : 'No announcements yet'} description={filter === 'unread' ? 'Every announcement has been read.' : 'Notices from HR will appear here.'} />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="announcement-feed">
            {visible.map((a, i) => {
              const open = openId === a.id;
              const isUnread = !a.is_read;
              return (
                <li
                  key={a.id}
                  data-testid="announcement-item"
                  data-unread={isUnread ? '1' : '0'}
                  data-tour={i === 0 ? 'announcements-item' : undefined}
                  style={{
                    borderTop: i ? '1px solid var(--border)' : undefined,
                    borderLeft: `3px solid ${isUnread ? 'var(--brand)' : 'transparent'}`,
                    background: isUnread ? 'color-mix(in srgb, var(--brand) 6%, var(--surface))' : 'var(--surface)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(a)}
                    aria-expanded={open}
                    data-testid="announcement-toggle"
                    style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', padding: '14px 18px', cursor: 'pointer' }}
                  >
                    <span style={{ color: a.pinned ? 'var(--brand)' : 'var(--muted)', marginTop: 2 }} aria-hidden>
                      <Icon name={a.pinned ? 'pin' : 'megaphone'} size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="row" style={{ gap: 8 }}>
                        <strong style={{ color: 'var(--text)', fontWeight: isUnread ? 700 : 600 }} data-testid="announcement-title">{a.title}</strong>
                        {a.pinned ? <Badge tone="info">Pinned</Badge> : null}
                        {isUnread ? <Badge tone="warning">New</Badge> : null}
                      </span>
                      <span className="help" style={{ display: 'block', marginTop: 4 }}>
                        {a.author_name ? `${a.author_name} · ` : ''}{fmtDateTime(postedAt(a))} · {a.audience_label}
                        {a.expires_at ? ` · until ${fmtDate(a.expires_at)}` : ''}
                      </span>
                      {!open ? (
                        <span className="muted" style={{ display: 'block', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.body.replace(/\s+/g, ' ').slice(0, 180)}
                        </span>
                      ) : null}
                    </span>
                    <span style={{ color: 'var(--muted)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} aria-hidden>
                      <Icon name="chevronDown" size={18} />
                    </span>
                  </button>
                  {open ? (
                    <div style={{ padding: '0 18px 16px 48px' }} data-testid="announcement-detail">
                      <AnnouncementBody text={a.body} />
                      <div className="row" style={{ marginTop: 14 }}>
                        {a.is_read ? (
                          <Button size="sm" variant="ghost" onClick={() => markUnread(a)} data-testid="announcement-mark-unread">
                            <Icon name="mail" size={15} /> Mark unread
                          </Button>
                        ) : null}
                        {a.read_at ? <span className="help">Read {fmtDateTime(a.read_at)}</span> : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
