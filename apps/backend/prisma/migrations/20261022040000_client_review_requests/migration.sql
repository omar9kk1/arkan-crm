-- Client review workflow (employee submissions awaiting manager approval).
-- ADDITIVE ONLY: one new table (+ its indexes), one nullable link column on
-- `Notification`, and appended `NotificationType` values. Rollback = drop the
-- table and the column — approved client rows and every relationship are
-- untouched by this migration.

-- The two review kinds (created before the table that uses it).
CREATE TYPE "ClientReviewKind" AS ENUM ('CREATION', 'EDIT');

CREATE TABLE "ClientReviewRequest" (
    "id" UUID NOT NULL,
    "kind" "ClientReviewKind" NOT NULL,
    "clientId" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    -- The proposed data, stored opaquely (decoded only by the review service).
    "payload" JSONB NOT NULL,
    -- EDIT only: snapshot of the approved client at submission time, compared
    -- against the live row inside the approval transaction (stale → safe 409).
    "base" JSONB,
    -- Requester-scoped idempotency key of a wizard session (see index below).
    "idempotencyKey" UUID,
    "requestedById" UUID NOT NULL,
    "reviewedById" UUID,
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "ClientReviewRequest_pkey" PRIMARY KEY ("id")
);

-- Requester-scoped idempotency: a repeated accidental submission with the same
-- key resolves to the same review. Scoped to the requester so two employees'
-- key namespaces can never collide or expose one another.
CREATE UNIQUE INDEX "client_review_idempotency_per_requester"
    ON "ClientReviewRequest"("requestedById", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL;

-- At most ONE ACTIVE review per client: PENDING or CHANGES_REQUESTED EDIT
-- reviews reserve the client until resolved. Approved/rejected history never
-- blocks a new review. Enforced in SQL (partial), like
-- `PropertyRevision_one_pending_per_property`.
CREATE UNIQUE INDEX "client_review_active_edit_per_client"
    ON "ClientReviewRequest"("clientId")
    WHERE "kind" = 'EDIT'
      AND "clientId" IS NOT NULL
      AND "status" IN ('PENDING', 'CHANGES_REQUESTED');

-- Deliberately NO uniqueness on ("requestedById", kind='CREATION' active): one
-- employee may submit several different new clients concurrently.

ALTER TABLE "ClientReviewRequest"
    ADD CONSTRAINT "ClientReviewRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReviewRequest"
    ADD CONSTRAINT "ClientReviewRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientReviewRequest"
    ADD CONSTRAINT "ClientReviewRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ClientReviewRequest_status_createdAt_idx" ON "ClientReviewRequest"("status", "createdAt");
CREATE INDEX "ClientReviewRequest_requestedById_idx" ON "ClientReviewRequest"("requestedById");
CREATE INDEX "ClientReviewRequest_clientId_idx" ON "ClientReviewRequest"("clientId");

-- Review notification deep-link column (additive, nullable).
ALTER TABLE "Notification" ADD COLUMN "clientReviewId" UUID;
ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_clientReviewId_fkey" FOREIGN KEY ("clientReviewId") REFERENCES "ClientReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Appended enum values for the notification types (same appends-only
-- convention as the earlier notification-record-events migration).

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_REVIEW_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_REVIEW_RESUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_REVIEW_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_REVIEW_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_REVIEW_CHANGES_REQUESTED';
