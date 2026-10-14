import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */
type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; message: string }
const ToastCtx = createContext<{ push: (kind: ToastKind, message: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, kind, message }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} data-testid={`toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() {
  const { push } = useContext(ToastCtx);
  return useMemo(
    () => ({
      success: (m: string) => push('success', m),
      error: (m: any) => push('error', typeof m === 'string' ? m : m?.message || 'Something went wrong'),
      info: (m: string) => push('info', m),
    }),
    [push],
  );
}

/* ------------------------------------------------------------------ */
/* Basic controls                                                      */
/* ------------------------------------------------------------------ */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'link'; size?: 'sm' | 'md'; loading?: boolean };
export function Button({ variant = 'secondary', size = 'md', loading, className = '', children, disabled, ...rest }: BtnProps) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, required, children, className = '' }: { label?: string; hint?: string; error?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      {label ? (
        <span className="field-label">
          {label}
          {required ? <span className="req"> *</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = '', ...p }, ref) {
  return <input ref={ref} className={`input ${className}`} {...p} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...p }, ref) {
  return <textarea ref={ref} className={`input textarea ${className}`} {...p} />;
});
export function Select({ className = '', children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input select ${className}`} {...p}>
      {children}
    </select>
  );
}
export function Checkbox({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...p} />
      <span>{label}</span>
    </label>
  );
}
export function Switch({ label, checked, onChange, disabled }: { label?: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`switch ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */
export function PageHeader({ title, subtitle, actions, tour }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; tour?: string }) {
  return (
    <div className="page-header" data-tour={tour}>
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
export function Card({ title, actions, children, className = '', tour, padded = true }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; tour?: string; padded?: boolean }) {
  return (
    <section className={`card ${className}`} data-tour={tour}>
      {title || actions ? (
        <header className="card-header">
          <h2 className="card-title">{title}</h2>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}
export function Stat({ label, value, hint, color, tour, onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; color?: string; tour?: string; onClick?: () => void }) {
  return (
    <div className={`stat ${onClick ? 'clickable' : ''}`} data-tour={tour} onClick={onClick} style={color ? { borderTopColor: color } : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}
export function Badge({ children, color, tone = 'neutral', className = '' }: { children: React.ReactNode; color?: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'; className?: string }) {
  const style = color ? { background: color + '22', color, borderColor: color + '55' } : undefined;
  return (
    <span className={`badge badge-${tone} ${className}`} style={style}>
      {children}
    </span>
  );
}
export const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  active: 'success', approved: 'success', present: 'success', paid: 'success', completed: 'success', available: 'success', published: 'success', valid: 'success', ok: 'success', wfh: 'success', filled: 'success',
  pending: 'warning', probation: 'warning', half_day: 'warning', processed: 'info', warning: 'warning', correction_pending: 'warning', in_progress: 'info', maintenance: 'warning', on_hold: 'warning', pending_review: 'warning', onboarding: 'info', notice: 'warning', draft: 'neutral',
  rejected: 'danger', absent: 'danger', expired: 'danger', critical: 'danger', exited: 'danger', lost: 'danger', cancelled: 'neutral', retired: 'neutral', skipped: 'neutral',
  leave: 'info', holiday: 'info', weekend: 'neutral', assigned: 'info', open: 'info', generated: 'info', upcoming: 'neutral',
};
export function StatusBadge({ status, label }: { status?: string | null; label?: string }) {
  const s = status || '';
  return <Badge tone={STATUS_TONE[s] || 'neutral'}>{label ?? s.replace(/_/g, ' ')}</Badge>;
}
export function Avatar({ name, src, size = 32, color }: { name: string; src?: string | null; size?: number; color?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  if (src && !broken) return <img className="avatar" src={src} alt={name} width={size} height={size} style={{ width: size, height: size }} onError={() => setBroken(true)} />;
  return (
    <span className="avatar avatar-initials" style={{ width: size, height: size, fontSize: size * 0.4, background: color || undefined }} aria-label={name}>
      {initials}
    </span>
  );
}
export function EmptyState({ title, description, action, icon = '◎' }: { title: string; description?: string; action?: React.ReactNode; icon?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>{icon}</div>
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc">{description}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> {label}
    </div>
  );
}
export function Tabs({ tabs, value, onChange, tour }: { tabs: { key: string; label: React.ReactNode; count?: number }[]; value: string; onChange: (k: string) => void; tour?: string }) {
  return (
    <div className="tabs" role="tablist" data-tour={tour}>
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`tab ${value === t.key ? 'active' : ''}`} onClick={() => onChange(t.key)} data-tab={t.key}>
          {t.label}
          {t.count !== undefined ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modal & confirm                                                     */
/* ------------------------------------------------------------------ */
export function Modal({ open, title, onClose, children, footer, wide, testId }: { open: boolean; title: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" data-testid={testId || 'modal'}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
export function useConfirm() {
  const [state, setState] = useState<{ title: string; message?: string; resolve: (v: boolean) => void; danger?: boolean } | null>(null);
  const confirm = useCallback((title: string, message?: string, danger = true) => new Promise<boolean>((resolve) => setState({ title, message, resolve, danger })), []);
  const dialog = state ? (
    <Modal open title={state.title} onClose={() => { state.resolve(false); setState(null); }} testId="confirm-dialog"
      footer={
        <>
          <Button onClick={() => { state.resolve(false); setState(null); }}>Cancel</Button>
          <Button variant={state.danger ? 'danger' : 'primary'} data-testid="confirm-yes" onClick={() => { state.resolve(true); setState(null); }}>Confirm</Button>
        </>
      }>
      <p>{state.message || 'Are you sure?'}</p>
    </Modal>
  ) : null;
  return { confirm, dialog };
}

/* ------------------------------------------------------------------ */
/* Table                                                               */
/* ------------------------------------------------------------------ */
export interface Column<T> { key: string; header: React.ReactNode; render?: (row: T) => React.ReactNode; width?: string; align?: 'left' | 'right' | 'center' }
export function Table<T extends Record<string, any>>({ columns, rows, keyField = 'id', empty = 'Nothing here yet.', onRowClick, tour, dense, loading }: { columns: Column<T>[]; rows: T[]; keyField?: string; empty?: React.ReactNode; onRowClick?: (row: T) => void; tour?: string; dense?: boolean; loading?: boolean }) {
  return (
    <div className="table-wrap" data-tour={tour}>
      <table className={`table ${dense ? 'dense' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length}><Spinner /></td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={columns.length} className="table-empty">{empty}</td></tr>
          ) : (
            rows.map((r, i) => (
              <tr key={r[keyField] ?? i} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align }}>{c.render ? c.render(r) : r[c.key]}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */
/** Fetch helper with loading/error/reload. */
export function useFetch<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ver = useRef(0);
  const reload = useCallback(async () => {
    const v = ++ver.current;
    setLoading(true);
    try {
      const d = await fn();
      if (v === ver.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (v === ver.current) setError(e?.message || 'Failed to load');
    } finally {
      if (v === ver.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload, setData };
}

/** Simple form state. */
export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = (k: keyof T, v: any) => setValues((s) => ({ ...s, [k]: v }));
  const bind = (k: keyof T) => ({ name: String(k), value: (values[k] ?? '') as any, onChange: (e: React.ChangeEvent<any>) => set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value) });
  const reset = (v: T = initial) => setValues(v);
  return { values, set, bind, reset, setValues };
}

export function SearchInput({ value, onChange, placeholder = 'Search…', tour }: { value: string; onChange: (v: string) => void; placeholder?: string; tour?: string }) {
  return <input className="input search" data-tour={tour} type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />;
}

export function ExpiryDot({ state, days }: { state?: string; days?: number | null }) {
  const color = state === 'expired' ? '#dc2626' : state === 'critical' ? '#ea580c' : state === 'warning' ? '#ca8a04' : state === 'ok' ? '#16a34a' : '#9ca3af';
  const text = state === 'expired' ? `Expired ${Math.abs(days ?? 0)}d ago` : state === 'none' || !state ? 'No expiry' : days === 0 ? 'Expires today' : `${days}d left`;
  return (
    <span className={`expiry expiry-${state || 'none'}`} title={text}>
      <span className="dot" style={{ background: color }} /> {text}
    </span>
  );
}

export function Pill({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className={`pill ${active ? 'active' : ''}`} onClick={onClick}>{children}</button>
  );
}
export function KeyValue({ items }: { items: { k: string; v: React.ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((i) => (
        <div key={i.k} className="kv-row">
          <dt>{i.k}</dt>
          <dd>{i.v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
