# 01 - Final Technology Stack Decision

## Final Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + React + TypeScript |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Background Jobs | Redis + BullMQ |
| File Storage | S3-Compatible Storage |
| Authentication | JWT + Refresh Tokens |
| Smart Paste | AI Parser Service |
| Deployment | Docker |

## Final Decision

ننفذ المشروع كـ Frontend منفصل + Backend منفصل:

```text
Frontend: Next.js + React + TypeScript
Backend: NestJS + TypeScript
Database: PostgreSQL
ORM: Prisma
Queue/Jobs: Redis + BullMQ
Storage: S3-compatible Storage
Auth: JWT + Refresh Tokens
Deployment: Docker
Smart Paste: AI Parser Service
```

## Architecture Rule

- Next.js للواجهة فقط.
- NestJS للـ API والـ Business Logic.
- PostgreSQL + Prisma للبيانات.
- Redis + BullMQ للإشعارات والمهام اليومية.
- S3-compatible Storage للصور والملفات.
- Docker للتشغيل والنشر المحلي ثم الإنتاج.
