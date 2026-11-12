-- Finance ledger exact KWD precision, payout confirmer, idempotency and the
-- one-time backfill of existing deals/commissions into the ledger.
--
-- All ALTER TYPE operations below are exact numeric widenings
-- (DECIMAL(14,2) -> DECIMAL(15,3)); existing values keep their numeric value.
-- The unique index is the database-level guard against duplicate movements.
-- The backfill is idempotent (ON CONFLICT DO NOTHING).

ALTER TABLE "FinanceMovement" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "ManualExpense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "PayrollEntry" ALTER COLUMN "baseSalary" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "PayrollEntry" ALTER COLUMN "deductions" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "PayrollEntry" ALTER COLUMN "bonus" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "PayrollEntry" ALTER COLUMN "netAmount" SET DATA TYPE DECIMAL(15, 3);

ALTER TABLE "Commission" ADD COLUMN "paidById" UUID;
ALTER TABLE "Commission"
  ADD CONSTRAINT "Commission_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Commission_paidById_idx" ON "Commission"("paidById");

DROP INDEX "FinanceMovement_sourceType_sourceId_idx";
CREATE UNIQUE INDEX "FinanceMovement_sourceType_sourceId_key"
  ON "FinanceMovement"("sourceType", "sourceId");

-- One DEAL income movement per existing deal: the company's recorded
-- commission. This is an earned/accrued amount, not proof of cash collection.
INSERT INTO "FinanceMovement" (
  "id", "reference", "direction", "sourceType", "sourceId", "dealId",
  "commissionId", "payrollEntryId", "manualExpenseId", "createdById",
  "amount", "currency", "counterparty", "calculationNotes", "notes",
  "occurredAt", "createdAt"
)
SELECT
  gen_random_uuid(),
  'FM-D-' || replace(d."id"::text, '-', ''),
  'INCOME',
  'DEAL',
  d."id",
  d."id",
  NULL,
  NULL,
  NULL,
  d."recordedById",
  d."companyCommission",
  d."currency",
  'الشركة',
  concat(
    'قيمة الصفقة: ', d."price"::text, E'\n',
    'نوع الصفقة: ', CASE d."type" WHEN 'SALE' THEN 'بيع' WHEN 'RENT' THEN 'إيجار' ELSE 'تبادل' END, E'\n',
    'عمولة الشركة: ', d."companyCommission"::text, E'\n',
    'العقار: ', COALESCE(p."approvedReference", p."reference"), ' — ', p."title", E'\n',
    'العميل: ', c."name", E'\n',
    'موظف العقار: ', COALESCE(peu."name", 'غير محدد'), ' — المدير: ', COALESCE(pem."name", 'بدون مدير'), E'\n',
    'موظف العميل: ', COALESCE(ceu."name", 'غير محدد'), ' — المدير: ', COALESCE(cem."name", 'بدون مدير'), E'\n',
    'ملاحظة: عمولة الشركة مستحقة عند إغلاق الصفقة، ولا تُعدّ نقدًا محصلًا تلقائيًا.'
  ),
  d."notes",
  d."closedAt",
  d."createdAt"
FROM "Deal" d
JOIN "Property" p ON p."id" = d."propertyId"
JOIN "Client" c ON c."id" = d."clientId"
LEFT JOIN "EmployeeProfile" pe ON pe."id" = d."propertyEmployeeId"
LEFT JOIN "User" peu ON peu."id" = pe."userId"
LEFT JOIN "User" pem ON pem."id" = pe."managerUserId"
LEFT JOIN "EmployeeProfile" ce ON ce."id" = d."clientEmployeeId"
LEFT JOIN "User" ceu ON ceu."id" = ce."userId"
LEFT JOIN "User" cem ON cem."id" = ce."managerUserId"
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

-- One COMMISSION expense movement per existing employee commission, using the
-- exact amount already recorded on the Commission row. Pending commissions stay
-- visible in the ledger but are excluded from cash-out totals until paid.
INSERT INTO "FinanceMovement" (
  "id", "reference", "direction", "sourceType", "sourceId", "dealId",
  "commissionId", "payrollEntryId", "manualExpenseId", "createdById",
  "amount", "currency", "counterparty", "calculationNotes", "notes",
  "occurredAt", "createdAt"
)
SELECT
  gen_random_uuid(),
  'FM-C-' || replace(cm."id"::text, '-', ''),
  'EXPENSE',
  'COMMISSION',
  cm."id",
  NULL,
  cm."id",
  NULL,
  NULL,
  cm."createdById",
  cm."amount",
  cm."currency",
  eu."name",
  concat(
    'الصفقة: ', d."reference", ' — ', d."type"::text, E'\n',
    'دور العمولة: ', CASE cm."commissionRole"
      WHEN 'PROPERTY_EMPLOYEE' THEN 'موظف العقار'
      WHEN 'CLIENT_EMPLOYEE' THEN 'موظف العميل'
      ELSE 'عمولة يدوية' END, E'\n',
    'الموظف: ', eu."name", ' — المدير: ', COALESCE(mu."name", 'بدون مدير'), E'\n',
    'مبلغ العمولة: ', cm."amount"::text, E'\n',
    'الحالة المحاسبية: ', CASE cm."status" WHEN 'PAID' THEN 'تم الصرف' WHEN 'CANCELLED' THEN 'ملغاة' ELSE 'بانتظار الصرف' END
  ),
  cm."notes",
  COALESCE(cm."paidAt", d."closedAt"),
  cm."createdAt"
FROM "Commission" cm
JOIN "Deal" d ON d."id" = cm."dealId"
JOIN "EmployeeProfile" ep ON ep."id" = cm."employeeId"
JOIN "User" eu ON eu."id" = ep."userId"
LEFT JOIN "User" mu ON mu."id" = ep."managerUserId"
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;
