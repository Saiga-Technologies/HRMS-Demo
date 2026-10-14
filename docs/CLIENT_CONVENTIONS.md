# Client conventions (read before adding a page)

Stack: Vite + React 19 + TypeScript + react-router 7. No UI framework; everything comes from
`client/src/components/ui.tsx` and `client/src/styles.css`. Session is a cookie; call the API with
`api.get/post/put/delete/upload` from `client/src/lib/api.ts` (throws `ApiError` with a readable
`.message`; pass errors straight to `toast.error(err)`).

## Page skeleton

```tsx
import { usePageTour } from '../lib/tour';
import { PageHeader, Card, Table, Button, useFetch, useToast, Tabs } from '../components/ui';

export default function MyPage() {
  usePageTour('My page', [
    { element: '[data-tour="my-list"]', title: 'Title', description: 'What this area does.' },
  ]);
  const toast = useToast();
  const list = useFetch<Row[]>(() => api.get('/api/...'), []);
  return (
    <>
      <PageHeader title="My page" subtitle="..." actions={<Button variant="primary">+ Add</Button>} />
      <Card padded={false} tour="my-list"><Table rows={list.data || []} columns={[...]} loading={list.loading} /></Card>
    </>
  );
}
```

Rules
- Every page MUST call `usePageTour(name, steps)` with 3–8 steps. Steps point at `data-tour="..."`
  attributes you add to the page (`PageHeader`, `Card`, `Table`, `Tabs`, `Stat` accept a `tour` prop,
  or put `data-tour` on any element). Missing elements are skipped, so it is fine to tour tabs that
  are not currently visible — but prefer steps that exist on first render.
- Sub-sections of a module live in one page file using `Tabs` (e.g. `Payroll.tsx` has tabs
  Overview / Runs / Components / Adjustments / Settings). Routes are `module/*`, so you may also
  read `useParams`/`useSearchParams` for deep links (e.g. `/payroll?tab=runs`).
- Role gating in the UI: `const { isHr, isManager, user } = useAuth();` Hide HR-only actions
  (`isHr`), show approval tools for `isManager`. Employees see only their own data (the API already
  filters).
- Use `useForm` for simple forms, `Modal` for create/edit dialogs, `useConfirm` before deletes,
  `toast.success/error` after every mutation, then `reload()` the list.
- Formatting helpers in `client/src/lib/format.ts`: `fmtDate`, `fmtDateTime`, `fmtTime`,
  `fmtMoney(n, currency)`, `fmtMinutes`, `fullName`, `label(status)`, `todayIso`, `monthIso`,
  `localToIso`/`isoToLocal` for `datetime-local` inputs.
- Status chips: `<StatusBadge status={row.status} />`. Expiry colouring: `<ExpiryDot state={d.expiry_state} days={d.days_to_expiry} />`
  and add class `row-${d.expiry_state}` to table rows when listing documents.
- Add `data-testid` to primary buttons/inputs that an end-to-end test would need (e.g.
  `data-testid="employee-add"`, `data-testid="leave-apply"`).
- Keep each page self-contained; shared helpers go in `components/ui.tsx` only if generic.
- Do not add dependencies.

## API shape cheat-sheet
See `server/src/routes/*.ts` — each router is small and readable. All list endpoints return either an
array or `{ items, total }` (employees, documents, assets, attendance records). All mutations return
the updated row. Errors are `{ error: string }`.

## Phase 2 additions (read these too)

- **Icons:** `import { Icon } from '../components/Icons'` → `<Icon name="clock" size={16} />`. No emoji in UI. Names: dashboard, users, user, userPlus, sitemap, tree, briefcase, compass, folder, clock, leaf, banknote, laptop, settings, route, sun, moon, menu, pin, chevronLeft/Right/Down, upload, download, search, bell, logout, lock, sparkles, check, x, plus, file, filter, print, mapPin, calendar, trendingUp, alert, info, edit, trash, eye, star, play, stop, award, grid.
- **Theme:** everything must use CSS variables (`var(--surface)`, `--surface-2`, `--surface-3`, `--border`, `--text`, `--text-2`, `--muted`, `--brand`, `--accent`, `--success/--warning/--danger/--info` and the `*-bg/-ink/-border` variants). Never hard-code `#fff`, `#0f172a` etc. — both light and dark themes must look right (`[data-theme="dark"]`). Test with the moon/sun toggle in the top bar.
- **File pickers:** `<FileInput accept=".pdf,.docx" file={file} onChange={(files) => setFile(files[0] || null)} hint="Accepted: PDF, DOCX" testId="cv-file" />` from `components/ui.tsx`. Never a bare `<input type="file">`.
- **Tabs with pending counters:** `tabs={[{ key: 'approvals', label: 'Approvals', badge: counts.leave_approvals, icon: 'check' }]}`. `badge` is the red unread-style counter; `count` is a neutral total.
- **Counts:** `const { counts, refreshCounts } = useCounts()` from `lib/notifications.tsx` (keys from `server/src/routes/notifications.ts`). Call `refreshCounts()` after any mutation that changes a queue (approve, apply, upload…).
- **Charts:** `components/charts.tsx` exports `BarChart`, `DonutChart`, `LineChart`, `Sparkline`, `Gauge`, `Heatmap`; all accept `onSelect` for click-through. Use `CHART_COLORS`.
- **Stat cards:** `<Stat label value icon="users" color="#..." onClick={...} />`.
- **Downloads:** `downloadUrl('/api/reports/attendance.csv?...', 'attendance.csv')` from `components/ui.tsx` (fetches with the session cookie, triggers a save).
- **Approvals:** every approval goes through the reporting-manager hierarchy. Server helper `server/src/approvers.ts` (`approverChain`, `defaultApprover`, `canApproveFor`, `approvableEmployeeIds`). Requests store `approver_employee_id`; show "Pending with <name>" (`approver_name`) on request rows using the `.pending-with` class, and the reviewer + timestamp (`reviewer_name`, `reviewed_at`) once decided using `.audit-trail`.
- **Layout:** `detail-grid` + `Card` for detail pages instead of one long column; `section-title` for small headings; keep key/value rows (`KeyValue`) to ~6 items per card.
