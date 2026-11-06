-- DropIndex
DROP INDEX "Property_reference_pattern_idx";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "requestData" TEXT;

-- AlterTable
ALTER TABLE "PropertyCodeSequence" ALTER COLUMN "value" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "Property_reference_idx" ON "Property"("reference" text_pattern_ops);
