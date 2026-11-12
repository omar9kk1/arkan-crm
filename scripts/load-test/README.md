# Load-test scripts

These scripts target a **disposable** PostgreSQL database named
`arkan_crm_load_test` and a loopback test backend. They deliberately have no
usable database/API defaults: every run must provide explicit environment
variables.

## Required environment

```powershell
$env:LOAD_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:5433/arkan_crm_load_test?schema=public'
$env:LOAD_API_URL = 'http://127.0.0.1:4101'
$env:LOAD_TEST_PASSWORD = '<generated-account-password>'
```

- `LOAD_DATABASE_URL` must use `postgresql://` and its database name must be
  exactly `arkan_crm_load_test`. Any other name is rejected before connecting.
- Every database script re-checks `SELECT current_database()` and aborts on a
  mismatch, before any write.
- `LOAD_API_URL` must be loopback and must not use port `4001` (the real
  development API).
- `LOAD_TEST_PASSWORD` is the password assigned to generated load-test accounts.

Optional: `LOAD_STATE_FILE`, `LOAD_BACKEND_PID_FILE`, `LOAD_STAGE`.
See `.env.example` for placeholders (never put real secrets in it).

## Order

1. Create/migrate the disposable `arkan_crm_load_test` database.
2. Run `node scripts/load-test/generate.cjs A` to seed it.
3. Start a test backend on `LOAD_API_URL` against that database.
4. Run `node scripts/load-test/verify.cjs`, then the measurement/profile
   scripts.

The scripts never fall back to `arkan_crm` or `arkan_crm_api_test`.
