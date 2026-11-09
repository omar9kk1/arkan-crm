-- Owner/Manager/Employee hierarchy: session versioning, team assignment and
-- per-Manager review capabilities. Idempotent so it is safe to re-apply in an
-- isolated test database; the Prisma migration table still tracks it normally.

-- 1. Session versioning ------------------------------------------------
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RefreshToken"
  ADD COLUMN IF NOT EXISTS "authVersion" INTEGER NOT NULL DEFAULT 0;

-- Existing rows are version 0, matching every already-valid session.

-- 2. Current Manager assignment on the employee profile -----------------
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "managerUserId" UUID;

CREATE INDEX IF NOT EXISTS "EmployeeProfile_managerUserId_idx"
  ON "EmployeeProfile" ("managerUserId");

DO $$
BEGIN
  ALTER TABLE "EmployeeProfile"
    ADD CONSTRAINT "EmployeeProfile_managerUserId_fkey"
    FOREIGN KEY ("managerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Per-Manager capability model --------------------------------------
DO $$
BEGIN
  CREATE TYPE "ManagerCapabilityType" AS ENUM ('PROPERTY_APPROVE', 'PROPERTY_REJECT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ManagerCapability" (
  "id" UUID NOT NULL,
  "managerUserId" UUID NOT NULL,
  "capability" "ManagerCapabilityType" NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagerCapability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ManagerCapability_managerUserId_capability_key"
  ON "ManagerCapability" ("managerUserId", "capability");

CREATE INDEX IF NOT EXISTS "ManagerCapability_managerUserId_granted_idx"
  ON "ManagerCapability" ("managerUserId", "granted");

DO $$
BEGIN
  ALTER TABLE "ManagerCapability"
    ADD CONSTRAINT "ManagerCapability_managerUserId_fkey"
    FOREIGN KEY ("managerUserId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Default policy: no Manager can approve or reject until the OWNER grants it.
-- No rows are inserted here; absence is the default false state.
