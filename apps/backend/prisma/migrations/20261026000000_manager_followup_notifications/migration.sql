-- Manager preference: notify managers when employees save new follow-ups (default off).
-- Additive only; no existing rows rewritten, no business data changes.
ALTER TABLE "User" ADD COLUMN "notifyEmployeeFollowUps" BOOLEAN NOT NULL DEFAULT false;
