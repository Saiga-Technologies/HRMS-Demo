import { describe, it, expect, afterAll } from 'vitest';
import { app, request, hr, employee, auth, cleanup } from './helpers.js';

afterAll(cleanup);

const unread = async (t: string) => (await request(app).get('/api/notifications/counts').set(auth(t))).body.counts.announcements_unread;

describe('announcements unread counter', () => {
  it('only counts posts the user can see, and clears after mark all read', async () => {
    const h = await hr();
    const e = await employee();
    const feed = (await request(app).get('/api/announcements').set(auth(e))).body;
    expect(await unread(e)).toBe(feed.filter((a: any) => !a.is_read).length);

    // Posts for other audiences never reach the employee's counter.
    await request(app).post('/api/announcements').set(auth(h)).send({ title: 'HR only', body: 'x', audience: 'hr' });
    await request(app).post('/api/announcements').set(auth(h)).send({ title: 'Managers', body: 'x', audience: 'managers' });
    expect(await unread(e)).toBe(feed.filter((a: any) => !a.is_read).length);
    // An expired post is not counted either.
    const past = new Date(Date.now() - 3600_000).toISOString();
    await request(app).post('/api/announcements').set(auth(h)).send({ title: 'Old', body: 'x', publish_at: new Date(Date.now() - 7200_000).toISOString(), expires_at: past });
    expect(await unread(e)).toBe(feed.filter((a: any) => !a.is_read).length);

    await request(app).post('/api/announcements/read-all').set(auth(e));
    expect(await unread(e)).toBe(0);
    expect(await unread(h)).toBeGreaterThan(0);
  });
});
