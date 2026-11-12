# Backend Event-Loop & CPU Bottleneck Optimization

**Date:** 2026-11-09  
**Scope:** Manager dashboard query/scoping overhead under the Stage C mixed workload.  
**Verdict:** 10 users GO, 50 users GO with caution, **100 users still NO-GO** (latency, not HTTP failures).

---

## 1. Profiling evidence

### CPU profile (100-user keep-alive, before fix)

- Total profile time was ~48–50% **idle**; the server was not CPU-saturated on the event loop.
- Prisma client runtime/serialization dominated CPU:
  - `parseEngineResponse` ~5.2%
  - Prisma runtime helpers ~15–20% combined
  - `managerDashboard` ~1.3%
  - JSON `stringify` ~0.8%
  - GC ~2.4%

### Event-loop delay (before fix)

Measured inside the backend with `monitorEventLoopDelay` during 100-user keep-alive:

| Metric | Delay |
|---|---:|
| p50 | 21.0 ms |
| p95 | 58.2 ms |
| p99 | 168.2 ms |
| max | 275.0 ms |

**Correction to the previous report:** the `/health` 6.7 s observation was **not** server event-loop delay. The health probe shared the keep-alive HTTP agent with the load generator, so it queued behind outstanding client requests. Direct in-process event-loop delay never exceeded **275 ms**.

### Single-endpoint profile (before fix)

| Endpoint | P50 |
|---|---:|
| Dashboard — MANAGER, month | **228.3 ms** |
| Dashboard — OWNER, month | 134.0 ms |
| Dashboard — OWNER, all | 199.1 ms |
| Follow-ups | 32.7 ms |
| Manager overview | 39.6 ms |
| Employee sort | 55.1 ms |
| Clients | 33.3 ms |
| Properties | 21.9 ms |

Dashboard was the only endpoint materially slower than the rest, and 60 dashboard calls occur in the 100-user mix (20 owner + 40 manager).

### Confirmed dashboard root cause

For every manager dashboard request, `managerDashboard` called:

- `teamEmployeeUserIds()` → ~2,750 team user IDs.
- `teamEmployeeProfileIds()` → ~2,750 team profile IDs.

Both arrays were then used only as `IN` lists for 6 queries, and another `employees.findMany` loaded all active employees for leader-name maps. This added two full team scans/materializations per request on top of an already 16-query dashboard.

### Pool hypothesis rejected as primary

Tested `connection_limit=30` with the same workload:

- Pool 30: P50 **5,037 ms**, P95 **8,032 ms**, max DB connections **31**.
- Default pool: P50 **4,032 ms**, P95 **6,548 ms** after the fix.

Increasing the pool did **not** improve latency. PostgreSQL CPU stayed low. The bottleneck was query work/application serialization, not missing database connections.

---

## 2. Change

**File:** `apps/backend/src/dashboard/dashboard.service.ts`

Replaced manager team-array materialization with **relation predicates inside the queries**:

- `employeeScope`: `{ employee: { managerUserId: viewer.id } }`.
- `lateFollowUps`: `responsible: { managerUserId: viewer.id }` or `responsibleUserId: viewer.id`.
- `completedFollowUps`: `author: { managerUserId: viewer.id }` or `authorUserId: viewer.id`.
- `deals`: `propertyEmployee: { managerUserId: viewer.id }` or `clientEmployee: { managerUserId: viewer.id }`.
- `clientGroups`: `responsibleEmployee: { managerUserId: viewer.id }`.
- `propertyGroups`: active employee relation (`role=EMPLOYEE`, `isActive=true`, team scope).
- `auditLog`: actor employee team relation or `actorId = viewer.id`.

Removed:
- `teamEmployeeUserIds` / `teamEmployeeProfileIds` calls and imports.
- The `scopedUserIds` / `scopedProfileIds` / `profileFilter` arrays.

No response shape, counts, permissions or business rules changed.

---

## 3. Before/after measurements

### Single endpoint

| Endpoint | Before | After |
|---|---:|---:|
| Dashboard — MANAGER, month | **228.3 ms** | **132.9 ms** |
| Dashboard — OWNER, month | 134.0 ms | 138.5 ms |
| Dashboard — OWNER, all | 199.1 ms | 206.9 ms |
| Follow-ups | 32.7 ms | 32.2 ms |
| Manager overview | 39.6 ms | 30.8 ms |

Manager dashboard **−42%**. Owner dashboard was unaffected, as expected; it never loaded team arrays.

### Full mixed workload

| Level | Before | After |
|---|---:|---:|
| 10 | 36.48 RPS, P50 656.1 / P95 1,058.9 ms, 0% | **50.57 RPS, P50 626.7 / P95 726.4 ms, 0%** |
| 50 | 39.37 RPS, P50 3,378.3 / P95 4,763.4 ms, 0.5% | **54.23 RPS, P50 3,268.8 / P95 3,613.6 ms, 0%** |
| 100 (fetch) | 60.62 RPS, P50 3,178.5 / P95 6,026.2 ms, 15.5% | **64.25 RPS, P50 4,504.1 / P95 6,082.1 ms, 2.25%** |

- 100-user fetch errors: **62 → 9** ECONNRESET.
- No HTTP 4xx/5xx or timeouts.
- The 100-user P50 rose because far fewer requests were reset early; successful requests now complete instead of failing fast. It remains high.

### 100-user keep-alive comparison

| Run | RPS | P50 / P95 | Errors |
|---|---:|---:|---:|
| Before fix | 43.48 | 5,581.5 / 8,735.1 ms | 0% |
| After fix | **60.06** | **4,031.7 / 6,547.8 ms** | **0%** |

- P50 **−28%**, P95 **−25%**, RPS **+38%**.
- After-fix event-loop delay: p50 21 ms, p95 36 ms, p99 **110.4 ms**, max **204.3 ms**.
- `/health` max remained ~5.1 s **only because the probe shared the load agent**; direct event-loop evidence shows this is client queueing, not server blockage.
- Backend memory after 100 keep-alive: **~370 MB**; PostgreSQL CPU low.

---

## 4. Correctness and security regression

Focused tests:

```powershell
npm run test -w @arkan/backend -- `
  test/manager-dashboard.spec.ts `
  test/manager-dashboard-periods.spec.ts `
  test/employees-pagination.spec.ts `
  test/followups-pagination.spec.ts `
  test/followup-history-authorization.spec.ts `
  test/followups-supervision-employees.spec.ts `
  test/followups-manager.spec.ts
```

**7 suites / 35 tests passed.**

- Dashboard totals/periods unchanged.
- Employee global sorting/counts unchanged.
- Follow-up pagination >1,000 and supervision summaries unchanged.
- MANAGER/OWNER/EMPLOYEE isolation unchanged.
- Cross-team follow-up history remains **404**; no contact leakage.
- Backend typecheck and targeted ESLint: clean.

---

## 5. Remaining confirmed issues

1. **100-user latency is still too high.**
   - Keep-alive: P95 **6.55 s**.
   - Fetch: P95 **6.08 s** with 2.25% ECONNRESET.
   - This is not an HTTP 5xx problem; it is application/query queueing and serialization.

2. **Dashboard is still the slowest single endpoint.**
   - Owner/month ~139 ms, owner/all ~207 ms, manager/month ~133 ms.
   - It still issues **16 queries** per request; the all-employee leader-name query remains.

3. **Transport resets are reduced but not eliminated** with the original fetch client.
   - Keep-alive client: 0%; fetch: 2.25% at 100.
   - Use keep-alive for fair server-latency tests.

4. **Prisma pool size is not the primary fix.**
   - `connection_limit=30` was slower than default in this workload.

---

## 6. GO / NO-GO

- **10 users: GO.**
- **50 users: GO with caution.** P95 3.61 s and 0% errors; improved but still high for interactive use.
- **100 users: NO-GO.** P95 6.5 s and residual transport resets remain.

---

## 7. Recommended next fixes

1. Reduce dashboard query count further (combine counts/aggregates; avoid loading all active employees just to resolve leader names).
2. Add Prisma query timing/queue instrumentation and profile the remaining 100-user wait; do not tune pool size without evidence.
3. Standardize a keep-alive load client and separately probe `/health` with its own connection so client queueing is not misread as server delay.

---

## 8. Safety

- Only `arkan_crm_load_test` used; retained at 50 MB; no reset/seed/truncate.
- `arkan_crm` untouched (23 migrations).
- No migrations, `.env`, UI, commits or pushes.
- Load backend 4101 stopped; development backend 4001 healthy.

**Stopped for manual review.**
