# Phase 2 — what changed and why

Feedback-driven second release. Everything below is in the product; this file is the map.

## Look & feel
- **Icon rail sidebar**: 68 px rail of crisp SVG icons (no emoji) that expands on hover; pin it open
  with the pin control at the bottom; on phones it slides in with an overlay. Unread-style red
  badges on Attendance, Leave, Documents, Payroll, Recruitment and Journey show how many items
  need you (`GET /api/notifications/counts`, polled every 30 s).
- **Light and dark themes**: toggle in the top bar (remembered per browser); HR sets the default
  theme, brand colour and accent colour under Settings → Company. Every component uses CSS
  variables (`client/src/styles.css`), so a customer palette is a settings change, not code.
- **Doodle texture** on the page background (inline SVG pattern, theme-aware).
- **Styled file pickers** (`FileInput`): drag-and-drop zone, "Choose file" button, selected-file chip.
- **Detail pages** use a responsive card grid (`detail-grid`) instead of one long column.
- **Tab badges**: red counters on tabs with pending work (approvals, appeals, new candidates…).

## Workflow
- **Reporting-manager hierarchy** (`server/src/approvers.ts`): every request (leave, attendance
  appeals, comp-off) is routed to the employee's reporting manager; anyone above in the chain can
  escalate-approve; HR can always act. Rows show "Pending with <name>" and, once decided, who
  approved and when.
- **Attendance appeals with a deadline**: missed punch in / out / both / status appeals must be
  raised within `appeal_deadline_days` (default 3). Attendance records can only be changed through
  an approved appeal (`edit_only_via_appeal`), and each corrected record carries an audit trail
  (previous values, who raised it, who approved it, timestamps).
- **Attendance reports** with filters (date range, departments, employees, status, late only,
  late more than N minutes, work less/more than N hours, break more than, outside geofence,
  corrected only, include absent, group by, column picker) exported as **CSV** or a formatted
  **PDF**; per-employee attendance record export; late-comers preset.
- **Comp Off** replaces Earned Leave. Extra working days (weekly offs, holidays, optional extra
  hours) are **auto-detected** from attendance; the employee confirms, the reporting manager
  approves, and the credit lands in the Comp Off balance with an expiry. Criteria live under
  Leave → Settings.
- **Travel tracking**: start a trip with a destination, the browser samples GPS, stop to record
  distance (Haversine over the sampled path) and duration; personal and team summaries.
- **Payslip applications**: employees request a payslip for a period; HR fulfils or rejects.
- **Recruitment**: CV pool (PDF / DOCX / TXT upload with text extraction), automatic parsing
  (contact, experience, education, skills), ATS-style scoring against the vacancy's job description
  with an explainable breakdown, Kanban pipeline, interview notes, and **Hire → creates the
  employee**, pre-completes the journey stages up to Offer, links the vacancy, and copies the CV
  into the employee's documents. Add employee can also start from a candidate.
- **User IDs**: employee codes are always auto-generated; logins are created by default with a
  generated temporary password shown once.

## Dashboard
Graphical, clickable cards (attendance trend, today's attendance, headcount by department, leave
utilisation, document compliance, recruitment funnel, payroll cost trend, late comers, work-hours
distribution, time to hire, journey progress, asset utilisation, diversity, tenure, approvals queue,
my week…). Still no cap on the number of cards; drag to reorder; resize; per-role defaults.
