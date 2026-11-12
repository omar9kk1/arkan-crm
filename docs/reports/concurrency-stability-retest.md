# Focused Concurrency & Stability Retest

**Date:** 2026-11-09  
**Scope:** Stage C dataset, API-only re-test after follow-up sync optimization.  
**Verdict:** 10 users GO, 50 users GO with latency caveat, 100 users **NO-GO** until the remaining CPU-heavy endpoints/transport behavior are addressed.

---

## 1. Database and environment isolation

- Target: **`arkan_crm_load_test`** on localhost:5433 only.
- Verified with `current_database()`: **`arkan_crm_load_test`**.
- Stage C dataset retained unchanged:
  - 5,021 users
  - 5,000 employees
  - 15,000 clients
  - 15,000 properties
  - 23,750 follow-up subjects
  - DB size **50 MB**
- No seed, truncate, reset or dataset regeneration.
- Follow-up subjects before/after: **23,750 → 23,750**.
- Duplicate `targetKey` rows: **0 → 0**.
- Real `arkan_crm` untouched: **23 migrations**.
- Separate backend on **port 4101**; stopped after the test.
- Development backend on **4001** remained running and healthy; it was not used for load traffic.

**Environment:** 8 logical CPUs, 15.9 GB RAM (2.4 GB free before test), D: 582 GB free, C: 2.1 GB free, PostgreSQL container limit 7.7 GB. The normal dev backend was running during this retest, unlike the original stress run; this can only make absolute numbers slightly worse.

---

## 2. Cold vs warm follow-up first page

| Measurement | Result |
|---|---:|
| Cold first page after process start | **115.6 ms** |
| Warm repeated first page P50 | **35.7 ms** |
| Warm repeated first page P95 | **50.3 ms** |
| Response size | 31 KB |

- The cold request still performs the first full synchronization; the low 115.6 ms here reflects a warm PostgreSQL/page cache. A previous cold run measured **1,457 ms**, so cold-start remains variable and is not eliminated.
- Warm requests no longer rerun the full canonical scan. Prior optimized measurement: **38.1 / 48.0 ms**.

---

## 3. Before/after full request mix

Same mix as the original Stage C test: 4 requests per virtual user across owner, manager and employee paths.

| Level | Baseline (old sync) | After sync optimization | Change |
|---|---:|---:|---|
| 10 users | 13.12 RPS, P50 1,185.2 ms, P95 3,027.9 ms, 0% errors | **23.08 RPS, P50 668.0 ms, P95 1,528.5 ms, 0%** | P50 −44%, P95 −50%, RPS +76% |
| 50 users | 14.28 RPS, P50 5,833.7 ms, P95 13,948.9 ms, 5% (10 ECONNRESET) | **29.50 RPS, P50 3,331.1 ms, P95 6,403.5 ms, 0.5%** | P50 −43%, P95 −54%, RPS +107%, errors 5% → 0.5% |
| 100 users | Not run in baseline | **26.89 RPS, P50 7,319.3 ms, P95 14,105.6 ms, 3.75%** | New level; not healthy |

HTTP status distribution:

- 10 users: **200 = 40/40**
- 50 users: **200 = 199/200**, status 0 = 1 (ECONNRESET)
- 100 users: **200 = 385/400**, status 0 = 15 (ECONNRESET)

No HTTP 4xx/5xx and no explicit timeouts were observed. Status 0 is a client-side `fetch failed (ECONNRESET)`, not an HTTP error.

---

## 4. Resource observations

| Level | Backend CPU Δ | Backend memory | PostgreSQL CPU / memory | Free RAM after |
|---|---:|---:|---|---:|
| 10 | +4.6 s | 180 → 230 MB | 0.00% → 1.92% / 306 → 375 MB | 2,554 MB |
| 50 | +21.0 s | 230 → 429 MB | 0.10% → 0.05% / 375 → 478 MB | 2,245 MB |
| 100 | +41.2 s | 429 → 510 MB | 0.03% → 0.00% / 478 → 513 MB | 2,113 MB |

- Resource guards did not trigger (RAM stayed above 500 MB).
- PostgreSQL CPU remained low; backend CPU and application-side work dominate.
- Backend CPU figures are cumulative process CPU seconds sampled before/after each level, not peak telemetry.

### Slowest endpoints

The follow-up first page is no longer the dominant endpoint. Slowest paths were:

- `/employees?limit=50&sort=clientsCount` — **6.7 s at 50 users**, **14.7 s at 100 users**
- `/employees?limit=50` — **6.6 s at 50**, **14.6 s at 100**
- `/follow-ups/manager/overview?limit=50` — **1.5 s at 10 users**; remains expensive at higher levels

This points to employee directory global sorting/listing and manager overview enrichment as the remaining application bottlenecks.

---

## 5. Security regression (real synthetic JWTs)

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

The cross-team history fix remains effective. No roles or assignments were modified.

---

## 6. Confirmed bottlenecks vs hypotheses

### Confirmed
- Follow-up sync optimization removed the first-page sync bottleneck: warm P50 **35.7 ms**, warm P95 **50.3 ms**.
- Employee directory global sorting/listing and manager overview are now the slowest paths.
- Database CPU is low while backend CPU and memory rise with concurrency; the bottleneck is application-side, not PostgreSQL CPU.
- 100-user level produced **15/400 transport resets**; no HTTP 5xx. The server successfully served 385 requests.

### Not yet proven
- Whether ECONNRESET is driven primarily by Node HTTP client connection reuse (`fetch`/undici), backend event-loop saturation, Prisma pool exhaustion, or Windows socket behavior.
- Whether 100-user stability improves with keep-alive tuning alone or requires endpoint optimization/horizontal scaling.
- No browser, upload, Web Push or mutation-path concurrency was tested.

---

## 7. GO / NO-GO

- **10 concurrent users: GO.**
- **50 concurrent users: GO with caution.** No HTTP errors, 0.5% ECONNRESET, but P95 **6.4 s** is still high for interactive use.
- **100 concurrent users: NO-GO.** P95 **14.1 s** and 3.75% ECONNRESET are not acceptable without further tuning.

---

## 8. Top 3 recommended next fixes

1. **Employee directory global sorting/listing**: precompute/cache employee metrics (clients/properties/deals) or replace repeated correlated aggregates with a set-based/materialized summary. This is now the #1 slow endpoint.
2. **Manager overview first-page enrichment**: reduce the full-scope employee filter/summary payload (227 KB) and compute less on every first page; load employee filters separately/on demand.
3. **Concurrency/transport hardening**: test with a keep-alive HTTP client, expose Prisma pool/event-loop metrics, and tune server/pool timeouts before re-testing 100 users. Do not attribute the resets to Node/PostgreSQL without those measurements.

---

## 9. Safety

- No application code, migrations, `.env`, UI or real business data changed.
- No commits or pushes.
- `arkan_crm_load_test` retained for investigation (50 MB).
- Load backend stopped; development backend on 4001 remains healthy.

**Stopped for manual review.**
