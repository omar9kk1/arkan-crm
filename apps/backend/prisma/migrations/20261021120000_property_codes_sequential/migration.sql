-- Arkan CRM — Sequential property codes (A-000001, A-000002, …).
--
-- The owner approved RETIRING every legacy code (the old `AK-<date>-<random>`
-- format) and replacing it with a permanent, sequential one.
--
-- What this migration does:
--   1. creates the atomic counter table behind the new codes;
--   2. renumbers the EXISTING properties deterministically — ordered by
--      ("createdAt", "id") — to A-000001, A-000002, … ;
--   3. seeds the counter with the number of renumbered properties, so the next
--      code can never collide with an existing one;
--   4. adds the indexed prefix lookup for the code.
--
-- SAFETY:
--   * no Property row is deleted or recreated — only the `reference` column is
--     updated, so every id, image, contact, client, interest, approval and
--     revision stays exactly as it is;
--   * the renumbering runs in TWO phases (a temporary unique value first), so
--     the UNIQUE index never sees a transient duplicate;
--   * the order is total and deterministic ("createdAt", "id"), so the same
--     database always produces the same mapping;
--   * historical notification bodies keep their old text (immutable history);
--     the current code is resolved from `Property.id` where it is displayed.
--
-- The legacy codes are retired: there is no alias table and no fallback.

CREATE TABLE "PropertyCodeSequence" (
    "id" INTEGER NOT NULL,
    "value" BIGINT NOT NULL,

    CONSTRAINT "PropertyCodeSequence_pkey" PRIMARY KEY ("id")
);

-- Phase 1: a temporary, unique value for every row (the UNIQUE index stays
-- satisfied while the final codes are assigned).
UPDATE "Property" SET "reference" = 'Z-RETIRED-' || "id"::text;

-- Phase 2: the final sequential codes, ordered by ("createdAt", "id").
UPDATE "Property" p
SET "reference" = 'A-' || lpad(t.rn::text, 6, '0')
FROM (
    SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn
    FROM "Property"
) t
WHERE p."id" = t."id";

-- The counter continues after the renumbered rows: the next code is count + 1.
INSERT INTO "PropertyCodeSequence" ("id", "value")
VALUES (1, (SELECT count(*) FROM "Property"));

-- Indexed prefix lookup for the code (a `LIKE 'A-0001%'` search).
CREATE INDEX "Property_reference_pattern_idx"
    ON "Property" ("reference" text_pattern_ops);
