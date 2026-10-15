import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePageTour } from '../lib/tour';
import { DeptIcon } from '../components/DeptBadge';
import { Avatar, Button, Card, Checkbox, EmptyState, Field, Modal, PageHeader, Pill, SearchInput, Select, Spinner, useFetch, useToast } from '../components/ui';

/* ------------------------------------------------------------------ */
/* Types (mirrors GET /api/org/tree)                                    */
/* ------------------------------------------------------------------ */
type Mode = 'reporting' | 'department';
interface EmpNode { type: 'employee'; id: number; employee_code: string; first_name: string; last_name: string; email: string; photo_path?: string | null; manager_id?: number | null; department_id?: number | null; position_id?: number | null; status: string; department_name?: string | null; department_color?: string | null; position_title?: string | null; children?: EmpNode[] }
interface PosNode { type: 'position'; id: number; title: string; code?: string | null; department_id?: number | null; headcount: number; level: number; employees: EmpNode[] }
interface DeptNode { type: 'department'; id: number; name: string; code?: string | null; color?: string | null; icon?: string | null; parent_id?: number | null; head_employee_id?: number | null; positions: PosNode[]; employees: EmpNode[]; children: DeptNode[] }
type AnyNode = EmpNode | PosNode | DeptNode;
interface TreeResp { mode: Mode; roots: AnyNode[]; unassigned?: EmpNode[]; total: number }
interface Dept { id: number; name: string; color?: string; head_name?: string; employee_count: number; parent_id?: number | null }
interface Pos { id: number; title: string; department_id?: number | null; department_name?: string }
interface DirEmp { id: number; first_name: string; last_name: string; employee_code: string }
interface Options { photo: boolean; position: boolean; department: boolean; email: boolean; count: boolean }
interface DragInfo { type: AnyNode['type']; id: number; key: string; label: string }
type DropTarget = AnyNode | 'unassigned' | 'root';

const DEFAULT_OPTIONS: Options = { photo: true, position: true, department: true, email: false, count: true };
const keyOf = (n: AnyNode) => `${n.type[0]}-${n.id}`;
const nameOf = (n: AnyNode) => (n.type === 'employee' ? `${n.first_name} ${n.last_name}`.trim() : n.type === 'position' ? n.title : n.name);
function childrenOf(n: AnyNode): AnyNode[] {
  if (n.type === 'employee') return n.children || [];
  if (n.type === 'position') return n.employees;
  return [...n.children, ...n.positions, ...n.employees];
}
/** Employees: number of (indirect) reports. Positions: filled seats. Departments: employees incl. sub-departments. */
function countPeople(n: AnyNode): number {
  if (n.type === 'employee') return (n.children || []).reduce((a, c) => a + 1 + countPeople(c), 0);
  if (n.type === 'position') return n.employees.length;
  return n.employees.length + n.positions.reduce((a, p) => a + p.employees.length, 0) + n.children.reduce((a, c) => a + countPeople(c), 0);
}
function nodeText(n: AnyNode): string {
  if (n.type === 'employee') return [n.first_name, n.last_name, n.employee_code, n.email, n.position_title, n.department_name].filter(Boolean).join(' ').toLowerCase();
  if (n.type === 'position') return [n.title, n.code].filter(Boolean).join(' ').toLowerCase();
  return [n.name, n.code].filter(Boolean).join(' ').toLowerCase();
}

const TOUR = [
  { element: '[data-tour="tree-mode"]', title: 'Two ways to look at the organisation', description: '"Reporting line" nests people under their manager. "Departments" shows departments, the positions inside them and who holds each position.' },
  { element: '[data-tour="tree-options"]', title: 'Customise the chart', description: 'Switch between a horizontal or vertical layout, choose what each card shows (photo, position, department, email, headcount) and zoom in or out.' },
  { element: '[data-tour="tree-search"]', title: 'Find anyone', description: 'Type a name, code, email, position or department. Matches are highlighted and their branches are expanded automatically.' },
  { element: '[data-tour="tree-node"]', title: 'A node', description: 'Each card is a person, position or department. Use the small toggle under a card to collapse or expand its branch. HR can click a card to edit where it sits in the tree.' },
  { element: '[data-tour="tree-dnd"]', title: 'Drag and drop', description: 'HR can drag a person onto a new manager, or (in department view) drag people, positions and departments onto a department to move them. Changes are saved immediately.' },
  { element: '[data-tour="tree-unassigned"]', title: 'Unassigned people', description: 'In department view, employees without a department wait here. Drag them onto a department to place them.' },
  { element: '[data-tour="tree-print"]', title: 'Print or export', description: 'Print the current view (or save it as a PDF from the print dialog) to share the chart.' },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function OrgTree() {
  usePageTour('Org tree', TOUR);
  const toast = useToast();
  const { isHr } = useAuth();
  const [mode, setMode] = useState<Mode>('reporting');
  const [vertical, setVertical] = useState(false);
  const [options, setOptions] = useState<Options>(() => {
    try {
      const raw = localStorage.getItem('hrms:orgtree-options');
      return raw ? { ...DEFAULT_OPTIONS, ...JSON.parse(raw) } : DEFAULT_OPTIONS;
    } catch {
      return DEFAULT_OPTIONS;
    }
  });
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editNode, setEditNode] = useState<AnyNode | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  const tree = useFetch<TreeResp>(() => api.get(`/api/org/tree?mode=${mode}`), [mode]);
  const depts = useFetch<Dept[]>(() => api.get('/api/org/departments'), []);
  const positions = useFetch<Pos[]>(() => api.get('/api/org/positions'), []);
  const directory = useFetch<DirEmp[]>(() => api.get('/api/employees/directory/all'), []);
  const deptById = useMemo(() => new Map((depts.data || []).map((d) => [d.id, d])), [depts.data]);

  useEffect(() => {
    try { localStorage.setItem('hrms:orgtree-options', JSON.stringify(options)); } catch { /* ignore */ }
  }, [options]);

  /* ---- search: matching keys + their ancestors ---- */
  const search = useMemo(() => {
    const matches = new Set<string>();
    const ancestors = new Set<string>();
    const q = query.trim().toLowerCase();
    if (!q || !tree.data) return { matches, ancestors, active: false };
    const walk = (n: AnyNode, path: string[]) => {
      const k = keyOf(n);
      if (nodeText(n).includes(q)) { matches.add(k); path.forEach((p) => ancestors.add(p)); }
      childrenOf(n).forEach((c) => walk(c, [...path, k]));
    };
    tree.data.roots.forEach((r) => walk(r, []));
    return { matches, ancestors, active: true };
  }, [query, tree.data]);
  useEffect(() => {
    if (!search.ancestors.size) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      search.ancestors.forEach((k) => next.delete(k));
      return next;
    });
  }, [search]);

  const parentKeys = useMemo(() => {
    const out: string[] = [];
    const walk = (n: AnyNode) => { const ch = childrenOf(n); if (ch.length) out.push(keyOf(n)); ch.forEach(walk); };
    (tree.data?.roots || []).forEach(walk);
    return out;
  }, [tree.data]);

  const toggle = (k: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });
  const fit = () => {
    const vp = viewportRef.current;
    const inner = innerRef.current;
    if (!vp || !inner) return;
    const w = inner.scrollWidth || 1;
    const h = inner.scrollHeight || 1;
    const z = Math.min((vp.clientWidth - 24) / w, (vp.clientHeight - 24) / h, 1.6);
    setZoom(Math.max(0.3, Math.round(z * 100) / 100));
  };
  const reset = () => { setZoom(1); setCollapsed(new Set()); setQuery(''); };

  /* ---- drag and drop (HR only) ---- */
  const canDrop = (target: DropTarget): boolean => {
    if (!drag || !isHr) return false;
    if (target === 'root') return mode === 'reporting' && drag.type === 'employee';
    if (target === 'unassigned') return mode === 'department' && drag.type === 'employee';
    if (keyOf(target) === drag.key) return false;
    if (mode === 'reporting') return drag.type === 'employee' && target.type === 'employee';
    if (target.type === 'department') return true; // employee, position or department onto a department
    if (target.type === 'position') return drag.type === 'employee';
    return false;
  };
  const doDrop = async (target: DropTarget) => {
    if (!drag || !canDrop(target)) return;
    const d = drag;
    setDrag(null);
    setOver(null);
    try {
      let where = '';
      if (target === 'root') { await api.post('/api/org/tree/move', { type: 'employee', id: d.id, new_parent_id: null }); where = 'the top level'; }
      else if (target === 'unassigned') { await api.put(`/api/employees/${d.id}`, { department_id: null }); where = 'Unassigned'; }
      else if (target.type === 'department' && d.type === 'employee') { await api.put(`/api/employees/${d.id}`, { department_id: target.id }); where = target.name; }
      else if (target.type === 'position' && d.type === 'employee') {
        const body: Record<string, any> = { position_id: target.id };
        if (target.department_id) body.department_id = target.department_id;
        await api.put(`/api/employees/${d.id}`, body);
        where = target.title;
      } else { await api.post('/api/org/tree/move', { type: d.type, id: d.id, new_parent_id: target.id }); where = nameOf(target); }
      toast.success(`${d.label} moved to ${where}`);
      tree.reload();
      depts.reload();
    } catch (err) {
      toast.error(err);
    }
  };
  const dnd = (target: DropTarget, key: string) => ({
    onDragOver: (e: React.DragEvent) => { if (canDrop(target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== key) setOver(key); } },
    onDragEnter: (e: React.DragEvent) => { if (canDrop(target)) { e.preventDefault(); setOver(key); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); doDrop(target); },
  });
  const startDrag = (n: AnyNode) => (e: React.DragEvent) => {
    if (!isHr) { e.preventDefault(); return; }
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', keyOf(n));
    setDrag({ type: n.type, id: n.id, key: keyOf(n), label: nameOf(n) });
  };
  const endDrag = () => { setDrag(null); setOver(null); };

  /* ---- node renderer (recursive) ---- */
  let firstNodeTagged = false;
  const renderNode = (n: AnyNode): React.ReactNode => {
    const k = keyOf(n);
    const kids = childrenOf(n);
    const isCollapsed = collapsed.has(k);
    const people = countPeople(n);
    const color = n.type === 'employee' ? n.department_color || undefined : n.type === 'department' ? n.color || undefined : deptById.get(n.department_id || 0)?.color || undefined;
    const tourAttr = !firstNodeTagged ? 'tree-node' : undefined;
    firstNodeTagged = true;
    const cls = ['tree-node', n.type === 'department' ? 'dept' : '', n.type === 'position' ? 'pos' : '', search.matches.has(k) ? 'match' : '', search.active && !search.matches.has(k) && !search.ancestors.has(k) ? 'dim' : '', over === k ? 'drop-target' : '', drag?.key === k ? 'dragging' : ''].filter(Boolean).join(' ');
    return (
      <li key={k}>
        <div
          className={cls}
          data-tour={tourAttr}
          data-node={k}
          style={{ borderLeftColor: color }}
          draggable={isHr}
          onDragStart={startDrag(n)}
          onDragEnd={endDrag}
          onClick={isHr ? () => setEditNode(n) : undefined}
          title={isHr ? 'Click to edit, drag to move' : undefined}
          {...dnd(n, k)}
        >
          {n.type === 'employee' ? (
            <>
              {options.photo ? <Avatar name={nameOf(n)} src={n.photo_path ? apiUrl(`/api/employees/${n.id}/photo`) : undefined} size={36} color={color} /> : null}
              <div>
                <div className="tree-name">{nameOf(n)} <span className="muted mono">{n.employee_code}</span></div>
                {options.position ? <div className="tree-sub">{n.position_title || 'No position'}</div> : null}
                {options.department ? <div className="tree-sub" style={{ color }}>{n.department_name || 'No department'}</div> : null}
                {options.email ? <div className="tree-sub">{n.email}</div> : null}
                {options.count && people > 0 ? <div className="tree-sub">{people} report{people === 1 ? '' : 's'}</div> : null}
              </div>
            </>
          ) : n.type === 'department' ? (
            <>
              <DeptIcon name={n.name} icon={n.icon} color={n.color} size={32} />
              <div>
                <div className="tree-name">{n.name} {n.code ? <span className="muted mono">{n.code}</span> : null}</div>
                <div className="tree-sub">Head: {deptById.get(n.id)?.head_name || '—'}</div>
                {options.count ? <div className="tree-sub">{people} employee{people === 1 ? '' : 's'} · {n.positions.length} position{n.positions.length === 1 ? '' : 's'}</div> : null}
              </div>
            </>
          ) : (
            <div>
              <div className="tree-name">{n.title} {n.code ? <span className="muted mono">{n.code}</span> : null}</div>
              <div className="tree-sub">Position · L{n.level}</div>
              {options.count ? <div className="tree-sub">{n.employees.length} / {n.headcount} filled</div> : null}
            </div>
          )}
          {kids.length ? (
            <button type="button" className="tree-toggle" draggable={false} aria-label={isCollapsed ? 'Expand' : 'Collapse'} onClick={(e) => { e.stopPropagation(); toggle(k); }} onMouseDown={(e) => e.stopPropagation()}>
              {isCollapsed ? `+${kids.length}` : '−'}
            </button>
          ) : null}
        </div>
        {kids.length && !isCollapsed ? <ul>{kids.map(renderNode)}</ul> : null}
      </li>
    );
  };

  const roots = tree.data?.roots || [];
  const unassigned = tree.data?.unassigned || [];

  return (
    <>
      <PageHeader
        title="Org tree"
        subtitle={isHr ? 'Visualise and customise the organisation. Drag cards to restructure, or click one to edit it.' : 'Who reports to whom, and how departments are organised.'}
        actions={<Button onClick={() => window.print()} data-tour="tree-print" data-testid="tree-print">Print</Button>}
      />

      <Card className="no-print" tour="tree-toolbar">
        <div className="stack">
          <div className="row between">
            <div className="row" data-tour="tree-mode">
              <span className="muted">View</span>
              <Pill active={mode === 'reporting'} onClick={() => { setMode('reporting'); setCollapsed(new Set()); }}>Reporting line</Pill>
              <Pill active={mode === 'department'} onClick={() => { setMode('department'); setCollapsed(new Set()); }}>Departments</Pill>
              <span className="muted" style={{ marginLeft: 8 }}>Layout</span>
              <Pill active={!vertical} onClick={() => setVertical(false)}>Horizontal</Pill>
              <Pill active={vertical} onClick={() => setVertical(true)}>Vertical</Pill>
            </div>
            <div className="row">
              <SearchInput tour="tree-search" value={query} onChange={setQuery} placeholder="Search people, positions, departments…" />
              {search.active ? <span className="muted">{search.matches.size} match{search.matches.size === 1 ? '' : 'es'}</span> : null}
            </div>
          </div>
          <div className="row between" data-tour="tree-options">
            <div className="row">
              <span className="muted">Show</span>
              <Checkbox label="Photo" checked={options.photo} onChange={(e) => setOptions({ ...options, photo: e.target.checked })} />
              <Checkbox label="Position" checked={options.position} onChange={(e) => setOptions({ ...options, position: e.target.checked })} />
              <Checkbox label="Department" checked={options.department} onChange={(e) => setOptions({ ...options, department: e.target.checked })} />
              <Checkbox label="Email" checked={options.email} onChange={(e) => setOptions({ ...options, email: e.target.checked })} />
              <Checkbox label="Headcount" checked={options.count} onChange={(e) => setOptions({ ...options, count: e.target.checked })} />
            </div>
            <div className="row">
              <label className="row" style={{ gap: 6 }}>
                <span className="muted">Zoom</span>
                <input type="range" className="zoom-slider" min={0.3} max={1.6} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" />
                <span className="mono num">{Math.round(zoom * 100)}%</span>
              </label>
              <Button size="sm" onClick={fit}>Fit</Button>
              <Button size="sm" onClick={reset}>Reset</Button>
              <Button size="sm" onClick={() => setCollapsed(new Set())}>Expand all</Button>
              <Button size="sm" onClick={() => setCollapsed(new Set(parentKeys))}>Collapse all</Button>
            </div>
          </div>
          {isHr ? (
            <div className={`drop-hint ${over === 'root' ? 'drop-target' : ''}`} data-tour="tree-dnd" {...(mode === 'reporting' ? dnd('root', 'root') : {})}>
              {drag
                ? mode === 'reporting'
                  ? `Dragging ${drag.label} — drop onto a new manager, or drop here to make them a top-level node (no manager).`
                  : `Dragging ${drag.label} — drop onto a department${drag.type === 'employee' ? ', a position, or the Unassigned bucket' : ''}.`
                : mode === 'reporting'
                  ? 'Tip: drag a person onto another person to change their manager. Click a card to edit it instead.'
                  : 'Tip: drag people, positions or departments onto a department to move them. Click a card to edit it instead.'}
            </div>
          ) : null}
        </div>
      </Card>

      <div className={`orgtree-layout ${mode === 'department' ? 'with-side' : ''}`}>
        <Card padded={false} tour="tree-canvas">
          {tree.loading && !tree.data ? (
            <Spinner />
          ) : tree.error ? (
            <EmptyState title="Could not load the org tree" description={tree.error} />
          ) : roots.length === 0 ? (
            <EmptyState title="Nothing to show yet" description={mode === 'reporting' ? 'Add employees to see the reporting line.' : 'Create departments under Org structure to see them here.'} />
          ) : (
            <div className="tree-viewport" ref={viewportRef}>
              <div className={`tree ${vertical ? 'vertical' : ''} ${isHr ? '' : 'readonly'}`} ref={innerRef} style={{ transform: `scale(${zoom})` }}>
                <ul>{roots.map(renderNode)}</ul>
              </div>
            </div>
          )}
          <div className="tree-footer muted">
            {tree.data ? `${tree.data.total} employee${tree.data.total === 1 ? '' : 's'}` : ''}
            {mode === 'department' && depts.data ? ` · ${depts.data.length} department${depts.data.length === 1 ? '' : 's'}` : ''}
            {collapsed.size ? ` · ${collapsed.size} branch${collapsed.size === 1 ? '' : 'es'} collapsed` : ''}
          </div>
        </Card>

        {mode === 'department' ? (
          <Card title={<>Unassigned <span className="muted">({unassigned.length})</span></>} tour="tree-unassigned">
            <div className={`tree-side ${over === 'unassigned' ? 'drop-target' : ''}`} {...dnd('unassigned', 'unassigned')}>
              {unassigned.length === 0 ? <div className="help">Everyone has a department.{isHr ? ' Drop a person here to remove them from their department.' : ''}</div> : null}
              {unassigned.map((e) => (
                <div
                  key={e.id}
                  className={`tree-node ${drag?.key === keyOf(e) ? 'dragging' : ''}`}
                  draggable={isHr}
                  onDragStart={startDrag(e)}
                  onDragEnd={endDrag}
                  onClick={isHr ? () => setEditNode(e) : undefined}
                  style={{ borderLeftColor: '#94a3b8' }}
                >
                  {options.photo ? <Avatar name={nameOf(e)} src={e.photo_path ? apiUrl(`/api/employees/${e.id}/photo`) : undefined} size={30} /> : null}
                  <div>
                    <div className="tree-name">{nameOf(e)}</div>
                    <div className="tree-sub">{e.position_title || e.employee_code}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      {editNode ? (
        <EditNodeModal
          node={editNode}
          mode={mode}
          departments={depts.data || []}
          positions={positions.data || []}
          employees={directory.data || []}
          onClose={() => setEditNode(null)}
          onSaved={() => { setEditNode(null); tree.reload(); depts.reload(); positions.reload(); }}
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Non-drag fallback: edit where a node sits                           */
/* ------------------------------------------------------------------ */
function EditNodeModal({ node, mode, departments, positions, employees, onClose, onSaved }: { node: AnyNode; mode: Mode; departments: Dept[]; positions: Pos[]; employees: DirEmp[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [managerId, setManagerId] = useState<string>(node.type === 'employee' ? String(node.manager_id ?? '') : '');
  const [deptId, setDeptId] = useState<string>(node.type === 'employee' || node.type === 'position' ? String(node.department_id ?? '') : '');
  const [posId, setPosId] = useState<string>(node.type === 'employee' ? String(node.position_id ?? '') : '');
  const [parentId, setParentId] = useState<string>(node.type === 'department' ? String(node.parent_id ?? '') : '');
  const toNum = (v: string) => (v === '' ? null : Number(v));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (node.type === 'employee') {
        await api.put(`/api/employees/${node.id}`, { manager_id: toNum(managerId), department_id: toNum(deptId), position_id: toNum(posId) });
      } else if (node.type === 'department') {
        await api.post('/api/org/tree/move', { type: 'department', id: node.id, new_parent_id: toNum(parentId) });
      } else {
        await api.post('/api/org/tree/move', { type: 'position', id: node.id, new_parent_id: toNum(deptId) });
      }
      toast.success(`${nameOf(node)} updated`);
      onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const title = node.type === 'employee' ? 'Edit node: employee' : node.type === 'department' ? 'Edit node: department' : 'Edit node: position';
  return (
    <Modal open title={title} onClose={onClose} testId="tree-edit-modal"
      footer={<>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save as any} data-testid="tree-edit-save">Save</Button>
      </>}>
      <form onSubmit={save} className="stack">
        <div className="row between">
          <strong>{nameOf(node)}</strong>
          {node.type === 'employee' ? <Link to={`/employees/${node.id}`} className="btn btn-link btn-sm" onClick={onClose}>Open profile →</Link> : <Link to="/org" className="btn btn-link btn-sm" onClick={onClose}>Open Org structure →</Link>}
        </div>
        {node.type === 'employee' ? (
          <>
            <Field label="Reports to (manager)" hint={mode === 'reporting' ? 'Changes where this person sits in the reporting line.' : undefined}>
              <Select value={managerId} onChange={(e) => setManagerId(e.target.value)} autoFocus={mode === 'reporting'}>
                <option value="">— No manager (top level) —</option>
                {employees.filter((m) => m.id !== node.id).map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.employee_code})</option>)}
              </Select>
            </Field>
            <Field label="Department">
              <Select value={deptId} onChange={(e) => setDeptId(e.target.value)} autoFocus={mode === 'department'}>
                <option value="">— Unassigned —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </Field>
            <Field label="Position">
              <Select value={posId} onChange={(e) => setPosId(e.target.value)}>
                <option value="">— None —</option>
                {positions.map((p) => <option key={p.id} value={p.id}>{p.title}{p.department_name ? ` · ${p.department_name}` : ''}</option>)}
              </Select>
            </Field>
          </>
        ) : node.type === 'department' ? (
          <Field label="Parent department" hint="A department cannot be moved under one of its own sub-departments.">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} autoFocus>
              <option value="">— None (top level) —</option>
              {departments.filter((d) => d.id !== node.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Department">
            <Select value={deptId} onChange={(e) => setDeptId(e.target.value)} autoFocus>
              <option value="">— None —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
