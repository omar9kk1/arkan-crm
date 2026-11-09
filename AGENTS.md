# ARKAN CRM — Agent Guide

Arabic RTL real-estate CRM. Keep changes focused; this file is the fast path, not a full architecture document.

## Stack and ports

- Frontend: Next.js 16 App Router, React 19, TypeScript — `apps/frontend` — **http://localhost:3001**
- Backend: NestJS 11, Prisma/PostgreSQL, Redis/BullMQ — `apps/backend` — **http://localhost:4001**
- Shared API contracts: `packages/shared` (build before using in apps)
- Local development DB: `arkan_crm`
- Isolated test DB: `arkan_crm_api_test` only
- Reports: `docs/reports/`
- Backend process manager: `scripts/backend-dev.ps1` (`.dev/logs/backend.log`)

Read `apps/frontend/AGENTS.md` before frontend work: this Next.js version differs from older training data.

## Commands

Run from the repo root unless noted.

| Goal | Command |
|---|---|
| Both apps | `npm run dev` |
| Backend only | `npm run backend:start` |
| Backend status/logs/stop/restart | `npm run backend:status` / `backend:logs` / `backend:stop` / `backend:restart` |
| Typecheck + lint | `npm run check` |
| Typecheck only | `npm run typecheck` |
| Lint only | `npm run lint` |
| Full build (shared → backend → frontend) | `npm run build` |
| Full backend tests | `npm test` |
| Focused auth tests | `npm run test:auth` |
| Focused CSP tests | `npm run test:csp` |
| One/few specs | `npm run test -w @arkan/backend -- path/to.spec.ts another.spec.ts` |
| One frontend workspace | `npm run typecheck -w @arkan/frontend` / `npm run build -w @arkan/frontend` |
| CSP manifest verify (after production build) | `npm run csp:verify -w @arkan/frontend` |
| Enforced CSP preview (local, dev frontend stopped) | `npm run csp:preview -w @arkan/frontend` |

Tests that touch the database require `TEST_DATABASE_URL` pointed at `arkan_crm_api_test`. Set it in the shell; never point tests at `arkan_crm` and never print secrets.

The frontend `build` runs `next build` **and** the CSP hash postbuild step; use the workspace/root build, not raw `next build`, when validating production.

## Workflow tiers

**Small (copy, styling, one component, one endpoint):**
1. Read the relevant feature/API and the closest existing test.
2. Change only the necessary files.
3. Run the closest spec(s) or frontend typecheck if TS changed.
4. Run lint only if config/global patterns changed.
5. Stop there; do not run a full suite or clean build.

**Medium (shared type, several screens/modules, response shape):**
1. Run the affected specs first.
2. Run `npm run check`.
3. Build the affected workspace if routes, config, auth or CSP changed.
4. Keep reports short and link existing reports instead of restating them.

**Security-sensitive / major (auth, CSRF, cookies, CSP, permissions, private images, uploads, Web Push, database/schema, release):**
1. Preserve every existing security fix; never weaken CSRF, role checks or privacy to make a test pass.
2. Use the isolated test DB and temporary servers/ports.
3. Run focused tests, then the full backend suite; run typecheck, lint and builds.
4. Browser-verify login, roles, CSRF, images/uploads, notifications/SW, and no 401/403 loops where relevant.
5. Stop and report if a security architecture change is required.

Avoid repeated `npm install`/`npm ci`, clean builds, or full suites without a concrete reason. Do not rescan the whole repo when package metadata, `git grep`, and the relevant report answer the question.

## Privacy and authorization

- Server guards are authoritative: `JwtAuthGuard`, `RolesGuard`, CSRF guard, ownership/visibility filters.
- Manager: manager routes, employees, finance/payroll, approvals, Trash, global notifications.
- Employee: own/assigned properties, clients and follow-ups only; no manager routes or APIs.
- Do not expose owner/broker contact data, private images, or cross-employee records. Image access must follow the same visibility policy as the property detail.
- Role changes/disabled accounts must invalidate access. Do not add client-side-only checks.

## Property lifecycle

- **P-code** (`P-000001`) is the submission code shown while pending/rejected.
- **A-code** (`A-000001`) is the official code allocated only at approval; manager-created properties get it immediately.
- Employee submission → review; manager can approve, reject, or request changes; employee can resubmit.
- Duplicate submission/idempotency must stay blocked (HTTP 409); priority/duplicate rules are deliberate.
- `proposedOwner`/new contact becomes official only through the approval lifecycle; do not bypass.
- Trash/restore is Manager-only. Do not create, approve, reject, restore, delete or otherwise mutate real business rows without explicit authorization.

## Authentication and CSP invariants

- Local app uses **HttpOnly cookie auth**: access/refresh cookies, CSRF double-submit, `/auth/me` restore.
- Frontend sends `credentials: 'include'` and `X-CSRF-Token` through `lib/api-client.ts` / `lib/api/authorized.ts`; never store access/refresh tokens in JS storage.
- A `403` CSRF/origin failure is **not** session expiry. One `401` refresh attempt only.
- `legacy`/`dual` modes exist; the local app is configured for `cookie`. Do not change `.env`/`.env.local` or activation modes without explicit approval.
- Local CSP is **Report-Only**. A build-time hash manifest and `csp:preview` enforce adapter exist; do not enable enforcement on the actual app without separate approval.
- Keep `script-src` free of `unsafe-inline`/`unsafe-eval`; do not add wildcard origins or disable the hash pipeline.
- Preserve Web Push SSRF allowlist, upload/Multer hardening, and all prior security headers.

## UI

- Preserve the existing **Astra-glass Arabic RTL** design: direction, copy, spacing, tokens, dialogs/drawers, responsive layout.
- Reuse `components/` and feature tokens; no redesign or unrelated refactor.
- Preserve Google Fonts usage, notifications, Service Worker and Web Push behavior.

## Safety rules

- No database migrations, resets, seeds or business-data changes without explicit authorization.
- No `.env`/`.env.local` edits, secret printing or commits containing secrets.
- No commits, pushes, rebases or history changes unless explicitly requested.
- No new heavy tooling/services or unrelated dependencies.
- Do not start Rate Limiting, Prisma schema, or CSP enforcement work unless the task explicitly asks.
- If a task is blocked, stop and report the exact blocker instead of trying an unrelated architecture change.

## Reporting

When a report is requested, write a concise Arabic report under `docs/reports/` containing: files changed, exact commands/results, evidence, residual risks and whether activation was performed. Reference prior reports instead of retelling project history.
