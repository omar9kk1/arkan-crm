-- Arkan CRM — Web Push Phase 2 (ADDITIVE / NON-DESTRUCTIVE).
--
-- Two additive changes, nothing else:
--   1. "RefreshToken"."lineageId" — a NULLABLE column that identifies the
--      stable login family of a device across refresh-token rotations. It is
--      NULL for every pre-existing session: those sessions keep working exactly
--      as before and are simply not eligible for Web Push until a new login.
--   2. "PushSubscription" — a new table holding one row per browser
--      subscription, bound to its owner (User.id) and to the verified session
--      lineage. The endpoint is unique, so a shared browser can never keep a
--      subscription of a previous account.
--
-- No column is dropped or renamed, no row is deleted, no data is transformed:
-- every existing session and every existing notification stays byte-identical.

ALTER TABLE "RefreshToken" ADD COLUMN "lineageId" UUID;

CREATE INDEX "RefreshToken_lineageId_idx" ON "RefreshToken"("lineageId");

CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lineageId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

CREATE INDEX "PushSubscription_userId_lineageId_idx" ON "PushSubscription"("userId", "lineageId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
