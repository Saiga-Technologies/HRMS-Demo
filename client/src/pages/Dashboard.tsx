import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { fmtDate, fmtMoney, fullName } from '../lib/format';
import { Button, Card, EmptyState, ExpiryDot, Field, Input, Modal, PageHeader, Select, Stat, Textarea, useFetch, useToast, Badge } from '../components/ui';

interface CardDef { id: number; type: 'stat' | 'list' | 'link' | 'note'; title: string; config: any; size: 'sm' | 'md' | 'lg'; sort_order: number }
interface CatalogItem { type: string; key: string; title: string }

const TOUR = [
  { element: '[data-tour="dash-header"]', title: 'Your dashboard', description: 'A live overview of your organisation. Every card is optional and the layout is yours to arrange.' },
  { element: '[data-tour="dash-add"]', title: 'Add cards without limits', description: 'Pick any metric, list, quick-link or note card from the catalog. There is no cap on the number of cards.' },
  { element: '[data-tour="dash-grid"]', title: 'Arrange and resize', description: 'Drag cards to reorder them. Use the ⋯ menu on a card to resize or remove it. Click a stat to jump to the related page.' },
  { element: '[data-tour="tour-button"]', title: 'Tour any page', description: 'Every page has a "Tour this page" button that walks you through what is on screen.' },
];

const LINKS: Record<string, string> = {
  headcount: '/employees', present_today: '/attendance?tab=daily', on_leave_today: '/leave?tab=calendar', pending_leaves: '/leave?tab=approvals', pending_corrections: '/attendance?tab=corrections',
  expiring_documents: '/documents?tab=expiring', open_vacancies: '/jobs?tab=vacancies', assets_assigned: '/assets', payroll_last_net: '/payroll?tab=runs', my_leave_balance: '/leave', my_hours_this_month: '/attendance',
};

export default function Dashboard() {
  usePageTour('Dashboard', TOUR);
  const { user, company } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const cards = useFetch<CardDef[]>(() => api.get('/api/dashboard/cards'), []);
  const data = useFetch<any>(() => api.get('/api/dashboard/data'), []);
  const catalog = useFetch<CatalogItem[]>(() => api.get('/api/dashboard/catalog'), []);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CardDef | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const currency = company.currency || 'INR';
  const list = cards.data || [];

  const reorder = async (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const ids = list.map((c) => c.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    cards.setData(ids.map((id) => list.find((c) => c.id === id)!));
    try {
      await api.put('/api/dashboard/cards/reorder', { ids });
    } catch (e) {
      toast.error(e);
      cards.reload();
    }
  };
  const remove = async (c: CardDef) => {
    try {
      await api.delete(`/api/dashboard/cards/${c.id}`);
      cards.setData(list.filter((x) => x.id !== c.id));
    } catch (e) {
      toast.error(e);
    }
  };
  const resize = async (c: CardDef, size: 'sm' | 'md' | 'lg') => {
    try {
      const upd = await api.put<CardDef>(`/api/dashboard/cards/${c.id}`, { size });
      cards.setData(list.map((x) => (x.id === c.id ? upd : x)));
    } catch (e) {
      toast.error(e);
    }
  };
  const reset = async () => {
    try {
      const d = await api.post<CardDef[]>('/api/dashboard/cards/reset');
      cards.setData(d);
      toast.success('Dashboard reset to defaults');
    } catch (e) {
      toast.error(e);
    }
  };

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }, []);

  return (
    <>
      <PageHeader
        tour="dash-header"
        title={`${greeting}, ${user?.first_name || user?.email}`}
        subtitle={`${company.name || 'Your company'} · ${fmtDate(new Date().toISOString().slice(0, 10), { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <>
            <Button onClick={reset}>Reset layout</Button>
            <Button variant="primary" onClick={() => setAdding(true)} data-tour="dash-add" data-testid="dash-add-card">+ Add card</Button>
          </>
        }
      />
      {cards.loading || data.loading ? null : list.length === 0 ? (
        <EmptyState title="No cards yet" description="Add any number of cards to build your own dashboard." action={<Button variant="primary" onClick={() => setAdding(true)}>+ Add card</Button>} />
      ) : null}
      <div className="dash-grid" data-tour="dash-grid" data-testid="dash-grid">
        {list.map((c) => (
          <div
            key={c.id}
            className={`dash-card ${c.size} ${dragId === c.id ? 'dragging' : ''} ${overId === c.id && dragId !== c.id ? 'over' : ''}`}
            draggable
            onDragStart={() => setDragId(c.id)}
            onDragOver={(e) => { e.preventDefault(); setOverId(c.id); }}
            onDragLeave={() => setOverId(null)}
            onDrop={(e) => { e.preventDefault(); if (dragId != null) reorder(dragId, c.id); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            data-testid="dash-card"
          >
            <CardView card={c} data={data.data} currency={currency} onRemove={() => remove(c)} onResize={(s) => resize(c, s)} onEdit={() => setEditing(c)} onOpen={(to) => navigate(to)} />
          </div>
        ))}
      </div>
      {adding ? (
        <AddCardModal catalog={catalog.data || []} onClose={() => setAdding(false)} onAdded={(c) => { cards.setData([...list, c]); setAdding(false); }} />
      ) : null}
      {editing ? (
        <EditCardModal card={editing} onClose={() => setEditing(null)} onSaved={(c) => { cards.setData(list.map((x) => (x.id === c.id ? c : x))); setEditing(null); }} />
      ) : null}
    </>
  );
}

function CardMenu({ card, onRemove, onResize, onEdit }: { card: CardDef; onRemove: () => void; onResize: (s: 'sm' | 'md' | 'lg') => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="user-menu" onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-label="Card options" data-testid="card-menu">⋯</button>
      {open ? (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { onEdit(); setOpen(false); }}>Edit title / content</button>
          <button onClick={() => { onResize('sm'); setOpen(false); }}>{card.size === 'sm' ? '✓ ' : ''}Small</button>
          <button onClick={() => { onResize('md'); setOpen(false); }}>{card.size === 'md' ? '✓ ' : ''}Medium</button>
          <button onClick={() => { onResize('lg'); setOpen(false); }}>{card.size === 'lg' ? '✓ ' : ''}Large</button>
          <button className="danger" onClick={() => { onRemove(); setOpen(false); }} data-testid="card-remove">Remove card</button>
        </div>
      ) : null}
    </div>
  );
}

function CardView({ card, data, currency, onRemove, onResize, onEdit, onOpen }: { card: CardDef; data: any; currency: string; onRemove: () => void; onResize: (s: 'sm' | 'md' | 'lg') => void; onEdit: () => void; onOpen: (to: string) => void }) {
  const key = card.config?.key as string | undefined;
  const menu = <CardMenu card={card} onRemove={onRemove} onResize={onResize} onEdit={onEdit} />;
  if (card.type === 'stat') {
    const v = data?.[key || ''];
    let value: React.ReactNode = v ?? '—';
    let hint: React.ReactNode = undefined;
    if (key === 'payroll_last_net') { value = v ? fmtMoney(v.net, currency) : '—'; hint = v ? `${v.period} · ${v.status}` : 'No payroll run yet'; }
    if (key === 'my_hours_this_month') { value = `${v ?? 0} h`; }
    if (key === 'my_leave_balance') { hint = (data?.my_leave_balance_detail || []).map((b: any) => `${b.name.split(' ')[0]} ${b.available}`).join(' · '); }
    if (key === 'expiring_documents') { hint = v ? 'needs attention' : 'all documents valid'; }
    return (
      <div style={{ position: 'relative', height: '100%' }}>
        <Stat label={card.title} value={value} hint={hint} onClick={key && LINKS[key] ? () => onOpen(LINKS[key]) : undefined} />
        <div style={{ position: 'absolute', top: 6, right: 6 }}>{menu}</div>
      </div>
    );
  }
  if (card.type === 'note') {
    return (
      <Card title={card.title} actions={menu}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{card.config?.text || <span className="muted">Click ⋯ → Edit to write a note.</span>}</div>
      </Card>
    );
  }
  if (card.type === 'link') {
    const links: { label: string; to: string }[] = card.config?.links?.length ? card.config.links : [
      { label: 'Punch in / out', to: '/attendance' }, { label: 'Apply for leave', to: '/leave' }, { label: 'My documents', to: '/documents' }, { label: 'My payslips', to: '/payroll' }, { label: 'Org tree', to: '/org-tree' },
    ];
    return (
      <Card title={card.title} actions={menu}>
        <div className="chip-list">
          {links.map((l, i) => <Link key={i} className="chip" to={l.to}>{l.label}</Link>)}
        </div>
      </Card>
    );
  }
  // list cards
  const rows: any[] = data?.[key || ''] || [];
  return (
    <Card title={card.title} actions={menu}>
      {rows.length === 0 ? <div className="muted">Nothing to show.</div> : (
        <ul className="list">
          {rows.map((r, i) => <li key={r.id ?? i}>{renderListRow(key || '', r, currency)}</li>)}
        </ul>
      )}
    </Card>
  );
}

function renderListRow(key: string, r: any, currency: string) {
  switch (key) {
    case 'recent_joiners':
      return <><span><Link to={`/employees/${r.id}`}>{fullName(r)}</Link> <span className="meta">{r.position_title || ''}</span></span><span className="meta">{fmtDate(r.join_date)}</span></>;
    case 'upcoming_birthdays':
      return <><Link to={`/employees/${r.id}`}>{fullName(r)}</Link><span className="meta">🎂 {fmtDate(r.next, { day: 'numeric', month: 'short' })}</span></>;
    case 'expiring_documents_list':
      return <><span><Link to={`/employees/${r.employee_id}`}>{r.employee_name}</Link> <span className="meta">{r.type_name || r.title}</span></span><ExpiryDot state={r.expiry_state} days={r.days_to_expiry} /></>;
    case 'pending_approvals':
      return <><span><Link to={r.kind === 'leave' ? '/leave?tab=approvals' : '/attendance?tab=corrections'}>{r.employee_name}</Link> <span className="meta">{r.kind === 'leave' ? `${r.detail} · ${r.days}d` : r.detail}</span></span><Badge tone={r.kind === 'leave' ? 'info' : 'warning'}>{r.kind}</Badge></>;
    case 'upcoming_holidays':
      return <><span>{r.name}</span><span className="meta">{fmtDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></>;
    case 'journey_in_progress':
      return <><span><Link to={`/journey?employee=${r.id}`}>{fullName(r)}</Link> <span className="meta">{r.stage}</span></span><span className="meta">{r.done}/{r.total}</span></>;
    case 'my_recent_payslips':
      return <><span>{r.period} <Badge tone={r.status === 'paid' ? 'success' : 'info'}>{r.status}</Badge></span><strong className="num">{fmtMoney(r.net, r.currency || currency)}</strong></>;
    default:
      return <span>{JSON.stringify(r)}</span>;
  }
}

function AddCardModal({ catalog, onClose, onAdded }: { catalog: CatalogItem[]; onClose: () => void; onAdded: (c: CardDef) => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'catalog' | 'note' | 'link'>('catalog');
  const [key, setKey] = useState(catalog[0]?.key || '');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [size, setSize] = useState<'sm' | 'md' | 'lg'>('sm');
  const [busy, setBusy] = useState(false);
  const chosen = catalog.find((c) => c.key === key);
  const submit = async () => {
    setBusy(true);
    try {
      let body: any;
      if (kind === 'catalog') {
        if (!chosen) throw new Error('Pick a card');
        body = { type: chosen.type, title: title || chosen.title, config: { key: chosen.key }, size: size || (chosen.type === 'stat' ? 'sm' : 'md') };
      } else if (kind === 'note') body = { type: 'note', title: title || 'Note', config: { text }, size };
      else body = { type: 'link', title: title || 'Quick links', config: {}, size };
      const c = await api.post<CardDef>('/api/dashboard/cards', body);
      toast.success('Card added');
      onAdded(c);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Add a card" onClose={onClose} testId="add-card-modal" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit} data-testid="add-card-submit">Add card</Button></>}>
      <div className="stack">
        <div className="row">
          {(['catalog', 'note', 'link'] as const).map((k) => <button key={k} className={`pill ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'catalog' ? 'Metric / list' : k === 'note' ? 'Note' : 'Quick links'}</button>)}
        </div>
        {kind === 'catalog' ? (
          <Field label="Card">
            <Select value={key} onChange={(e) => setKey(e.target.value)} data-testid="add-card-key">
              {catalog.map((c) => <option key={c.key} value={c.key}>{c.title} ({c.type})</option>)}
            </Select>
          </Field>
        ) : null}
        <Field label="Title" hint="Optional — defaults to the card name"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={chosen?.title} /></Field>
        {kind === 'note' ? <Field label="Note"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field> : null}
        <Field label="Size"><Select value={size} onChange={(e) => setSize(e.target.value as any)}><option value="sm">Small</option><option value="md">Medium</option><option value="lg">Large</option></Select></Field>
        <p className="help">You can add as many cards as you like — there is no limit.</p>
      </div>
    </Modal>
  );
}

function EditCardModal({ card, onClose, onSaved }: { card: CardDef; onClose: () => void; onSaved: (c: CardDef) => void }) {
  const toast = useToast();
  const [title, setTitle] = useState(card.title);
  const [text, setText] = useState(card.config?.text || '');
  const [links, setLinks] = useState<{ label: string; to: string }[]>(card.config?.links || []);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const config = { ...card.config };
      if (card.type === 'note') config.text = text;
      if (card.type === 'link') config.links = links.filter((l) => l.label && l.to);
      const c = await api.put<CardDef>(`/api/dashboard/cards/${card.id}`, { title, config });
      onSaved(c);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title="Edit card" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Save</Button></>}>
      <div className="stack">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {card.type === 'note' ? <Field label="Note"><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field> : null}
        {card.type === 'link' ? (
          <div className="stack">
            <span className="field-label">Links</span>
            {links.map((l, i) => (
              <div className="row" key={i}>
                <Input placeholder="Label" value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Input placeholder="/path" value={l.to} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" onClick={() => setLinks(links.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <div><Button size="sm" onClick={() => setLinks([...links, { label: '', to: '/' }])}>+ Add link</Button></div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
