# 05 - Codex First Task

Use this as the first prompt/task for Codex.

```text
Create the initial monorepo structure for Arkan Real Estate CRM.

Stack:
- Frontend: Next.js + React + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Queue/Jobs: Redis + BullMQ
- Storage: S3-compatible Storage
- Auth: JWT + Refresh Tokens
- Deployment: Docker

Requirements:
1. Create a monorepo with:
   - apps/frontend
   - apps/backend
   - packages/shared

2. Backend:
   - NestJS app with health endpoint `/health`.
   - Config module using environment variables.
   - Auth skeleton with JWT access token and refresh token placeholders.
   - Roles: MANAGER, EMPLOYEE.
   - Global validation pipe.
   - Prisma module.
   - Empty domain modules:
     users, employees, clients, owners, properties, deals, commissions,
     payroll, finance, attendance, followups, notifications, files, smart-paste, jobs.

3. Frontend:
   - Next.js app with TypeScript.
   - RTL Arabic layout.
   - Basic routes:
     /login
     /manager
     /employee
   - Do not implement all screens yet.
   - Add placeholder layout components for ManagerLayout and EmployeeLayout.

4. Database:
   - PostgreSQL via docker-compose.
   - Redis via docker-compose.
   - Initial Prisma schema draft for users, employees, clients, owners, properties, deals, commissions, payroll, finance movements, attendance, followups, notifications, audit logs.

5. Docker:
   - docker-compose.yml for frontend, backend, postgres, redis.
   - .env.example for both apps.

6. Quality:
   - TypeScript strict.
   - ESLint/Prettier.
   - No big files.
   - No business logic in controllers.
   - Add README with local setup commands.

Important:
Use the prototype HTML only as UI reference. Do not copy it as one giant component.
Create clean architecture and small components.
```
