# تدقيق معمارية الخلفية — تحليل جاهز للتنفيذ (Phase 1)

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **النوع:** تدقيق وفحص فقط (Inspection & Architecture Report) — **بدون أي تنفيذ**
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات غير مُلتزمة، لم يُنفَّذ commit أو push.
- **مراجع سابقة:** [three-step-property-wizard](./2026-10-15-three-step-property-wizard.md)، [three-step-wizard-corrections](./2026-10-15-three-step-wizard-corrections.md)، [brokers-privacy-property-image](./2026-10-14-brokers-privacy-property-image.md)

> **نطاق هذه المهمة:** فحص الكود الفعلي وإنتاج تقييم معماري جاهز للتنفيذ. **لم يُعدَّل أي كود تطبيقي، ولم يُعدَّل مخطط Prisma، ولم تُشغَّل أي migration، ولم تُكتب أي بيانات.** الملفان الوحيدان المُنشأ/المُحدَّث هما هذا التقرير وفهرس `docs/reports/README.md`.

> **منهجية:** كل ما ورد تحت «موجود حاليًا» مبني على ملفات فُحصت فعليًا (المسارات مذكورة). كل ما ورد تحت «مقترح» هو تصميم مطلوب، وليس وصفًا لواقع قائم.

---

## 1. الملخص التنفيذي

الخلفية الحالية **بنية تحتية حقيقية وليست وهمية** (NestJS + Prisma + PostgreSQL + Redis، مع مصادقة JWT مُختبَرة)، لكن **طبقة الأعمال العقارية غير موجودة إطلاقًا**: كل وحدات النطاق في `apps/backend/src/*` هي `@Module({})` فارغة، والمتحكّمات الفعلية الوحيدة هي `auth` و`health`.

بالتالي: إنشاء العقارات، الموافقات، الإصدارات (revisions)، سجل الملاك/الوسطاء، رفع الصور، وتطبيق قواعد الخصوصية على مستوى الصفوف — **كلها `Not Implemented` خلفيًا**. الواجهة الأمامية الحالية تعمل بالكامل على حالة React/المتصفح (Mock) وتُمرِّر النموذج كـ JSON داخل حقل `description`.

الخبر الجيد: مخطط Prisma يحتوي بالفعل على علاقات مهمة جاهزة (`Property`, `Owner`, `PropertyApprovalRequest`, `FileAsset`, `AuditLog`) وقواعد CHECK مفيدة، ما يقلّص كمية الترحيل المطلوبة — لكن يحتاج **إضافات جوهرية** لدعم `EXCHANGE`، الوسطاء، إصدارات التعديل، الأدوار، والصور المتعددة.

---

## 2. ما هو موجود فعليًا في الخلفية (مبني على فحص الملفات)

### 2.1 البنية والتشغيل

| العنصر | الملف | الحالة |
| --- | --- | --- |
| نقطة الإقلاع + Global setup | `apps/backend/src/main.ts` | موجود — CORS + `enableShutdownHooks` + الاستماع على `0.0.0.0` |
| الوحدة الجذرية | `apps/backend/src/app.module.ts` | موجود — يسجّل كل الوحدات (معظمها فارغ) |
| التحقق من البيئة | `apps/backend/src/config/environment.ts` | موجود — Joi (NODE_ENV, PORT, FRONTEND_ORIGIN, DATABASE_URL, REDIS_HOST/PORT, JWT_*) |
| Pipe/Filters/Interceptor | `apps/backend/src/common/configure-app.ts` + `filters/api-exception.filter.ts` + `interceptors/response.interceptor.ts` | موجود — `whitelist + forbidNonWhitelisted + transform`، تغليف `{ data }` / `{ error }` |
| Prisma | `apps/backend/src/prisma/prisma.service.ts` | موجود — `PrismaClient` مع `onModuleInit/Destroy` |
| الطابور | `apps/backend/src/jobs/jobs.module.ts` | موجود — BullMQ `system` queue (اتصال Redis + إعدادات إعادة المحاولة) |
| الصحة | `apps/backend/src/health/health.controller.ts` + `health.service.ts` | موجود — `GET /health` (live) و`GET /health/ready` (DB+Redis مع مهلة 3s) |

### 2.2 المصادقة والتفويض

| العنصر | الملف | الوصف الفعلي |
| --- | --- | --- |
| المتحكّم | `apps/backend/src/auth/auth.controller.ts` | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` (كلها `@Public`)، و`GET /auth/me` (محمي) |
| الخدمة | `apps/backend/src/auth/auth.service.ts` | scrypt للتحقق، إصدار JWT (HS256 مع sub/role/sid) + refresh token عشوائي (base64url) يُخزَّن كـ SHA-256 فقط، تدوير refresh، إبطال، سجلات `AuditLog` داخل `$transaction` |
| الحرّاس | `apps/backend/src/auth/guards/jwt-auth.guard.ts` + `roles.guard.ts` | `JwtAuthGuard` عام (APP_GUARD): يتحقق من التوقيع/الـissuer/الـaudience، ويقرأ الجلسة من `RefreshToken`، ويُرسل `AuthUser = { id, role }`. `RolesGuard` عام ويطبّق `@Roles` |
| المُزخرِفات | `decorators/public.decorator.ts` + `roles.decorator.ts` | `@Public()` لتجاوز المصادقة، `@Roles(Role...)` لتقييد الدور |
| الوحدة | `apps/backend/src/auth/auth.module.ts` | تسجّل الحارسين كـ `APP_GUARD` — أي متحكّم جديد محمي تلقائيًا بالافتراضي |
| كلمات المرور | `apps/backend/src/auth/password.ts` | `scrypt-v1$salt$hash` مع `timingSafeEqual` |

**الخلاصة:** طبقة المصادقة/الدور **جاهزة وقابلة لإعادة الاستخدام**. أي متحكّم أعمال جديد سيُحمى تلقائيًا بـ JWT، ويمكن تقييده بـ `@Roles`.

### 2.3 الوحدات الفارغة (Domain scaffolds)

كل الملفات التالية مضمونها حرفيًا `@Module({})` مع تعليق «Domain boundary only» — **لا Controllers، لا Services، لا DTOs، لا Repository**:

`users`, `employees`, `clients`, `owners`, `properties`, `deals`, `commissions`, `payroll`, `finance`, `attendance`, `followups`, `notifications`, `files`, `smart-paste`.

تأكيد بالفحص: البحث عن `@Controller|@Injectable|@Get|@Post|...` في `apps/backend/src` أعاد نتائج في `auth` و`health` و`prisma` والحارسين/الفلاتر **فقط** — لا يوجد أي متحكّم أعمال.

### 2.4 قاعدة البيانات (Prisma)

- المخطط: `apps/backend/prisma/schema.prisma` — يحتوي **18 نموذجًا** بمعرّفات UUID.
- الترحيلات: `apps/backend/prisma/migrations/`
  - `20260907000000_initial/migration.sql` — ينشئ الجداول + الفهارس + قيود CHECK.
  - `20260907100000_mvp_schema_refinements/migration.sql` — يضيف حقول عقار/عميل/مالك، ويضيف `CommissionRole`/`createdById`، وينشئ `ManualExpense`، ويحدّث قيد `FinanceMovement_source_matches_relation`. **يفشل عن قصد** إذا كانت جداول `Commission`/`PayrollEntry`/`FinanceMovement` غير فارغة (يتطلب backfill مرحلي).
- البذور: `apps/backend/prisma/seed.cjs` — ينشئ `manager@arkan.test` و`employee@arkan.test` (كلمة مرور موحّدة)، ويرفض العمل في `production`، ويحافظ على كلمات المرور الحالية.

### 2.5 الاختبارات الحالية

`apps/backend/test/` — ثلاثة ملفات Jest/Supertest:
- `auth.spec.ts` — تغطية شاملة بتعويض Prisma (test double): التجزئة/التحقق، تسجيل الدخول لكلا الدورين، حدود الأدوار (`/test/manager` و`/test/employee`)، تدوير refresh ومنع إعادة الاستخدام، التزامن، تسجيل الخروج، JWTs غير صالحة، والتحقق من الـpayload.
- `health.spec.ts` — جاهزية DB+Redis.
- `environment.spec.ts` — التحقق من مخطط Joi.

> **مهم:** لا يوجد أي اختبار تكامل بقاعدة بيانات حقيقية، ولا E2E متصفح، ولا اختبار لواجهات الأعمال (لأنها غير موجودة).

---

## 3. مخطط Prisma الحالي — الكيانات والعلاقات (فعلي)

الملف: `apps/backend/prisma/schema.prisma`.

### 3.1 التعدادات (Enums)

| Enum | القيم | ملاحظة حرجة |
| --- | --- | --- |
| `Role` | `MANAGER`, `EMPLOYEE` | كافٍ |
| `PropertyStatus` | `PENDING`, `AVAILABLE`, `REJECTED`, `SOLD`, `RENTED`, `ARCHIVED` | **لا يوجد مفهوم إصدار معلّق (revision)** |
| `DealType` | `SALE`, `RENT` | **لا يوجد `EXCHANGE`** — يُستخدم كـ`Property.listingType` |
| `AssignmentPurpose` | `MARKETING`, `OWNER_FOLLOWUP`, `VIEWINGS` | كافٍ |
| `ApprovalStatus` | `PENDING`, `APPROVED`, `REJECTED`, `CHANGES_REQUESTED` | يصلح لتدفق الموافقة على الإنشاء |
| `FollowUpStatus`, `PaymentStatus`, `CommissionRole`, `FinanceDirection`, `FinanceSourceType`, `AttendanceStatus` | ... | خارج نطاق المهمة |

### 3.2 الكيانات ذات الصلة المباشرة بالمهمة

| النموذج | الحقول المهمة | العلاقات |
| --- | --- | --- |
| `User` | `email @unique`, `passwordHash`, `name`, `role`, `isActive` | `employee?` (EmployeeProfile 1-1)، جلسات، ملفات، تدقيق |
| `EmployeeProfile` | `userId @unique` → `User`، `phone?`, `baseSalary?` | المالك الحقيقي لمعظم علاقات «الموظف» |
| `Owner` | `name`, `phone`, `notes?`, `source?`, `status?` | `createdById?` → EmployeeProfile، `responsibleEmployeeId?` → EmployeeProfile، `properties[]`، `followups[]` |
| `Property` | `reference @unique`, `title`, `area` (String، **مطلوب**)، `address?`, `sizeSqm? Decimal(14,2)`, `block?`, `street?`, `description?`, `askingPrice? Decimal(14,2)`, `currency CHAR(3)`، `status` (default `PENDING`)، `listingType DealType` | `ownerId` **مطلوب** → `Owner`، `createdById?` → EmployeeProfile، `assignments[]`, `approvals[]`, `files[]`, `deals[]`, `manualExpenses[]` |
| `PropertyApprovalRequest` | `status`, `notes?`, `createdAt`, `reviewedAt?` | `propertyId` → Property، `requestedById` → **User**، `reviewedById?` → **User** |
| `PropertyAssignment` | `purpose` | `propertyId` + `employeeId`، فريد `(property,employee,purpose)` |
| `FileAsset` | `bucket`, `key @unique`, `mimeType`, `sizeBytes BigInt`, `createdAt` | `uploadedById` → **User**، `propertyId?` → Property (**اختياري، علاقة واحدة فقط**) |
| `AuditLog` | `action`, `entityType`, `entityId`, `before Json?`, `after Json?` | `actorId` → User |
| `Notification` | `title`, `body`, `readAt?`, روابط اختيارية | `userId` → User + property/client/owner/deal/followUp/payroll |

### 3.3 القيود الحالية (CHECK)

- `FollowUp_exactly_one_target`: `num_nonnulls(clientId, ownerId, propertyId) = 1`.
- `FinanceMovement_source_matches_relation`: يطابق `sourceType/sourceId` مع العلاقة الصحيحة (مُحدَّث في الترحيل الثاني).

**ملاحظة تصميمية مهمة:** `Property.createdById` يشير إلى `EmployeeProfile` بينما JWT يحمل `User.id`. أي ربط بين «من أنشأ العقار» و«هوية الطلب» يتطلب ربطًا عبر `EmployeeProfile.userId`. لاحظ أيضًا أن المدير لا يُنشأ له `EmployeeProfile` في الـseed (يُنشأ للموظف فقط)، لذا `Property.createdById` سيكون `NULL` لعقارات المدير — وهذا مقبول لأنها معتمدة فورًا.

### 3.4 فجوات المخطط مقابل متطلبات العمل المعتمدة

| المتطلب | الحالة في المخطط | الفجوة |
| --- | --- | --- |
| بيع/إيجار/بدل | `DealType = SALE|RENT` فقط | **لا يُعبَّر عن البدل** |
| عقار معروض + عقار مطلوب (بدل) | لا توجد حقول/جداول للجانب المطلوب | **مفقود بالكامل** |
| نطاق ميزانية المطلوب (min/max) | لا يوجد | **مفقود** |
| أدوار ديناميكية + سرداب/نصف/ربع | لا يوجد (`bedrooms/bathrooms` فقط) | **مفقود** |
| وسيط عقاري (broker) | لا يوجد تمييز؛ `Owner` فقط | **مفقود** |
| مساحة اختيارية موحّدة | `area String` مطلوب + `sizeSqm?` | تعارض دلالي (انظر §10) |
| منطقة/محافظة/قطعة/قسيمة | `area`(مستخدم كمنطقة)، `block`, `street` | لا يوجد `plotNumber`/`governorate` صريح |
| صورة رئيسية مطلوبة + صور متعددة مستقبلًا | `FileAsset.propertyId?` علاقة واحدة | لا `isPrimary`، لا ترتيب |
| إصدارات التعديل (revision) | لا يوجد | **مفقود** |
| رفض مع سبب | `PropertyApprovalRequest.notes` يمكن استخدامه | جزئيًا فقط |
| خصوصية جهة التواصل | `Owner.name/phone` مباشرة | لا فصل عام/خاص في الـDTO |

---

## 4. الهوية والأدوار المُصادَقة (فعلي)

1. العميل يستدعي `POST /auth/login` ← الخدمة تتحقق من `User` النشط + scrypt، ثم داخل `$transaction` تعيد القراءة وتصدر:
   - access token (JWT HS256) بحمولة `{ sub: User.id, role, sid: RefreshToken.id, exp, iss, aud }`
   - refresh token عشوائي (يُخزَّن hash فقط) بصلاحية 7 أيام.
2. كل طلب محمي يمرّ بـ`JwtAuthGuard`: يتحقق من التوقيع، ثم يقرأ جلسة `RefreshToken` الحية ويتأكد من `userId === sub`، عدم الإبطال، عدم الانتهاء، `isActive`، وتطابق الدور، ثم يضع `request.user = { id, role }`.
3. `RolesGuard` يطبّق `@Roles` إن وُجد.
4. `AuthUser` (في `packages/shared/src/dto/auth.ts`) يحمل **`id` و`role` فقط** — لا اسم، لا `employeeProfileId`.

**تأثير على التصميم المقترح:**
- التفويض على مستوى الصف يجب أن يستخدم `user.id` (User.id) و`user.role`.
- لربط «الموظف المسؤول» بمخطط Prisma يجب عمل join إلى `EmployeeProfile` عبر `userId`.
- الواجهة تحتاج (للعرض) اسم الموظف المسؤول؛ حاليًا تخترعه محليًا. الـAPI يجب أن يُرجع `responsibleName` ضمن الـDTO (أو توسيع `/auth/me`).

---

## 5. التصميم المقترح (Proposed Architecture)

> كل ما في هذا القسم **مقترح وغير موجود**. القصد منه أن يكون جاهزًا للتنفيذ بعد الموافقة.

### 5.1 نموذج جهات التواصل: `Contact` + `PropertyContact`

بدلًا من تحميل `Owner` بمعنى «وسيط»، يُقترح فصل واضح مع الحفاظ على التوافق:

```prisma
enum ContactType { OWNER, BROKER }

model Contact {
  id                    String  @id @default(uuid()) @db.Uuid
  type                  ContactType
  name                  String
  phone                 String
  notes                 String?
  // ملكية الصف للتفويض: User.id للموظف المسؤول، NULL = سجل شركة (يراه المدير فقط)
  responsibleUserId     String? @db.Uuid
  responsibleUser       User?   @relation(fields: [responsibleUserId], references: [id], onDelete: Restrict)
  // ربط اختياري بالسباق القديم (Owner) للترحيل المرحلي
  legacyOwnerId         String? @unique @db.Uuid
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  propertyLinks         PropertyContact[]
  @@index([type, responsibleUserId])
  @@index([phone])
}

enum PropertyContactRole { OWNER, BROKER }

model PropertyContact {
  id        String @id @default(uuid()) @db.Uuid
  propertyId String @db.Uuid
  property  Property @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  contactId String @db.Uuid
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Restrict)
  role      PropertyContactRole
  isPrimary Boolean @default(true)
  @@unique([propertyId, contactId, role])
  @@index([propertyId])
}
```

**بديل أخف (إذا رُغب بتقليل الترحيل):** الاحتفاظ بـ`Owner` وإضافة `type ContactType @default(OWNER)` و`responsibleUserId` إليه، والاعتماد على `Property.ownerId` للتواصل الأساسي. هذا أسرع لكنه **يخلط مفهوم الوسيط بجدول اسمه Owner** ويصعّب دعم أكثر من جهة تواصل للعقار. **يُنصح بالخيار الأول (`Contact`) مع ترحيل مرحلي.**

### 5.2 نموذج الإصدارات: `PropertyRevision`

```prisma
model PropertyRevision {
  id            String           @id @default(uuid()) @db.Uuid
  propertyId    String           @db.Uuid
  property      Property         @relation(fields: [propertyId], references: [id], onDelete: Restrict)
  status        ApprovalStatus   @default(PENDING)
  // لقطة كاملة مقترحة (JSON) للقيم الجديدة، أو حقول صريحة
  payload       Json
  requestedById String           @db.Uuid
  requestedBy   User             @relation("RevisionRequester", fields: [requestedById], references: [id], onDelete: Restrict)
  reviewedById  String?          @db.Uuid
  reviewedBy    User?            @relation("RevisionReviewer", fields: [reviewedById], references: [id], onDelete: Restrict)
  reviewNotes   String?
  createdAt     DateTime         @default(now())
  reviewedAt    DateTime?
  @@index([propertyId, status])
  @@index([status, createdAt])
}
```

**المنطق:** لا يتغيّر `Property.status` عند إنشاء إصدار؛ يبقى الإصدار المعتمد ظاهرًا للجميع. عند الموافقة يُطبَّق `payload` على `Property` (داخل `$transaction`) ويُعلَّم الإصدار `APPROVED`. عند الرفض يبقى `REJECTED` والـ`Property` دون تغيير.

> **ملاحظة مهمة:** إذا اعتُمد `payload Json` فقط، يبقى المخطط مرنًا لكنه يفقد التحقق المرجعي على الحقول. البديل: حقول صريحة على `PropertyRevision` أو جداول فرعية. **قرار مفتوح (انظر §13).**

### 5.3 حقول العقار المفقودة (المعروض)

لتمثيل «المعروض» بالكامل، يُقترح إضافة/توسيع:

```prisma
enum DealType { SALE, RENT, EXCHANGE }      // ALTER TYPE ADD VALUE
enum FloorType { GROUND, FIRST, SECOND, THIRD, FOURTH, FIFTH, BASEMENT, HALF, QUARTER, CUSTOM }

model PropertyFloor {
  id         String  @id @default(uuid()) @db.Uuid
  propertyId String  @db.Uuid
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  type       FloorType
  customLabel String?
  details    String?
  @@index([propertyId])
}
```

على `Property` يُقترح إضافة: `governorate String?`, `district String?` (اسم منطقة الكويت), `plotNumber String?`, `negotiable Boolean?` (أو enum ثلاثي)، إضافة إلى إعادة استخدام `sizeSqm` كمساحة موحّدة اختيارية.

> **تنبيه تسمية حرج:** الحقل الحالي `Property.area` (String، مطلوب، مفهرس مع status) يستخدمه الكود الأمامي كـ«المنطقة/Region»، بينما معنى «المساحة م²» في الواجهة يقابل `sizeSqm`. يجب حسم دلالة `area` قبل الترحيل (انظر §10). **قرار مفتوح.**

### 5.4 العقار المطلوب (بدل فقط): `RequestedProperty`

```prisma
model RequestedProperty {
  id            String   @id @default(uuid()) @db.Uuid
  propertyId    String   @unique @db.Uuid
  property      Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  governorate   String?
  district      String?
  block         String?
  plotNumber    String?
  sizeSqm       Decimal? @db.Decimal(14, 2)
  floorRequirements String?
  notes         String?
  budgetMin     Decimal? @db.Decimal(14, 2)
  budgetMax     Decimal? @db.Decimal(14, 2)
}
```

يفرض التحقق التطبيقي: `budgetMin <= budgetMax` عند وجود الاثنين (نفس قاعدة الواجهة الحالية).

### 5.5 الصور: `PropertyImage`

بما أن `FileAsset` الحالي يسمح بعلاقة واحدة (`propertyId?`) ولا يدعم التمييز بين الصورة الرئيسية وغيرها:

```prisma
model PropertyImage {
  id         String    @id @default(uuid()) @db.Uuid
  propertyId String    @db.Uuid
  property   Property  @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  fileId     String    @unique @db.Uuid
  file       FileAsset @relation(fields: [fileId], references: [id], onDelete: Restrict)
  isPrimary  Boolean   @default(false)
  sortOrder  Int       @default(0)
  createdAt  DateTime  @default(now())
  @@index([propertyId, isPrimary])
}
```

قيد تطبيقي: **صورة رئيسية واحدة إلزامية** عند الإنشاء (`isPrimary = true` على صورة واحدة).

---

## 6. نموذج الحالة المقترح (الموافقة/الرفض/الإصدار)

### 6.1 الإنشاء

| الفاعل | النتيجة |
| --- | --- |
| مدير | `Property.status = AVAILABLE` مباشرة (معتمد)، بدون طلب موافقة |
| موظف | `Property.status = PENDING` + إنشاء `PropertyApprovalRequest{status: PENDING, requestedById}` داخل `$transaction` |

### 6.2 قرار المدير على الإنشاء

| الإجراء | التحديث |
| --- | --- |
| اعتماد | `Property.status → AVAILABLE`, طلب الموافقة `APPROVED` + `reviewedById/reviewedAt` |
| رفض (مع سبب) | `Property.status → REJECTED`, طلب الموافقة `REJECTED`, `notes = reason` |
| إعادة إرسال الموظف | تعديل العقار المرفوض يعيده إلى `PENDING` (طلب موافقة جديد) |

### 6.3 التعديل

| الحالة | الفاعل | النتيجة |
| --- | --- | --- |
| عقار معتمد | مدير | تطبيق فوري على `Property` (+`AuditLog`) |
| عقار معتمد | موظف | إنشاء `PropertyRevision{status: PENDING, payload}` — **العقار المعتمد يبقى كما هو** |
| إصدار معلّق | مدير اعتماد | تطبيق `payload` على `Property` داخل `$transaction` + `revision.status = APPROVED` |
| إصدار معلّق | مدير رفض | `revision.status = REJECTED`, `reviewNotes` — العقار المعتمد **دون تغيير** |
| عقار `PENDING`/`REJECTED` | منشئه | تعديل مباشر (لا حاجة لإصدار لأن لا نسخة معتمدة بعد) |

### 6.4 الرؤية (Visibility)

| حالة العقار | من يرى |
| --- | --- |
| `PENDING` أو `REJECTED` | المدير + منشئه فقط |
| `AVAILABLE` | جميع الموظفين المصرح لهم (+ المدير) |

> هذان القيدان **غير مطبّقين خلفيًا حاليًا** لأن لا يوجد API عقارات؛ يجب فرضهما في طبقة الخدمة (row-level)، وليس في الواجهة فقط.

---

## 7. واجهات REST المقترحة وقواعد التفويض

> لا يوجد `/api` prefix حاليًا (المتحكّمات الحالية `auth`/`health`). يُقترح الحفاظ على نفس النمط (بدون prefix) أو إضافة prefix موحّد — **قرار مفتوح**.

| Method + Path | الدور | التفويض على مستوى الصف |
| --- | --- | --- |
| `POST /properties` | MANAGER, EMPLOYEE | — |
| `GET /properties` | MANAGER, EMPLOYEE | المدير: الكل. الموظف: `AVAILABLE` + الخاصة به (`createdByUserId = user.id`) |
| `GET /properties/:id` | MANAGER, EMPLOYEE | منع 404/403 لمن لا يحق له رؤية `PENDING/REJECTED` |
| `PATCH /properties/:id` | MANAGER, EMPLOYEE | مدير: مباشر. موظف: منشئ فقط، ويُنشئ إصدارًا إذا كان العقار معتمدًا |
| `POST /properties/:id/approve` | MANAGER | — |
| `POST /properties/:id/reject` | MANAGER | يتطلب سببًا |
| `GET /properties/:id/revisions` | MANAGER, EMPLOYEE | المدير + منشئ الإصدار |
| `POST /properties/:id/revisions/:revisionId/approve\|reject` | MANAGER | — |
| `GET /contacts?type=` | MANAGER, EMPLOYEE | المدير: الكل. الموظف: `responsibleUserId = user.id` فقط (منع افتراضي) |
| `POST /contacts` | MANAGER, EMPLOYEE | الموظف: يُوسَم تلقائيًا بـ`responsibleUserId = user.id` |
| `POST /files` (multipart) | MANAGER, EMPLOYEE | حجم/نوع، ثم إنشاء `FileAsset` |
| `GET /files/:id` | MANAGER, EMPLOYEE | مدير أو منشئ/مرتبط بعقار مرئي |

**آلية التفويض المقترحة:**
- استخدم `@Roles(...)` للقيود الخشنة (مثل حصر الاعتماد بالمدير).
- استخدم **خدمة سياسات** (Policy service) للتفويض على مستوى الصف: `resolveViewer(user) → { userId, employeeProfileId, isManager }`، ثم شروط `where` في Prisma بدلًا من الفلترة بعد الجلب (لمنع تسريب أي بيانات).
- استخدم `NotFoundException` بدلًا من `ForbiddenException` لحالات «غير مرئي» لتقليل تسريب الوجود.

---

## 8. استبعاد بيانات الاتصال الخاصة من DTO العام

**القاعدة:** لا تُعاد أي كيان Prisma مباشرة. تُعاد DTOs صريحة تُبنى دالة تحويل واحدة:

```
toPropertyDto(property, viewer):
  public: id, code/reference, title, listingType, status, governorate, district,
          block, plotNumber, sizeSqm, price, negotiable, floors[], requestedProperty?,
          primaryImageUrl, responsibleName
  privateContact (فقط إذا viewer.isManager أو property.responsibleUserId === viewer.userId):
          contact: { type, name, phone }
  وإلا: contact = null (لا يُرسَل الاسم/الهاتف إطلاقًا)
```

- الاسم/الهاتف **لا يُرسلان للشبكة أصلًا** لغير المخوّل (لا يكفي إخفاؤهما في الواجهة).
- يجب تطبيق الإخفاء في **كل** نقاط النهاية، بما فيها القوائم الملخّصة.
- `responsibleName` اسم عرضي عام (الموظف المسؤول)، وليس بيانات تواصل.
- يُفضَّل فرضه عبر **Mapper مركزي** لتجنب نسيانه في endpoint جديد.

---

## 9. تخزين الصور الدائم (للتطوير والإنتاج)

**الواقع الحالي:** `FilesModule` فارغ، `FileAsset` بيانات وصفية فقط، والصور في الواجهة `blob:` مؤقتة تنتهي بإعادة التحميل.

**مقترح:**

| البيئة | النهج |
| --- | --- |
| تطوير محلي | تخزين على نظام ملفات خدمة الخلفية داخل مجلد قابل للتهيئة (خارج git)، مع نقطة نهاية للقراءة (static/streamed) محمية بالتفويض؛ أو حاوية MinIO متوافقة مع S3 عبر Compose |
| إنتاج | كائنات في تخزين متوافق مع S3 (bucket خاص)، مع روابط موقّعة قصيرة الأجل (`presigned GET`) للعرض |

- التحقق من النوع (MIME whitelist للصور)، الحجم الأقصى، وتوليد `key` فريد.
- حفظ بيانات `FileAsset` (bucket/key/mimeType/sizeBytes/uploadedById) + `PropertyImage(isPrimary)`.
- **يجب** إضافة متغيرات بيئة جديدة لاحقًا (`STORAGE_*`) — لكن **ليس في هذه المهمة**.

---

## 10. الترحيل والتوافق (مخاوف حرجة)

| # | المخاوف | التوصية |
| --- | --- | --- |
| 1 | `DealType` بلا `EXCHANGE` | `ALTER TYPE "DealType" ADD VALUE 'EXCHANGE'` (إضافي غير مدمّر). يجب تطبيقه في migration مستقل قبل الاستخدام |
| 2 | تعارض دلالة `Property.area` | حسم: هل `area` = منطقة (Region) أم مساحة؛ الأمن هو إعادة تسمية الدلالة إلى `district`/`governorate`، ثم استخدام `sizeSqm` للمساحة. **لا تحذف `area` قبل backfill** |
| 3 | `Property.ownerId` مطلوب | مع إدخال `PropertyContact`، يُنصح بالاحتفاظ بـ`ownerId` مؤقتًا كـbackfill ثم جعله اختياريًا في مرحلة لاحقة — **دون فقدان بيانات** |
| 4 | `createdById` → EmployeeProfile بينما JWT = User | إضافة `createdByUserId String? @db.Uuid` على `Property` (مصدر حقيقة للتفويض) مع الحفاظ على `createdById` القديم، أو join عبر `EmployeeProfile.userId` |
| 5 | دقة المال (KWD 3 خانات) | الواجهة تستخدم أحيانًا قيمًا صحيحة؛ DB `Decimal(14,2)`. يجب تثبيت سياسة (3 خانات للدينار) وترحيل/توحيد قبل الكتابة |
| 6 | الترحيل الثاني يفشل إن لم تكن جداول المال فارغة | أي migration جديدة يجب أن تأتي بعده؛ ولا حذف بيانات للتحايل |
| 7 | سجل جهات التواصل في الذاكرة | لم تُهاجَر أي بيانات (لا مصدر خلفي أصلًا)، لذا لا يوجد ترحيل بيانات — فقط إنشاء بنية |
| 8 | مسودات المتصفح | **ليست مخزّنة خلفيًا**؛ لا تُرحَّل. أي دمج لاحق يجب أن يقرأ المسودة محليًا ويرسلها عبر API |
| 9 | الواجهة الأمامية غير مُلتزمة وفي منتصف إعادة تصميم (V2) | يجب تنسيق نوع الحقول النهائي بين الـAPI والواجهة قبل بناء طبقة العمل (انظر §13) |
| 10 | `PropertyApprovalRequest` يُستخدم للإنشاء فقط | يمكن إعادة استخدامه للإنشاء، و`PropertyRevision` للتعديل (فصل واضح) |

---

## 11. مراحل التنفيذ المقترحة (بترتيب الاعتماد)

| المرحلة | المحتوى | الاعتماد |
| --- | --- | --- |
| 0 | **اعتماد هذا التقرير + حسم القرارات المفتوحة (§13)** | — |
| 1 | **مخطط Prisma فقط:** `Contact`/`PropertyContact`, `PropertyRevision`, `RequestedProperty`, `PropertyFloor`, `PropertyImage`, `EXCHANGE`, أعمدة العقار الجديدة + migration + `prisma validate` | المرحلة 0 |
| 2 | **وحدة Properties (CRUD + تفويض صفّي + DTO إخفاء):** إنشاء/قراءة/قائمة/تحديث | 1 |
| 3 | **سير عمل الموافقة/الرفض + الإصدارات** (transactions + AuditLog) | 2 |
| 4 | **وحدة Contacts** (مع الترحيل من `Owner` المرحلي) | 1 |
| 5 | **وحدة Files** (رفع/تخزين/ربط الصورة الرئيسية) | 1 |
| 6 | **دمج الواجهة الأمامية** مع الـAPI (استبدال حالة React/الذاكرة) | 2–5 |
| 7 | **تقوية** (rate limiting، تنظيف refresh tokens، مراقبة) | بعد الاستقرار |

> **لا يُنفَّذ أي من ذلك قبل موافقة صريحة على المرحلة 0.**

---

## 12. استراتيجية الاختبار (بما فيها العزل بين موظفين)

| المستوى | المحتوى |
| --- | --- |
| وحدة | خدمات Properties/Contacts/Revisions بتعويض Prisma (بنفس نمط `auth.spec.ts`): التحقق من التفويض، رفض الحالات غير المسموحة، منطق `min<=max` |
| تفويض | `@Roles` على الاعتماد/الرفض: موظف → 403؛ مدير → 200 |
| **عزل الخصوصية (الأهم)** | بذر **موظفين اثنين** E1 وE2 + عقار `PENDING` أنشأه E1: تأكيد أن استجابة E2 `GET /properties/:id` **لا تحتوي** `contact.name`/`contact.phone`، وأنها تُرجع `responsibleName` فقط؛ وتأكيد أن E2 لا يستطيع رؤية عقار E1 المعلّق/المرفوض |
| الإصدارات | E1 يعدّل عقارًا معتمدًا → إصدار `PENDING`؛ E2 يرى النسخة المعتمدة القديمة؛ اعتماد المدير → الجديد يظهر للجميع؛ الرفض → القديم يبقى |
| الصور | رفع صورة واحدة → `PropertyImage.isPrimary`؛ منع رفع صورة ثانية كرئيسية؛ رفض MIME غير الصورة |
| تكامل DB | **جديد مطلوب:** قاعدة Postgres اختبارية (Testcontainers أو خدمة Compose منفصلة) — لا يوجد حاليًا أي اختبار تكامل حقيقي |
| E2E (لاحقًا) | لا يوجد إطار متصفح حالي؛ يُقترح لاحقًا بعد دمج الواجهة |

**تنبيه:** اختبار «موظفان حقيقيان» في الواجهة الحالية **`Not Tested` ومحجوب معماريًا** (السجل في ذاكرة التبويب). الاختبار الحقيقي يصبح ممكنًا فقط بعد وجود الـAPI.

---

## 13. المخاطر والقرارات المفتوحة والعوائق

### 13.1 عوائق حرجة (Blockers)

1. **لا يوجد API أعمال إطلاقًا** — كل شيء يجب بناؤه. (معروف ومقصود)
2. **المخطط لا يمثّل العمل المعتمد:** بدل، وسيط، إصدارات، أدوار، صور متعددة.
3. **لا اختبار تكامل بقاعدة بيانات حقيقية** — أي منطق معاملاتي/تفويض سيُختبر ابتدائيًا بتعويضات فقط.
4. **تعارض دلالة `Property.area`** ومخاطر فقدان/إساءة تفسير بيانات عند الترحيل.

### 13.2 قرارات مفتوحة (تحتاج حسمًا قبل التنفيذ)

| القرار | الخيارات | توصيتي |
| --- | --- | --- |
| نموذج جهات التواصل | (أ) `Contact` جديد + `PropertyContact` — (ب) توسيع `Owner` بـ`type` | **(أ)** لفصل أوضح ودعم أشكال متعددة |
| تمثيل الإصدار | (أ) `payload Json` — (ب) حقول/جداول صريحة | **(أ)** أولًا للسرعة، مع تحقق في الخدمة؛ يمكن التحويل لاحقًا |
| دلالة `Property.area` | منطقة أم مساحة | **منطقة** (كما يفهمها الكود الحالي)، والمساحة `sizeSqm` |
| prefix الـAPI | `‎/api` أم لا | **لا** (توافقًا مع auth/health الحالي) — أو حسمه مرة واحدة |
| التخزين | نظام ملفات محلي مقابل MinIO/S3 | **ملفات محلية للتطوير + تجريد StorageService** للتبديل للإنتاج |
| إثراء هوية المستخدم | توسيع `/auth/me` بالاسم، أم `employedBy` endpoint | **توسيع DTO الردود** بـ`responsibleName` بدون لمس بنية Auth الحساسة |

### 13.3 مخاطر تشغيلية

- **CORS** يحتوي أصول تطوير مضمّنة (`main.ts`)؛ يجب مراجعتها قبل الإنتاج.
- **Compose** يستخدم بيانات اعتماد تطويرية، وPostgres مكشوف (في المشروع الحالي على المنفذ `5433:5432`).
- **لا rate limiting** ولا تدوير عائلي للرموز، ولا تنظيف لـrefresh tokens المنتهية.
- **الأدوار لا تكفي وحدها** — يجب التفويض الصفّي دائمًا.

---

## 14. إجابة الأسئلة المطلوبة (تجميع)

1. **ما الموجود:** بنية Nest/Prisma/Redis، مصادقة JWT/أدوار مُختبَرة، health/readiness، مخطط 18 نموذجًا + ترحيلان + seed + اختبارات مصادقة. (`auth`, `health`, `prisma`, `jobs`, `config`, `common`)
2. **ما المفقود:** كل منطق الأعمال — خصائص، موافقات، إصدارات، جهات تواصل، صور، إشعارات فعلية، وكل الـAPIs.
3. **الكيانات والعلاقات:** §3.
4. **الهوية والأدوار:** §4 (`AuthUser = {id, role}`، الحارسان العامان، الجلسة من `RefreshToken`).
5. **العلاقات المقترحة:** §5 (`Contact`/`PropertyContact`, `PropertyRevision`, `RequestedProperty`, `PropertyFloor`, `PropertyImage`).
6. **نموذج الحالة:** §6.
7. **نقاط REST والتفويض:** §7.
8. **إخفاء بيانات الاتصال:** §8 (`toPropertyDto` + إخفاء على مستوى الشبكة).
9. **تخزين الصور:** §9.
10. **الترحيل والتوافق:** §10.
11. **المراحل:** §11.
12. **الاختبارات (عزل موظفين):** §12.
13. **المخاطر/القرارات/العوائق:** §13.

---

## 15. الملفات التي فُحصت (مسارات فعلية)

**الخلفية:**
`apps/backend/src/main.ts`, `app.module.ts`, `config/environment.ts`, `common/configure-app.ts`, `common/filters/api-exception.filter.ts`, `common/interceptors/response.interceptor.ts`, `prisma/prisma.service.ts`, `prisma/prisma.module.ts`, `auth/auth.module.ts`, `auth/auth.controller.ts`, `auth/auth.service.ts`, `auth/password.ts`, `auth/guards/jwt-auth.guard.ts`, `auth/guards/roles.guard.ts`, `auth/decorators/public.decorator.ts`, `auth/decorators/roles.decorator.ts`, `auth/dto/login.dto.ts`, `auth/dto/refresh-token.dto.ts`, `health/health.controller.ts`, `health/health.service.ts`, `jobs/jobs.module.ts`, والوحدات الفارغة (`properties`, `files`, `owners`, `users`, `smart-paste`, `employees`, `clients`, `deals`, `commissions`, `payroll`, `finance`, `attendance`, `followups`, `notifications`).

**قاعدة البيانات:**
`apps/backend/prisma/schema.prisma`, `apps/backend/prisma/seed.cjs`, `apps/backend/prisma/migrations/20260907000000_initial/migration.sql`, `apps/backend/prisma/migrations/20260907100000_mvp_schema_refinements/migration.sql`.

**الاختبارات:**
`apps/backend/test/auth.spec.ts`, `apps/backend/test/health.spec.ts`, `apps/backend/test/environment.spec.ts`.

**العقود المشتركة:**
`packages/shared/src/index.ts`, `dto/auth.ts`, `enums/role.ts`, `types/api-response.ts`.

**الواجهة (للفهم لا للتعديل):**
`apps/frontend/lib/api-client.ts`, `lib/contact-registry.ts`, `lib/property-privacy.ts`, `lib/property-description.ts`, `lib/area-governorate.ts`, `features/employee-properties/model.ts`, `features/employee-properties/components/new-property-modal-v2.tsx`, `new-property-model-v2.ts`, `features/manager-properties/components/manager-properties.tsx`, `add-property-modal.tsx`, `approval-property-card.tsx`, `preview-data.ts`, `features/employee-properties/components/employee-properties-page.tsx`.

**الجذر/التشغيل:**
`README.md`, `PROJECT_CONTEXT.md`, `docker-compose.yml`, `package.json`, `apps/backend/package.json`, `docs/reports/*`.

---

## 16. الحالة النهائية

| البند | الحالة |
| --- | --- |
| فحص الكود الفعلي (خلفية + مخطط + اختبارات + واجهة) | `Completed` |
| تقييم معماري جاهز للتنفيذ | `Completed` |
| تنفيذ أي API أعمال | `Not Implemented` (مقيّد بالمهمة) |
| تعديل مخطط Prisma / migrations | `Not Implemented` (مقيّد بالمهمة) |
| كتابة قاعدة بيانات / اختبار تكامل حقيقي | `Not Implemented` |
| اختبار عزل موظفين خلفي | `Not Tested` (لا API بعد) |

**الخلاصة:** الخلفية تمتلك أساسًا تقنيًا متينًا (مصادقة/أدوار/Prisma/Redis/health) لكنها **خالية تمامًا من منطق الأعمال العقاري**. التنفيذ المقترح يحتاج أولًا إلى توسيع المخطط (`EXCHANGE`، جهات تواصل، إصدارات، أدوار، صور) ثم بناء خدمات Properties/Contacts/Files مع **تفويض صفّي** و**إخفاء بيانات الاتصال على مستوى الـDTO**، مع ترحيل متوافق غير مدمّر يحترم قيود الترحيل الحالية.

**التوصية:** اعتماد هذا التقرير وحسم القرارات المفتوحة في §13.2 قبل بدء المرحلة 1 (مخطط Prisma).
