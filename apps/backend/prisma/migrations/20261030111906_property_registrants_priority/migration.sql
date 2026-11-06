-- DropIndex
DROP INDEX "Property_reference_idx";

-- CreateIndex
CREATE INDEX "Property_reference_idx" ON "Property"("reference" text_pattern_ops);
