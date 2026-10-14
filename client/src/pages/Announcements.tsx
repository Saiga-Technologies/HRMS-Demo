import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour } from '../lib/tour';
import { Button, PageHeader, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { Feed } from '../components/announcements/Feed';
import { Manage } from '../components/announcements/Manage';
import { AnnouncementModal } from '../components/announcements/AnnouncementModal';
import { ReadersModal } from '../components/announcements/ReadersModal';
import type { Announcement, Department } from '../components/announcements/shared';

const TOUR = [
  { element: '[data-tour="announcements-header"]', title: 'Announcements', description: 'Company notices from HR. HR can post a new announcement from here, for everyone or for one audience.' },
  { element: '[data-tour="announcements-tabs"]', title: 'Feed and management', description: 'The red badge counts announcements you have not read yet. HR also gets a Manage tab with every post, including scheduled and expired ones.' },
  { element: '[data-tour="announcements-toolbar"]', title: 'Filter and catch up', description: 'Switch between all and unread posts, or mark everything as read in one click.' },
  { element: '[data-tour="announcements-feed"]', title: 'Your feed', description: 'Pinned posts stay at the top; unread ones are highlighted. Posts disappear on their expiry date.' },
  { element: '[data-tour="announcements-item"]', title: 'Read an announcement', description: 'Click a post to expand it. Opening it marks it read; use "Mark unread" to keep it on your list.' },
  { element: '[data-tour="announcements-manage"]', title: 'Manage posts', description: 'Edit, pin or delete posts, see whether they are live, scheduled or expired, and open the read receipts.' },
];

type TabKey = 'feed' | 'manage';

export default function Announcements() {
  usePageTour('Announcements', TOUR);
  const { isHr } = useAuth();
  const { counts, refreshCounts } = useCounts();
  const [params, setParams] = useSearchParams();
  const tab: TabKey = isHr && params.get('tab') === 'manage' ? 'manage' : 'feed';
  const openParam = Number(params.get('id')) || null;
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });

  const feed = useFetch<Announcement[]>(() => api.get('/api/announcements'), []);
  const manage = useFetch<Announcement[]>(() => (isHr ? api.get('/api/announcements/all') : Promise.resolve([])), [isHr]);
  const departments = useFetch<Department[]>(() => (isHr ? api.get('/api/org/departments') : Promise.resolve([])), [isHr]);

  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [readersOf, setReadersOf] = useState<Announcement | null>(null);

  const reloadAll = () => { feed.reload(); if (isHr) manage.reload(); refreshCounts(); };
  const onFeedChanged = (patch?: { id: number; is_read: number }) => {
    if (patch) feed.setData((rows) => (rows || []).map((r) => (r.id === patch.id ? { ...r, is_read: patch.is_read, read_at: patch.is_read ? r.read_at : null } : r)));
    reloadAll();
  };

  // Prefer the unread count from the feed itself (exactly what this user can see); fall back to the global counter.
  const feedUnread = feed.data ? feed.data.filter((r) => !r.is_read).length : counts.announcements_unread || 0;

  return (
    <>
      <PageHeader
        tour="announcements-header"
        title="Announcements"
        subtitle="Company notices and updates. Pinned posts stay on top; unread posts are highlighted."
        actions={isHr ? (
          <Button variant="primary" onClick={() => setEditing('new')} data-testid="announcement-new">
            <Icon name="plus" size={15} /> New announcement
          </Button>
        ) : undefined}
      />
      <Tabs
        tour="announcements-tabs"
        value={tab}
        onChange={(k) => setParam('tab', k === 'feed' ? null : k)}
        tabs={[
          { key: 'feed', label: 'Feed', icon: 'megaphone', badge: feedUnread || undefined },
          ...(isHr ? [{ key: 'manage', label: 'Manage', icon: 'settings', count: manage.data?.length }] : []),
        ]}
      />

      {tab === 'feed' ? (
        <Feed
          rows={feed.data || []}
          loading={feed.loading}
          error={feed.error}
          openId={openParam}
          onOpenChange={(id) => setParam('id', id ? String(id) : null)}
          onChanged={onFeedChanged}
        />
      ) : (
        <Manage
          rows={manage.data || []}
          loading={manage.loading}
          error={manage.error}
          onEdit={(a) => setEditing(a)}
          onReaders={(a) => setReadersOf(a)}
          onChanged={reloadAll}
        />
      )}

      {editing ? (
        <AnnouncementModal
          existing={editing === 'new' ? null : editing}
          departments={departments.data || []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reloadAll(); }}
        />
      ) : null}
      {readersOf ? <ReadersModal announcement={readersOf} onClose={() => setReadersOf(null)} /> : null}
    </>
  );
}
