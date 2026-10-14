import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useCounts } from '../../lib/notifications';
import { todayIso } from '../../lib/format';
import { Button, Card, EmptyState, Spinner, useFetch } from '../ui';
import ApplyLeaveModal from './ApplyLeaveModal';
import { RequestsTable, useCancelRequest } from './RequestsTable';
import { Holiday, LeaveBalance, LeaveRequest, LeaveType, fmtDays } from './shared';

export function BalanceCards({ balances, loading, tour }: { balances: LeaveBalance[]; loading?: boolean; tour?: string }) {
  if (loading && !balances.length) return <Spinner />;
  if (!balances.length) return <Card><EmptyState icon="🌴" title="No leave balances" description="HR has not set up any active leave types yet." /></Card>;
  return (
    <div className="grid grid-auto balance-grid" data-tour={tour}>
      {balances.map((b) => {
        const total = b.allocated + b.carried + b.adjusted;
        const pct = total > 0 ? Math.min(100, Math.round((b.used / total) * 100)) : 0;
        return (
          <div key={b.id} className="balance-card" style={{ borderTopColor: b.color }} data-testid="balance-card">
            <div className="row between">
              <span className="row" style={{ gap: 6 }}><span className="color-swatch" style={{ background: b.color }} /><strong>{b.name}</strong></span>
              <span className="muted mono">{b.code}</span>
            </div>
            <div className="balance-available"><span className="stat-value">{b.available}</span> <span className="muted">available</span></div>
            <div className="progress"><span style={{ width: `${pct}%`, background: b.color }} /></div>
            <div className="balance-meta muted">
              <span>Used {b.used}</span>
              <span>Pending {b.pending}</span>
              <span>Allocated {b.allocated}{b.carried ? ` + ${b.carried} carried` : ''}{b.adjusted ? ` ${b.adjusted > 0 ? '+' : ''}${b.adjusted} adj.` : ''}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MyLeave({ types, holidays, weeklyOffs, sandwich }: { types: LeaveType[]; holidays: Holiday[]; weeklyOffs: number[]; sandwich: boolean }) {
  const { user, isHr } = useAuth();
  const eid = user?.employee_id;
  const year = new Date().getFullYear();
  const balances = useFetch<LeaveBalance[]>(() => (eid ? api.get(`/api/leave/balances/${eid}${qs({ year })}`) : Promise.resolve([])), [eid]);
  const requests = useFetch<LeaveRequest[]>(() => (eid ? api.get(`/api/leave/requests${qs({ employee_id: eid })}`) : Promise.resolve([])), [eid]);
  const [apply, setApply] = useState(false);
  const [edit, setEdit] = useState<LeaveRequest | null>(null);
  const { refreshCounts } = useCounts();
  const reload = () => { balances.reload(); requests.reload(); refreshCounts(); };
  const { cancel, dialog } = useCancelRequest(reload);
  if (!eid) {
    return (
      <Card>
        <EmptyState icon="🌴" title="No employee record linked to your login" description="Leave balances and requests need an employee profile. Ask HR to link your user account to your employee record under Settings → Users." />
      </Card>
    );
  }
  const rows = requests.data || [];
  const pendingDays = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
  return (
    <>
      {dialog}
      <div className="row between mb">
        <span className="muted">{year} balances{pendingDays ? ` · ${fmtDays(pendingDays)} awaiting approval` : ''}</span>
        <Button variant="primary" onClick={() => setApply(true)} data-testid="leave-apply" data-tour="leave-apply-btn">+ Apply for leave</Button>
      </div>
      <BalanceCards balances={balances.data || []} loading={balances.loading} tour="leave-balances" />
      <Card padded={false} title="My requests" className="mt" tour="leave-my-requests">
        <RequestsTable
          rows={rows}
          loading={requests.loading}
          empty="You have not applied for any leave yet."
          canEdit={(r) => r.status === 'pending' || r.status === 'approved'}
          canCancel={(r) => (r.status === 'pending' || r.status === 'approved' || r.status === 'correction_pending') && (isHr || r.status === 'pending' || r.start_date > todayIso())}
          onEdit={(r) => setEdit(r)}
          onCancel={cancel}
        />
        <p className="help" style={{ padding: '8px 18px' }}>Pending requests can be edited freely. Editing an <strong>approved</strong> request sends the change to your approver as “correction pending” and the original dates stay in effect until it is approved.</p>
      </Card>
      {apply ? <ApplyLeaveModal types={types} holidays={holidays} weeklyOffs={weeklyOffs} sandwich={sandwich} onClose={() => setApply(false)} onSaved={() => { setApply(false); reload(); }} /> : null}
      {edit ? <ApplyLeaveModal types={types} existing={edit} holidays={holidays} weeklyOffs={weeklyOffs} sandwich={sandwich} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /> : null}
    </>
  );
}
