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
