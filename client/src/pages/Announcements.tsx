import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCounts } from '../lib/notifications';
import { usePageTour, type TourStep } from '../lib/tour';
import { Button, PageHeader, Tabs, useFetch } from '../components/ui';
import { Icon } from '../components/Icons';
import { Feed } from '../components/announcements/Feed';
import { Manage } from '../components/announcements/Manage';
import { AnnouncementModal } from '../components/announcements/AnnouncementModal';
import { ReadersModal } from '../components/announcements/ReadersModal';
import type { Announcement, Department } from '../components/announcements/shared';

const TOUR: TourStep[] = [
  { title: 'Announcements', description: 'The company notice board. Everyone reads here; HR also writes and manages posts. The flow: 1) see what is pinned and unread in your feed, 2) read, mark unread or catch up in one click, then for HR 3) compose a post for the right audience with an optional schedule and expiry, 4) manage live, scheduled and expired posts, and 5) check who has read them.' },
  { element: '[data-tab="feed"]', title: 'Your feed', description: 'Every announcement meant for you: company-wide posts, posts for your department, and manager or HR posts if that is your role. The red badge counts posts you have not read yet; the same count shows next to Announcements in the menu.', tab: 'feed' },
  { element: '[data-tour="announcements-filter"]', title: 'All or unread', description: 'Show every post, or only the ones you still need to read. The numbers in brackets update as you read.' },
  { element: '[data-testid="announcements-read-all"]', title: 'Mark all read', description: 'Catch up in one click: every post in your feed is marked read and the unread badges clear. It is greyed out when there is nothing unread.' },
  { element: '[data-tour="announcements-feed"]', title: 'The feed', description: 'Pinned posts always sit at the top, then the newest first. Posts appear on their publish time and drop off after their expiry date.' },
  { element: '[data-tour="announcements-feed"] .badge-info', title: 'Pinned posts', description: 'HR pins the notices everyone must see, such as policy changes or office closures, so they stay above newer posts.' },
  { element: '[data-tour="announcements-feed"] [data-unread="1"]', title: 'Unread posts', description: 'Unread posts have a coloured edge, a tinted background and a "New" tag until you open them.' },
  { element: '[data-tour="announcements-item"]', title: 'Read a post', description: 'Click a post to expand the full message. Opening it marks it read and records when; a "Mark unread" button then lets you put it back on your list as a reminder.' },
  { element: '[data-tour="announcements-item"] .help', title: 'Who, when and for whom', description: 'The author, when it was published, the audience it was sent to and, if set, the last day it stays on the board.' },
  { element: '[data-testid="announcement-new"]', title: 'Post an announcement', description: 'HR opens the compose form here: a title and a plain-text message, the audience (everyone, managers and HR, HR only, or one department), "keep at the top" to pin it, an optional publish time to schedule it, and an optional expiry date. It goes straight into the feed of everyone in that audience, or at the scheduled time.' },
  { element: '[data-tour="announcements-states"]', title: 'Next, manage posts', description: 'The Manage tab lists every post, including ones employees cannot see yet or any more. Filter by state: live, scheduled for later, or expired.', tab: 'manage' },
  { element: '[data-tour="announcements-manage"]', title: 'All announcements', description: 'Each post with its author, audience, state, publish time, expiry date and how many people have read it.' },
  { element: '[data-tour="announcements-manage"] [data-tour="announcements-state-chip"]', title: 'Post state', description: 'Live posts are in the feed now. Scheduled posts appear at their publish time. Expired posts are hidden from the feed but kept here for the record.' },
  { element: '[data-tour="announcements-manage"] [data-testid="announcement-readers-btn"]', title: 'Who has read it', description: 'Click the read count to see each reader and when they read it, against the rough size of the audience, so you know who still needs a nudge.' },
  { element: '[data-tour="announcements-manage"] [data-testid="announcement-pin-toggle"]', title: 'Pin, edit or delete', description: 'Pin or unpin a post, edit its text, audience, schedule or expiry (for example to extend it), or delete it for everyone along with its read receipts.' },
  { tab: 'feed', title: 'What to do next', description: 'The loop: HR posts, the audience sees it highlighted and the menu badge counts it, people read it, and HR checks the readers and lets it expire or unpins it. Check the feed regularly; pinned posts are the ones that matter most.' },
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
