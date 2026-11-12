# Dashboard Deal Aggregation & Prisma Queue Diagnostics

**Date:** 2026-11-10
**Scope:** Deal metrics inside the manager dashboard; remaining query wait under concurrency on Stage C (`arkan_crm_load_test`).
**File changed:** `apps/backend/src/dashboard/dashboard.service.ts` (only production file; temporary diagnostics in `prisma.service.ts` were reverted exactly).
**Verdict:** all-time dashboard **123.3 ms → 33.2 ms**. Monthly dashboards are unchanged within noise. Remaining wait is **connection-pool queueing from the 16-query fan-out**, not slow SQL.

**خلاصة عربية:** أصبحت مجاميع الصفقات والعمولات ورسم الشهور تُحسب داخل PostgreSQL (≤13 صفًا بدل 5,000 صف). زمن OWNER/all انخفض من 123.3ms إلى 33.2ms، والنتائج المالية مطابقة تمامًا (تجربة على 5 فترات × دورين). التشخيص أثبت أن SQL نفسه سريع (p50 2–3ms) وأن الانتظار المتبقي سببه طابور pool (10 اتصالات) أمام 16 استعلامًا لكل طلب dashboard، وليس بطء قاعدة البيانات. لم تُترك أي أدوات قياس في الكود.

---

## 1. Root cause and change

`deal.findMany` returned every matching closed deal with `price`, `companyCommission`, `closedAt`, `propertyEmployeeId`, `clientEmployeeId`, and Node.js then:

- summed `Number(price)` / `Number(companyCommission)` in a loop,
- divided for the average,
- and bucketed `closedAt` into 24 hours / 7 days / 30–31 days / calendar months.

Stage C: 5,000 deals all-time, 3,124 for Manager A. The all-time request transferred and parsed all 5,000 rows to produce one total, one commission, one average and a 13-element array.

### New implementation (`dashboard.service.ts`)

One grouped raw query replaces `deal.findMany`:

```sql
SELECT <bucket> AS bucket,
       COUNT(*)::int AS "count",
       SUM(d.price)::text AS value,
       SUM(d."companyCommission")::text AS commission
FROM "Deal" d
WHERE <closedAt range> AND <manager IN-scope>
GROUP BY 1
ORDER BY 1
```

- **Bucket** is chosen from a closed switch, never user input:
  - hour → `EXTRACT(hour FROM closedAt + interval '3 hours')`
  - day → `EXTRACT(day FROM closedAt + interval '3 hours') - 1`
  - week → `FLOOR(EXTRACT(epoch FROM (closedAt - start)) / 86400)`
  - all → `year*12 + month` of `closedAt + 3 hours`
- **Period filter** keeps the existing inclusive/exclusive `closedAt` range, so the `Deal.closedAt` index stays usable.
- **Manager scope** is `propertyEmployeeId IN (team profile ids) OR clientEmployeeId IN (team profile ids)` — identical to the previous relation filter, so OWNER-direct employees and other teams stay excluded.
- **Financial precision:** sums accumulate as integer cents through `BigInt`; the response is formatted exactly like before (`"300000"`, `"1234.5"`). No floating-point accumulation, no record ceiling.
- The average is derived from the exact total and the exact count (same rounding style as before).
- `dailyCounts` is rebuilt in JavaScript from ≤31 grouped rows, preserving array length and zero-filled gaps (All-Time still extends to the current Kuwait month).

Removed only the now-unused `kuwaitDayOfMonth` helper; `kuwaitHourOfDay` stays (exported and covered by `manager-dashboard-format.spec.ts`).

**Query count: 16 → 16** (the fan-out is unchanged). Rows transferred for deal metrics: **5,000 → ≤13**.

---

## 2. Before / after measurements

### Deal aggregation only (Stage C, warm, median of 5)

| Case | `deal.findMany` + rows | JS sum/buckets | SQL aggregate |
|---|---:|---:|---:|
| OWNER month | 6.4 ms (126) | 0.2 ms | **2.6 ms (9 rows)** |
| OWNER all | 96.5 ms (5,000) | 4.9 ms | **5.3 ms (13 rows)** |
| MANAGER month | 8.0 ms (81) | 0.1 ms | **4.7 ms (9 rows)** |
| MANAGER all | 75.2 ms (3,124) | 2.8 ms | **7.0 ms (13 rows)** |

Cold-cache first run showed 139.1 ms / 85.3 ms for the all-time `findMany`; the warm medians above are the fair comparison.

### Dashboard API (single user, clean final build)

| Endpoint | Before | After (range over runs) | Change |
|---|---:|---:|---:|
| OWNER month | 20.7 ms | **19.4 ms** (17.1–23.4) | flat (−6%) |
| MANAGER month | 30.4 ms | **30.5 ms** (29.2–34.9) | flat |
| OWNER all | 123.3 ms | **33.2 ms** (29.4–34.2) | **−73%** |

Response payload is unchanged: 916 B (owner month), 900 B (manager month).

Monthly dashboards do not improve because their deal set is already tiny (126 / 81 rows, 5–8 ms) and the request is dominated by the other 15 queries and their queueing. The gain is concentrated in the all-time chart, which previously had to move the whole deal table.

---

## 3. Exact correctness verification

Live API vs an independent re-implementation of the *previous* JS logic, all five periods × both roles (script deleted afterwards):

| Period | OWNER count / total / commission | MANAGER A count / total / commission | Buckets |
|---|---|---|---|
| today | 0 / 0 / 0 | 0 / 0 / 0 | exact (24) |
| week | 42 / 4,200,000 / 42,000 | 27 / 2,700,000 / 27,000 | exact (7) |
| month | 126 / 12,600,000 / 126,000 | 81 / 8,100,000 / 81,000 | exact (30) |
| last_month | 434 / 43,400,000 / 434,000 | 278 / 27,800,000 / 278,000 | exact (31) |
| all | 5,000 / 500,000,000 / 5,000,000 | 3,124 / 312,400,000 / 3,124,000 | exact (13) |

- `ALL_OK=true`: counts, totals, commissions, averages, charts and leader values all matched for every combination.
- Exact cent arithmetic matched the decimal sums, not just `Number()` equality.
- 3,124 deals for the manager and 5,000 for the owner: well above the 1,000-deal requirement.
- Manager totals remain isolated (3,124 vs 5,000), and the retest security checks still return `404` for other teams and OWNER-direct personal data (`managerA_teamB=404`, `managerA_managerBPersonal=404`, `employee0_teamB=404`, no phone leaks).

Focused tests (`arkan_crm_api_test`): `manager-dashboard`, `manager-dashboard-periods`, `manager-dashboard-format` → **3 suites / 10 tests passed**. Backend typecheck and targeted ESLint clean.

---

## 4. Prisma queue diagnostics

Temporary, env-gated instrumentation only (no SQL text and no parameters logged):

- `DASHBOARD_TIMING`: server-side time until the 16-query `Promise.all` settles vs total service time.
- `PRISMA_TIMING`: prisma query durations aggregated every 2 s (count, sum, p50, p95, max).
- PostgreSQL `pg_stat_activity` sampling every 200 ms (connections, active/idle, waits, oldest active query).
- Node event-loop histogram injected through the inspector.

All instrumentation was removed afterwards and `prisma.service.ts` was restored byte-for-byte (`git diff` empty).

### What the numbers say

| Measurement | Result |
|---|---|
| Prisma query duration under load | p50 **2–3 ms**, p95 **26–34 ms**, max **72–129 ms** |
| PostgreSQL connections | avg 8.7, max 10 (app pool), never above 10 |
| Active DB sessions | avg 1.47, max 9 during the 100-user run; idle avg 7.06 |
| Wait events | only `Client` (idle) and none — no lock/IO waits |
| Oldest active query | ≤ 0.169 s |
| Dashboard server-side DB wait (50-user mix) | p50 **347 ms**, p95 **750 ms** |
| Dashboard server-side DB wait (100-user keep-alive) | p50 **416 ms**, p95 **617 ms** |
| Application time after the DB wait | p50 **0–1 ms** |
| Event loop (50 users) | p50 21 ms, p95 42 ms, p99 108 ms, max 185 ms |

**Conclusion:** SQL execution is not the bottleneck. The dashboard's entire server-side time is spent waiting for its query fan-out to settle; the JS work afterwards is ~1 ms. The DB is mostly idle, with short queries.

### Dashboard-only burst (clean isolation)

Server-side DB wait per request, median, by number of concurrent dashboard requests:

| Concurrent dashboards | 1 | 5 | 10 | 20 | 30 |
|---|---:|---:|---:|---:|---:|
| OWNER month | 14 ms | 32 ms | 55 ms | 101 ms | 230 ms |
| MANAGER month | 30 ms | 107 ms | 145 ms | 141 ms | 276 ms |

During the same bursts, individual query duration stayed p50 5–8 ms (avg 8–10.5 ms). The wait grows with concurrency even though each SQL statement is fast: 30 dashboards × 16 queries = 480 statements competing for the **10-connection Prisma pool**, which matches the observed ~230–354 ms.

So the remaining "Prisma wait" is **confirmed but is queueing at the client pool created by the 16-query fan-out**, not PostgreSQL execution, locks, or DB CPU. The database never exceeds the pool size, and query execution accounts for only ~6 ms per statement.

---

## 5. Concurrency results

| Level | Previous phase | This run |
|---:|---|---|
| 10 | 78.97 RPS, P50 409.2 / P95 492.3 ms, 0% | **73.36 RPS, P50 403.8 / P95 468.3 ms, 0%** |
| 50 | 80.05 RPS, P50 2,082 / P95 2,420 ms, 0.5% | **67.9–69.4 RPS, P50 2,460 / P95 2,798–2,871 ms, 0%** |
| 100 keep-alive | 77.05 RPS, P50 3,082 / P95 5,073 ms, 0 errors | **84.59 RPS, P50 2,857 / P95 4,625 ms, 0 errors** |

- 100-user keep-alive: max DB connections 11 (10 app + sampler), `/health` max 191.3 ms on a separate connection, backend RSS 164 MB → 275 MB, PostgreSQL 293 MB → 346 MB.
- No HTTP 5xx, no timeouts, no 401/403 loops.
- The 50-user mix regressed relative to the previous report **while the host had only 1.8–2.9 GB free RAM instead of ~4.1 GB**, and the slowest endpoints were again `/follow-ups?limit=50` (≈2.8 s) and `/employees?limit=50` — none of which this change touches. The 10-user result is flat and the 100-user keep-alive improved, so this is environment variance, not a dashboard regression.
- Integrity guards unchanged: 23,750 follow-up subjects before/after, 0 duplicate target keys.

---

## 6. Remaining bottlenecks (measured, ranked)

1. **`/follow-ups?limit=50` and `/employees?limit=50[&sort=clientsCount]`** — slowest in every mixed run (2.8–2.9 s at 50 users). `pg_stat_activity` shows heavy `DISTINCT`/`OR`-join queries (client counts by employee, assigned-property counts) that dominate the pool.
2. **Dashboard fan-out vs 10-connection pool** — 16 statements per request; the burst curve above shows wait proportional to concurrency. SQL itself is 2–8 ms.
3. **Remaining heavy scans inside those 16** — 3 leader aggregates over 15k clients / 15k properties / 5k deals plus `client.count` / `property.groupBy(status)`.
4. **All-time request still computes a full-year month chart** — now from 13 rows instead of 5,000, so no longer material.
5. **JSON/Prisma processing** — ~1 ms of dashboard service time; not a bottleneck.

---

## 7. Recommendation for the next measured fix

**Next target: the employees list (especially `sort=clientsCount`) and the follow-ups list**, because they are the measured slowest endpoints and the main pool consumers during the mixed workload. Optimize their per-row/DISTINCT aggregations before touching the dashboard again.

For the dashboard, if another step is needed, the only measured lever left is reducing the fan-out (16 → ~10) by merging the six single-row counts into one `SELECT` with scalar subqueries, validated with the 30-concurrent dashboard burst. Do **not** merge queries with `UNION ALL` (previous phase: 100-user keep-alive fell from 77 to 43 RPS) and do **not** raise the Prisma pool size without a new measurement (the previous phase showed no gain).

---

## 8. Artifacts

- Production change: `apps/backend/src/dashboard/dashboard.service.ts`
- Temporary diagnostics (removed): `prisma.service.ts` timing hooks, `tmp-pg-sampler.cjs`, `tmp-dashboard-burst.cjs`, `tmp-deal-correctness.cjs`
- New measurement script: `scripts/load-test/profile-deal-aggregation.cjs`
- Reused: `measure-single-endpoints.cjs`, `retest-concurrency.cjs` (now accepts `LOAD_LEVELS`), `keepalive-compare.cjs`, `profile-backend.cjs` (now accepts `PROFILE_LEVEL`)
- Focused commands: backend typecheck, targeted ESLint, dashboard tests against `arkan_crm_api_test`, `npm run build -w @arkan/backend`, isolated backend on **4101** (Stage C DB, legacy cookies, relaxed limits)
- Environment: 4101 stopped; 4001 health 200; `arkan_crm` untouched (23 applied migrations, no migration run); load DB 50 MB; no commits or pushes.
