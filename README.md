# HRMS Demo

A complete, sellable **Human Resource Management System** web application that an HR team can
run for their own organisation. One Node.js process serves both the API and the web app; data lives
in an embedded SQLite database, so a customer can run it with a single command.

| Module | What it does |
| --- | --- |
| **Staff & profiles** | Add employees with personal, job, bank and statutory details, photo, emergency contact. HR defines **custom fields** (text, number, date, dropdown, yes/no, long text) that appear on the form automatically. Role-based visibility of sensitive fields. |
| **Org structure & tree** | Departments (nested), positions (with reporting line, level, headcount) and a **customisable org tree**: reporting-line or department view, horizontal/vertical, drag-and-drop re-parenting, display options, zoom, search. |
| **Job description management** | Versioned JDs with responsibilities, requirements, skills, experience and salary ranges; draft → published → archived; duplicate; vacancies linked to positions and JDs. |
| **Document management** | Per-employee documents. HR decides the **accepted upload formats per document type (PDF / JPG / PNG)**, size limit and expiry rules. Files are validated by extension, MIME type and magic bytes. **Colour-coded expiry indication** (green ok, yellow warning, orange critical, red expired) everywhere a document is listed, plus a compliance matrix of required documents. |
| **Payroll** | Salary components (fixed / % of basic / % of gross, earnings and deductions), per-employee salary structures with history and live preview, adjustments (bonus, overtime, reimbursement, advance, loan recovery, arrears, deductions), statutory deductions (PF, ESI, professional tax, slab-based TDS), loss-of-pay from attendance and unpaid leave, monthly pay runs (draft → processed → approved → paid), editable payslips, printable payslip, payroll settings. |
| **Attendance** | **Punch in/out with geolocation and geofencing** against HR-defined work locations (radius in metres), **timed breaks** (break/lunch/personal) with a configurable daily limit, shifts, late marks, overtime, daily roster, monthly summary, HR manual time correction, employee **correction requests** with manager/HR approval, holidays, attendance settings (require geofence, allow remote punch, weekly offs…). |
| **Leave** | Customisable leave types (quota, paid/unpaid, carry-forward, notice days, half-days, colour), balances, apply, approve/reject by manager or HR, cancel, **corrections** (edit a pending request; edits to approved leave go through re-approval), HR adjustments, team calendar, full history per request. |
| **Assets** | Asset register (tag, category, serial, model, vendor, cost, warranty with expiry colouring, specs), assign to / return from employees with condition tracking and full assignment history. |
| **Employee journey** | A **customisable 10–15 step journey** from vacancy to current role (default 14 stages: Vacancy raised → Requisition approval → Budget & accounting → JD → Publishing → Sourcing & screening → Interviews → Offer → Document collection → Background verification → Onboarding → Probation → Confirmation → Current role). Stage templates can be added, renamed, re-ordered, coloured; each employee's timeline can be started/completed/skipped, annotated, extended with custom stages and checklists. |
| **Dashboard** | Personal dashboard with **no cap on the number of cards**: stat, list, quick-link and note cards from a role-aware catalog; drag to reorder; resize; reset. |
| **Tour this page** | Every page has a **"Tour this page"** button that runs a guided walkthrough of what is on screen (driver.js), plus an optional auto-start on first visit. |
| **Settings** | Company profile & branding (name, logo initial, brand colour), document rules, custom fields, users & roles (HR / Manager / Employee), configurable lists, audit log. |

## Quick start

```bash
npm install
npm run dev          # API on :4000, web app on :5173 (proxied)
```

Or build and run as one process:

```bash
npm run build
npm run start:prod   # http://localhost:4000 (compiled server + static client)
```

The database is created and **seeded with demo data** on first start (`server/data/hrms.sqlite`).
Delete that file to start over.

Demo logins (password `Password123!`):

| Role | Email |
| --- | --- |
| HR admin | `hr@acme.example` |
| Manager | `manager@acme.example` |
| Employee | `employee@acme.example` |

## Tests

```bash
npm test             # API/integration tests (vitest + supertest, fresh SQLite per file)
npm run build        # typecheck + production bundle
npm run test:e2e     # Playwright end-to-end tests against the built app (fresh seeded DB)
npm run test:all     # everything
```

Playwright needs a Chromium; run `npx playwright install chromium` once if it is not already
available on the machine.

## Deploy to Vercel

The repository is pre-configured for Vercel (`vercel.json` + `api/index.mjs`): the React app is served
as static files and the whole Express API runs as one serverless function.

1. In the Vercel dashboard choose **Add New → Project → Import** and pick the `HRMS-Demo` GitHub
   repository (install the Vercel GitHub app on the account/org if it asks).
2. **Root Directory must stay empty** (the repository root), otherwise `vercel.json` and the
   `api/` function are not picked up and the build fails with "No Output Directory named dist".
   If the import wizard suggested `client` as the root, clear it (Project → Settings → General →
   Root Directory). Framework preset **Other**; `vercel.json` already sets the build command
   (`npm run build`), output directory (`client/dist`) and install command. Node.js **22.x**.
3. Click **Deploy**. Every push to `main` redeploys automatically; pull requests get preview URLs.

No environment variables are required for the demo. Optional ones: `HRMS_TZ_OFFSET_MINUTES`
(default 330) and, if the runtime is older than Node 22.13, `NODE_OPTIONS=--experimental-sqlite`.

**Demo-mode storage caveat.** Vercel functions have no persistent disk, so on Vercel the SQLite
database and uploaded files live in `/tmp`. They survive while an instance is warm and are
**re-seeded with the demo data on every cold start** — ideal for demos and sales walkthroughs, not
for customer data. For a persistent deployment either run `npm run build && npm run start:prod`
on any host with a disk (Railway, Render, Fly.io, a VM, Docker), or swap the storage layer to a
hosted database (Turso/libSQL or Postgres) and object storage (Vercel Blob / S3) — the data access
is isolated in `server/src/db.ts` and the upload paths in `server/src/routes/documents.ts` and
`employees.ts`.

## Tech stack

- **Server:** Node.js 22+, Express 5, SQLite via the built-in `node:sqlite` (no native build step), multer
  for uploads, scrypt password hashing, cookie sessions, role-based access control, audit log.
- **Client:** Vite, React 19, TypeScript, react-router 7, driver.js for page tours. No UI framework —
  a small hand-written component kit (`client/src/components/ui.tsx`) and stylesheet.
- **Tests:** vitest + supertest (API), Playwright (E2E).

## Project layout

```
server/      Express API, schema, seed, tests
client/      React app
e2e/         Playwright configuration and specs
docs/        Architecture and client conventions
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data model, security notes and how the
modules fit together, and [docs/CLIENT_CONVENTIONS.md](docs/CLIENT_CONVENTIONS.md) before adding pages.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `HRMS_DATA_DIR` | `server/data` | Where the SQLite file and uploads live |
| `HRMS_DB_FILE` | `<data dir>/hrms.sqlite` | Database file |
| `HRMS_TZ_OFFSET_MINUTES` | `330` | Local offset used to compare punches with shift start times |

Deploy behind HTTPS (the session cookie is marked `Secure` when the request is secure).
