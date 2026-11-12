# Final Concurrency & Stability Verification

**Date:** 2026-11-09  
**Scope:** Stage C full mixed authenticated workload after employee-directory and manager-supervision optimizations.  
**Verdict:** 10 users GO, 50 users GO with caution, **100 users NO-GO**. No server 5xx were observed; 100-user failures were transport resets plus confirmed server-side latency/event-loop pressure.

---

## 1. Isolation proof

- Target DB verified as **`arkan_crm_load_test`** via `current_database()`.
- Stage C dataset retained, no seed/reset/truncate:
  - 5,021 users
  - 5,000 employees
  - 15,000 clients
  - 15,000 properties
  - 23,750 follow-up subjects
  - DB size **50 MB**
- Follow-up subjects before/after: **23,750 → 23,750**.
- Duplicate `targetKey` rows: **0 → 0**.
- Real `arkan_crm` untouched: **23 migrations**.
- Load backend ran on **4101** and was stopped afterward.
- Development backend on **4001** stayed running and healthy.
- No code, migrations, `.env` or data changes.

**Environment before test:** 8 logical CPUs, 15.9 GB RAM (3.5 GB free), D: 581 GB free, C: 2 GB free, PostgreSQL container limit 7.7 GB.

---

## 2. Completed load levels

Same mixed workload as the previous full test (4 requests per virtual user across OWNER/MANAGER/EMPLOYEE paths), including:
- optimized employee directory listing/sorting;
- optimized manager supervision overview;
- follow-up feed, clients, properties, notifications, dashboard, recommendations.

All levels completed; no resource guard stopped the test. The 100-user level was followed by one bounded keep-alive comparison because the original fetch client produced ECONNRESET.

---

## 3. Before/after full-mix comparison

| Level | Previous full-mix (before employee/supervision optimizations) | Current full-mix | Observation |
|---|---:|---:|---|
| 10 | 23.08 RPS, P50 668.0 / P95 1,528.5 ms, 0% | **36.48 RPS, P50 656.1 / P95 1,058.9 ms, 0%** | P95 −31%, RPS +58% |
| 50 | 29.50 RPS, P50 3,331.1 / P95 6,403.5 ms, 0.5% | **39.37 RPS, P50 3,378.3 / P95 4,763.4 ms, 0.5%** | P95 −26%, RPS +33% |
| 100 | 26.89 RPS, P50 7,319.3 / P95 14,105.6 ms, 3.75% | **60.62 RPS, P50 3,178.5 / P95 6,026.2 ms, 15.5%** | Lower successful latency, but more transport resets; NO-GO |

HTTP status distributions:

- 10 users: **200 = 40/40**
- 50 users: **200 = 199/200**, status 0 = 1 (ECONNRESET)
- 100 users: **200 = 338/400**, status 0 = 62 (ECONNRESET)

No HTTP 4xx/5xx and no timeout errors were observed with the original client.

### Follow-up cold vs warm in this run

- Cold first page: **1,292.9 ms**
- Warm repeated first page: **P50 35.5 / P95 46.2 ms**

The follow-up sync optimization remains effective.

---

## 4. Transport diagnosis: fetch vs keep-alive

One bounded 100-user comparison with a proper keep-alive HTTP agent (`maxSockets=128`, `keepAlive=true`, same 400-request mix):

| Client | Requests | RPS | P50 / P95 | Errors | Status |
|---|---:|---:|---:|---:|---|
| Node `fetch` (default) | 400 | 60.62 | 3,178.5 / 6,026.2 ms | **15.5%** (62 ECONNRESET) | 338 × 200, 62 × status 0 |
| Keep-alive `http.Agent` | 400 | 43.48 | 5,581.5 / 8,735.1 ms | **0%** | 400 × 200 |

Confirmed:
- **ECONNRESET is transport/client-connection related**, not an HTTP server failure. With keep-alive, all 400 requests succeeded.
- Removing resets exposes the real server latency: with keep-alive, P50 **5.6 s**, P95 **8.7 s**.
- During the keep-alive run, a `/health` probe reached **6,719.9 ms**, showing severe event-loop/request-queue delay.
- Max observed PostgreSQL connections from this environment: **10**; PostgreSQL CPU stayed low. Prisma pool saturation is plausible but **not proven as the primary cause**; the backend event-loop delay is directly measured.

---

## 5. Resource usage

| Level | Backend CPU Δ | Backend memory after | PostgreSQL sample |
|---|---:|---:|---|
| 10 | +4.1 s | 266 MB | CPU 5.68% → 60.10% (instant), 326 MB |
| 50 | +14.7 s | 396 MB | CPU 17.26% → 0.02%, 377 MB |
| 100 fetch | +19.9 s | 464 MB | CPU 0.08% → 0.05%, 372 MB |
| 100 keep-alive | +25.6 s | 441 MB | CPU 0.24% → 0.00%, 388 MB |

- Free RAM after 100 keep-alive: **2,993 MB**.
- Backend CPU/memory rose with concurrency; PostgreSQL CPU remained low.
- Slowest endpoints at 50 users: dashboard month ~5.0 s, follow-ups ~4.97 s, employee listing/sort ~4.97 s.
- Slowest at 100 fetch: dashboard ~6.44 s, employee listing ~6.38 s, follow-ups ~6.38 s.

---

## 6. Security regression

All checks passed with real synthetic JWTs:

| Check | Result |
|---|---:|
| MANAGER A → Team B employee history | **404** |
| MANAGER A → Manager B personal history | **404** |
| MANAGER A → own team history | **200** |
| OWNER → Team B history | **200** |
| OWNER → Manager B personal history | **200** |
| EMPLOYEE0 → own history | **200** |
| EMPLOYEE0 → Team B history | **404** |
| Unauthorized response contains client phone | **No** |
| Unauthorized response contains contact phone | **No** |

No roles or team assignments were modified.

---

## 7. Confirmed remaining issues

1. **100-user concurrency is not stable.**
   - Original client: 15.5% ECONNRESET.
   - Keep-alive client: 0% transport errors but P95 **8.7 s** and `/health` up to **6.7 s**.
   - This is both a client connection-reuse problem and a real server-side event-loop/latency problem.

2. **Dashboard and mixed read endpoints remain slow under heavy concurrency.**
   - Dashboard month ~5.0 s at 50, ~6.4 s at 100.
   - Follow-ups/employee list ~5–6.4 s at 100.
   - PostgreSQL CPU is low; the pressure is in the Node/Prisma/application path.

3. **50-user latency is still high for interactive use.**
   - P95 **4.76 s** with 0.5% resets is improved, but not production-grade.

4. **Prisma pool size observed at 10.**
   - Whether pool queueing is the dominant cause is not proven; keep-alive + event-loop health indicate server-side saturation.

5. No HTTP 5xx, no data corruption, no duplicate subjects, and no authorization regression.

---

## 8. GO / NO-GO

- **10 concurrent users: GO.**
- **50 concurrent users: GO with caution** for local/staging verification, not a production SLO.
- **100 concurrent users: NO-GO.** Do not claim 100-user readiness until event-loop latency and transport behavior are improved and retested.

---

## 9. Recommended next fixes (testing-only task; none implemented)

1. **Instrument and reduce event-loop blocking** in the mixed read path, especially `dashboard/manager`, `follow-ups`, and employee listing; profile CPU/JSON serialization and Prisma query queueing.
2. **Tune HTTP/Prisma pooling and keep-alive**: document/configure Prisma pool size, server keep-alive/timeouts, and use a keep-alive load client for future tests. Retest 100 users after measuring event-loop delay.
3. **Add bounded caching/precomputation** for dashboard period aggregates and any remaining full-scope statistics, with explicit invalidation, rather than recomputing on every concurrent request.

---

## 10. Safety

- `arkan_crm_load_test` only; no seed/reset/truncate; retained at 50 MB.
- `arkan_crm` untouched (23 migrations).
- No code changes, migrations, `.env` changes, commits or pushes.
- 4101 stopped; 4001 healthy.

**Stopped for manual review.**
