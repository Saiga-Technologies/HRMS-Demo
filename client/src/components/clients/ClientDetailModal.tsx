import React, { useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney } from '../../lib/format';
import { Button, KeyValue, Modal, Spinner, Stat, useConfirm, useFetch, useToast } from '../ui';
import { Icon } from '../Icons';
import { ClientStatusBadge } from './Bits';
import { ClientFormModal } from './ClientFormModal';
import { PlacementFormModal } from './PlacementFormModal';
import { PlacementsTable, usePlacementActions } from './PlacementsTable';
import type { Client, ClientDetail, Placement } from './types';

/** Client profile with its placements and margin summary. HR can edit, delete and add placements. */
export function ClientDetailModal({ id, canEdit, clients, onClose, onChanged }: { id: number; canEdit: boolean; clients: Client[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const det = useFetch<ClientDetail>(() => api.get(`/api/clients/${id}`), [id]);
  const [mode, setMode] = useState<'view' | 'edit' | 'add-placement'>('view');
  const [editPlacement, setEditPlacement] = useState<Placement | null>(null);
  const changed = () => { det.reload(); onChanged(); };
  const actions = usePlacementActions(changed);
  const c = det.data;
  const cur = c?.billing_currency || 'INR';

  const remove = async () => {
    if (!c) return;
    const extra = c.total_placements ? ` Its ${c.total_placements} placement${c.total_placements === 1 ? '' : 's'} will be deleted too.` : '';
    if (!(await confirm(`Delete ${c.name}?`, `The client record will be removed permanently.${extra}`))) return;
    try {
      await api.delete(`/api/clients/${c.id}`);
      toast.success('Client deleted');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  if (mode === 'edit' && c) return <ClientFormModal client={c} onClose={() => setMode('view')} onSaved={() => { setMode('view'); changed(); }} />;
  if (mode === 'add-placement' && c) return <PlacementFormModal clientId={c.id} clients={clients.some((x) => x.id === c.id) ? clients : [...clients, c]} onClose={() => setMode('view')} onSaved={() => { setMode('view'); changed(); }} />;
  if (editPlacement) return <PlacementFormModal placement={editPlacement} clients={clients} onClose={() => setEditPlacement(null)} onSaved={() => { setEditPlacement(null); changed(); }} />;

  const ms = c?.margin_summary;
  return (
    <Modal open wide onClose={onClose} testId="client-detail"
      title={c ? <span>{c.name} {c.code ? <span className="muted mono">{c.code}</span> : null} <ClientStatusBadge status={c.status} /></span> : 'Client'}
      footer={c && canEdit ? (
        <>
          <Button variant="danger" onClick={remove} style={{ marginRight: 'auto' }} data-testid="client-delete"><Icon name="trash" size={15} /> Delete</Button>
          <Button onClick={() => setMode('edit')} data-testid="client-edit"><Icon name="edit" size={15} /> Edit</Button>
          <Button variant="primary" onClick={() => setMode('add-placement')} data-testid="client-add-placement"><Icon name="plus" size={15} /> Add placement</Button>
        </>
      ) : <Button onClick={onClose}>Close</Button>}>
      {dialog}
      {actions.dialog}
      {det.loading && !c ? <Spinner /> : det.error ? <div className="alert alert-error">{det.error}</div> : c && ms ? (
        <>
          <div className="stat-strip">
            <Stat label="Active placements" value={ms.active_placements} icon="users" color="var(--brand)" />
            <Stat label="Monthly billing" value={fmtMoney(ms.monthly_billing, cur)} icon="banknote" color="var(--info)" />
            <Stat label="Monthly margin" value={fmtMoney(ms.monthly_margin, cur)} hint={`${ms.margin_pct}% of billing`} icon="trendingUp" color="var(--success)" />
            <Stat label="Placement fees" value={fmtMoney(ms.placement_fees, cur)} icon="wallet" color="var(--accent)" />
          </div>
          <div className="detail-grid mb">
            <div>
              <div className="section-title">Contact</div>
              <KeyValue items={[
                { k: 'Name', v: c.contact_name || '—' },
                { k: 'Email', v: c.contact_email ? <a href={`mailto:${c.contact_email}`}>{c.contact_email}</a> : '—' },
                { k: 'Phone', v: c.contact_phone || '—' },
                { k: 'Website', v: c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website.replace(/^https?:\/\//, '')}</a> : '—' },
              ]} />
            </div>
            <div>
              <div className="section-title">Account</div>
              <KeyValue items={[
                { k: 'Industry', v: c.industry || '—' },
                { k: 'Billing', v: `${c.billing_currency} · net ${c.payment_terms_days} days` },
                { k: 'Address', v: c.address || '—' },
                { k: 'Notes', v: c.notes || '—' },
              ]} />
            </div>
          </div>
          <div className="section-title">Placements ({c.placements.length})</div>
          <PlacementsTable
            rows={c.placements}
            canEdit={canEdit}
            showClient={false}
            onEdit={setEditPlacement}
            onStatus={actions.changeStatus}
            onDelete={actions.remove}
            empty={canEdit ? 'No placements yet. Use "Add placement" to place an employee or candidate.' : 'No placements yet.'}
          />
        </>
      ) : null}
    </Modal>
  );
}
