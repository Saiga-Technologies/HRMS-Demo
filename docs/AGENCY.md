# Agency mode — one HR agency, many client companies

The HRMS now runs as the platform of an HR / payroll agency (demo: **Saiga HR Services**) that
manages client companies in **India, the GCC (UAE, KSA, Qatar) and the US**. Agency staff see every
company they manage in one portfolio and work inside any of them; each client's own HR team, managers
and employees still log in and see only their company.

## Who signs in where

| Login | Lands on | Sees |
|---|---|---|
| Agency staff (`admin@saigahr.example` owner, `am.india@` / `am.gcc@` / `am.us@` account managers, `payroll@`, `recruiter@`) | `/agency` portfolio | Companies they are assigned to (owner/admin: all). Opening a company runs the whole HR app for it under `/c/<slug>/…`, acting as HR. |
| Client HR (`hr@<company>.example`, `payroll@<company>.example`) | `/` of their company | Their company only, plus **Agency services** (payroll calendar, filings, service desk, invoices). Approves the payroll register. |
| Managers / employees (`manager@…`, `employee@…`, `first.last@<company>.example`) | `/` | Unchanged self-service. |

Every demo password is `Password123!`. Sign-in is one page for everyone: agency staff are matched
first, then the **login directory** (agency DB) tells which company an email belongs to. Logins created
with a temporary password (new client HR admins, new employees) must change it on first sign-in.

## Architecture

- **One SQLite database per client company** (`data/companies/<slug>.sqlite`, same schema as before) and
  **one agency database** (`data/agency.sqlite`: companies, agency users and assignments, login
  directory, billing). Data from two clients can never meet in one query.
- **Tenant context** (`server/src/context.ts`, AsyncLocalStorage). The tenancy middleware
  (`server/src/tenancy.ts`) decides the company for each request and runs the rest of it inside that
  context, so `getDb()`, the query helpers and `today()` (company time zone, DST-aware) resolve to the
  company without any route passing it around.
  - Company logins are pinned to their company by the session token (it carries the slug).
  - Agency staff address a company explicitly: `/api/c/<slug>/…`. The browser adds the prefix while it
    is under `/c/<slug>/` (`apiUrl()` in `client/src/lib/api.ts`; the React router runs with that
    basename). Without a company, agency staff can only call `/api/agency/*`.
  - Agency staff act inside a company through a **shadow user** (role HR, never logs in by itself), so
    audit trails and foreign keys keep working; recruiters act as managers.
- The original single-company demo (**Acme**) is the default company: its database path, its logins
  and its URLs are unchanged, so existing installs keep working (an old `data/hrms.sqlite` is moved to
  `data/companies/acme.sqlite` on start).
- Demo companies (`server/src/seed/registry.ts`, generator in `server/src/seed/`) are generated
  deterministically from their slug (identical on every serverless instance) in under 100 ms each.

## Features

### Portfolio (`/agency`)
Health per company (green / amber / red with reasons), payroll countdown and milestone track, filings
due or overdue, open / late service requests, outstanding billing; summary across the portfolio;
"Needs attention" alerts; filters by market, health and account manager; company drawer with details,
account-manager reassignment and status.

### Payroll calendar and countdown notifications
Each company has a pay day (fixed day moved back to the previous working day, or last working day —
weekends and holidays come from **that company's** calendar: KSA/Qatar Fri–Sat, UAE Sat–Sun, some
companies Sunday only). Milestones are derived for every period:

| When (working days before pay day) | Milestone | Owner |
|---|---|---|
| 7 | Payroll inputs received | Client |
| 5 | Attendance cut-off (locks the period) | Agency |
| **3** | **Payroll generation** | Agency |
| 2 | Client approval of the register | Client |
| 0 | Salary payment & payslips | Agency |

Offsets are payroll settings (`input_deadline_days_before`, `attendance_cutoff_days_before`,
`generation_days_before`, `client_approval_days_before`). Status comes from the payroll run and manual
checkpoints. Alerts ("Payroll generation: 3 days to go", overdue in red) appear in the agency bell, the
portfolio, the cross-company calendar (`/agency/calendar`) and the company's Agency services page.

- **Client approval:** in agency-managed companies the client's HR approves the processed register;
  agency staff cannot (they see "Waiting for the client to approve").
- **Period lock:** once attendance is cut off or the run is processed, attendance and leave changes up to
  the cut-off date are refused (record them as next month's adjustment). Live punches are never blocked.

### Statutory compliance calendar
Rules per country generate dated filings per company (`server/src/ops/compliance.ts`): India (PF ECR,
ESI, TDS deposit, professional tax by state, Form 24Q, Form 16, Maharashtra LWF), UAE (WPS/SIF, GPSSA,
Emiratisation), KSA (GOSI, Mudad WPS, Nitaqat/Qiwa review), Qatar (WPS, GRSIA), US (federal deposits,
Form 941, state withholding, SUI wage report, W-2/W-3, Form 940). The agency marks filings as filed
(with the acknowledgement reference) or not applicable; clients see them read-only. Due dates are demo
master data — confirm with the authority before relying on them.

### Service desk
Clients raise requests (onboarding, payroll, exits, letters, compliance…) with priority-based SLAs
(urgent 4 h, high 24 h, normal 48 h, low 96 h; paused while waiting for the client). The agency works
them from one inbox across companies (`/agency/requests`), assigns, replies and resolves.

### Onboarding a client company (`/agency/companies/new`)
Wizard: company → country, region, weekly offs, pay day → client HR admin → billing. Creates the
company database with the country template (settings, salary components incl. statutory ones, leave
types, holidays, document types, journey stages, departments), the client HR admin login (temporary
password shown once), the billing profile and the compliance calendar from the onboarding date.

### Agency team (`/agency/team`)
Roles: owner, admin, account manager, payroll, recruiter; company assignments.

### Billing (`/agency/billing`)
Monthly invoices per company from its billing profile: fee per active employee per month, fee per
payroll run, minimum monthly charge, one-off setup fee. Invoicing entity per market (India GSTIN
Kerala; UAE TRN, which also bills Qatar as a zero-rated export; KSA VAT; US EIN). Amounts are integer
minor units; tax rates are effective-dated master data; GST is CGST+SGST within Kerala and IGST
otherwise. Invoice numbers are consecutive per tax registration per financial year (India 1 Apr–31 Mar)
and assigned only on issue. Payments are idempotent. Clients see their invoices (PDF) under Agency
services → Invoices. KSA invoices would need ZATCA e-invoicing (QR, Arabic) for real use.

## Demo companies

| Market | Company | Weekend | Pay day | This month's payroll |
|---|---|---|---|---|
| India | Nimbus Retail (Mumbai), Tejas Infotech (Kochi), Ganga Pharma (Hyderabad), Acme (Bengaluru, original demo) | Sun / Sat–Sun | last working day, 18th, 25th, 28th | not started / draft / awaiting client approval |
| GCC | Falcon Logistics (Dubai), Najd Construction (Riyadh), Pearl Hospitality (Doha) | Sat–Sun / Fri–Sat / Fri–Sat | 25th, 27th, 18th | not started / approved / awaiting approval |
| US | Redwood Health (CA), Hudson Analytics (NY), Lone Star Energy (TX) | Sat–Sun / Sat–Sun / Sun | last working day, 20th, 25th | not started / draft / approved |

Each has 54–72 employees with market-appropriate names, IDs, bank details, salary structures and
statutory deductions, leave types, holidays (lunar dates marked "expected"), 60 days of attendance,
three paid payroll months, documents (GCC visas / Iqamas expiring), vacancies and candidates.

## Limits of the demo

- Vercel storage is per instance and temporary: every instance seeds the same data, but changes made on
  one instance are not seen by another and are lost on a cold start. A real agency needs persistent
  storage (a VPS disk, or hosted SQLite/Postgres).
- Uploaded files share one folder (random names; access always goes through the owning company's
  records).
- No e-mail sending: notifications are in-app (bell, portfolio, calendar, badges).
- Payroll is monthly for every market (US bi-weekly / semi-monthly runs are not modelled); statutory
  maths is simplified (see the generator notes in `server/src/seed/countries.ts`).
