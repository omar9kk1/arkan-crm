# Remaining Work

Source-based handoff checklist, reviewed 2026-10-02. Items below reflect current scaffolds, mock implementations, tests and documented MVP scope. They are not authorization to change the database, security or product scope.

## 1. Resolve contracts before real integration

- [ ] Reconcile frontend multi-type property/client bundles, exchange requests, budget ranges, structured floors and NFC tags with the existing Prisma schema/shared contracts. These currently lack a complete persistent representation.
- [ ] Resolve mock KWD thousandths versus Decimal(14,2) database precision; define explicit money/currency conversion contracts before writing finance APIs.
- [ ] Reconcile parser property types/legacy fields with active editors and district data. Add regression cases for Arabic number formats, missing values, exchange splits and manual corrections.
- [ ] Preserve SQL CHECK constraints and deletion restrictions. If financial tables contain records before refinement migration, prepare a reviewed staged backfill instead of deleting data.

## 2. Implement the planned business backend

Evidence: corresponding src domain modules are empty; frontend calls only authentication APIs.

- [ ] User/employee management: real User + EmployeeProfile creation, temporary-credential lifecycle and server permissions; current employee form is mock only.
- [ ] Clients/owners and property CRUD with ownership/responsibility, assignments, approval/rejection/change-request transitions and audit records.
- [ ] Persist client requests and connect linked-property choices to real records after approving their schema mapping.
- [ ] Follow-ups: persistence, result/completion/rescheduling and employee access rules.
- [ ] Manager deal workflow: record deal, change property status without deletion, create agreed commissions/financial entries and audit in a transaction.
- [ ] Payroll/manual-expense/finance services with source traceability, payment state, currency handling and business validation.
- [ ] Real attendance/manual-entry API; replace local NFC simulation with JWT-user/tag validation, server time, atomic transitions and duplicate protection as described in docs/NFC_ATTENDANCE_PLAN.md.
- [ ] Notifications and BullMQ workers for planned follow-up/daily work; system queue currently has no business processors.
- [ ] S3-compatible file service and authorized upload/download flow; only FileAsset metadata exists.
- [ ] Backend Smart Paste service behind a replaceable contract; no AI provider is selected/integrated in current code.

## 3. Connect current UI without redesigning it

- [ ] Replace per-page sample stores with API clients and agreed contracts. Ensure properties/clients/deals/finance/dashboard views reflect shared persistent data.
- [ ] Connect approval, settings and payroll preview actions to real authorized operations; do not treat existing success feedback as persistence.
- [ ] Implement the attendance export already represented by a button; currently it only shows a toast.
- [ ] Preserve background form recovery while distinguishing draft recovery from successful server saves. Review retention/personal data in generic draft notes and storage-failure behavior.
- [ ] Verify mobile/keyboard interactions and property/client multi-type review flows with browser tests after API integration.

## 4. Production security and configuration

Evidence: current auth/session implementation, environment templates, Docker and CORS configuration.

- [ ] Review production session transport: tokens currently reside in JavaScript-readable sessionStorage; HttpOnly/Secure cookie design and associated CSRF protections are not implemented.
- [ ] Add login abuse/rate-limit controls and review refresh-token lifecycle cleanup/reuse handling; current rotation has no token-family revocation or absolute session-age limit.
- [ ] Define real per-record business authorization; client route guards/sample ownership are insufficient.
- [ ] Correct the frontend .env.example mismatch and replace/review development secret examples. JWT_REFRESH_SECRET is present but unused.
- [ ] Remove or explicitly gate hardcoded development CORS/allowed origins for deployment; review PostgreSQL port exposure and default Compose credentials.
- [ ] Review Docker environment-file exclusions beyond .env/.env.local, backend image dependency footprint and runtime secret delivery.
- [ ] Decide company timezone/work hours and payroll-period normalization before real attendance/payroll; mock late threshold uses device time.

## 5. Verification and deployment

- [ ] Add real PostgreSQL integration tests for auth rotation/concurrency, migrations and SQL constraints; current Jest suite uses doubles.
- [ ] Add business API tests as those services are implemented, plus frontend login/role/form-recovery and wizard E2E coverage.
- [ ] Validate NFC return/refresh behavior in browser and on the intended physical device; existing script tests pure mock logic only.
- [ ] Establish production hosting, runtime networking, TLS/domain, migration process and CI/CD; no complete deployment is configured.
- [ ] Set up and verify database/file backups and restore procedures, monitoring and production load tests before promising capacity.

## Explicitly deferred product scope

- [ ] Reports and marketing remain coming-soon pages per docs/02_MVP_SCOPE.md; implement only when that phase is requested.
