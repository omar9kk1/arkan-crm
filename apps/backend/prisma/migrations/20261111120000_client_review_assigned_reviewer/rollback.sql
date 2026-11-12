-- EMERGENCY ROLLBACK ONLY — never applied automatically.
--
-- WARNING: dropping assignedReviewerId discards the persisted pending-review
-- ownership and the historical reviewer assignment. Export/audit first, then
-- get explicit approval. Prefer a forward fix.

DROP INDEX "ClientReviewRequest_assignedReviewerId_status_idx";
ALTER TABLE "ClientReviewRequest" DROP CONSTRAINT "ClientReviewRequest_assignedReviewerId_fkey";
ALTER TABLE "ClientReviewRequest" DROP COLUMN "assignedReviewerId";
