# Architecture

## Overview

```
browser ──HTTP──▶ Express (server/src/app.ts) ──▶ SQLite (node:sqlite, WAL)
   ▲                 │  /api/*  JSON routes (server/src/routes/*.ts)
   │                 │  static  client/dist (production)
   └── React SPA ────┘
```

* One process. In development Vite serves the SPA on :5173 and proxies `/api` to :4000.
* Every table is created with `IF NOT EXISTS` from `server/src/schema.ts` on boot; `seed.ts` fills an
  empty database with a realistic demo company (13 employees, departments, positions, documents,
  payroll, attendance, leave, assets, journeys).

## Data model (main tables)

| Area | Tables |
| --- | --- |
| Identity | `users` (email, scrypt hash, role hr/manager/employee, employee_id), `sessions`, `audit_log` |
| Organisation | `departments` (parent_id, head, colour), `positions` (department, reports_to, level, headcount), `job_descriptions` (JSON lists, version), `vacancies` |
| People | `employees` (profile, job, bank/statutory, `custom_fields` JSON), `custom_field_defs`, `work_locations`, `shifts` |
| Documents | `document_types` (allowed_formats JSON, requires_expiry, warning/critical days, required_for_all, max size), `documents` (stored file, format, expiry) |
| Payroll | `salary_components`, `salary_structures` (basic + overrides JSON, effective_from), `payroll_adjustments`, `payroll_runs` (period, status), `payslips` (earnings/deductions JSON) |
| Attendance | `attendance_records` (punch in/out with lat/lng, geofence result, work/break/overtime/late minutes), `attendance_breaks`, `attendance_corrections`, `holidays` |
| Leave | `leave_types`, `leave_balances` (per employee/type/year), `leave_requests` (status incl. correction_pending + `correction` JSON), `leave_history` |
| Assets | `assets`, `asset_assignments` |
| Journey | `journey_stage_templates`, `journey_stages` (per employee copy, status, checklist JSON) |
| Dashboard | `dashboard_cards` (per user, unlimited) |
| Settings | `settings` (JSON blobs: company, documents, payroll, attendance, leave, lists) |

## Key business rules

* **Document formats:** HR configures the global default (`settings.documents.allowed_formats`) and a
  per-type subset. Uploads are checked by extension, MIME type **and** magic bytes, then by size.
  Expiry state: `expired` (<0 days), `critical` (≤ type critical days), `warning` (≤ type warning days),
  else `ok`; `none` when the type has no expiry. Colours: red / orange / yellow / green / grey.
* **Geofencing:** `work_locations` carry lat/lng/radius. A punch is accepted when the Haversine distance
  to the nearest active location is within its radius, unless `attendance.allow_remote_punch` is on.
  The record stores the coordinates, nearest location, distance and in/out-of-fence flags.
* **Breaks:** one open break at a time; total break minutes vs `attendance.max_break_minutes`; work
  minutes = punch span − breaks; overtime beyond `overtime_after_minutes`; late vs shift start + grace.
* **Corrections:** HR edits records directly (`source = manual`); employees file correction requests that a
  manager (for their reports) or HR approves, which writes the record with `source = correction`.
* **Leave:** days exclude weekly offs and holidays (unless sandwich rule); balance = allocated + carried +
  adjusted − used; pending requests are reserved; approved leave deducts; cancellation restores; edits to
  approved leave create a `correction_pending` request that must be re-approved.
* **Payroll:** per month: working days (calendar or working-day mode), loss-of-pay = unpaid leave +
  absences (only when attendance was tracked that month) + half days; components prorated by paid days;
  PF on capped basic, ESI under the wage ceiling, professional tax above threshold, TDS from annualised
  taxable earnings minus standard deduction through slabs. Runs lock payslips once approved.
* **Journey:** templates are copied into each new employee's `journey_stages`; HR can re-apply templates,
  add custom stages, reorder, and track status per stage.

## Security

* Passwords: scrypt with per-user salt; login rate limiting (10 attempts / 15 min per IP+email).
* Sessions: random 256-bit tokens in an `HttpOnly; SameSite=Lax` cookie (12 h), also accepted as a
  Bearer token for API clients/tests. Cross-site state-changing requests are rejected via
  `Sec-Fetch-Site`.
* RBAC: `requireHr`, `requireRole('manager')`, `canAccessEmployee` (self, direct reports, HR) and
  `visibleEmployeeIds` scope every list. Sensitive fields (bank, tax ids) are stripped for non-HR
  viewers of other people's records.
* Uploads: stored outside the web root with random names, served through authenticated endpoints only.
* SQL: parameterised statements everywhere; JSON columns validated before storage.
* Headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
* Audit log of every mutation by user/action/entity.

## Extending

* New module: add a table to `schema.ts`, a router in `server/src/routes`, mount it in `app.ts`, a page in
  `client/src/pages`, a route in `App.tsx`, a nav item in `components/Layout.tsx`, and a `usePageTour`.
* Multi-tenant SaaS: run one instance (data dir) per customer, or add a `tenant_id` column to every
  table and scope queries by the session's tenant.
