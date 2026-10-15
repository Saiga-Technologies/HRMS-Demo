import React, { useState } from 'react';
import { api } from '../../lib/api';
import { isoToLocal, localToIso } from '../../lib/format';
import { Button, Field, Input, Modal, Select, Switch, Textarea, useForm, useToast } from '../ui';
import type { Announcement, Department } from './shared';

/** Date input (YYYY-MM-DD, local) -> end of that local day as ISO; and back. */
const dateToIso = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);
const isoToDate = (v?: string | null) => isoToLocal(v).slice(0, 10);

/** Create or edit an announcement (HR). */
export function AnnouncementModal({ existing, departments, onClose, onSaved }: {
  existing: Announcement | null;
  departments: Department[];
  onClose: () => void;
  onSaved: (a: Announcement) => void;
}) {
  const toast = useToast();
  const f = useForm({
    title: existing?.title || '',
    body: existing?.body || '',
    audience: existing?.audience || 'all',
    pinned: !!existing?.pinned,
    publish_at: isoToLocal(existing?.publish_at),
    expires_at: isoToDate(existing?.expires_at),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = f.values;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v.title.trim() || !v.body.trim()) { setError('Title and message are required.'); return; }
    const publish_at = localToIso(v.publish_at);
    const expires_at = dateToIso(v.expires_at);
    if (publish_at && expires_at && expires_at <= publish_at) { setError('The expiry date must be after the publish time.'); return; }
    setError(null);
    setSaving(true);
    const payload = { title: v.title.trim(), body: v.body.trim(), audience: v.audience, pinned: v.pinned, publish_at, expires_at };
    try {
      const saved = existing ? await api.put<Announcement>(`/api/announcements/${existing.id}`, payload) : await api.post<Announcement>('/api/announcements', payload);
      toast.success(existing ? 'Announcement updated' : saved.state === 'scheduled' ? 'Announcement scheduled' : 'Announcement posted');
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message || 'Could not save');
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const activeDepts = departments.filter((d) => d.active !== 0 || v.audience === `department:${d.id}`);
  return (
    <Modal open title={existing ? 'Edit announcement' : 'New announcement'} onClose={onClose} wide testId="announcement-modal"
      footer={(
        <>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="announcement-form" loading={saving} data-testid="announcement-submit">{existing ? 'Save changes' : 'Post'}</Button>
        </>
      )}>
      <form id="announcement-form" className="form-grid" onSubmit={submit}>
        {error ? <div className="alert alert-error span-2">{error}</div> : null}
        <Field label="Title" required className="span-2">
          <Input {...f.bind('title')} maxLength={200} placeholder="e.g. Office closed on Friday" data-testid="announcement-title-input" autoFocus />
        </Field>
        <Field label="Message" required className="span-2" hint="Plain text. Leave a blank line between paragraphs.">
          <Textarea {...f.bind('body')} rows={8} data-testid="announcement-body-input" />
        </Field>
        <Field label="Audience" required>
          <Select {...f.bind('audience')} data-testid="announcement-audience">
            <option value="all">Everyone</option>
            <option value="managers">Managers (and HR)</option>
            <option value="hr">HR only</option>
            {activeDepts.length ? (
              <optgroup label="Department">
                {activeDepts.map((d) => <option key={d.id} value={`department:${d.id}`}>{d.name}</option>)}
              </optgroup>
            ) : null}
          </Select>
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <span className="field-label">Pinned</span>
          <span data-testid="announcement-pinned"><Switch label="Keep at the top of the feed" checked={v.pinned} onChange={(x) => f.set('pinned', x)} /></span>
        </div>
        <Field label="Publish at" hint="Leave empty to publish now.">
          <Input type="datetime-local" {...f.bind('publish_at')} data-testid="announcement-publish-at" />
        </Field>
        <Field label="Expires on" hint="Optional. Hidden from the feed after this day.">
          <Input type="date" {...f.bind('expires_at')} data-testid="announcement-expires-at" />
        </Field>
      </form>
    </Modal>
  );
}
