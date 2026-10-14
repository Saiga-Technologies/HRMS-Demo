import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { usePageTour } from '../lib/tour';
import { Icon } from '../components/Icons';
import { PageHeader, Card, Table, Button, Field, Input, Checkbox, Modal, Tabs, Stat, Badge, StatusBadge, useFetch, useToast, useConfirm, useForm } from '../components/ui';

interface Option { key: string; label: string; description: string }
interface ApiKey { id: number; name: string; key_prefix: string; scopes: string[]; active: number; last_used_at: string | null; created_at: string; created_by_email: string | null }
interface Webhook { id: number; url: string; events: string[]; active: number; has_secret: boolean; deliveries: number; failures: number; last_attempt_at: string | null; last_ok: number | null; created_at: string }
interface Delivery { id: number; event: string; status_code: number | null; ok: number; error: string | null; attempted_at: string; payload: string }
interface Overview { keys: ApiKey[]; webhooks: Webhook[]; scopes: Option[]; events: Option[]; careers: { path: string; open_jobs: number; applications_30d: number; api_candidates_30d: number } }

const TOUR = [
  { element: '[data-tour="int-stats"]', title: 'At a glance', description: 'Open jobs on the public careers page, applications it brought in and candidates pushed by API keys over the last 30 days.' },
  { element: '[data-tour="int-careers"]', title: 'Public careers page', description: 'Every open vacancy is listed here for candidates, with its published job description. Applications land in Recruitment → New, parsed and scored.' },
  { element: '[data-tour="int-tabs"]', title: 'Keys and webhooks', description: 'API keys let job boards push candidates in; webhooks push recruitment events out to your other tools.' },
  { element: '[data-tour="int-keys"]', title: 'API keys', description: 'Each key has scopes. The full key is shown once when created; afterwards only its prefix. Revoke a key to block it immediately.' },
  { element: '[data-tour="int-key-add"]', title: 'Create a key', description: 'Name it after the system that will use it, pick its scopes and copy the key into that system.' },
  { element: '[data-tour="int-webhooks"]', title: 'Webhooks', description: 'Signed JSON POSTs on candidate created, moved and hired. Send a test ping and read the delivery log to debug.' },
  { element: '[data-tour="int-docs"]', title: 'Quick reference', description: 'The endpoints, headers and signature format to hand to whoever builds the integration.' },
];

type TabKey = 'keys' | 'webhooks' | 'docs';

export default function Integrations() {
  usePageTour('Integrations & API', TOUR);
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const tab = (['keys', 'webhooks', 'docs'].includes(params.get('tab') || '') ? params.get('tab') : 'keys') as TabKey;
  const setTab = (k: string) => setParams(k === 'keys' ? {} : { tab: k }, { replace: true });
  const data = useFetch<Overview>(() => api.get('/api/integrations'), []);
  const [keyOpen, setKeyOpen] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [hookEdit, setHookEdit] = useState<Webhook | 'new' | null>(null);
  const [logFor, setLogFor] = useState<Webhook | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const o = data.data;
  const careersUrl = `${window.location.origin}/careers`;

  const revoke = async (k: ApiKey) => {
    if (!(await confirm('Revoke API key?', `"${k.name}" will stop working immediately. This cannot be undone.`))) return;
    try { await api.post(`/api/integrations/keys/${k.id}/revoke`); toast.success('Key revoked'); data.reload(); } catch (e) { toast.error(e); }
  };
  const removeKey = async (k: ApiKey) => {
    if (!(await confirm('Delete API key?', `"${k.name}" will be removed from the list.`))) return;
    try { await api.delete(`/api/integrations/keys/${k.id}`); toast.success('Key deleted'); data.reload(); } catch (e) { toast.error(e); }
  };
  const removeHook = async (h: Webhook) => {
    if (!(await confirm('Delete webhook?', `Deliveries to ${h.url} stop and its log is removed.`))) return;
    try { await api.delete(`/api/integrations/webhooks/${h.id}`); toast.success('Webhook deleted'); data.reload(); } catch (e) { toast.error(e); }
  };
  const toggleHook = async (h: Webhook) => {
    try { await api.put(`/api/integrations/webhooks/${h.id}`, { active: !h.active }); toast.success(h.active ? 'Webhook paused' : 'Webhook resumed'); data.reload(); } catch (e) { toast.error(e); }
  };
  const testHook = async (h: Webhook) => {
    setTesting(h.id);
    try {
      const res = await api.post<{ delivery: Delivery }>(`/api/integrations/webhooks/${h.id}/test`);
      if (res.delivery?.ok) toast.success(`Ping delivered (HTTP ${res.delivery.status_code})`);
      else toast.error(`Ping failed: ${res.delivery?.error || 'no response'}`);
      data.reload();
    } catch (e) { toast.error(e); } finally { setTesting(null); }
  };
  const copy = async (text: string, what = 'Copied') => {
    try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.info('Select the text and copy it manually'); }
  };

  const activeKeys = o?.keys.filter((k) => k.active).length ?? 0;
  const failing = o?.webhooks.filter((w) => w.active && w.last_ok === 0).length ?? 0;

  return (
    <>
      <PageHeader title="Integrations & API" subtitle="Public careers page, API keys for job boards and webhooks for your other tools."
        actions={<Button onClick={() => window.open('/careers', '_blank', 'noopener')} data-testid="careers-open"><Icon name="globe" size={15} /> Open careers page</Button>} />

      <div className="grid grid-auto" data-tour="int-stats" style={{ marginBottom: 16 }}>
        <Stat label="Open jobs on careers page" value={o?.careers.open_jobs ?? '—'} icon="briefcase" color="#5BA85A" />
        <Stat label="Applications (30 days)" value={o?.careers.applications_30d ?? '—'} icon="userPlus" color="#2563eb" />
        <Stat label="Candidates via API (30 days)" value={o?.careers.api_candidates_30d ?? '—'} icon="code" color="#9333ea" />
        <Stat label="Active keys / webhooks" value={o ? `${activeKeys} / ${o.webhooks.filter((w) => w.active).length}` : '—'} icon="key" color="#d97706" />
      </div>

      <Card tour="int-careers" title={<span className="row"><Icon name="globe" size={16} /> Public careers page</span>}>
        <div className="row between">
          <div className="stack" style={{ gap: 4 }}>
            <span className="muted">Share this link on your website and social profiles. Open vacancies appear automatically.</span>
            <span className="mono" data-testid="careers-url">{careersUrl}</span>
          </div>
          <Button size="sm" onClick={() => copy(careersUrl, 'Careers link copied')}>Copy link</Button>
        </div>
      </Card>

      <Tabs tour="int-tabs" value={tab} onChange={setTab} tabs={[
        { key: 'keys', label: 'API keys', icon: 'key', count: o?.keys.length },
        { key: 'webhooks', label: 'Webhooks', icon: 'send', count: o?.webhooks.length, badge: failing || undefined },
        { key: 'docs', label: 'Quick reference', icon: 'code' },
      ]} />

      {tab === 'keys' ? (
        <Card padded={false} tour="int-keys" title="API keys" actions={<span data-tour="int-key-add"><Button variant="primary" size="sm" onClick={() => setKeyOpen(true)} data-testid="key-add"><Icon name="plus" size={14} /> New key</Button></span>}>
          <Table<ApiKey> rows={o?.keys || []} loading={data.loading} empty="No API keys yet. Create one for each job board or tool that sends you candidates."
            columns={[
              { key: 'name', header: 'Name', render: (k) => <strong>{k.name}</strong> },
              { key: 'key_prefix', header: 'Key', render: (k) => <span className="mono">{k.key_prefix}…</span> },
              { key: 'scopes', header: 'Scopes', render: (k) => <span className="chip-list">{k.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</span> },
              { key: 'last_used_at', header: 'Last used', render: (k) => (k.last_used_at ? fmtDateTime(k.last_used_at) : <span className="muted">Never</span>) },
              { key: 'active', header: 'Status', render: (k) => <StatusBadge status={k.active ? 'active' : 'cancelled'} label={k.active ? 'Active' : 'Revoked'} /> },
              { key: 'actions', header: '', align: 'right', render: (k) => (
                <span className="row end">
                  {k.active ? <Button size="sm" variant="ghost" onClick={() => revoke(k)} data-testid={`key-revoke-${k.id}`}>Revoke</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => removeKey(k)} aria-label="Delete key"><Icon name="trash" size={14} /></Button>
                </span>
              ) },
            ]} />
        </Card>
      ) : null}

      {tab === 'webhooks' ? (
        <Card padded={false} tour="int-webhooks" title="Webhooks" actions={<Button variant="primary" size="sm" onClick={() => setHookEdit('new')} data-testid="webhook-add"><Icon name="plus" size={14} /> Add webhook</Button>}>
          <Table<Webhook> rows={o?.webhooks || []} loading={data.loading} empty="No webhooks yet. Add one to notify another system when candidates arrive, move or are hired."
            columns={[
              { key: 'url', header: 'Endpoint', render: (h) => <span className="stack" style={{ gap: 2 }}><span className="mono" style={{ overflowWrap: 'anywhere' }}>{h.url}</span>{h.has_secret ? <small className="muted"><Icon name="lock" size={12} /> Signed</small> : null}</span> },
              { key: 'events', header: 'Events', render: (h) => <span className="chip-list">{h.events.map((e) => <span key={e} className="chip">{e}</span>)}</span> },
              { key: 'last', header: 'Last delivery', render: (h) => (h.last_attempt_at ? <span className="row"><Badge tone={h.last_ok ? 'success' : 'danger'}>{h.last_ok ? 'OK' : 'Failed'}</Badge><small className="muted">{fmtDateTime(h.last_attempt_at)}</small></span> : <span className="muted">None yet</span>) },
              { key: 'active', header: 'Status', render: (h) => <StatusBadge status={h.active ? 'active' : 'on_hold'} label={h.active ? 'Active' : 'Paused'} /> },
              { key: 'actions', header: '', align: 'right', render: (h) => (
                <span className="row end">
                  <Button size="sm" onClick={() => testHook(h)} loading={testing === h.id} data-testid={`webhook-test-${h.id}`}>Send test</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLogFor(h)} data-testid={`webhook-log-${h.id}`}>Log ({h.deliveries})</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleHook(h)}>{h.active ? 'Pause' : 'Resume'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setHookEdit(h)} aria-label="Edit webhook"><Icon name="edit" size={14} /></Button>
                  <Button size="sm" variant="ghost" onClick={() => removeHook(h)} aria-label="Delete webhook"><Icon name="trash" size={14} /></Button>
                </span>
              ) },
            ]} />
        </Card>
      ) : null}

      {tab === 'docs' ? <Docs origin={window.location.origin} events={o?.events || []} scopes={o?.scopes || []} /> : null}

      <NewKeyModal open={keyOpen} scopes={o?.scopes || []} onClose={() => setKeyOpen(false)} onCreated={(k) => { setKeyOpen(false); setNewKey(k); data.reload(); }} />
      <Modal open={!!newKey} title="Copy your API key" onClose={() => setNewKey(null)} testId="key-created"
        footer={<Button variant="primary" onClick={() => setNewKey(null)} data-testid="key-done">I have copied it</Button>}>
        <div className="stack">
          <div className="alert alert-warning">This is the only time the full key for <strong>{newKey?.name}</strong> is shown. Store it in the other system now.</div>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <Input readOnly value={newKey?.key || ''} className="mono" data-testid="key-value" onFocus={(e) => e.currentTarget.select()} />
            <Button onClick={() => newKey && copy(newKey.key, 'Key copied')}>Copy</Button>
          </div>
          <small className="muted">Send it in the <code>X-API-Key</code> header.</small>
        </div>
      </Modal>
      <WebhookModal hook={hookEdit} events={o?.events || []} onClose={() => setHookEdit(null)} onSaved={() => { setHookEdit(null); data.reload(); }} />
      <DeliveriesModal hook={logFor} onClose={() => setLogFor(null)} />
      {dialog}
    </>
  );
}

function NewKeyModal({ open, scopes, onClose, onCreated }: { open: boolean; scopes: Option[]; onClose: () => void; onCreated: (k: { name: string; key: string }) => void }) {
  const toast = useToast();
  const f = useForm({ name: '', scopes: ['candidates:write'] as string[] });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ name: string; key: string }>('/api/integrations/keys', f.values);
      toast.success('API key created');
      f.reset();
      onCreated(res);
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const toggle = (k: string) => f.set('scopes', f.values.scopes.includes(k) ? f.values.scopes.filter((s) => s !== k) : [...f.values.scopes, k]);
  return (
    <Modal open={open} title="New API key" onClose={onClose} testId="key-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="key-form" loading={busy} data-testid="key-submit">Create key</Button></>}>
      <form id="key-form" className="stack" onSubmit={submit}>
        <Field label="Name" required hint="Who uses this key, e.g. “Naukri job board”.">
          <Input {...f.bind('name')} required maxLength={80} data-testid="key-name" autoFocus />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="field-label">Scopes</span>
          {scopes.map((s) => (
            <Checkbox key={s.key} checked={f.values.scopes.includes(s.key)} onChange={() => toggle(s.key)} data-testid={`key-scope-${s.key}`}
              label={<span><strong>{s.label}</strong> <span className="muted">— {s.description}</span></span>} />
          ))}
        </div>
      </form>
    </Modal>
  );
}

function WebhookModal({ hook, events, onClose, onSaved }: { hook: Webhook | 'new' | null; events: Option[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const editing = hook && hook !== 'new' ? hook : null;
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [lastHook, setLastHook] = useState<typeof hook>(null);
  if (hook !== lastHook) {
    setLastHook(hook);
    setUrl(editing?.url || '');
    setSecret('');
    setSelected(editing?.events || events.map((e) => e.key));
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: any = { url, events: selected };
      if (secret) body.secret = secret;
      if (editing) await api.put(`/api/integrations/webhooks/${editing.id}`, body);
      else await api.post('/api/integrations/webhooks', body);
      toast.success(editing ? 'Webhook updated' : 'Webhook added');
      onSaved();
    } catch (err) { toast.error(err); } finally { setBusy(false); }
  };
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <Modal open={!!hook} title={editing ? 'Edit webhook' : 'Add webhook'} onClose={onClose} testId="webhook-modal"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="hook-form" loading={busy} data-testid="webhook-submit">{editing ? 'Save' : 'Add webhook'}</Button></>}>
      <form id="hook-form" className="stack" onSubmit={submit}>
        <Field label="Endpoint URL" required hint="We POST JSON to this address. It must accept requests from this server.">
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://example.com/hrms-webhook" data-testid="webhook-url" autoFocus />
        </Field>
        <Field label="Signing secret" hint={editing?.has_secret ? 'A secret is set. Leave blank to keep it.' : 'Optional. Adds an X-HRMS-Signature HMAC-SHA256 header.'}>
          <Input value={secret} onChange={(e) => setSecret(e.target.value)} data-testid="webhook-secret" autoComplete="off" />
        </Field>
        <div className="stack" style={{ gap: 8 }}>
          <span className="field-label">Events</span>
          {events.map((ev) => (
            <Checkbox key={ev.key} checked={selected.includes(ev.key)} onChange={() => toggle(ev.key)} label={<span><strong>{ev.label}</strong> <span className="mono muted">{ev.key}</span><br /><small className="muted">{ev.description}</small></span>} />
          ))}
        </div>
      </form>
    </Modal>
  );
}

function DeliveriesModal({ hook, onClose }: { hook: Webhook | null; onClose: () => void }) {
  const log = useFetch<Delivery[]>(() => (hook ? api.get(`/api/integrations/webhooks/${hook.id}/deliveries`) : Promise.resolve([])), [hook?.id]);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Modal open={!!hook} title="Delivery log" onClose={onClose} wide testId="webhook-log">
      <p className="muted" style={{ marginTop: 0 }}>Last 20 attempts to <span className="mono">{hook?.url}</span>. Click a row to see the payload.</p>
      <Table<Delivery> rows={log.data || []} loading={log.loading} dense empty="Nothing delivered yet. Use “Send test” to try it."
        onRowClick={(d) => setOpen(open === d.id ? null : d.id)}
        columns={[
          { key: 'attempted_at', header: 'When', render: (d) => fmtDateTime(d.attempted_at) },
          { key: 'event', header: 'Event', render: (d) => <span className="mono">{d.event}</span> },
          { key: 'ok', header: 'Result', render: (d) => <Badge tone={d.ok ? 'success' : 'danger'}>{d.ok ? `HTTP ${d.status_code}` : d.error || 'Failed'}</Badge> },
          { key: 'payload', header: 'Payload', render: (d) => (open === d.id ? <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0, maxWidth: 420, overflowWrap: 'anywhere' }}>{pretty(d.payload)}</pre> : <span className="muted">Show</span>) },
        ]} />
    </Modal>
  );
}
function pretty(s: string) {
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function Docs({ origin, events, scopes }: { origin: string; events: Option[]; scopes: Option[] }) {
  const block = (s: string) => <pre className="mono" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }}>{s}</pre>;
  return (
    <div className="detail-grid" data-tour="int-docs">
      <Card title="Push a candidate">
        <div className="stack">
          <span className="muted">Needs a key with <code>candidates:write</code>. Send JSON, or multipart with a <code>cv</code> file (PDF, DOCX, TXT) to have it parsed and scored.</span>
          {block(`curl -X POST ${origin}/api/public/v1/candidates \\
  -H "X-API-Key: hrms_…" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Asha","last_name":"Rao","email":"asha@example.com","vacancy_id":1,"source":"Job board"}'`)}
          {block(`curl -X POST ${origin}/api/public/v1/candidates \\
  -H "X-API-Key: hrms_…" -F vacancy_id=1 -F cv=@resume.pdf`)}
        </div>
      </Card>
      <Card title="Read open jobs">
        <div className="stack">
          <span className="muted">Needs <code>jobs:read</code>. Returns the vacancies shown on the careers page with their job descriptions.</span>
          {block(`curl ${origin}/api/public/v1/jobs -H "X-API-Key: hrms_…"`)}
          <span className="section-title">Scopes</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{scopes.map((s) => <li key={s.key}><code>{s.key}</code> — {s.description}</li>)}</ul>
        </div>
      </Card>
      <Card title="Webhook payloads">
        <div className="stack">
          {block(`POST <your URL>
Content-Type: application/json
X-HRMS-Event: candidate.created
X-HRMS-Signature: sha256=<HMAC-SHA256(body, secret)>

{"event":"candidate.created","sent_at":"…","data":{"id":42,"email":"…","vacancy_id":1,"score":78}}`)}
          <span className="section-title">Events</span>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{events.map((e) => <li key={e.key}><code>{e.key}</code> — {e.description}</li>)}</ul>
          <small className="muted">Deliveries time out after 5 s and are not retried; a 2xx response counts as delivered.</small>
        </div>
      </Card>
    </div>
  );
}
