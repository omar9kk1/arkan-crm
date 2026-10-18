# تصحيح توافق: جعل `Property.ownerId` القديم اختياريًا (قبل تطبيق الترحيل)

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **النوع:** تصحيح مخطط Prisma + تعديل ملف migration **غير مُطبَّق** (Compatibility Fix — بدون تطبيق)
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات غير مُلتزمة، لم يُنفَّذ commit أو push.
- **مراجع سابقة:** [property-schema-migration-preparation](./2026-10-15-property-schema-migration-preparation.md)، [backend-architecture-audit](./2026-10-15-backend-architecture-audit.md)

> **نطاق هذه المهمة:** تصحيح توافق واحد فقط: جعل `Property.ownerId` القديم **اختياريًا** (لأن مالك الأصل القانوني قد يكون مجهولًا عند وصول العقار عبر **وسيط**)، وتحديث **ملف الترحيل نفسه غير المُطبَّق** بالـSQL الآمن المقابل. **لم يُطبَّق أي ترحيل، ولم تُعدَّل الواجهة الأمامية أو معالج Astra، ولم تُبنَ أي API، ولم تُكتب/تُحذف بيانات، ولم تُغيَّر البيئة، ولم يُثبَّت أي شيء، ولم يُلمَس أي ترحيل سابق.**

---

## 1. سياق التحقق قبل التعديل

### 1.1 حالة Git

- الفرع `main`، `HEAD = ff71379`، لا commit/لا push.
- تعديلات هذه المهمة غير مُلتزمة: `M apps/backend/prisma/schema.prisma`، `M apps/backend/prisma/migrations/20261015100000_property_schema_expansion/migration.sql`، وتقرير جديد وإضافته للفهرس ضمن `docs/reports/` غير المتعقّب.
- لم تُلمَس أي ملفات واجهة أمامية. التغييرات الأمامية/الجذرية غير المُلتزمة السابقة بقيت كما هي.

### 1.2 تأكيد أن الترحيل لم يُطبَّق بعد (شرط مسبق إلزامي)

```
3 migrations found in prisma/migrations
Following migration have not yet been applied:
20261015100000_property_schema_expansion
```

**الترحيل `20261015100000_property_schema_expansion` غير مُطبَّق على قاعدة التطوير** (localhost:5433). لذلك كان تعديل ملف الترحيل نفسه آمنًا ومشروعًا. لو كان مُطبَّقًا لتوقفنا وأبلغنا بدلًا من تعديل ترحيل مُطبَّق.

### 1.3 فحص اعتماديات `ownerId` في الخلفية

- البحث عن `ownerId`/`Owner` في `apps/backend/src` و`apps/backend/test` و`apps/backend/prisma/seed.cjs` و`packages/shared`: **لا يوجد أي كود أعمال يعتمد على أن `ownerId` غير فارغ**.
- النتائج الوحيدة: تسجيل `OwnersModule` في `app.module.ts`، والملف `apps/backend/src/owners/owners.module.ts` وهو `@Module({})` فارغ (حدود نطاق فقط).
- البذور `seed.cjs` لا تُنشئ أي `Owner` ولا أي `Property`.
- **الاستنتاج:** تغيير `ownerId` إلى اختياري **لا يفرض أي تصحيح توافق إضافي في الكود الحالي** (لا خدمات عقارات بعد).

---

## 2. المشكلة الأصلية: إلزامية `ownerId`

- في المخطط السابق كان `Property.ownerId` **مطلوبًا** (`String`, NOT NULL) وله مفتاح أجنبي إلى جدول `Owner` القديم.
- قواعد العمل المعتمدة تسمح بأن يكون مصدر العقار **وسيطًا (BROKER)**، وهذا شائع في السوق العقاري الكويتي: الوسيط يعرض العقار ولا يعرف المالك القانوني الأصلي.
- إبقاء `ownerId` مطلوبًا يعني أن إنشاء عقار قادم عبر وسيط **يجبر النظام على اختراع سجل `Owner` وهمي** لتلبية القيد — وهو ما رفضته قواعد العمل.
- لذلك يجب أن يكون المالك القانوني **اختياريًا** بشكل نزيه (بدون بيانات مُختلَقة)، وأن تكون **جهة التواصل المصدر** ممثّلة بوضوح عبر `Contact`.

---

## 3. نموذج `Contact` المعتمد كجهة التواصل المصدر

- يبقى `Contact` هو المصدر الأساسي لجهة التواصل:

| الحقل | الوصف |
| --- | --- |
| `id` | UUID مستقر. |
| `type` | `ContactType` = `OWNER` أو `BROKER`. |
| `name` | الاسم. |
| `phone` | الهاتف. |
| `notes?` | ملاحظات اختيارية. |
| `responsibleUserId?` | → `User.id` (وليس اسم عرض)؛ `NULL` لسجل الشركة/المدير. |
| `createdAt` / `updatedAt` | الطوابع الزمنية. |

- `Property.contactId` يبقى **الرابط الجديد** الذي يحدّد جهة التواصل المصدر الأساسية، **اختياريًا (NULLABLE)** على مستوى القاعدة خلال المرحلة الانتقالية.
- **عقار واحد ↔ جهة تواصل أساسية واحدة على الأكثر** (علاقة مباشرة `Property → Contact`).
- **جهة تواصل واحدة ↔ عدة عقارات** (علاقة `Contact.properties`). السجلات تُميَّز بـ`type` و`id` لتمكين علاقات مستقبلية (متابعات/صفقات/عمولات) — **دون تنفيذها الآن**.

---

## 4. تعديلات Prisma الفعلية (Exact schema changes)

التعديل الوحيد في `apps/backend/prisma/schema.prisma` داخل نموذج `Property`:

```diff
-  ownerId           String                    @db.Uuid
-  owner             Owner                     @relation(fields: [ownerId], references: [id], onDelete: Restrict)
+  ownerId           String?                   @db.Uuid
+  owner             Owner?                    @relation(fields: [ownerId], references: [id], onDelete: Restrict)
```

- تم الحفاظ على: جدول `Owner`، العلاقة `Owner.properties Property[]`، الفهرس `@@index([ownerId])`، والمفتاح الأجنبي `Property_ownerId_fkey` (RESTRICT).
- لم يُحذف العمود، ولم يُغيَّر نوعه (`UUID`)، ولم يُعَد تسميته، ولم تُغيَّر سياسة الحذف.
- لم يُضَف أي حقل جديد للمالك ولم تُخترع بيانات.

---

## 5. تعديل SQL الفعلي في الترحيل غير المُطبَّق

الملف: `apps/backend/prisma/migrations/20261015100000_property_schema_expansion/migration.sql` (لم يُطبَّق).

أُضيفت عبارة `ALTER COLUMN "ownerId" DROP NOT NULL;` مدمجة داخل جملة `ALTER TABLE "Property"` الخاصة بالترحيل — بنفس الشكل الذي يولّده Prisma بالضبط (تحقّقنا بإعادة تشغيل `prisma migrate diff`):

```sql
-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "contactId" UUID,
ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "floorCount" INTEGER,
ADD COLUMN     "governorate" TEXT,
ADD COLUMN     "negotiable" BOOLEAN,
ADD COLUMN     "plotNumber" TEXT,
ADD COLUMN     "primaryImageId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "ownerId" DROP NOT NULL;
```

- العملية **غير مدمّرة**: إسقاط قيد NOT NULL فقط، دون حذف العمود ودون حذف المفتاح الأجنبي ودون حذف الفهرس.
- لم تُضَف أي عبارة لحذف `Owner` أو لملء بيانات.
- لم يُعَد ترتيب/تعديل أي عملية أخرى في الترحيل. جميع الإضافات السابقة محفوظة كما هي:
  `EXCHANGE`، `PropertyFloor`، `RequestedProperty`، `PropertyRevision`، الفهرس الفريد الجزئي للإصدار المعلّق الواحد، قيد `CHECK` لميزانية المطلوب، `Property.version`، علاقة الصورة الرئيسية الواحدة، وحقول تفويض العقار.

---

## 6. التوافق مع سجلات `Owner` الحالية

| البند | الحالة |
| --- | --- |
| جدول `Owner` | باقٍ بلا تغيير. |
| سجلات `Owner` الحالية | محفوظة بالكامل (لا حذف/لا تعديل). |
| قيم `Property.ownerId` الحالية | محفوظة (السجلات القديمة تبقى صالحة بمالكها). |
| المفتاح الأجنبي `Property_ownerId_fkey` | باقٍ كما هو (RESTRICT). |
| الفهرس `Property_ownerId_idx` | باقٍ كما هو. |
| العقارات القديمة بلا `Contact` | تبقى صالحة لأن `contactId` اختياري. |
| عقارات المدير/الشركة | يمكن تمثيلها بـ`ownerId = NULL` عند غياب مالك قانوني معروف. |

**لا فقدان بيانات ولا إجبار على backfill.** فرض وجود `Contact` لكل عقار **جديد** سيتم لاحقًا في خدمة الخلفية المُصادَقة، لا بهذا الترحيل الذي يجب ألا يكسر الصفوف القديمة.

---

## 7. مثال على عقار عبر وسيط فقط (Broker-only)

| الحقل | عقار A (مالكه معروف) | عقار B (عبر وسيط، المالك مجهول) |
| --- | --- | --- |
| `Property.contactId` | `Contact: خالد` (`type = BROKER`) — أو مالك عند الحاجة | `Contact: خالد` (`type = BROKER`) |
| `Contact.type` | `OWNER` أو `BROKER` | `BROKER` |
| `Property.ownerId` | معرّف المالك القانوني — **اختياري** | `NULL` |
| بيانات وهمية | لا | **لا** |

كلاهما قابل للتمثيل دون اختراع أي سجل `Owner`. مثال آخر: عقار من نفس الوسيط «خالد» يمكن ربط عدة عقارات بنفس سجل `Contact` (بما أن `contactId` متعدد-إلى-واحد على جهة التواصل).

---

## 8. نتائج التحقق (غير مدمّرة)

| الفحص | النتيجة |
| --- | --- |
| `npx prisma validate` | ✅ «The schema ... is valid». |
| `npx prisma format` | ✅ «Formatted ... in 56ms» (لا تغيير دلالي). |
| `npx prisma migrate diff --from-schema-datasource ... --script` | ✅ يُظهر `ALTER COLUMN "ownerId" DROP NOT NULL;` مدموجة داخل جملة `ALTER TABLE "Property"` — مطابقة تمامًا لملف الترحيل. |
| `npx prisma migrate status` | ✅ يعرض 3 ترحيلات، والجديد ضمن «have not yet been applied» — أي **لم يُطبَّق**. |
| `npm run typecheck -w @arkan/backend` | ✅ نجح (`tsc --noEmit`). |
| `npm run test -w @arkan/backend` | ✅ **3 suites / 12 tests passed**. |
| `git diff --check` | ✅ Exit 0 (تحذيرات CRLF فقط من Git على Windows، لا أخطاء مسافات). |
| `npx prisma generate` | ⚠️ محجوب بـ`EPERM` كما سبق (قفل ملف محرّك الاستعلام) — انظر §9. |
| فحص اعتماديات الكود على `ownerId` | ✅ لا اعتماد — لا حاجة لتصحيحات توافق إضافية. |

---

## 9. المخاطر المتبقية والعوائق

1. **توليد Prisma Client محجوب (`EPERM`)**: ملف `node_modules/.prisma/client/query_engine-windows.dll.node` محجوز من عملية قيد التشغيل (على الأرجح خادم التطوير). **لم نُنهِ أي عملية ولم نحذف أي ملف مقفل** (غير مُصرَّح). التوليد غير مطلوب الآن (لا كود يشير للنماذج الجديدة)، ويُعاد لاحقًا بعد إيقاف العملية صراحةً.
2. **قيد `ownerId` الجديد اختياري على مستوى القاعدة**: هذا مقصود للمرحلة الانتقالية؛ جودة البيانات (ضرورة مالك أو جهة تواصل) تُفرض في خدمة الـAPI لاحقًا، وأي قيد قاعدة إضافي غير ضروري الآن.
3. **الفهرس الفريد الجزئي للإصدار المعلّق الواحد**: ما زال غير منمذج في Prisma؛ يجب مراجعة أي migration مستقبلية لعدم توليد `DROP INDEX` له (كما ورد في تقرير التحضير).
4. **الترحيل الثاني (`20260907100000_mvp_schema_refinements`)**: يفشل عن قصد إن لم تكن جداول المال فارغة؛ يجب أن يكون مُطبَّقًا (أو يُجهَّز backfill مرحلي) قبل ترحيلنا في أي بيئة جديدة.
5. **لا اختبار تكامل بقاعدة بيانات حقيقية**: صحة SQL مُتحقَّقة بالمراجعة والأوامر غير المدمّرة فقط (التطبيق ممنوع).

---

## 10. تأكيد عدم تطبيق أي migration

- ✅ **لم يُطبَّق** `20261015100000_property_schema_expansion` على أي قاعدة بيانات.
- ✅ لم يُشغَّل `prisma migrate deploy` ولا `prisma db push` ولا `prisma migrate reset`.
- ✅ `prisma migrate status` يعرض الترحيل الجديد ضمن «have not yet been applied».
- ✅ لم تُكتب/تُحذف/تُعدّل أي صفوف بيانات؛ لم تُلمس ملفات البيئة؛ لم يُثبَّت أي شيء؛ لم يُنفَّذ commit/push.

---

## 11. الحالة النهائية

| البند | الحالة |
| --- | --- |
| جعل `Property.ownerId` اختياريًا في المخطط | `Completed` |
| تحديث SQL الترحيل غير المُطبَّق (DROP NOT NULL) | `Completed` |
| فحص اعتماديات الكود على `ownerId` | `Completed` (لا اعتماد) |
| `validate` / `format` / `migrate diff` / `migrate status` | `Completed` |
| typecheck + اختبارات Jest | `Completed` (✅ 12 اختبار) |
| توليد Prisma Client | `Not Implemented` (محجوب بـEPERM؛ غير مطلوب الآن) |
| **تطبيق الترحيل على قاعدة البيانات** | **`Not Tested` — لم يُطبَّق، وممنوع في هذه المهمة** |
| أي API/خدمة أو تعديل واجهة | `Not Implemented` (مقيّد بالمهمة) |

**الخلاصة:** أصبح المالك القانوني القديم (`ownerId`) اختياريًا بأصغر تعديل آمن ممكن (إسقاط NOT NULL فقط، مع الحفاظ على العمود والقيم والمفتاح الأجنبي والفهرس)، مع بقاء `Contact` هو جهة التواصل المصدر المعتمدة. عُدِّل ملف الترحيل **غير المُطبَّق** ليعكس ذلك بنفس شكل Prisma المُولَّد، واجتازت جميع الفحوص غير المدمّرة. الخطوة التالية تتطلب موافقة صريحة قبل تطبيق أي ترحيل.
