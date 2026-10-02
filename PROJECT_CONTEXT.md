# Arkan Real Estate CRM — Project Context

Reviewed against repository files on **2026-10-02**. Source paths below are relative to the repository root. This describes implementation, not production readiness. Live databases, private environment values, deployment accounts and customer data were not inspected.

## Project Overview

Arkan Real Estate CRM (أركان الخليج العقارية) is an Arabic RTL workspace for a real estate company's managers and employees. Its intended workflow connects owners, property listings, clients and requests, follow-ups, deals, commissions, payroll/expenses and attendance.

Managers oversee company operations; employees enter properties/client requests and manage daily follow-ups and attendance. Most business workflows are currently frontend demonstrations inside a real application with a working authentication foundation.

## Current Project Status

**Implemented foundation:** npm workspaces; separate Next.js/NestJS applications; shared contracts; Prisma schema and two migrations; development seed; real login/refresh/logout/current-user API; password hashing, JWT/role guards and transactional auth audit records; HTTP/environment validation; health checks; Redis/BullMQ system queue; manager/employee UI shells and navigation.

**Partially completed:** business lists, filters, drawers and form interactions use mock data. Most final records exist only in React state and disappear after remount/refresh. Important forms recover temporary input from browser storage. Smart Paste uses keyword parsers. Employee attendance persists locally; manager attendance combines it with samples. Application Dockerfiles exist, but current Compose starts only data services.

**Not implemented:** real business CRUD, notifications/jobs, S3 storage and AI parsing. Backend modules `users`, `employees`, `clients`, `owners`, `properties`, `deals`, `commissions`, `payroll`, `finance`, `attendance`, `followups`, `notifications`, `files`, and `smart-paste` are empty `@Module({})` scaffolds. Reports/marketing are coming-soon screens. Production deployment and cross-device business synchronization are not established.

## Tech Stack

Resolved versions below are from package-lock.json, not manifest ranges.

| Layer          | Implementation                                                                           |
| -------------- | ---------------------------------------------------------------------------------------- |
| Runtime        | Node.js >=22; Dockerfiles use node:22-bookworm-slim                                      |
| Frontend       | Next.js 16.3.4 App Router, React 19.2.8, TypeScript 5.9.3                                |
| Backend        | NestJS core 11.2.3, Express platform                                                     |
| Database       | PostgreSQL; Compose postgres:16, patch not pinned                                        |
| ORM            | Prisma CLI/client 6.19.3                                                                 |
| Queue          | BullMQ 5.81.4, Nest BullMQ 11.0.5; redis:7-alpine image                                  |
| Authentication | Nest JWT, HS256 access tokens, opaque refresh tokens; Node crypto scrypt/SHA-256         |
| Validation     | Joi 18.2.8, class-validator 0.14.4, class-transformer 0.5.1                              |
| Styling        | CSS Modules/shared tokens, IBM Plex Sans Arabic via Google Fonts; Tahoma/Arial fallback  |
| Tests          | Jest 30.5.1, ts-jest 29.4.12, Supertest 7.2.2; custom Node assertion scripts             |
| Tooling        | ESLint 9.39.5, Prettier 3.9.6, concurrently 9.2.4                                        |
| Storage/API/AI | PostgreSQL foundation, browser storage mocks, JSON auth/health API; no S3/AI integration |
| Hosting        | No production provider/domain established in repository configuration                    |

## Architecture

### Frontend

`app` defines routes/layouts; `features` contains domain UI, mock data and helpers; `components/ui` and `components/layout` provide reusable controls/shells. `lib/api-client.ts` is currently consumed only by authentication: public API base URL, Bearer headers, no-store fetch, 10-second timeout and response unwrapping. No business Next.js server-action/API implementation was found.

Root layout supplies Arabic RTL and AuthProvider. RequireRole protects workspace navigation in the browser; it is not server-side authorization for sensitive data. UI uses soft beige/gold glass styling, white transparent controls, architectural backgrounds, thin scrollbars and responsive navigation. Mobile form controls have a minimum 16px rule.

### Backend and database

AppModule registers config, Prisma, auth, health, jobs and empty domain modules. Controllers coordinate HTTP; AuthService contains current real transaction logic. Global DTO validation rejects extra fields and transforms input. Success is `{ data: ... }`; errors are `{ error: { statusCode, message, path } }`. Unexpected errors use a generic client message; server logs can contain stacks.

PrismaService manages PostgreSQL access. Shared contracts do not export Prisma Client to the frontend. Auth session changes and audit records are transactional. Business schema relationships exist before their services.

### Authentication flow

Login normalizes email, checks scrypt password hash/active status, and rechecks account state in a transaction. Backend issues HS256 JWT claims sub/role/sid and an opaque random refresh token; only the SHA-256 refresh hash is stored. Frontend calls `/auth/me`, then stores tokens/user in sessionStorage under `arkan.auth.v1`.

Route/reload restoration calls `/auth/me`; a 401 triggers one refresh attempt. Concurrent restoration consumers share a pending promise. Refresh conditionally consumes the old record and creates replacement tokens/session; the old access token also fails because its session is revoked. Access TTL defaults to 900 seconds; refresh lifetime is seven days from issuance/rotation, with no absolute session-age limit.

Every protected backend request verifies algorithm/issuer/audience and reads the stored session/current active user and role. Logout clears browser state and revokes the supplied session; network failure may leave the server session valid. Non-auth restoration network failures preserve tokens and show retry.

### Authorization and API structure

Global JWT guard requires authentication unless @Public is supplied. RolesGuard applies @Roles metadata where present. Current production controllers are auth/health only; business permissions and ownership policies are not implemented.

| Method/path        | Access / behavior                                           |
| ------------------ | ----------------------------------------------------------- |
| GET /health        | Public liveness                                             |
| GET /health/ready  | Public PostgreSQL/Redis checks; 503 on failure/timeout      |
| POST /auth/login   | Credentials input; token pair and expiry                    |
| POST /auth/refresh | Public route requiring valid refresh token in JSON          |
| POST /auth/logout  | Public route accepting refresh token; idempotent revocation |
| GET /auth/me       | Bearer JWT; current user ID/role                            |

No /api prefix is configured. Nest listens on all interfaces. CORS combines configured origins with hardcoded localhost/LAN development origins. FileAsset is metadata only; FilesModule has no upload/download implementation.

## Project Structure

| Path                                    | Responsibility                                     |
| --------------------------------------- | -------------------------------------------------- |
| apps/frontend/app                       | Routes/layouts                                     |
| apps/frontend/features                  | Domain UI, mocks, auth session, parsers            |
| apps/frontend/components                | Shared controls, overlays, navigation              |
| apps/frontend/lib/drafts                | Scoped recovery/debounce/sanitization              |
| apps/frontend/lib/area-governorate.ts   | District/governorate/block helpers                 |
| apps/frontend/lib/kuwait-districts.json | Imported district/block-count reference            |
| apps/frontend/styles and public         | Tokens, CSS, static assets                         |
| apps/backend/src/auth, common, config   | Auth/security, HTTP/environment infrastructure     |
| apps/backend/src/prisma, health, jobs   | Database lifecycle, probes, system queue           |
| apps/backend/src/domain folders         | Business scaffolds listed above                    |
| apps/backend/prisma                     | Schema, migrations, seed                           |
| apps/backend/test                       | Jest auth/environment/health tests                 |
| packages/shared/src                     | Role enum, auth contracts, API response types      |
| scripts                                 | Draft/NFC checks                                   |
| docker and docker-compose.yml           | Image recipes and local data-service orchestration |
| prototype                               | Visual reference, not production application code  |
| docs                                    | Original decisions/scope and focused notes         |

## Database

PostgreSQL schema has 18 UUID-key models:

| Models                  | Responsibility / relationships                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| User, RefreshToken      | Unique email, active role, many hashed sessions                                |
| EmployeeProfile         | Optional one-to-one user profile through unique userId; salary/phone/hire date |
| Client, Owner           | Creator/responsible employee; indexed non-unique phone; owner properties       |
| Property                | Unique reference, required owner, optional creator, listing/status/price       |
| PropertyAssignment      | Unique property + employee + purpose                                           |
| PropertyApprovalRequest | Property, requester/reviewer, approval state                                   |
| FollowUp                | Employee and exactly one client/owner/property target                          |
| Deal                    | Property/client/recorder, optional property/client employees, price/commission |
| Commission              | Deal/employee/creator, commission role, amount/payment state                   |
| PayrollEntry            | Unique employee + period, creator, salary/deductions/bonus/net                 |
| ManualExpense           | Free-text type, amount/currency, creator, optional property                    |
| FinanceMovement         | Unified income/expense and typed source relationship                           |
| AttendanceRecord        | Unique employee + date, status/check-in/out                                    |
| Notification            | Recipient, optional business links, read timestamp                             |
| AuditLog                | Actor/action/entity, optional before/after JSON                                |
| FileAsset               | Unique object key, bucket, MIME/size, uploader, optional property              |

Money uses Decimal(14,2), with currency on monetary records; EmployeeProfile baseSalary has no currency field. DealType supports SALE/RENT only. PropertyStatus includes PENDING, AVAILABLE, REJECTED, SOLD, RENTED, ARCHIVED. Payroll period/attendance date are date columns; company timezone/period normalization is unfinished.

SQL CHECK `FollowUp_exactly_one_target` requires exactly one target. `FinanceMovement_source_matches_relation` matches sourceType/sourceId to the appropriate relation. Manual expenses require EXPENSE; the explicit manualExpense relation is optional but must match sourceId if supplied. Most history/business foreign keys restrict deletion; user refresh tokens and notifications cascade.

Migrations: `20260907000000_initial` establishes schema/CHECK constraints; `20260907100000_mvp_schema_refinements` adds property/client/owner fields, creator/commission metadata, manual expenses and source links. The latter refuses existing Commission, PayrollEntry or FinanceMovement rows: a reviewed staged backfill is required, not record deletion.

Seed creates two development users (one per role) and an employee profile transactionally. It refuses production mode, preserves existing accounts/passwords, and rejects incompatible existing roles. It builds/reuses the backend password helper. Credentials are intentionally not reproduced here.

Current schema does not represent frontend exchange listings, multi-type request bundles, structured floors, budget ranges or NFC tag fields. Approve domain mapping/migrations before integrating them.

## User Roles and Permissions

| Role            | Current interface                                                                                                                                                   | Boundaries                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| MANAGER         | Dashboard, properties/approval previews, deals, clients/owners, employees/assignments, finance, attendance, notifications, settings, reports/marketing placeholders | Redirected away from employee-only UI; mock actions do not administer real accounts/records            |
| EMPLOYEE        | Daily dashboard, properties, client requests, follow-ups, notifications, self-attendance/NFC                                                                        | Redirected away from manager UI; no deal-recording/finance page; sample ownership is not authorization |
| Unauthenticated | Login and public health/auth entrypoints                                                                                                                            | Workspace redirects to login; private backend routes reject missing JWT                                |

There is no additional admin role. Manager-only deals and assignment-for-focus semantics are MVP requirements in docs/02_MVP_SCOPE.md, not enforced business API policies yet. UI settings do not alter server permissions.

## Main Features

| Routes / feature                                | Current behavior                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| /manager, /employee                             | Sample dashboard metrics/feeds                                                                                                              |
| /manager/properties, /employee/properties       | Search/grouping/details, shared intake; manager additions display approved, employee additions pending; approvals are previews; local lists |
| /manager/clients, /employee/clients             | Clients/owners or employee clients, search/details, new/existing-client request wizard; local changes                                       |
| /manager/deals                                  | Local deal wizard, manual commissions, local property sold/rented state; payroll samples/preview form                                       |
| /manager/employees                              | Sample metrics/assignments; local employee addition/mock credential card, no User/EmployeeProfile creation                                  |
| /manager/finance                                | Dedicated sample sources, filters/details, manual expense with free-text type/KWD/EGP; not a live projection of other pages                 |
| /employee/followups                             | Local creation, results, completion/rescheduling; no persistent reminders                                                                   |
| /manager/attendance, /employee/attendance       | Manager samples/manual state plus locally stored employee attendance; export is toast only                                                  |
| /manager/notifications, /employee/notifications | Samples/local read actions; no delivery service                                                                                             |
| /manager/settings                               | Preview controls/save feedback, not persisted policies                                                                                      |
| /manager/reports, /manager/marketing            | Coming-soon screens                                                                                                                         |
| /employee/attendance/nfc                        | Mock tag scan                                                                                                                               |

### Forms and Smart Paste

Property steps: owner, offer types, analysis/editing, review/send. Client steps: identity, request types, analysis/editing, review/save. Existing people use searchable selection. Property bundles allow multiple sale/rent/exchange types; client bundles allow buyer/renter/exchanger types. Client interest may link a sample property, contain a new request, or both.

Analysis reveals editable fields in the same stage and scrolls to them. `parsePropertyMessage` in property components and `parseRequest` in the client-request model are synchronous keyword/regex helpers, not AI. They cover limited locations/numbers/exchange phrases. Missing values require manual completion; some legacy parsed fields are hidden by current editors.

Floor editors use floor name/free-text contents; legacy roomsOrFloor/portion data remains. Desired-client budget uses from/to. Property editor choices include قسيمة/فيلا, but parsers can return older types. District helpers map governorates and generate blocks 1..count from imported Excel counts; duplicate rows use maximum count. These are not independently verified official block IDs.

### Background form recovery

lib/drafts scopes keys by user/role/route/form, restores in effects, debounces 500ms, and flushes on page hide/visibility change/unmount. localStorage is primary, sessionStorage fallback. Recursive key filtering excludes password/token/secret/credential fields, not sensitive content typed into generic notes.

Important property/client/deal/employee/follow-up/expense/manual-attendance forms use recovery, including open state/steps where wired. No draft-management buttons. Success clears form data; cancel generally retains it; property modal X clears its draft. Browser-close recovery may require login again because auth uses sessionStorage. Recovery does not preserve final in-memory business records.

## Important Business Rules

- Auth requires active users, non-revoked sessions, matching roles, single-use refresh and transactional audit/session writes.
- Property mock requires owner identity, analysis, area/type, nonnegative numbers, positive sale/rent price, exchange target area/type, complete added floors/custom fields.
- Client mock requires identity/type/interest, valid linked sample property, analysis for new requests, complete floors, nonnegative budgets and upper >= lower budget when both are supplied.
- Deal mock requires available sample property, known client/employees, positive price, nonnegative commissions and date. It updates only its local store.
- Finance uses integer thousandths, three decimals for KWD/two for EGP and separate currency totals. Database money has two decimals; resolve before persistence.
- NFC mock checks sample tag/email ownership. First daily action checks in, second checks out, then completed; device-local time after 09:15 is late. This is not final server policy.

## Environment Variables

Sources: backend src/config/environment.ts and frontend lib/api-client.ts. Never document live values.

| Variable                | Required/optional and purpose                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| NODE_ENV                | Optional backend; defaults development; development/test/production; seed refuses production |
| PORT                    | Optional backend, default 4000; frontend container separately sets 3000                      |
| FRONTEND_ORIGIN         | Required backend; comma-separated exact HTTP(S) origins                                      |
| DATABASE_URL            | Required backend/Prisma PostgreSQL URI                                                       |
| REDIS_HOST              | Required backend Redis hostname                                                              |
| REDIS_PORT              | Optional backend, default 6379                                                               |
| JWT_ACCESS_SECRET       | Required >=32 characters; generate independently, never reuse example text                   |
| JWT_ACCESS_TTL_SECONDS  | Optional integer 60..3600, default 900                                                       |
| JWT_ISSUER              | Required JWT issuer identifier                                                               |
| JWT_AUDIENCE            | Required JWT audience identifier                                                             |
| NEXT_PUBLIC_API_URL     | Required for browser auth calls; browser-reachable origin, fixed at production build         |
| JWT_REFRESH_SECRET      | Present in backend example but unused; refresh tokens are opaque                             |
| NEXT_TELEMETRY_DISABLED | Optional Next tooling flag set by frontend image build                                       |
| HOSTNAME                | Frontend standalone container binding setting                                                |

Compose supplies POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB for database initialization; these are container settings, not Joi variables. Values are intentionally omitted.

Local files: apps/backend/.env and apps/frontend/.env.local. Replace backend example secrets. Use frontend **.env.local.example**: frontend .env.example currently contains only a misplaced backend CORS setting and cannot configure login. Current code consumes no S3/AI variables.

## Local Development

See [README.md](README.md) for exact commands. Requires Git/repository access, Node.js >=22/npm, Docker Compose and available ports 3000/4000/5432/6379.

Clone, create environments, set fresh secret/matching origins/database values, install locked dependencies, generate Prisma, build shared, start data services, wait for readiness, deploy migrations, seed development accounts and start applications. Login: http://localhost:3000/login.

Shared exports compiled dist; rebuild after changes. Prisma commands read backend .env within its workspace. Check database target and migration preconditions before migration/seed.

## Build and Production

Root build compiles shared, backend, frontend. Generate Prisma first. Backend start executes node dist/main.js; frontend start executes next start. Runtime backend environment and a public API URL at frontend build are required.

Dockerfiles build from repository root. Frontend uses Next standalone with a separate runtime stage. Backend runs non-root but retains build dependencies. Neither image automatically migrates/seeds. Current Compose has no frontend/backend/migration services. Existing build recipes do not prove production deployment.

## Testing

| Command                                   | Scope                                                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm.cmd test                              | Jest/Supertest auth with Prisma double, hashing, roles on test routes, JWT, refresh/reuse/concurrency logic, logout, environment and mocked readiness |
| node scripts/test-form-drafts.cjs         | Hook harness for recovery, debounce/flush, sensitive-key exclusion, isolation, cleanup/fallback/migration                                             |
| node scripts/test-nfc-attendance.cjs      | Pure mock transitions, tag mismatch, date/late status, safe return routing                                                                            |
| npm.cmd run typecheck                     | Shared build/workspace typechecks                                                                                                                     |
| npm.cmd run lint                          | ESLint apps/packages                                                                                                                                  |
| npm.cmd run db:validate -w @arkan/backend | Prisma schema validation                                                                                                                              |
| npm.cmd run format:check                  | Repository Prettier check                                                                                                                             |

No browser E2E framework, real PostgreSQL integration suite, load tests, physical NFC tests, parser regression suite or business API tests were found. Test doubles/harnesses do not establish browser correctness or database concurrency. User capacity cannot be inferred from source.

## Security

- Salted scrypt/timing-safe verification; hashed refresh tokens; verified JWT algorithm/issuer/audience.
- Global DTO whitelist; login/refresh responses disable caching.
- sessionStorage tokens are JavaScript-readable, not HttpOnly cookies. Production session/XSS/CSRF design needs review.
- No rate limiting, password recovery, MFA, token-family revocation, all-device logout or refresh cleanup.
- Browser attendance/drafts/sample ownership are not security controls. Notes may contain personal data; drafts have no retention expiry.
- CORS includes hardcoded development origins. PostgreSQL Compose port is not loopback-restricted; Redis is. Compose uses development credentials.
- Git ignores real .env variants. Docker ignore excludes .env/.env.local specifically; other environment filenames need review before builds.
- Never place secrets in NEXT_PUBLIC variables, logs, docs or commits. Sample flows are not secure customer-data storage.

## Known Issues

1. Most final business records vanish after reload; independent page stores do not synchronize property/deal/finance/client changes.
2. Frontend exchange/multiple types, floors, budgets and NFC tags exceed schema capabilities.
3. Mock KWD precision conflicts with two-decimal database money.
4. Parser coverage/normalization varies between property/client paths; legacy fields/types differ from editors.
5. Attendance relies on editable browser storage/device time with no cross-device sync/concurrent locking. Login captures sample identity metadata; manager manual records remain component state.
6. Approval/settings/export/payroll feedback is not proof of server persistence or actual outputs.
7. Seed preserves existing passwords; second migration blocks non-empty financial tables pending backfill.
8. Frontend environment templates differ; backend example secrets need replacement.
9. Deployment, backup/restore, monitoring and production load capacity are undefined/unverified.

## Important Technical Decisions

Original stack/clean-code docs specify separate Next UI/Nest API, domain modules, shared DTOs without Prisma leakage, and small reusable components for maintainable MVP development. Prisma is the relationship source of truth; SQL CHECK constraints cover invariants Prisma cannot express. FinanceMovement centralizes traceable sources. Restrictive relationships protect history; important domain writes/audits are intended to be transactional, with auth currently demonstrating this.

Prototype HTML is a visual reference rather than production code. The documents do not establish comparative reasons for PostgreSQL versus alternatives, JWT versus alternatives, or a hosting provider; do not invent them. S3/backend parsing are planned boundaries only.

## Things That Must Not Be Changed Without Review

- Auth session format/rotation, guards, hashing and shared contracts.
- Schema/migrations, CHECK constraints, restrictive relations, money precision/history; never delete data to bypass a migration error.
- Draft scopes, stored step IDs, close/cleanup behavior and sensitive-key filtering.
- Mock/real boundaries: no silent API writes from local previews.
- RTL navigation, glass styling, responsive behavior and intake steps.
- Environment/CORS, Docker networking, secrets and external calls.

## External Services

| Service               | Integration/state                                                     |
| --------------------- | --------------------------------------------------------------------- |
| PostgreSQL            | Prisma datasource/service and local Compose                           |
| Redis                 | Backend BullMQ system queue/readiness                                 |
| Google Fonts          | Browser CSS import in frontend styles/globals.css with fallback fonts |
| S3-compatible storage | Planned; FileAsset metadata only; FilesModule empty                   |
| AI parser             | Planned; SmartPasteModule empty; local regex mocks only               |

No real email/SMS/WhatsApp/payment/marketing provider integration was found. GitHub hosts source, not the application. Dependency/build network downloads are not business integrations.

## Deployment

Local topology: Next 3000, Nest 4000, PostgreSQL 5432, Redis loopback 6379. Named volumes retain data. Compose down preserves volumes; deleting volumes destroys data and requires explicit approval.

No hosting provider, managed database, bucket, domain/DNS/TLS, CI/CD workflow, reverse proxy, production Compose topology or proven deployment runbook was found. README documents existing build/start/migration mechanisms; full production deployment requires reviewed infrastructure decisions.

## Current Data Flow Examples

1. **Real login:** form -> session.signIn -> API client -> POST /auth/login -> password/active-user checks -> PostgreSQL refresh-hash + audit transaction -> tokens -> GET /auth/me -> guard reads session/user -> sessionStorage -> role workspace.
2. **Real refresh:** route/reload -> expired-access 401 -> POST /auth/refresh -> consume old record/create replacement + audit -> new tokens -> /auth/me -> restored UI. Non-auth network failures retain tokens/show retry.
3. **Mock property:** owner/offers -> message -> parsePropertyMessage -> editable fields -> validation -> toProperty -> local page list -> clear draft. No business API/database call.
4. **Mock client:** identity/types -> linked sample property and/or message -> parseRequest -> edits -> saveBundle -> local client list -> clear draft. No server client/request record.
5. **Mock NFC:** employee route with assigned-demo-tag query -> role/session/mock identity -> tag/email check -> registerAttendance -> localStorage/update event -> history/result. Same-origin manager merges records with samples. No hardware API/attendance endpoint.

## Next Recommended Tasks

See [TODO.md](TODO.md): reconcile domain/UI contracts, implement authorized business services/API clients, then transactional finance, real attendance/jobs/storage/parser, production hardening/deployment and integration/E2E/load verification. Reports/marketing remain deferred.

## AI Agent Handoff Instructions

- Read this file first; inspect relevant existing code before changing it.
- Preserve architecture unless explicitly approved; do not rewrite working features unnecessarily.
- Keep work scoped and conserve tokens; inspect large prototype HTML only when needed.
- Never expose secrets or delete database data without explicit approval.
- Explain major architecture changes first; backend/database/auth/API work requires explicit scope.
- Preserve mock boundaries and distinguish local feedback from real server success.
- Run relevant tests, explain results/untested areas, and update docs after significant changes.
- Do not commit/push unless requested. A private repository is not secret storage.

## Verification and Uncertainty

Evidence: source, lockfile, config, schema/migrations, tests and reference docs. Review results are in README. No application code, environments, databases or Docker configuration were changed.

Unknown: running/deployed services, applied migrations, customer data, real credentials, hosting/DNS/accounts, backup health, browser visual correctness, physical NFC behavior and production performance. These require environment-specific verification, not assumptions from source.
