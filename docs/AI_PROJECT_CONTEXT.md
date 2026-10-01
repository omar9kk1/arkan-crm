# AI Project Context — Arkan Real Estate CRM

Read this file first when joining the project. It describes the current implementation and the intended architecture; planned services are not evidence of working business APIs. Last reviewed: 2026-10-01.

## 1. Project Overview

**Arkan Real Estate CRM** is an Arabic RTL CRM for real estate company operations, supporting manager and employee accounts.

Current stage: a frontend UI prototype inside a real application, with an authentication/backend foundation. Most business pages still use mock data until their APIs are implemented. A working form, parser, dashboard, or success toast does not imply a database write.

## 2. Final Technology Stack

| Layer | Technology and status |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript |
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL; local Compose uses PostgreSQL 16 |
| ORM | Prisma 6.19 |
| Background jobs | Redis + BullMQ; foundation, not proof that every workflow has a real job |
| File storage | S3-compatible storage planned for later |
| Authentication | JWT access tokens + refresh tokens |
| Deployment | Docker / Docker Compose; current root Compose starts PostgreSQL and Redis only |
| Workspace | npm workspaces; Node.js >= 22 |

## 3. Architecture Rules

- Frontend and backend remain separate applications.
- The backend owns permanent business logic, validation, authorization, and persistence.
- Frontend features should call API clients. Temporary mock business rules must remain isolated and replaceable rather than becoming permanent frontend logic.
- The Prisma schema is the database source of truth. Do not change the database, schema, or migrations unless explicitly requested.
- Do not modify authentication or security unless explicitly requested.
- Use small, reusable components and feature modules.
- Do not convert the old prototype HTML into one giant React component.
- Existing module folders or schema models do not prove that their endpoints are implemented or connected to the UI.

## 4. Current Project Structure

| Path | Purpose |
| --- | --- |
| `apps/frontend` | Next.js application: `app` routes, `features` for domain UI, shared `components`, `lib` helpers, styles and public assets |
| `apps/backend` | NestJS application: domain modules under `src`, authentication, infrastructure, Prisma schema/migrations/seed, backend tests |
| `packages/shared` | Shared TypeScript contracts and DTOs used across applications |
| `docs` | Architecture decisions, scope, development guidance, and implementation notes |
| `docker-compose.yml` | Local PostgreSQL and Redis services with persistent Docker volumes |

Useful related documents: `01_STACK_DECISION.md`, `03_PROJECT_STRUCTURE.md`, `04_CLEAN_CODE_RULES.md`, `NFC_ATTENDANCE_PLAN.md`, and `refresh-drafts.md` in this directory. Consult only the documents relevant to the current task.

## 5. Authentication

Login is implemented through the real backend API. Roles are `MANAGER` and `EMPLOYEE`. Refresh tokens and protected manager/employee routes exist. The auth controller provides login, refresh, logout, and current-user operations.

Local demo seed accounts:

| Role | Email | Demo password |
| --- | --- | --- |
| Manager | `manager@arkan.test` | `ChangeMe123!` |
| Employee | `employee@arkan.test` | `ChangeMe123!` |

These are development seed credentials, not production secrets. The seed must be run against the intended local database; it is disabled in production and does not reset an existing user's password. A mock employee created in the UI is not automatically a real login account.

## 6. Manager Routes

| Route | Page |
| --- | --- |
| `/manager` | Dashboard / الرئيسية |
| `/manager/properties` | Properties / العقارات |
| `/manager/deals` | Deals / الصفقات |
| `/manager/clients` | Clients and owners / العملاء |
| `/manager/employees` | Employees / الموظفون |
| `/manager/finance` | Finance / المالية |
| `/manager/attendance` | Attendance / الحضور والانصراف |
| `/manager/notifications` | Notifications / الإشعارات |
| `/manager/settings` | Settings / الإعدادات |
| `/manager/reports` | Reports / التقارير |
| `/manager/marketing` | Marketing / التسويق |

## 7. Employee Routes

| Route | Page |
| --- | --- |
| `/employee` | Dashboard / الرئيسية |
| `/employee/clients` | Clients and requests / العملاء والطلبات |
| `/employee/properties` | Properties / العقارات |
| `/employee/followups` | Follow-ups / المتابعات |
| `/employee/notifications` | Notifications / الإشعارات |
| `/employee/attendance` | Attendance / الحضور والانصراف |
| `/employee/attendance/nfc` | Mock NFC attendance result |

## 8. UI Design Rules

- Arabic RTL first, including forms, navigation, and content alignment.
- Main font: IBM Plex Sans Arabic, with Tahoma/Arial fallbacks.
- Preserve the glassmorphism style, soft beige/gold palette, and soft architectural background.
- Use white transparent buttons, soft borders and shadows; no dark buttons unless explicitly requested.
- Preserve smooth, thin scrollbars and responsive mobile bottom navigation.
- Forms, modals, and drawers must match the prototype style and remain usable on narrow screens without horizontal overflow.
- Mobile form controls must use a font size of at least 16px to avoid iOS focus zoom.
- Reuse existing controls and layouts. A behavior task is not permission to redesign the form or navigation.

## 9. Important Form Rules

### Add Client / Request

The form uses a Smart Paste mock flow with new or existing clients. A client can be a buyer, renter, property exchanger, or have multiple selected request types. Interest may be a linked existing property only, a new request only, or both.

The current flow is client details, request types, message analysis with editable fields, then review/save. Clicking analysis reveals the fields within the analysis stage and scrolls to them; there is no separate required data-review stage. Desired budgets use from/to values. Floor details use named floors with free-text contents rather than one rooms/floor count field.

### Add Property

The form uses an owner/property Smart Paste mock flow: new or existing owner, offer types, message analysis with editable fields, then review/send. Offers can be sale, rent, exchange, or multiple selected types. Exchange distinguishes the owner's current property from the desired property.

Smart parsing is currently local frontend mock logic only. It extracts limited keywords and numbers, leaves missing values for manual completion, and requires user review. Do not call a real AI API. A backend Smart Paste Parser Service is planned for later.

Kuwait district/governorate data lives in `apps/frontend/lib/kuwait-districts.json`, with helpers in `area-governorate.ts`. District selection determines the governorate and available blocks. Block choices are derived as 1..N from the supplied Excel counts, not a separately verified list of block identifiers.

### Background form recovery

Important forms autosave temporary input in browser storage with a debounce. Recovery should restore the open form, current step, and input after refresh without visible draft-management buttons. Never save passwords, tokens, or credentials as form drafts. Successful final mock submission clears the associated temporary draft.

Explicit close behavior is not identical to refresh: the Add Property modal's X clears its draft, as requested. Do not assume every modal has that exception; preserve the current per-form behavior unless asked to change it. Browser storage is not a database backup or cross-device synchronization.

## 10. Attendance / NFC

NFC attendance is currently frontend mock behavior. Example employee route:

`/employee/attendance/nfc?tag=EMP-EMPLOYEE-001`

Records are stored in localStorage under `arkan:mock-attendance-records`. The first scan checks in, the next scan checks out, and subsequent scans report the completed day. Refreshing the same result entry must not immediately check out. Records use the device clock and are shared only within the same browser profile and origin.

Future implementation: `POST /attendance/nfc-scan`. The backend must validate `tagId` against the current verified JWT user, enforce atomic attendance transitions and duplicate protection, and provide server-side audit records. That endpoint is planned, not currently provided by this mock flow. Browser storage and mock identity metadata are not an authorization boundary.

See [NFC_ATTENDANCE_PLAN.md](NFC_ATTENDANCE_PLAN.md) for current limitations, tests, and the future integration plan.

## 11. Data Status

- **Real:** backend authentication/API, JWT and refresh-token foundation, Prisma/PostgreSQL infrastructure.
- **Mostly mock:** business lists, dashboards, forms, Smart Paste parsing, and business actions. Some state exists only in memory; some persists locally in browser storage.
- **Local infrastructure:** PostgreSQL and Redis are configured to run with Docker Compose. This document does not assert that they are currently running.
- **Business API work remains:** properties, clients, owners, follow-ups, deals, commissions, finance, attendance, and notifications. Inspect the relevant module before implementing a specific endpoint; scaffolding is not a finished integration.
- S3-compatible uploads and production parsing are future work. Do not silently replace mocks with real network calls.

## 12. Development Rules for AI Assistants

1. Read this file first. Conserve credits/tokens and inspect only files relevant to the task.
2. Do not scan large prototype HTML files unless the UI task requires them.
3. Do not modify unrelated files. Before changing many files, provide a short plan.
4. Do not add pages, buttons, or flows without user approval; an explicit request for them is approval for that scope.
5. UI polish only means frontend components/styles only. Backend, API, database, and auth/security changes require explicit instruction.
6. Keep mock behavior clearly separated from real API behavior.
7. Never commit `.env` files, credentials, or secrets, even to a private repository.
8. Do not redesign forms during behavior-only tasks.
9. Run checks appropriate to the change, report what was actually checked, and distinguish untested browser behavior from verified logic.
10. After big UI changes, update `docs/CURRENT_PROJECT_STATE.md` if requested. It is not present at the time of this review; do not assume it exists.
11. Follow the user's current instructions and scope. Do not make a commit or push unless requested.

## 13. Environment / Secrets

Required local files:

- `apps/backend/.env`: database connection, Redis settings, JWT secrets, and backend configuration.
- `apps/frontend/.env.local`: frontend configuration such as the public API base URL.

Use the checked-in `.env.example` / `.env.local.example` templates to create local files. Never commit actual environment files or expose their contents in logs or documentation. Public frontend variables must never contain secrets.

A new development machine needs its own environment configuration and local services. GitHub stores committed source, not local database contents, browser mock data, ignored files, or environment secrets.

## 14. Common Local Commands

Run from the repository root in Windows PowerShell. Install Node.js >= 22 and dependencies (`npm.cmd install`), create the local environment files from examples, and have Docker available before initial setup.

```powershell
# Start local data services.
docker compose up -d postgres redis

# Generate the Prisma client, apply existing migrations, and seed local demo users.
npm.cmd run db:generate -w @arkan/backend
npm.cmd run db:deploy -w @arkan/backend
npm.cmd run db:seed -w @arkan/backend
```

Choose one development startup mode; do not start the backend twice:

```powershell
# Backend only.
npm.cmd run dev:backend

# Alternatively, start both backend and frontend.
npm.cmd run dev
```

Login URL: `http://localhost:3000/login`.

These are reference commands, not instructions to run migrations or seeds during an unrelated UI/documentation task.

## 15. Git Workflow

- Keep `main` stable and use feature branches for changes, with the `codex/` prefix unless the user specifies another name.
- Make small, focused commits when requested. Inspect the diff and staged files first.
- Never push secrets or ignored environment files. Private repository visibility does not make secrets appropriate to commit.
- Push only when the user asks; local changes are not backed up to GitHub until pushed.
- Source backup is separate from database backups and browser-stored mock data.
