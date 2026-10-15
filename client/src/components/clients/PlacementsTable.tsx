import React from 'react';
import { api } from '../../lib/api';
import { fmtDate, fmtMoney } from '../../lib/format';
import { Button, EmptyState, Table, useConfirm, useToast, type Column } from '../ui';
import { Icon } from '../Icons';
import { Margin, PersonCell, PlacementStatusBadge, Rate, TransitionButtons } from './Bits';
import { PLACEMENT_STATUS_LABEL, TRANSITION_LABEL, type Placement, type PlacementStatus } from './types';

/** Status change + delete for placements, with confirmation for the irreversible ones. */
export function usePlacementActions(onChanged: () => void) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const changeStatus = async (p: Placement, to: PlacementStatus) => {
    if (to === 'terminated' || to === 'completed') {
      const ok = await confirm(`${TRANSITION_LABEL[to]} placement?`, `${p.person_name || 'This placement'} at ${p.client_name} will be marked ${PLACEMENT_STATUS_LABEL[to].toLowerCase()}${p.end_date ? '' : ' and the end date set to today'}.`, to === 'terminated');
      if (!ok) return;
    }
    try {
      await api.post(`/api/clients/placements/${p.id}/status`, { status: to });
      toast.success(`Placement ${PLACEMENT_STATUS_LABEL[to].toLowerCase()}`);
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };
  const remove = async (p: Placement) => {
    if (!(await confirm('Delete placement?', `${p.role_title} for ${p.person_name || 'this person'} at ${p.client_name} will be removed permanently.`))) return;
    try {
      await api.delete(`/api/clients/placements/${p.id}`);
      toast.success('Placement deleted');
      onChanged();
    } catch (err) {
      toast.error(err);
    }
  };
  return { changeStatus, remove, dialog };
}

export function PlacementsTable({ rows, loading, canEdit, showClient = true, onEdit, onStatus, onDelete, onOpenClient, empty, tour }: {
  rows: Placement[];
  loading?: boolean;
  canEdit: boolean;
  showClient?: boolean;
  onEdit?: (p: Placement) => void;
  onStatus?: (p: Placement, to: PlacementStatus) => void;
  onDelete?: (p: Placement) => void;
  onOpenClient?: (clientId: number) => void;
  empty?: React.ReactNode;
  tour?: string;
}) {
  const columns: Column<Placement>[] = [
    { key: 'person', header: 'Person', render: (p) => <PersonCell p={p} /> },
    ...(showClient ? [{ key: 'client', header: 'Client', render: (p: Placement) => (
      onOpenClient ? <button type="button" className="btn btn-link btn-sm" onClick={(e) => { e.stopPropagation(); onOpenClient(p.client_id); }}>{p.client_name}</button> : p.client_name
    ) }] : []),
    { key: 'role_title', header: 'Role', render: (p) => <span><span data-testid="placement-role-cell">{p.role_title}</span>{p.location ? <div className="muted">{p.location}</div> : null}</span> },
    { key: 'dates', header: 'Dates', render: (p) => (
      <span>
        {fmtDate(p.start_date)} – {p.end_date ? fmtDate(p.end_date) : <span className="muted">open</span>}
        {p.status === 'active' && p.days_to_end != null && p.days_to_end >= 0 && p.days_to_end <= 30 ? <div style={{ color: 'var(--warning-ink)' }}>Ends in {p.days_to_end} day{p.days_to_end === 1 ? '' : 's'}</div> : null}
      </span>
    ) },
    { key: 'bill', header: 'Bill / pay', render: (p) => (
      <span><Rate value={p.bill_rate} unit={p.rate_unit} currency={p.billing_currency} /><div className="muted"><Rate value={p.pay_rate} unit={p.rate_unit} currency={p.billing_currency} /></div></span>
    ) },
    { key: 'margin', header: 'Margin', render: (p) => <Margin p={p} /> },
    { key: 'fee', header: 'Fee', align: 'right', render: (p) => (p.placement_fee ? fmtMoney(p.placement_fee, p.billing_currency) : <span className="muted">—</span>) },
    { key: 'status', header: 'Status', render: (p) => <PlacementStatusBadge status={p.status} /> },
  ];
  if (canEdit) {
    columns.push({ key: 'actions', header: '', align: 'right', render: (p) => (
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6, flexWrap: 'nowrap' }}>
        {onStatus ? <TransitionButtons p={p} onChange={onStatus} /> : null}
        {onEdit ? <Button size="sm" variant="ghost" aria-label="Edit placement" title="Edit" data-testid="placement-edit" onClick={(e) => { e.stopPropagation(); onEdit(p); }}><Icon name="edit" size={15} /></Button> : null}
        {onDelete ? <Button size="sm" variant="ghost" aria-label="Delete placement" title="Delete" data-testid="placement-delete" onClick={(e) => { e.stopPropagation(); onDelete(p); }}><Icon name="trash" size={15} /></Button> : null}
      </div>
    ) });
  }
  return (
    <Table<Placement>
      tour={tour}
      loading={loading}
      rows={rows}
      empty={empty || <EmptyState title="No placements" description="Nobody is placed here yet." />}
      columns={columns}
    />
  );
}
