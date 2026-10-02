# Arkan Real Estate CRM

Arabic RTL CRM for real estate managers and employees: properties, owners, clients/requests, follow-ups, deals, finance and attendance.

**Current stage:** real backend authentication and database foundation, with a substantial frontend mock prototype. Most business submissions are local page state, not database records. Reports/marketing are coming soon. Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) before development and [TODO.md](TODO.md) for remaining work.

## Stack and structure

Next.js 16.3.4 / React 19.2.8 / TypeScript 5.9.3 frontend; NestJS 11.2.3 backend; Prisma 6.19.3 / PostgreSQL; Redis / BullMQ. Resolved versions are in package-lock.json.

- apps/frontend: App Router, domain UI/mocks, authentication client and shared components.
- apps/backend: authentication/health infrastructure, business module scaffolds, Prisma schema/migrations.
- packages/shared: API contracts and role types; compiled before applications.
- docs: original scope/architecture decisions and focused implementation notes.
- scripts: standalone draft/NFC logic tests.
- docker: application image recipes. Root Compose currently starts **PostgreSQL and Redis only**.

## Clean-machine local setup

Requires Git/access to the repository, Node.js **>=22** with npm, Docker with Compose, and free ports 3000, 4000, 5432, 6379. Examples use Windows PowerShell and npm.cmd; on Linux/macOS use npm and cp instead.

```powershell
git clone <repository-url> arkan-crm
Set-Location arkan-crm
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/frontend/.env.local.example apps/frontend/.env.local
```

Copy templates only on a clean checkout; do not overwrite an existing environment. Edit backend .env before starting:

- Set NODE_ENV to development, PORT to 4000 and FRONTEND_ORIGIN to http://localhost:3000.
- Configure DATABASE_URL for the local PostgreSQL service, matching the development database initialization settings in docker-compose.yml.
- Set REDIS_HOST to localhost and REDIS_PORT to 6379.
- Replace JWT_ACCESS_SECRET with an independently generated random secret of at least 32 characters. Configure JWT_ISSUER and JWT_AUDIENCE consistently.
- JWT_ACCESS_TTL_SECONDS is optional (default 900). JWT_REFRESH_SECRET in the template is unused by current code.

Generate a fresh local secret with the following command and place its output only in your untracked backend .env. Do not share/commit it:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Frontend .env.local must contain the public API address:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4000
```

Use **.env.local.example**, not frontend .env.example: the latter currently contains a backend-only CORS setting. Never add secrets to NEXT_PUBLIC variables. Full environment requirements are in PROJECT_CONTEXT.md.

Install and prepare services from the repository root:

```powershell
npm.cmd ci
npm.cmd run db:generate
npm.cmd run build -w @arkan/shared
docker compose up -d postgres redis
docker compose ps
docker compose exec postgres pg_isready -U postgres
docker compose exec redis redis-cli ping
```

Wait until PostgreSQL is accepting connections and Redis answers PONG. Then, for this new development database:

```powershell
npm.cmd run db:deploy -w @arkan/backend
npm.cmd run db:seed -w @arkan/backend
npm.cmd run dev
```

The seed creates a manager, an employee and the employee profile. Development-only seed account definitions are in apps/backend/prisma/seed.cjs; credentials are intentionally not reproduced in this guide. Seed is disabled in production and preserves existing account passwords. It is not a password-reset tool.

Open [login](http://localhost:3000/login). Manager accounts go to /manager; employee accounts go to /employee.

The second migration intentionally fails when existing financial rows need a staged backfill. Do not delete data to bypass it. Check the target database before applying migrations/seed.

## Everyday development

Run both applications:

```powershell
npm.cmd run dev
```

Or run these in separate terminals, without also running the combined command:

```powershell
npm.cmd run dev:backend
npm.cmd run dev:frontend
```

Rebuild shared after shared-contract changes:

```powershell
npm.cmd run build -w @arkan/shared
```

- Frontend: http://localhost:3000/login
- Backend liveness: http://localhost:4000/health
- Backend database/queue readiness: http://localhost:4000/health/ready

Backend success responses wrap content in data; errors wrap statusCode/message/path in error. Real endpoints are GET /health, GET /health/ready, POST /auth/login, POST /auth/refresh, POST /auth/logout and GET /auth/me. Business modules do not yet expose APIs.

For another device, use an API address reachable from that browser, configure the actual frontend origin, and review existing development-origin settings in backend main.ts and frontend next.config.ts. Browser storage is separate for localhost and LAN origins. Restart after environment changes; rebuild frontend production assets after public API URL changes.

Stop development processes with Ctrl+C. Stop data services while preserving volumes:

```powershell
docker compose down
```

Do not delete Docker volumes without explicit approval and an appropriate backup.

## Build and production-mode mechanisms

These are existing build/start commands, not a complete production deployment procedure. Configure the intended environments first; NEXT_PUBLIC_API_URL is embedded during frontend build.

```powershell
npm.cmd run db:generate
npm.cmd run build
```

After approved migration deployment to the intended database, start each application in a separate terminal/process with production environment supplied:

```powershell
npm.cmd run start -w @arkan/backend
npm.cmd run start -w @arkan/frontend
```

Backend start runs node dist/main.js; the frontend start script runs next start. The configured frontend build uses standalone output; the frontend Dockerfile supplies its standalone server and required static/public assets. Validate the chosen runtime before deployment rather than assuming the start script proves standalone packaging works. Set NODE_ENV=production in the process environment. Do not run demo seed in production.

Application image recipes can be built from repository root:

```powershell
docker build -f docker/backend.Dockerfile -t arkan-backend .
docker build -f docker/frontend.Dockerfile --build-arg NEXT_PUBLIC_API_URL=<public-api-origin> -t arkan-frontend .
```

Replace angle-bracket placeholders before executing. Frontend image runs standalone output; backend image runs compiled Nest. Neither automatically applies migrations or seeds. Current Compose has no application/migration services, so docker compose up does not start the web applications. Runtime networking, secrets, TLS, backups, hosting and CI/CD remain to be configured/reviewed.

## Tests and quality checks

After dependency installation, Prisma generation and shared build:

```powershell
npm.cmd test
node scripts/test-form-drafts.cjs
node scripts/test-nfc-attendance.cjs
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run db:validate -w @arkan/backend
npm.cmd run format:check
```

Jest uses Prisma/queue test doubles; it does not require a live database and does not verify real database concurrency. Standalone scripts check draft lifecycle and mock NFC logic using local harnesses, not a browser/physical tag. No browser E2E/load or business API suite exists yet.

Handoff verification on 2026-10-02: **3 Jest suites / 12 tests passed**, both standalone scripts passed. This documentation-only task did not run production build, live migrations, Docker image deployment, browser/physical NFC checks or load tests.

## Important limitations

- Most business saves update component state only. Draft autosave is temporary recovery, not final-record persistence or database backup.
- Auth uses sessionStorage and real backend validation; mock NFC uses editable localStorage. Neither is a finished production session/attendance security design.
- CORS includes hardcoded development origins, Compose has development database credentials and exposes PostgreSQL beyond loopback. Review before deployment.
- Frontend exchange/floors/budget bundles outpace the database model; money precision also needs reconciliation.
- Source backup does not include local environment secrets, database contents or browser data.

Preserve the existing architecture/UI; keep mock and real behavior explicit. Never commit secrets, and do not push without the user's request. See PROJECT_CONTEXT.md for security, source references, data flows and deployment unknowns.
