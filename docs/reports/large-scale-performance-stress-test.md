# Large-Scale Data & Performance Stress Test

**Date:** 2026-11-09  
**Scope:** controlled local load test on a disposable PostgreSQL database; no production traffic.  
**Verdict:** Stage A/B/C completed functionally; one confirmed authorization/privacy finding; 100-user concurrency is not healthy beyond Stage A.

---

## 1. Database isolation proof

- Load database: **`arkan_crm_load_test`** on local PostgreSQL port **5433**.
- Development database `arkan_crm` was **not** used for seeding, truncation or load traffic.
- Every seed/truncate verified both:
  - URL database name equals `arkan_crm_load_test`.
  - `current_database()` equals `arkan_crm_load_test`.
- Separate backend instance ran on **port 4101** (not the development backend on 4001).
- Backend was started with `DATABASE_URL` pointing only to `arkan_crm_load_test`; the development backend was not running during the test.
- After the test, `arkan_crm` is unchanged:
  - 23 migrations
  - 4 users
  - 2 employee profiles
  - 4 properties
  - 5 file assets
- `arkan_crm_load_test` was **retained** for investigation: **49 MB**, Stage C data.
- Load-test backend was stopped after measurements; port 4101 is free.
- No code, schema, migration, `.env` or real-data changes were made.

---

## 2. Generator and stages

Reusable local harness:

- `scripts/load-test/generate.cjs` — deterministic, configurable, batched generator.
- `scripts/load-test/verify.cjs` — functional checks + bounded API load.
- Deterministic random seeds: A=101, B=202, C=303.
- Synthetic accounts only (`@example.test`), no real credentials or personal data.

| Stage | Total rows | Users (employees) | Clients | Properties (non-deleted) | Contacts | FollowUps | FollowUpSubjects | Notifications | Approvals | Assignments | Deals | AuditLogs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | **6,495** | 1,057 (1,050) | 700 | 700 (665) | 300 | 900 | 900 | 300 | 88 | 150 | 50 | 300 |
| B | **21,126** | 2,513 (2,500) | 2,500 | 2,500 (2,375) | 1,000 | 3,500 | 3,500 | 1,000 | 313 | 500 | 300 | 1,000 |
| C | **107,896** | 5,021 (5,000) | 15,000 | 15,000 (14,250) | 5,000 | 20,000 | 20,000 | 8,000 | 1,875 | 3,000 | 5,000 | 5,000 |

All stages included >1,000 employees; B/C included >1,000 clients and properties.

---

## 3. Functional scalability results

Each stage ran **55 checks**: **54 PASS / 1 FAIL**. The single failure is the authorization finding in §6.

| Check | Stage A | Stage B | Stage C |
|---|---:|---:|---:|
| Owner clients paginated | 700 | 2,500 | 15,000 |
| Owner properties paginated | 665 | 2,375 | 14,250 |
| Owner employees paginated | 1,050 | 2,500 | 5,000 |
| Manager A team | 577 | 1,375 | 2,750 |
| Manager B team | 263 | 625 | 1,250 |
| Manager A supervision feed | 747 | 1,775 | 10,556 |
| Employee0 properties | 80 | 140 | 222 |
| Owner notifications | 150 | 500 | 4,000 |

- All paginated collections reached `nextCursor = null` with **no duplicates**.
- Counts matched `GET /clients/stats`, employee `summary`, dashboard totals and DB-side expectations.
- Search found records at the end of the dataset:
  - `Load Client 015000`
  - `P-LOAD-0015000`
  - `Load Employee 05000`
- Global employee sorting (`clientsCount`, `propertiesCount`, `dealsCount`) paginated every employee exactly once, and the heaviest employee was first for `clientsCount`, not just first-page first.
- Employee0 recommendations returned **298** candidates in Stage C, including clients beyond the first page (first 50).
- Manager A saw only team A; manager B only team B; OWNER-direct employees were absent from manager lists.
- Manager A received `404` for a team B employee detail and an OWNER-direct employee detail.
- Employee received `403` for `/employees`, `404` for a team B client and a foreign PENDING property.
- Full client, employee and follow-up detail endpoints returned `200` within the authorized scope.

No hidden total cap of 50/100/200/1000 was observed.

---

## 4. Single-user latency (P50 / P95 ms)

| Endpoint | Stage A | Stage B | Stage C |
|---|---:|---:|---:|
| `GET /clients?limit=50` | 18.9 / 20.3 | 24.4 / 27.2 | 50.5 / 70.1 |
| `GET /clients/stats` | 9.5 / 10.4 | 10.8 / 12.6 | 25.8 / 27.3 |
| `GET /clients?search=...` | 13.1 / 14.3 | 17.7 / 18.4 | 41.3 / 45.8 |
| `GET /properties?limit=50` | 20.1 / 28.2 | 22.7 / 25.1 | 23.2 / 31.8 |
| `GET /properties?q=...` | 16.6 / 18.6 | 25.4 / 27.0 | 81.1 / 97.4 |
| `GET /employees?sort=clientsCount` | 148.4 / 179.9 | 192.3 / 216.7 | 314.6 / 492.3 |
| `GET /employees?sort=dealsCount` | 149.2 / 161.9 | 267.8 / 280.0 | 322.3 / 403.3 |
| `GET /follow-ups?limit=50` (manager) | 70.6 / 82.3 | 311.3 / 424.8 | **995.0 / 1117.0** |
| `GET /follow-ups/manager/overview` | 67.2 / 78.7 | 192.4 / 203.3 | 283.0 / 304.4 |
| `GET /dashboard/manager?period=month` | 78.2 / 79.7 | 113.2 / 117.1 | 197.9 / 242.5 |
| `GET /dashboard/manager?period=all` | 80.1 / 104.2 | 140.3 / 148.7 | 259.2 / 329.0 |
| `GET /notifications?limit=20` | 11.9 / 12.9 | 10.8 / 12.0 | 11.1 / 12.3 |
| `GET /employees/:id/properties` | 10.0 / 12.4 | 9.3 / 12.5 | 8.9 / 10.1 |
| `GET /clients/recommendation-candidates` (employee) | 8.7 / 9.3 | 9.7 / 10.4 | 15.8 / 19.0 |
| `GET /auth/me` | 3.3 / 3.7 | 5.0 / 6.3 | 4.3 / 5.0 |

Response-size growth:
- Manager supervision overview: **65 KB → 117 KB → 227 KB**.
- Recommendation candidates: **15 KB → 28 KB → 45 KB** (298 candidates at C).

---

## 5. Concurrent-user load

Bounded test: 4 requests per virtual user (40 / 200 / 400 requests). Real JWTs were used; request mix covered owner, manager and employee read paths. Status `0` means the Node client got `fetch failed`/`ECONNRESET`; it is not an HTTP 5xx.

| Stage | Users | Requests | RPS | P50 ms | P95 ms | Error rate | Status counts | Backend CPU Δ | Backend mem after | PostgreSQL |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| A | 10 | 40 | 74.3 | 331.9 | 516.2 | 0% | 200=40 | +1.9 s | 310 MB | 0.07% CPU / 300 MB |
| A | 50 | 200 | 74.9 | 1,667.7 | 2,551.9 | 0% | 200=200 | +9.5 s | 356 MB | 0.03% / 302 MB |
| A | 100 | 400 | 70.0 | 3,830.8 | 5,502.5 | 2% | 0=8, 200=392 | +18.1 s | 457 MB | 0.08% / 302 MB |
| B | 10 | 40 | 34.7 | 575.6 | 1,127.3 | 0% | 200=40 | +3.5 s | 299 MB | 0.11% / 316 MB |
| B | 50 | 200 | 39.1 | 2,960.9 | 5,059.2 | 0.5% | 0=1, 200=199 | +18.7 s | 434 MB | 0.05% / 335 MB |
| B | 100 | 400 | 44.2 | 4,493.8 | 8,810.8 | **15.25%** | 0=61, 200=339 | +31.0 s | 489 MB | 0.07% / 345 MB |
| C | 10 | 40 | 13.1 | 1,185.2 | 3,027.9 | 0% | 200=40 | +10.4 s | 570 MB | 0.17% / 504 MB |
| C | 50 | 200 | 14.3 | 5,833.7 | **13,948.9** | **5%** | 0=10, 200=190 | +52.0 s | **819 MB** | 0.15% / 493 MB |
| C | 100 | — | — | — | — | skipped | — | — | — | — |

- PostgreSQL CPU stayed low (≤1.2% sampled), while backend CPU rose to roughly **3–4 cores** during the heaviest levels. The bottleneck is application/Prisma-side, not the database CPU.
- Backend memory grew from ~250 MB to **819 MB** during Stage C.
- 100 users were **not healthy** at Stage B (15.25% connection resets), so Stage C 100-user was skipped. A repeated Stage A 100-user run earlier showed 11.25% resets; the final corrected run showed 2%. Treat 100-user readiness as borderline until transport tuning is done.
- Slowest endpoints at Stage C were consistently `/follow-ups` (manager, first page), employee global sorting, and manager supervision/dashboard.
- Docker/backend resource figures are **instantaneous before/after samples**, not peak telemetry.

**Environment:** 8 logical CPUs, 15.9 GB RAM (2.9 GB free at test time), D: 582 GB free, C: 0.8 GB free, PostgreSQL container limit 7.7 GB. Load DB size 49 MB.

---

## 6. Findings (prioritized)

### High — Cross-team follow-up history authorization/privacy leak
- `GET /follow-ups/:id/history` authorizes MANAGER with an empty scope in `apps/backend/src/followups/followups.service.ts` (`viewer.role === MANAGER ? {}`).
- Confirmed with real synthetic JWT:
  - MANAGER A received **200** for a follow-up subject owned by a **team B employee**.
  - MANAGER A received **200** for a manager B personal subject.
- The history response selects `client.phone` and `property.contact.phone`, so this can expose private contact data across teams.
- Expected behavior per the rest of the app: team-scoped `404`.
- **Not fixed in this task** (testing/reporting only).

### High — Manager follow-up first page performs full sync on every request
- `/follow-ups` calls `sync(viewer)` whenever `cursor` is absent.
- At Stage C, manager first-page P50 was **995 ms**, P95 **1,117 ms**, and it dominated every concurrent load level.
- Recommendation: throttle/incremental sync, sync watermark, or avoid full sync on every first page.

### High/Medium — 100-user concurrency and connection resets
- Stage B 100 users: **15.25%** client `ECONNRESET`; Stage C 50 users: **5%**, P95 **13.95 s**.
- No HTTP 5xx surfaced; resets are transport/client connection failures under backend saturation.
- Backend memory reached **819 MB** and ~3–4 CPU cores.
- Recommendation: tune Node/keep-alive/Prisma pool/timeouts, use a keep-alive load client, optimize the heavy endpoints, and scale horizontally before claiming 100-user readiness.

### Medium — Employee global sorting scales with total employees
- P50 grew **148 ms (A) → 315 ms (C)**; P95 **492 ms** at C.
- The metric SQL/correlated aggregates remain the main cost at 5,000 employees/15,000 clients/5,000 deals.
- Recommendation: precomputed counters/materialized aggregates or batch metric calculation.

### Medium — Manager overview payload and full-scope enrichment
- First page P50 **283 ms**, payload **227 KB** at C because the first page also returns the full responsible-employee filter list and full-scope summary.
- Dashboard All-Time is **259 ms P50 / 329 ms P95**.
- Recommendation: load the employee filter list on demand/paginated, and cache/split the summary from the page.

### Low — Text search still benefits from trigram/index work
- Property search P50 **81 ms** at C; client search **41 ms**.
- No `pg_trgm` extension was enabled; not required for correctness, but a future targeted search optimization candidate.

---

## 7. What was tested vs. not tested

**Tested**
- API-level data access, pagination/search/filter/sort, counts, roles, team isolation, recommendations.
- Single-user latency across representative endpoints.
- Bounded 10/50/100 concurrent-user API load with real JWTs.
- Backend/PostgreSQL resource samples and response sizes.

**Not tested**
- Browser rendering, Core Web Vitals, UI responsiveness or RTL visual behavior.
- File/image upload/download and private-image serving.
- Web Push real delivery, Redis/BullMQ throughput, scheduled job stress.
- Write/mutation workflows, approvals, deletes, restore, financial calculations.
- Production network, TLS, CDN or multi-instance deployment.
- `pg_stat_statements`/database slow-query log (extension unavailable); only endpoint timing was recorded.
- 100 users at Stage C (skipped after Stage B 100-user resets).

**No application code, indexes, migrations, `.env`, real data or development backend were changed. The load-test database remains available as disposable investigation data.**
