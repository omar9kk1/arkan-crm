# تحضير مخطط Prisma وتجهيز ترحيل آمن لتوسيع العقار (خلفية — Phase 2A)

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **النوع:** تعديل مخطط Prisma + إنشاء ملف migration **بدون تطبيقه** (Schema & Migration Preparation Only)
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات غير مُلتزمة، لم يُنفَّذ commit أو push.
- **مراجع سابقة:** [backend-architecture-audit](./2026-10-15-backend-architecture-audit.md)، [three-step-property-wizard](./2026-10-15-three-step-property-wizard.md)، [three-step-wizard-corrections](./2026-10-15-three-step-wizard-corrections.md)

> **نطاق هذه المهمة:** توسيع **مخطط قاعدة البيانات فقط** وإنشاء ملف ترحيل **إضافي غير مدمّر** جاهز للمراجعة. **لم يُطبَّق أي ترحيل على قاعدة البيانات، ولم تُبنَ أي واجهات برمجية، ولم تُعدَّل الواجهة الأمامية أو معالج Astra ثلاثي الخطوات، ولم تُشغَّل أي أوامر تُغيّر بيانات قاعدة البيانات، ولم تُثبَّت أي حزمة جديدة.**

---

## 1. الملخص التنفيذي

تم تنفيذ توسيع مخطط Prisma المطلوب لحقول العقار والجهات والصور والإصدارات، **بأسلوب إضافي بالكامل** (إضافة أعمدة/جداول/أنواع/فهارس فقط، دون أي حذف أو إعادة تسمية). تم إنشاء ملف ترحيل واحد قابل للمراجعة:

- `apps/backend/prisma/migrations/20261015100000_property_schema_expansion/migration.sql`

الملف مُشتق من فرق Prisma الرسمي (`prisma migrate diff`) ثم أُضيفت إليه يدويًا (بعد مراجعة) عبارتان لا يستطيع Prisma نمذجتهما:

1. فهرس فريد جزئي يفرض **إصدار تعديل معلّق واحد فقط** لكل عقار: `UNIQUE(propertyId) WHERE status = 'PENDING'`.
2. قيد `CHECK` لقواعد نطاق ميزانية العقار المطلوب (`RequestedProperty`).

**لم يُطبَّق الترحيل.** حالة الطرفية: `prisma validate` ناجح، و`prisma migrate status` يقول إن قاعدة التطوير محدّثة بالترحيلين السابقين فقط، والترحيل الجديد ملف نصي غير مُنفَّذ.

---

## 2. الأساس الحالي (Baseline) — مُتحقَّق منه فعليًا

### 2.1 حالة Git

- الفرع `main`، `HEAD = ff71379`.
- لا commit/لا push. جميع تعديلات هذه المهمة غير مُلتزمة:
  - `M apps/backend/prisma/schema.prisma`
  - `?? apps/backend/prisma/migrations/20261015100000_property_schema_expansion/`
  - `?? docs/reports/2026-10-15-property-schema-migration-preparation.md`
  - `M docs/reports/README.md`
- لم تُلمَس أي ملفات واجهة أمامية. التغييرات الأمامية/الجذرية غير المُلتزمة الموجودة مسبقًا بقيت كما هي.

### 2.2 الأدوات والإصدارات (بدون ترقية)

| العنصر | الإصدار |
| --- | --- |
| Prisma CLI (`node_modules/prisma`) | `6.19.3` |
| `@prisma/client` | `6.19.3` |
| مُزوّد Prisma | `postgresql` (migration_lock = postgresql) |
| سكربتات الحزمة | `db:generate`, `db:migrate`, `db:deploy`, `db:validate`, `db:seed` (موجودة مسبقًا) |

### 2.3 الترحيلات الموجودة

1. `20260907000000_initial/migration.sql` — الجداول/الفهارس/قيود CHECK الأصلية (18 جدولًا).
2. `20260907100000_mvp_schema_refinements/migration.sql` — حقول عقار/عميل/مالك، `CommissionRole`، `createdById`، `ManualExpense`، وتحديث قيد `FinanceMovement_source_matches_relation`. **يفشل عن قصد** إذا لم تكن جداول `Commission`/`PayrollEntry`/`FinanceMovement` فارغة.

### 2.4 حالة قاعدة البيانات (قراءة فقط)

```
2 migrations found in prisma/migrations
Database schema is up to date!
```

أي أن ترحيلَينا السابقين مُطبّقان على قاعدة التطوير (localhost:5433)، ولا يوجد drift حالياً. لم يُطلب أي reset ولم يُنفَّذ.

### 2.5 الكيانات الأساسية وقت البدء

- `Property`: `reference @unique`, `title`, `area String` (مطلوب — حقل نصي)، `address?`, `sizeSqm? Decimal(14,2)`, `bedrooms?`, `bathrooms?`, `block?`, `street?`, `description?`, `askingPrice? Decimal(14,2)`, `currency Char(3)`, `status` (default `PENDING`), `listingType DealType`, `ownerId` (مطلوب → `Owner`), `createdById?` (→ `EmployeeProfile`).
- `Owner` و`Property.ownerId` **مُحتفظ بهما كما هما**.
- `PropertyApprovalRequest` (إنشاء)، `FileAsset` (بيانات وصفية + `propertyId?`)، `AuditLog`.
- `DealType = SALE | RENT` فقط (لا `EXCHANGE`).
- `ApprovalStatus = PENDING | APPROVED | REJECTED | CHANGES_REQUESTED`.

---

## 3. التعدادات (Enums)

| التعداد | القيمة/التغيير | السبب |
| --- | --- | --- |
| `DealType` | **إضافة `EXCHANGE`** (`SALE`, `RENT`, `EXCHANGE`) | دعم البدل. لا حذف لأي قيمة. |
| `ContactType` | جديد: `OWNER`, `BROKER` | تمييز جهة التواصل. |
| `FloorType` | جديد: `GROUND`, `FIRST`..`SEVENTH`, `ROOF`, `MEZZANINE`, `BASEMENT`, `HALF`, `QUARTER`, `CUSTOM` | يطابق قائمة الأدوار في الواجهة الحالية (الأرضي/الأول..السابع/السطح/الميزانين/أخرى) + يضيف `HALF`/`QUARTER` المطلوبين. |

ملاحظة: `PropertyRevision.status` يعيد استخدام `ApprovalStatus` الموجود (`PENDING`/`APPROVED`/`REJECTED`)، فهو يكفي ولا يحتاج تعدادًا جديدًا.

---

## 4. حقول `Property` المضافة (كلها إضافية)

| الحقل | النوع | ملاحظات |
| --- | --- | --- |
| `governorate` | `String?` | محافظة اختيارية. |
| `district` | `String?` | **منطقة صريحة** (للتوافق مع دلالة `area`). |
| `plotNumber` | `String?` | قطعة/قسيمة اختيارية. |
| `floorCount` | `Int?` | عدد الأدوار كما في الواجهة. |
| `negotiable` | `Boolean?` | ثلاثي القيم (true/false/null). |
| `version` | `Int @default(1)` | أساس التحكم بالتفاؤل (optimistic concurrency). |
| `createdByUserId` | `String? @db.Uuid` → `User` | **مصدر حقيقة للتفويض** (JWT يحمل `User.id`) بجانب `createdById` القديم. |
| `contactId` | `String? @db.Uuid` → `Contact` | جهة التواصل الأساسية (اختيارية). |
| `primaryImageId` | `String? @db.Uuid @unique` → `FileAsset` | الصورة الرئيسية الواحدة (اختيارية، فريدة). |

العلاقات الجديدة على `Property`: `createdByUser`، `contact`، `primaryImage`، `floors[]`، `requestedProperty?`، `revisions[]`.

فهارس جديدة على `Property`: `@@index([contactId])`, `@@index([createdByUserId])`, `@@index([governorate, district])`.

### دلالة `area` (قرار مهم)

- `Property.area` **لم يُحذف ولم يُعدَّل ولم يُغيَّر نوعه** (يبقى `String` مطلوبًا).
- المعنى المعتمد: `area` = منطقة/منطقة الحقول النصية القديمة، و`district` هو الحقل الصريح الجديد للمنطقة، و`sizeSqm` يمثّل المساحة بالمتر المربع (اختياري).
- دقة المال: `Decimal(14,2)` **لم تُغيَّر**. ملاحظة مفتوحة: الدينار الكويتي قد يحتاج 3 خانات عشرية — تم توثيقها دون تغيير أي عمود مالي (انظر §12).

---

## 5. نموذج `Contact` والتوافق مع `Owner`

```prisma
enum ContactType { OWNER BROKER }

model Contact {
  id                String      @id @default(uuid()) @db.Uuid
  type              ContactType
  name              String
  phone             String
  notes             String?
  responsibleUserId String?     @db.Uuid
  responsibleUser   User?       @relation("ContactResponsible", ...)
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  properties        Property[]
  @@index([type, responsibleUserId])
  @@index([phone])
}
```

- العلاقة **مباشرة Property → Contact** (جهة أساسية واحدة) كما اعتمدت المهمة، **دون** إنشاء `PropertyContact` كثير-إلى-كثير غير ضروري.
- `responsibleUserId` يشير إلى `User.id` (وليس إلى اسم عرض الموظف)، وقيمته `NULL` للسجلات المملوكة للمدير/الشركة (لا تُعرَض تلقائيًا للموظفين).
- **التوافق مع `Owner`:** جدول `Owner` و`Property.ownerId` (المطلوب) **باقيان بلا تغيير**. عمود `Property.contactId` **اختياري (NULLABLE)** ولا يوجد أي backfill إجباري ولا بيانات مُختلَقة. بذكور seed لا تُنشئ أي `Contact`.
- لم يُضف عمود ربط `legacyOwnerId`، لأن المهمة لم تطلب ربطًا تلقائيًا ولا ترحيل بيانات؛ أي ربط مستقبلي من `Owner` إلى `Contact` سيُصمَّم كخطوة backfill مرحلية لاحقة (قرار مفتوح §12).

---

## 6. `PropertyFloor` (الأدوار الديناميكية)

```prisma
enum FloorType { GROUND FIRST SECOND THIRD FOURTH FIFTH SIXTH SEVENTH ROOF MEZZANINE BASEMENT HALF QUARTER CUSTOM }

model PropertyFloor {
  id          String    @id @default(uuid()) @db.Uuid
  propertyId  String    @db.Uuid
  property    Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  type        FloorType
  customLabel String?
  details     String?
  sortOrder   Int       @default(0)
  createdAt   DateTime  @default(now())
  @@index([propertyId, sortOrder])
}
```

- يمثّل النموذج **البسيط** للمعالج ثلاثي الخطوات، **لا** المعالج القديم بست خطوات.
- Zero floors صالح: لا يوجد أي شرط يفرض وجود دور واحد على الأقل (العلاقة قائمة).
- **حقل نصي حرّ واحد فقط** للتفاصيل (`details`). لا توجد عدّادات منفصلة لغرف النوم/الحمام/المطبخ/الشقق.
- `customLabel` يُستخدم مع `type = CUSTOM`، و`sortOrder` يحفظ الترتيب، و`createdAt` متوافق مع بقية الجداول.
- ملاحظة توافق: الواجهة الحالية تخزّن نصف/ربع الدور/السرداب كأعلام على الدور؛ المخطط يمثّلها كأنواع أدوار مستقلة (`BASEMENT`/`HALF`/`QUARTER`) عند كتابة الـAPI لاحقًا (قرار تطبيقي مؤجّل).

---

## 7. `RequestedProperty` (العقار المطلوب في البدل)

```prisma
model RequestedProperty {
  id                String   @id @default(uuid()) @db.Uuid
  propertyId        String   @unique @db.Uuid
  property          Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  governorate       String?
  district          String?
  block             String?
  plotNumber        String?
  sizeSqm           Decimal? @db.Decimal(14, 2)
  floorRequirements String?
  notes             String?
  budgetMin         Decimal? @db.Decimal(14, 2)
  budgetMax         Decimal? @db.Decimal(14, 2)
}
```

- علاقة **one-to-one** مع العقار المعروض (`propertyId @unique`). لا يمثّل عقارًا مستقلًا، ولا يحتوي حقول مالك/وسيط، ولا يتطلب صورة ثانية.
- الدقة المالية تتبع عُرف المشروع `Decimal(14,2)`.

**قيد CHECK يدوي (غير منمذج في Prisma):**

```sql
ALTER TABLE "RequestedProperty" ADD CONSTRAINT "RequestedProperty_budget_range_check"
  CHECK (
    ("budgetMin" IS NULL OR "budgetMin" >= 0)
    AND ("budgetMax" IS NULL OR "budgetMax" >= 0)
    AND ("budgetMin" IS NULL OR "budgetMax" IS NULL OR "budgetMin" <= "budgetMax")
  );
```

- يدعم: كلاهما فارغ، min فقط، max فقط، وكلاهما موجود بشرط `min <= max`. ويمنع القيم السالبة.
- التحقق التطبيقي يبقى مطلوبًا أيضًا في طبقة الخدمة (مؤجَّل).

---

## 8. `PropertyRevision` (إصدارات التعديل)

```prisma
model PropertyRevision {
  id            String         @id @default(uuid()) @db.Uuid
  propertyId    String         @db.Uuid
  property      Property       @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  status        ApprovalStatus @default(PENDING)
  payload       Json
  baseVersion   Int
  requestedById String         @db.Uuid
  requestedBy   User           @relation("RevisionRequester", ...)
  reviewedById  String?        @db.Uuid
  reviewedBy    User?          @relation("RevisionReviewer", ...)
  reviewNotes   String?
  createdAt     DateTime       @default(now())
  reviewedAt    DateTime?
  @@index([propertyId, status])
  @@index([status, createdAt])
  @@index([requestedById])
}
```

- يمثّل تعديل عقار **معتمد** فقط. طلبات اعتماد الإنشاء تبقى في `PropertyApprovalRequest` كما هي — فصل واضح بين اعتماد الإنشاء واعتماد التعديل.
- `payload Json` يحمل التغييرات المقترحة، و`baseVersion` يُقارَن بـ`Property.version` عند الاعتماد لاحقًا.
- **قيد قاعدة البيانات الحاسم (فهرس فريد جزئي يدوي):**

```sql
CREATE UNIQUE INDEX "PropertyRevision_one_pending_per_property"
  ON "PropertyRevision" ("propertyId")
  WHERE "status" = 'PENDING';
```

هذا يمنع وجود **أكثر من إصدار معلّق واحد** لنفس العقار على مستوى قاعدة البيانات، ويُسمح تاريخيًا بإصدارات `APPROVED`/`REJECTED` متعددة لأن الفهرس **جزئي** (لا يقيّد إلا `PENDING`). لم يُستخدم أي قيد `UNIQUE(propertyId)` عادي.

- إدارة الإصدارات (مقارنة `baseVersion` وتحديث `Property.version`) **غير مُنفَّذة** هنا؛ موضعها طبقة الخدمة لاحقًا.

---

## 9. الصورة الرئيسية عبر `FileAsset`

- أعيد استخدام `FileAsset` الموجود. أُضيف على `Property` عمود `primaryImageId` اختياري **فريد** (`@unique`) → `FileAsset.id`، أي **صورة رئيسية واحدة لكل عقار**.
- العلاقة القديمة `FileAsset.propertyId → Property` **باقية** ومحفوظة (أُعطي كلٌّ من العلاقتين اسمًا في Prisma لأنهما بين نفس النموذجين):
  - `Property.files FileAsset[] @relation("PropertyFiles")` ↔ `FileAsset.property Property? @relation("PropertyFiles", ...)`
  - `Property.primaryImage FileAsset? @relation("PropertyPrimaryImage", ...)` ↔ `FileAsset.primaryImageFor Property? @relation("PropertyPrimaryImage")`
- لا يُفرض وجود الصورة على الصفوف القديمة (العمود اختياري)، ولا يُحذف/يُستبدل أي `FileAsset` قائم.
- لم يُنشأ جدول `PropertyImage` لأن الصورة الرئيسية الواحدة لا تتطلبه (تجنّبًا لجدول غير ضروري). أي عمل رفع/تخزين فعلي **خارج نطاق هذه المهمة**.

---

## 10. عمليات SQL الفعلية داخل الترحيل (Exact operations)

الملف: `apps/backend/prisma/migrations/20261015100000_property_schema_expansion/migration.sql`

مُشتق من الأمر:

```
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

(قراءة فقط لقاعدة التطوير المحدّثة). العمليات بالترتيب:

1. `CREATE TYPE "ContactType" AS ENUM ('OWNER','BROKER');`
2. `CREATE TYPE "FloorType" AS ENUM (...);`
3. `ALTER TYPE "DealType" ADD VALUE 'EXCHANGE';` (إضافي، لا حذف).
4. `ALTER TABLE "Property" ADD COLUMN ...` — إضافة 9 أعمدة: `contactId`, `createdByUserId`, `district`, `floorCount`, `governorate`, `negotiable`, `plotNumber`, `primaryImageId` (كلها NULL)، و`version INTEGER NOT NULL DEFAULT 1`.
5. `CREATE TABLE "Contact"`, `"PropertyFloor"`, `"RequestedProperty"`, `"PropertyRevision"`.
6. `CREATE INDEX` لجهات التواصل والأدوار والمطلوب والإصدارات + `CREATE UNIQUE INDEX "Property_primaryImageId_key"` + فهارس العقار الجديدة.
7. `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` لكل العلاقات الجديدة (9 قيود FK) مع سياسات الحذف المختارة (`Cascade` للأدوار/المطلوب، `Restrict` لجهات التواصل/الصورة/الإصدارات).
8. **يدوي:** `CREATE UNIQUE INDEX "PropertyRevision_one_pending_per_property" ... WHERE "status" = 'PENDING';`
9. **يدوي:** `ALTER TABLE "RequestedProperty" ADD CONSTRAINT "RequestedProperty_budget_range_check" CHECK (...);`

لا يحتوي الملف أي `DROP COLUMN` أو `DROP TABLE` أو `ALTER COLUMN ... TYPE` أو `RENAME` أو `DELETE` أو backfill.

---

## 11. أدلة على أن التغييرات غير مدمّرة

| البند | الدليل |
| --- | --- |
| لا حذف/إعادة تسمية أعمدة | `git diff schema.prisma` يُظهر إضافات فقط؛ لا أسطر محذوفة عدا إعادة تنسيق كتلتي `Property`/`FileAsset`. |
| `area` بلا تغيير | النوع والدلالة كما هما؛ `district` حقل جديد منفصل. |
| `Owner`/`ownerId` بلا تغيير | لم يُلمَس `Owner`، و`Property.ownerId` ما زال مطلوبًا. |
| المفاتيح الأجنبية الجديدة اختيارية | كلها NULLABLE ما عدا `version` (له افتراضي `1`). |
| لا backfill | لم تُخترع أي بيانات جهات/صور؛ الجداول الجديدة تُنشأ فارغة. |
| لا db push / لا reset | لم يُشغَّل `prisma db push` ولا أي reset. |
| لا تطبيق للترحيل | الملف أُنشئ فقط؛ لم يُنفَّذ `migrate deploy` ولا `migrate dev`. |
| العلاقات مكتملة على الطرفين | `prisma validate` ناجح يتحقق من تعريف كل علاقة من الجهتين. |

---

## 12. أوامر التحقق والنتائج

| الأمر | النتيجة |
| --- | --- |
| `npx prisma validate` | ✅ «The schema ... is valid». |
| `npx prisma format` | ✅ «Formatted ... in 59ms» (لا تغيير دلالي؛ المخطط كان منسّقًا مسبقًا). |
| `npx prisma migrate status` (قبل إنشاء الملف) | ✅ «2 migrations found ... Database schema is up to date!» |
| `npx prisma migrate status` (بعد إنشاء الملف) | ✅ يتعرّف على 3 ترحيلات، ويسرد الترحيل الجديد تحت «the following migration have not yet been applied» — دليل قاطع على أنه **لم يُطبَّق**. |
| `npx prisma migrate dev --create-only --name property_schema_expansion` | ⚠️ رفض: Prisma يمنع أمر `migrate dev` في بيئة غير تفاعلية (لا TTY). لم يُسجَّل أي reset. |
| `npx prisma migrate diff ... --script` | ✅ أنتج SQL إضافيًا بالكامل (استُخدم كأساس للملف). |
| `npm run typecheck -w @arkan/backend` | ✅ نجح (`tsc --noEmit`). |
| `npm run test -w @arkan/backend` | ✅ **3 suites / 12 tests passed** (تعويضات Prisma، بدون قاعدة بيانات حقيقية). |
| `git diff --check` | ✅ Exit 0 (تحذيرات CRLF فقط من Git على Windows، لا أخطاء مسافات). |
| `npx prisma generate` | ⚠️ فشل `EPERM` على قفل ملف محرّك الاستعلام (`query_engine-windows.dll.node`) — على الأرجح عملية تطوير قيد التشغيل. **توليد العميل غير مطلوب** في هذه المرحلة (لا كود يشير للنماذج الجديدة)، ولم يُتَجاوَز الخطأ بأي حذف/إعادة تشغيل. |

> لم يُدَّعَ أي نجاح لتطبيق الترحيل فعليًا على قاعدة البيانات؛ التطبيق **ممنوع صراحةً** في هذه المهمة.

---

## 13. مخاطر الترحيل القائمة

1. **الترحيل الثاني (`20260907100000_mvp_schema_refinements`)**: يفشل عن قصد إذا كانت `Commission`/`PayrollEntry`/`FinanceMovement` غير فارغة. أي بيئة لم تُطبّق فيه هذا الترحيل ستتوقف عنده قبل الوصول إلى ترحيلنا الجديد. **لا يجوز** التحايل بحذف بيانات؛ الحل هو backfill مرحلي مُراجَع. (في قاعدة التطوير الحالية الترحيل مُطبّق بالفعل.)
2. **`ALTER TYPE "DealType" ADD VALUE 'EXCHANGE'`**: على PostgreSQL 12+ (المشروع يستخدم `postgres:16`) يُسمح به حتى داخل معاملة، بشرط ألا تُستخدم القيمة الجديدة في نفس المعاملة — وترحيلنا لا يستخدمها. لا يشكل خطرًا هنا.
3. **الفهرس الفريد الجزئي**: Prisma لا ينمذج الفهارس الجزئية، لذا أُضيف بـSQL خام. عند تشغيل `prisma migrate dev` مستقبلًا لتوليد ترحيل جديد يجب **مراجعة SQL الناتج** للتأكد من عدم توليد `DROP INDEX` لهذا الفهرس. (Prisma يتجاهل عادةً الفهارس الجزئية عند introspection، لكن المراجعة اليدوية مطلوبة دائمًا.)
4. **`primaryImageId` فريد**: تحذير Prisma نفسه عند إضافة قيد فريد على عمود جديد فارغ — لا خطر لأن العمود جديد (كل الصفوف `NULL` و`NULL` لا يتعارض في القيود الفريدة).
5. **دقة المال**: يبقى `Decimal(14,2)` دون تغيير؛ سياسة الـ3 خانات للدينار الكويتي قرار مفتوح للتنسيق قبل كتابة أي API مالي.
6. **لا اختبار تكامل بقاعدة بيانات حقيقية**: صحة الـSQL لم تُختبر بالتطبيق الفعلي (ممنوع)، بل بالمراجعة وأوامر Prisma غير المدمّرة فقط.

---

## 14. القرارات/مسائل التوافق المفتوحة

| الموضوع | القرار المتخذ هنا | ملاحظة مفتوحة |
| --- | --- | --- |
| نموذج الجهات | علاقة مباشرة `Property → Contact` | لا `PropertyContact`؛ أي دعم لأكثر من جهة مستقبلًا يتطلب توسيعًا لاحقًا. |
| ربط `Owner` القديم | إبقاء `ownerId` وإضافة `contactId` اختياري | لا `legacyOwnerId` ولا backfill؛ الخطوة المرحلية قرار لاحق. |
| دلالة `area` | نص منطقة قديم، و`district` حقل صريح، و`sizeSqm` للمساحة | يلزم قرار خدمة عند التعبئة المزدوجة مستقبلًا. |
| تمثيل الإصدار | `payload Json` + `baseVersion` | يفتقد التحقق المرجعي على الحقول؛ قد يُستبدل بحقول صريحة لاحقًا. |
| قيد الإصدار المعلّق الواحد | فهرس فريد جزئي على مستوى القاعدة | مراجعة أي migration مستقبلية لعدم إسقاطه. |
| `Property.version` | يبدأ من `1` | فرض التزامن الفعلي مؤجَّل لطبقة الخدمة. |
| دقة الدينار | بلا تغيير (`Decimal(14,2)`) | قرار 3 خانات مؤجَّل. |
| أنواع الأدوار | `FloorType` enum | مطابقة أعلام نصف/ربع/سرداب في الواجهة إلى أنواع مستقلة قرار تطبيقي مؤجَّل. |
| بادئة الـAPI والتخزين | خارج النطاق | قرارات مؤجَّلة كما في تقرير التدقيق. |

---

## 15. تأكيد عدم تطبيق أي migration

- ✅ **لم يُطبَّق** `20261015100000_property_schema_expansion` على أي قاعدة بيانات.
- ✅ لم يُشغَّل `prisma migrate deploy` ولا `prisma db push` ولا `prisma migrate reset`.
- ✅ `prisma migrate status` يعرض الآن **3 ترحيلات**، ويسرد `20261015100000_property_schema_expansion` صراحةً تحت «have not yet been applied» (أي أن الترحيل الجديد موجود كملف لكنه **غير مُطبَّق**).
- ✅ لم تُكتب/تُحذف/تُعدّل أي صفوف بيانات. لم تُلمس ملفات البيئة. لم تُثبَّت أي حزمة.

---

## 16. الخطوات التالية قبل تطبيق الترحيل

1. **موافقة صريحة** على هذا المخطط وهذا الملف من مالك المشروع.
2. التأكد من أن بيئة الهدف **طبّقت الترحيل الثاني** (أو جُهّز backfill مرحلي للجداول المالية) قبل التقدم.
3. مراجعة يدوية نهائية لملف `migration.sql` (خصوصًا الفهرس الجزئي وقيد `CHECK`).
4. بعد الموافقة فقط: تطبيق الترحيل (مثلًا `prisma migrate deploy`) على بيئة تطوير، ثم التحقق أن `migrate status` خالٍ من drift، وأن الجداول الجديدة فارغة وبنيوية فقط.
5. ثم الانتقال إلى **Phase 2B**: بناء خدمات/واجهات Properties + التفويض الصفّي + إخفاء بيانات التواصل في DTO (خارج نطاق هذه المهمة).
6. إعادة توليد Prisma Client عندما لا تكون هناك عملية تحجز ملف المحرّك (لإتاحة النماذج الجديدة للكود مستقبلًا).

---

## 17. الحالة النهائية

| البند | الحالة |
| --- | --- |
| فحص المشروع والترحيلات والأدوات | `Completed` |
| توسيع `schema.prisma` (إضافي) | `Completed` |
| إنشاء ملف ترحيل إضافي + قيود يدوية | `Completed` |
| `prisma validate` / `format` / `migrate status` | `Completed` |
| تحديث نوع الخلفية + اختبارات Jest | `Completed` (typecheck ✅، 12 اختبار ✅) |
| توليد Prisma Client | `Not Implemented` (محجوب بـEPERM؛ غير مطلوب في هذه المرحلة) |
| **تطبيق الترحيل على قاعدة البيانات** | **`Not Tested` — ممنوع في هذه المهمة، ولم يُطبَّق** |
| تنفيذ أي API/خدمة أو تعديل واجهة | `Not Implemented` (مقيّد بالمهمة) |
| اختبار تكامل بقاعدة بيانات حقيقية لقيد الإصدار الواحد | `Not Tested` (يحتاج تطبيق الترحيل لاحقًا) |

**الخلاصة:** مخطط العقار توسّع بشكل إضافي كامل (بدل، جهات تواصل، أدوار، عقار مطلوب، إصدارات، صورة رئيسية)، وأُنشئ ملف ترحيل واحد قابل للمراجعة يفرض قيد «إصدار معلّق واحد» وقيود الميزانية على مستوى قاعدة البيانات، **دون تطبيقه ودون المساس بأي بيانات أو بالواجهة الأمامية**. الخطوة التالية تتطلب موافقة صريحة قبل أي أمر يغيّر قاعدة البيانات.
