-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROPERTY_PRIORITY_EXPIRED';

-- DropIndex
DROP INDEX "Property_reference_idx";

-- CreateIndex
CREATE INDEX "Property_reference_idx" ON "Property"("reference" text_pattern_ops);
