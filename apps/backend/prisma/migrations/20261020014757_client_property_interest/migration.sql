-- CreateTable
CREATE TABLE "ClientPropertyInterest" (
    "id" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientPropertyInterest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPropertyInterest_propertyId_idx" ON "ClientPropertyInterest"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPropertyInterest_clientId_propertyId_key" ON "ClientPropertyInterest"("clientId", "propertyId");

-- AddForeignKey
ALTER TABLE "ClientPropertyInterest" ADD CONSTRAINT "ClientPropertyInterest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPropertyInterest" ADD CONSTRAINT "ClientPropertyInterest_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
