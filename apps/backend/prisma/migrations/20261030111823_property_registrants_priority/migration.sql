-- DropIndex
DROP INDEX "Property_reference_idx";

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "priorityDeadline" TIMESTAMP(3),
ADD COLUMN     "priorityExpiredNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "priorityHolderUserId" UUID,
ADD COLUMN     "priorityLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "PropertyApprovalRequest" ADD COLUMN     "duplicateCandidateIds" JSONB;

-- CreateTable
CREATE TABLE "PropertyRegistrant" (
    "id" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "employeeUserId" UUID NOT NULL,
    "registrationOrder" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyRegistrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "PropertyRegistrant_employeeUserId_idx" ON "PropertyRegistrant"("employeeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PropertyRegistrant_propertyId_employeeUserId_key" ON "PropertyRegistrant"("propertyId", "employeeUserId");

-- CreateIndex
CREATE INDEX "Property_reference_idx" ON "Property"("reference" text_pattern_ops);

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_priorityHolderUserId_fkey" FOREIGN KEY ("priorityHolderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyRegistrant" ADD CONSTRAINT "PropertyRegistrant_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyRegistrant" ADD CONSTRAINT "PropertyRegistrant_employeeUserId_fkey" FOREIGN KEY ("employeeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyRegistrant" ADD CONSTRAINT "PropertyRegistrant_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
