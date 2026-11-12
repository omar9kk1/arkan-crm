# Dashboard Query & Aggregation Optimization

**Date:** 2026-11-09
**Scope:** Manager dashboard query work on the Stage C dataset (`arkan_crm_load_test`).
**File changed:** `apps/backend/src/dashboard/dashboard.service.ts` (only).
**Verdict:** 10 users **GO**, 50 users **GO with caution**, 100 users **GO for controlled testing only** (no 5xx/timeouts, but P95 ≈ 4.9–5.1 s is not a production latency guarantee).

**خلاصة عربية:** كان السبب الأكبر هو تحميل كل الموظفين النشطين (4,801 صفًا) في كل طلب dashboard فقط لبناء أسماء المتصدرين. استُبدل ذلك بثلاثة استعلامات تجميع تُرجع صفًا واحدًا لكل بطاقة. عدد الاستعلامات بقي 16، لكن حجم البيانات المنقولة داخليًا انخفض من ~5,113 صفًا إلى 3 صفوف. زمن OWNER/شهر انخفض من 138.5ms إلى 20.7ms، وMANAGER/شهر من 132.9ms إلى 30.4ms، وOWNER/all من 206.9ms إلى 123.3ms. الأرقام والصلاحيات لم تتغير.

---

## 1. Baseline profile (before any change)

Measured read-only against `arkan_crm_load_test` (Stage C: 5,021 users / 5,000 employees / 15,000 clients / 15,000 properties / 5,000 deals), three iterations per query, median:

### OWNER, month — `SEQ_SUM = 190.65 ms`

| Query | ms | Rows returned |
|---|---:|---:|
| **user.findMany(active employees) + employee profile select** | **144.11** | **4,801** |
| property.groupBy(status) | 7.04 | 6 |
| property.groupBy(period/creator) | 5.53 | 151 |
| deal.findMany(period) | 5.00 | 126 |
| followUpSubject.count(late) | 4.24 | 1 |
| client.groupBy(period/responsible) | 3.64 | 161 |
| user.count(employees) | 3.29 | 1 |
| user.count(active) | 3.03 | 1 |
| property.count(trash) | 2.42 | 1 |
| client.count(total) | 2.40 | 1 |
| contact.count(owners) | 2.30 | 1 |
| other single-row counts / recent activity | ≤1.81 | ≤1 |

### MANAGER A, month — `SEQ_SUM = 208.68 ms`

| Query | ms | Rows returned |
|---|---:|---:|
| **user.findMany(active employees) + employee profile select** | **111.39** | **2,641** |
| client.count(total) | 16.61 | 1 |
| property.groupBy(status) | 13.81 | 6 |
| followUpSubject.count(late) | 8.90 | 1 |
| property.groupBy(period/creator) | 8.07 | 82 |
| client.groupBy(period/responsible) | 6.52 | 89 |
| contact.count(owners) | 6.01 | 1 |
| property.count(trash) | 5.73 | 1 |
| deal.findMany(period) | 5.71 | 81 |
| user.count(employees) | 4.99 | 1 |
| user.count(active) | 4.96 | 1 |
| other single-row counts / recent activity | ≤4.75 | ≤1 |

**Root cause:** the dashboard loaded every active employee (`id`, `name`, `employee.id`) on each request only to translate leader `employeeProfileId` / `userId` keys into display names, and it also materialised `client.groupBy` and `property.groupBy` result sets for the same maps. That was **76%** of OWNER and **53%** of MANAGER query work, plus thousands of rows parsed, joined and garbage-collected — to produce three names/counts in a ~0.9 KB response.

Starting-point API latency (from the previous phase, same workload): OWNER month **138.5 ms**, MANAGER month **132.9 ms**, OWNER all **206.9 ms** P50.

---

## 2. Change

`apps/backend/src/dashboard/dashboard.service.ts`:

1. **Removed** `user.findMany` over all active employees and the two `groupBy` collections used only for leader maps.
2. **Replaced** them with three `$queryRaw` aggregates that compute `count` and `name` in PostgreSQL and return **one row each** (`ORDER BY count DESC, u.name ASC LIMIT 1`) for clients, properties and deals.
3. Deleted the JS `Map` aggregation, `topEntry()` and the name-resolution join.

Semantics preserved exactly:

- same leader key: clients → `Client.responsibleEmployeeId`; properties → `Property.createdByUserId`; deals → `COALESCE(Deal.propertyEmployeeId, Deal.clientEmployeeId)`;
- same scope filters: `role = 'EMPLOYEE' AND isActive = true`, plus `managerUserId = :managerId` for MANAGER only;
- same period filter (`createdAt` for clients/properties, `closedAt` for deals) and the same Kuwait-timezone window (`periodWindow` is untouched);
- same tie-break (`count DESC`, then `name ASC`).

**Query count: 16 → 16** (unchanged). The win is data volume and allocations, not round trips:

| Per dashboard request | Before | After |
|---|---:|---:|
| Internal rows fetched for leader/name work | 5,113 (OWNER) / 2,812 (MANAGER) | 3 |
| Largest single query | 144.1 ms | ≤16.6 ms |
| Response payload | same contract | 0.9 KB measured (fields unchanged) |

### Experiments that were measured and rejected

| Attempt | Result | Decision |
|---|---|---|
| One `user.findMany` with `OR` over candidate user/profile ID lists | month improved, **all-time regressed to 603.6 ms** (OR + two large `IN` lists) | rejected |
| Split into `employeeProfile.findMany` + `user.findMany` by candidate IDs | all-time still **608.3 ms** (4,720 + 4,601 rows) | rejected |
| Merge the three aggregates into one `UNION ALL` (16 → 14 queries) | 100-user keep-alive **43.35 RPS**, P50 5,347 / P95 9,070 ms (vs 77.05 RPS, 3,082 / 5,073 ms) | **reverted** — keeping the three separate aggregates |
| `connection_limit=30` (previous phase) | no gain; max connections 31 vs 10 with default | rejected |

The three separate single-row aggregates are the final shape.

---

## 3. Correctness verification

One-off read-only script compared live dashboard responses with an independent Prisma computation on Stage C (same scopes/periods computed in JS), then was deleted.

| Metric | Response | Independent computation |
|---|---|---|
| OWNER month — properties / clients / employees | 14,250 / 15,000 / 5,000 | 14,250 / 15,000 / 5,000 |
| OWNER month — leaders (clients / properties / deals) | 9 / 8 / 19 | 9 / 8 / 19 |
| OWNER all — properties / clients / employees | 14,250 / 15,000 / 5,000 | 14,250 / 15,000 / 5,000 |
| OWNER all — leaders | 350 / 209 / 618 | 350 / 209 / 618 |
| MANAGER A month — properties / clients / employees | 7,301 / 7,533 / 2,750 | 7,301 / 7,533 / 2,750 |
| MANAGER A month — leaders | 9 / 8 / 19 | 9 / 8 / 19 |

`ok = true` (all totals, leader names and leader counts matched on month and all-time, for both roles). The dataset is far above the 1,000-employee/deal requirement (5,000 employees, 5,000 deals).

Focused regression (test DB `arkan_crm_api_test`):

```
8 suites passed, 39 tests passed
manager-dashboard, manager-dashboard-periods, manager-dashboard-format,
employees-pagination, followups-pagination, followup-history-authorization,
followups-supervision-employees, followups-manager
```

Backend `typecheck` and ESLint on the changed file: clean.

---

## 4. Security / authorization

| Check | Result |
|---|---|
| OWNER sees company-wide totals | 14,250 properties / 15,000 clients / 5,000 employees |
| MANAGER sees only current team | 7,301 / 7,533 / 2,750 (same numbers as the previous IN-list implementation) |
| OWNER-direct employees excluded from managers | leader SQL requires `e."managerUserId" = :managerId`; `managerUserId IS NULL` never matches |
| Cross-team follow-up history | `followup-history-authorization.spec.ts` passes (404 preserved) |
| Response contract | `manager-dashboard-format.spec.ts` passes; fields unchanged |

No guard, CSRF, cookie, visibility policy or notification code was touched.

---

## 5. Performance results

### Dashboard single endpoint (final build, quiet machine, keep-alive client)

| Endpoint | Before P50 | After P50 / P95 | Change (P50) |
|---|---:|---:|---:|
| OWNER, month | 138.5 ms | **20.7 / 33.0 ms** | **−85%** |
| MANAGER, month | 132.9 ms | **30.4 / 32.7 ms** | **−77%** |
| OWNER, all | 206.9 ms | **123.3 / 126.0 ms** | **−40%** |

Payload: 916 B (owner month), 911 B (owner all), 900 B (manager month) — unchanged contract.

Note: single-endpoint runs taken while other Node/Jest processes were still finishing were 2–3× slower (e.g. manager month 69–83 ms, owner all 252–284 ms). The numbers above are from the final run after the machine was quiet; the variance is measurement noise, not a code path difference.

### Full mixed workload (same keep-alive retest script)

| Users | Before (previous phase) | After |
|---:|---|---|
| 10 | 50.57 RPS, P50 626.7 / P95 726.4 ms, 0% | **78.97 RPS, P50 409.2 / P95 492.3 ms, 0%** |
| 50 | 54.23 RPS, P50 3,268.8 / P95 3,613.6 ms, 0% | **80.05 RPS, P50 2,082.1 / P95 2,420.0 ms, 0.5%** (1 ECONNRESET) |
| 100 | 64.25 RPS, P50 4,504.1 / P95 6,082.1 ms, 2.25% | **79.90 RPS, P50 3,390 / P95 4,858 ms, 0.5%** (2 ECONNRESET) |

No HTTP 5xx, no timeouts, no 401/403 loops. The remaining errors are client-side socket resets at 50/100 users.

### 100-user keep-alive (final)

| Metric | Result |
|---|---|
| RPS | 77.05 |
| P50 / P95 | 3,082 / 5,073 ms |
| Errors | 0 / 400 |
| Max DB connections | 10 |
| `/health` max (separate connection) | 193.7 ms |
| Backend RSS during run | 214.5 MB → 285.7 MB |
| PostgreSQL memory during run | 274 MB → 327 MB |

Event-loop delay during the same final code (100-user profile run): p50 **21.1 ms**, p95 **29.2 ms**, p99 **49.6 ms**, max **217.4 ms**. The earlier 6.7 s `/health` was client-agent queueing, not server delay (see `backend-event-loop-cpu-optimization.md`).

Dashboard improvement vs overall: dashboard P50 dropped 77–85%, while the full mix gained +56% RPS at 10 users and +48% at 50. At 100 users the gain is smaller (+24% RPS, −20% P95) because queueing behind a 10-connection pool dominates.

---

## 6. Remaining bottlenecks (ranked by measured impact)

1. **`/employees?limit=50[&sort=clientsCount]` and `/follow-ups?limit=50`** — single-user P50 48–59 ms, and the slowest requests under 10-user concurrency (492–494 ms). They now dominate the full mix, not the dashboard.
2. **All-time deal aggregation** — `deal.findMany` still returns every closed deal (5,000 rows in Stage C, ~95 ms isolated) and sums `price`/`companyCommission` in JS. This is why OWNER/all stays at 123 ms while month is 21 ms. Month is cheap (126 rows).
3. **Dashboard fan-out** — still 16 parallel queries per request; dashboard is 60 of the 400 mixed requests, so 100 users ≈ 960 queries per batch against a pool that never exceeds 10 connections (Prisma default). Merging queries was measured and was worse, so the next step would be pool/queue tuning, not more SQL merging.
4. **Large counts** — MANAGER `client.count(total)` 16.6 ms and `property.groupBy(status)` 13.8 ms over 7.5k / 14k rows.
5. **Prisma parse + JSON + GC** — ~5% CPU each in the prior CPU profile; unchanged by this task.

---

## 7. GO / NO-GO

| Level | Verdict | Evidence |
|---:|---|---|
| 10 | **GO** | 78.97 RPS, P95 492 ms, 0 errors |
| 50 | **GO with caution** | 80.05 RPS, P95 2.42 s, 1 client reset (0.5%) |
| 100 | **Controlled testing only** | 77–80 RPS, P95 4.86–5.07 s, 0–0.5% client resets, 0 HTTP 5xx |

This is an application-level improvement, not a production latency guarantee. At 100 users the workload is still limited by connection-pool queueing on non-dashboard list endpoints.

---

## 8. Artifacts and commands

- Changed: `apps/backend/src/dashboard/dashboard.service.ts`
- New/updated measurement scripts (untracked, as before): `scripts/load-test/profile-dashboard-queries.cjs`, `measure-single-endpoints.cjs`, `retest-concurrency.cjs`, `keepalive-compare.cjs`, `profile-backend.cjs`
- Verification commands:
  - `npm run typecheck -w @arkan/backend`
  - `npx eslint apps/backend/src/dashboard/dashboard.service.ts`
  - `TEST_DATABASE_URL=…arkan_crm_api_test npm run test -w @arkan/backend -- test/manager-dashboard.spec.ts test/manager-dashboard-periods.spec.ts test/manager-dashboard-format.spec.ts test/employees-pagination.spec.ts test/followups-pagination.spec.ts test/followup-history-authorization.spec.ts test/followups-supervision-employees.spec.ts test/followups-manager.spec.ts`
  - `npm run build -w @arkan/backend` (isolated backend on port 4101, `AUTH_COOKIE_MODE=legacy`, `RATE_LIMIT_*` relaxed, Stage C DB)
- Environment: isolated backend on **4101** stopped after measurement; **4001** health = 200. `arkan_crm` untouched (23 applied migrations, no migration run). Load DB remains 50 MB. No commits or pushes.
