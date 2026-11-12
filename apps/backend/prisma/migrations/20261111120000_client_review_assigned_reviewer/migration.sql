-- Persist the reviewer who owns each client review request.
--
-- NULL means the OWNER review pool (employee reports directly to OWNER).
-- Pending rows are backfilled from the employee's CURRENT active direct
-- supervisor; completed rows keep the user who actually decided them.
-- Ambiguous legacy states abort the migration instead of inventing an owner.

ALTER TABLE "ClientReviewRequest" ADD COLUMN "assignedReviewerId" UUID;
ALTER TABLE "ClientReviewRequest"
  ADD CONSTRAINT "ClientReviewRequest_assignedReviewerId_fkey"
  FOREIGN KEY ("assignedReviewerId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ClientReviewRequest_assignedReviewerId_status_idx"
  ON "ClientReviewRequest"("assignedReviewerId", "status");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ClientReviewRequest"
    WHERE status <> 'PENDING'
      AND "reviewedById" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot backfill client review ownership: a completed review has no reviewedById.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ClientReviewRequest" cr
    JOIN "User" requester ON requester.id = cr."requestedById"
    LEFT JOIN "EmployeeProfile" profile ON profile."userId" = requester.id
    LEFT JOIN "User" manager ON manager.id = profile."managerUserId"
    WHERE cr.status = 'PENDING'
      AND requester.role = 'EMPLOYEE'
      AND profile."managerUserId" IS NOT NULL
      AND (
        manager.id IS NULL
        OR manager.role <> 'MANAGER'
        OR manager."isActive" = false
      )
  ) THEN
    RAISE EXCEPTION 'Cannot backfill client review ownership: a pending review has an inactive/invalid manager assignment.';
  END IF;
END $$;

UPDATE "ClientReviewRequest" cr
SET "assignedReviewerId" = CASE
  WHEN cr.status = 'PENDING' THEN (
    SELECT CASE
      WHEN requester.role IN ('MANAGER', 'OWNER') THEN NULL
      WHEN profile."managerUserId" IS NULL THEN NULL
      ELSE profile."managerUserId"
    END
    FROM "User" requester
    LEFT JOIN "EmployeeProfile" profile ON profile."userId" = requester.id
    WHERE requester.id = cr."requestedById"
  )
  ELSE cr."reviewedById"
END;
