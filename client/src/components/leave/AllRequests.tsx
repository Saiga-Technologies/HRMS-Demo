import React, { useState } from 'react';
import { api, qs } from '../../lib/api';
import { useCounts } from '../../lib/notifications';
import { label } from '../../lib/format';
import { Button, Card, Input, Select, useFetch } from '../ui';
import ApplyLeaveModal from './ApplyLeaveModal';
import { RequestsTable, useCancelRequest } from './RequestsTable';
import { DirectoryEmployee, Holiday, LeaveRequest, LeaveType, employeeLabel } from './shared';

const STATUSES = ['pending', 'approved', 'correction_pending', 'rejected', 'cancelled'];

/** HR view of every request, with filters, apply-on-behalf, edit and cancel. */
export function AllRequests({ types, employees, holidays, weeklyOffs, sandwich }: { types: LeaveType[]; employees: DirectoryEmployee[]; holidays: Holiday[]; weeklyOffs: number[]; sandwich: boolean }) {
  const [filters, setFilters] = useState({ status: '', employee_id: '', from: '', to: '' });
  const set = (k: keyof typeof filters, v: string) => setFilters((s) => ({ ...s, [k]: v }));
  const key = JSON.stringify(filters);
  const list = useFetch<LeaveRequest[]>(() => api.get(`/api/leave/requests${qs(filters)}`), [key]);
  const [apply, setApply] = useState(false);
  const [edit, setEdit] = useState<LeaveRequest | null>(null);
  const { refreshCounts } = useCounts();
  const reload = () => { list.reload(); refreshCounts(); };
  const { cancel, dialog } = useCancelRequest(reload);
  const rows = list.data || [];
  return (
    <>
      {dialog}
      <div className="toolbar" data-tour="leave-all-filters">
        <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        <Select value={filters.employee_id} onChange={(e) => set('employee_id', e.target.value)} aria-label="Employee">
          <option value="">All employees</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{employeeLabel(e)}</option>)}
        </Select>
        <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From" />
        <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To" />
        <span className="muted">{rows.length} requests</span>
        <Button variant="primary" style={{ marginLeft: 'auto' }} onClick={() => setApply(true)} data-testid="leave-apply-behalf">+ Apply on behalf</Button>
      </div>
      <Card padded={false} tour="leave-all">
        <RequestsTable
          rows={rows}
          loading={list.loading}
          showEmployee
          empty="No leave requests match these filters."
          canEdit={(r) => r.status === 'pending' || r.status === 'approved'}
          canCancel={(r) => r.status === 'pending' || r.status === 'approved' || r.status === 'correction_pending'}
          onEdit={(r) => setEdit(r)}
          onCancel={cancel}
        />
      </Card>
      {apply ? <ApplyLeaveModal types={types} employees={employees} defaultEmployeeId={filters.employee_id ? Number(filters.employee_id) : undefined} holidays={holidays} weeklyOffs={weeklyOffs} sandwich={sandwich} onClose={() => setApply(false)} onSaved={() => { setApply(false); reload(); }} /> : null}
      {edit ? <ApplyLeaveModal types={types} existing={edit} holidays={holidays} weeklyOffs={weeklyOffs} sandwich={sandwich} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} /> : null}
    </>
  );
}
