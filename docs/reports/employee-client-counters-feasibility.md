# عدّادات عملاء الموظفين الدقيقة — دراسة جدوى معمارية

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تصميم عدّادات `clientsCount` دقيقة ومُحدَّثة معاملاتيًا لتسريع فرز دليل الموظفين وملخصه.  
**الحالة:** دراسة فقط — **لا تنفيذ، لا migration، لا تعديل قاعدة بيانات أو كود**.

**الخلاصة:** التعريف الحالي للعدّ هو عدد العملاء المميزين حيث الموظف منشئ **أو** مسؤول (مرة واحدة عند التطابق). توجد **4 مسارات كتابة فقط** للعملاء ولا يوجد حذف/استعادة/استيراد مجمّع. عدّاد في جدول مستقل تُحدّثه **triggers على مستوى الصف** داخل نفس المعاملة يعطي دقة فورية وتغطية كاملة، ويحوّل قراءة الصفحة من 29–40ms إلى ~8–11ms والملخص من 40–55ms إلى ~16–24ms (تقدير من شكل الخطة). التوصية: **GO لتجربة معزولة معتمدة**، **NO-GO للتنفيذ الإنتاجي المباشر** قبل تلك التجربة.

---

## 1. تعريف العد الحالي ومسارات التغيير

### التعريف (مطابق لاستعلام الدليل)

```
عدد العملاء المميزين لكل EmployeeProfile حيث:
  Client.createdById = profile.id  OR  Client.responsibleEmployeeId = profile.id
```
- إذا كان العمودان لنفس الملف → يُحسب العميل **مرة واحدة** (UNION يزيل التكرار).
- إذا كانا لملفين مختلفين → يُحسب لكل منهما.
- `createdByUserId` (عميل أنشأه مدير بلا موظف مسؤول) **لا يُحسب لأي موظف**.
- لا يوجد soft-delete للعميل؛ لا `deletedAt` ولا `isActive` على `Client`.

### مسارات الكتابة الفعلية (تم تتبّعها في الكود)

| المسار | الملف | ما يتغيّر | التأثير على العد |
|---|---|---|---|
| `POST /clients` | `clients.service.ts` (create) | `createdById` + `responsibleEmployeeId` (موظف: كلاهما لنفسه؛ مدير: مسؤول اختياري + `createdByUserId`) | +1 للمنشئ والمسؤول (بعد إزالة التكرار) |
| `PATCH /clients/:id` | `clients.service.ts` (update) | `responsibleEmployeeId` يمكن تغييره أو إزالته؛ `createdById` ثابت | نقل −1/+1 حسب الفرق بين المجموعتين |
| اعتماد إنشاء عميل من مراجعة | `client-reviews.service.ts` (applyCreation) | `createdById = responsibleEmployeeId = requester` | +1 مرة واحدة |
| اعتماد تعديل عميل | `client-reviews.service.ts` (applyEdit) | حقول/اهتمامات فقط، لا مسؤولية/منشئ | لا تغيير |

**غير موجود في التطبيق:** لا `DELETE /clients`، لا استعادة، لا `createMany` للعملاء، لا كتابة SQL مباشرة على `Client`. حذف/تعطيل الموظف غير موجود أيضًا (`User`/`EmployeeProfile` لا يُحذفان)؛ تعطيل الحساب لا يغيّر العدّادات.

> ملاحظة: سكربتات توليد بيانات الحمل تكتب مباشرة عبر Prisma خارج التطبيق؛ وهي ليست مسار إنتاج، لكنها تبرّر استخدام trigger يغطي **أي** كتابة مستقبلية.

---

## 2. النموذج المقترح (للتصميم فقط)

```prisma
// مقترح للمراجعة — غير مطبّق
model EmployeeClientCounter {
  employeeProfileId String          @id @db.Uuid
  employeeProfile   EmployeeProfile @relation(fields: [employeeProfileId], references: [id], onDelete: Cascade)
  clientsCount      Int             @default(0)
  updatedAt         DateTime        @updatedAt
}
```

```sql
-- DDL للمراجعة فقط — غير منفّذ
CREATE TABLE "EmployeeClientCounter" (
  "employeeProfileId" UUID PRIMARY KEY
    REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "clientsCount" INTEGER NOT NULL DEFAULT 0 CHECK ("clientsCount" >= 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
```

- جدول مستقل بدل عمود على `EmployeeProfile`: يعزل الكتابة الساخنة عن صف الملف، ويجعل الـbackfill/الاستعادة أوضح.
- `CHECK (clientsCount >= 0)` يجعل أي خطأ منطقي يفشل المعاملة بدل عدّاد سالب صامت.
- لا حاجة لفهرس إضافي: المفتاح الأساسي يكفي لربط 5,000 صف.

### Backfill الدقيق (مطابق لـUNION)

```sql
BEGIN;
LOCK TABLE "Client" IN SHARE ROW EXCLUSIVE MODE; -- يمنع الكتابة أثناء الـbackfill (ثوانٍ)
INSERT INTO "EmployeeClientCounter" ("employeeProfileId", "clientsCount", "updatedAt")
SELECT p.id, COALESCE(u.cnt, 0), now()
FROM "EmployeeProfile" p
LEFT JOIN (
  SELECT profile_id, COUNT(*)::int AS cnt
  FROM (
    SELECT "createdById" AS profile_id, id FROM "Client" WHERE "createdById" IS NOT NULL
    UNION
    SELECT "responsibleEmployeeId", id FROM "Client" WHERE "responsibleEmployeeId" IS NOT NULL
  ) pairs
  GROUP BY profile_id
) u ON u.profile_id = p.id;
CREATE TRIGGER ... ; -- في نفس المعاملة بعد الـbackfill
COMMIT;
```
`UNION` (لا `UNION ALL`) ضروري لإزالة تكرار العميل عند تطابق المنشئ والمسؤول.

---

## 3. الحفاظ على الدقة: الفرق بين الحالتين (Set Delta)

لكل عميل: `S = DISTINCT { createdById, responsibleEmployeeId } \ {NULL}`.
- **INSERT:** أضف +1 لكل `p ∈ S`.
- **UPDATE (تغيّر أحد العمودين):** `added = S_new \ S_old` → +1، `removed = S_old \ S_new` → −1.
- **DELETE (مستقبلي):** −1 لكل `p ∈ S_old`.

أمثلة على الحالات الحرجة:

| قبل | بعد | النتيجة |
|---|---|---|
| creator=C, resp=C | C→B | C ثابت (لا −1 لأنه ما زال منشئًا)، B +1 |
| creator=C, resp=A | resp→C | A −1، C ثابت |
| creator=C, resp=A | resp→null | A −1 |
| creator=null, resp=A | resp→B | A −1، B +1 |
| creator=C, resp=A | نفس القيم (retry) | لا تغيير (delta فارغ) |

### Trigger مقترح (للمراجعة فقط)

```sql
CREATE FUNCTION sync_employee_client_counter() RETURNS trigger AS $$
DECLARE added UUID[]; removed UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    added := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[NEW."createdById", NEW."responsibleEmployeeId"]) x WHERE x IS NOT NULL);
  ELSIF TG_OP = 'DELETE' THEN
    removed := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[OLD."createdById", OLD."responsibleEmployeeId"]) x WHERE x IS NOT NULL);
  ELSE
    added := ARRAY(
      SELECT DISTINCT x FROM unnest(ARRAY[NEW."createdById", NEW."responsibleEmployeeId"]) x WHERE x IS NOT NULL
      EXCEPT
      SELECT DISTINCT x FROM unnest(ARRAY[OLD."createdById", OLD."responsibleEmployeeId"]) x WHERE x IS NOT NULL);
    removed := ARRAY(
      SELECT DISTINCT x FROM unnest(ARRAY[OLD."createdById", OLD."responsibleEmployeeId"]) x WHERE x IS NOT NULL
      EXCEPT
      SELECT DISTINCT x FROM unnest(ARRAY[NEW."createdById", NEW."responsibleEmployeeId"]) x WHERE x IS NOT NULL);
  END IF;
  INSERT INTO "EmployeeClientCounter" ("employeeProfileId", "clientsCount", "updatedAt")
    SELECT p, 1, now() FROM unnest(added) p
    ON CONFLICT ("employeeProfileId") DO UPDATE
      SET "clientsCount" = "EmployeeClientCounter"."clientsCount" + 1, "updatedAt" = now();
  UPDATE "EmployeeClientCounter"
    SET "clientsCount" = "clientsCount" - 1, "updatedAt" = now()
    WHERE "employeeProfileId" = ANY(removed);
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "Client_counter_sync"
AFTER INSERT OR UPDATE OF "createdById", "responsibleEmployeeId" OR DELETE ON "Client"
FOR EACH ROW EXECUTE FUNCTION sync_employee_client_counter();
```

- `UPDATE OF` يطلق فقط عند ذكر العمودين في `SET`؛ إعادة الإرسال بنفس القيمة تنتج delta فارغًا (idempotent).
- كل شيء داخل معاملة العميل نفسها: rollback يعيد العدّاد، والخطأ يُجهض العملية.
- التزامن: تحديث `Client` يقفل الصف؛ الـtrigger يحسب الفرق من `OLD/NEW` لنفس الصف، وتحديث العدّاد ذري (`count + 1`). لا lost updates.
- للاستيراد المجمّع مستقبلًا: يفضّل trigger على مستوى العبارة مع `REFERENCING NEW TABLE` لتجميع الفروق لكل موظف دفعة واحدة بدل صف-بصف.

---

## 4. مسار القراءة

### الصفحة (sort=clientsCount)

```sql
WITH scoped AS (
  SELECT u.id, u."isActive", e.id AS profile_id
  FROM "User" u LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
  WHERE u.role = 'EMPLOYEE'
    AND ($managerId::uuid IS NULL OR e."managerUserId" = $managerId::uuid)
    AND ($active::boolean IS NULL OR u."isActive" = $active::boolean)
    AND (<search predicate>)
)
SELECT s.id, COALESCE(c."clientsCount", 0)::int AS metric
FROM scoped s
LEFT JOIN "EmployeeClientCounter" c ON c."employeeProfileId" = s.profile_id
WHERE ($cursorMetric::int IS NULL
       OR metric < $cursorMetric::int
       OR (metric = $cursorMetric::int AND s.id > $cursorId::uuid))
ORDER BY metric DESC, s.id ASC
LIMIT $limit + 1;
```

- نفس `scoped` ونفس شروط البحث/الحالة/الـcursor/الترتيب الثابت `(metric DESC, id ASC)`.
- OWNER/MANAGER: نفس `managerUserId` filter؛ لا تغيير في الصلاحيات.
- `pageMetrics` للـ50 صفًا يقرأ `clientsCount` من العدّاد (50 قفزة PK) بدل join العميل/المسؤول؛ بقية المقاييس كما هي.

### الملخص

```sql
WITH scoped AS (...), late_counts AS (...)
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE s."isActive")::int AS active,
       COALESCE(SUM(c."clientsCount"), 0)::int AS clients_total,
       COALESCE(SUM(lc.cnt), 0)::int AS late_total
FROM scoped s
LEFT JOIN "EmployeeClientCounter" c ON c."employeeProfileId" = s.profile_id
LEFT JOIN late_counts lc ON lc.profile_id = s.profile_id;
```

- نفس أسماء الحقول والقيم (clientsTotal = مجموع عدّادات الملفات ضمن النطاق).
- يبقى الملخص والصفحة **استعلامين متوازيين** كما في الكود الحالي؛ لا دمج.

---

## 5. Trigger مقابل إدارة التطبيق

| المعيار | Trigger (موصى به) | Application-managed |
|---|---|---|
| تغطية كل مسارات الكتابة | ✅ أي INSERT/UPDATE/DELETE حتى SQL مستقبلي | ❌ يفوت أي مسار جديد/سكربت |
| الذرية | ✅ داخل معاملة العميل | ✅ إن أُضيفت في نفس `$transaction` |
| قابلية الاختبار | متوسطة (تتطلب migration في test DB) | عالية (mock/transaction tests) |
| الشفافية | مخفية في DB | واضحة في الكود |
| الأداء | ~1–2 upsert/صف؛ قابلة للتجميع بـtransition tables | نفسها |
| المخاطر | lock خفي، تعقيد migration/rollback | نسيان مسار، انحراف |

**التوصية:** triggers للأمان الدلالي (تغطية كاملة)، مع الاحتفاظ بمعاملات التطبيق الحالية وإضافة **وظيفة مصالحة** (reconciliation) دورية كشبكة أمان.

---

## 6. التكلفة والعمليات

### كلفة الكتابة
- إنشاء عميل: 1–2 `INSERT ... ON CONFLICT` على العدّاد (0.1–0.3ms) + قفل صف/صفين.
- إعادة إسناد: تحديثان كحد أقصى.
- التزامن: عمليات على نفس الموظف تتسلسل على صف العدّاد؛ نادرة في CRM (عمليات موظف واحد). لا قفل على جدول Client كامل.
- استيراد مجمّع مستقبلي: trigger صف-بصف قد يضيف 15k قفلًا؛ يُعالج بـstatement-level trigger مع transition tables.

### المخاطر
- عدّاد سالب عند خطأ منطقي → `CHECK` يُجهض المعاملة (fail-closed).
- تجاوز INTEGER (2.1B عميل/موظف) غير واقعي؛ يمكن BIGINT بلا كلفة تُذكر.
- drift عند كتابات SQL خارج التطبيق **قبل** إنشاء triggers، أو عند تعطيلها.
- lock أثناء الـbackfill يمنع كتابة العملاء لجزء من الثانية.

### النشر والتراجع
1. Migration واحدة: إنشاء الجدول + قفل `Client` + backfill + إنشاء triggers + commit.
2. نشر كود القراءة بعدها مباشرة (نفس الإصدار).
3. تحقق مزدوج: مقارنة العدّادات بالاستعلام القديم في اختبارات/سكربت تدقيق.
4. التراجع: إرجاع مسار القراءة القديم أولًا، ثم migration عكسية تحذف triggers والجدول.

### المصالحة
```sql
-- تقرير الانحراف (قراءة فقط)
SELECT c."employeeProfileId", c."clientsCount" AS counter, e.cnt AS exact
FROM "EmployeeClientCounter" c
JOIN (
  SELECT profile_id, COUNT(*)::int AS cnt FROM (
    SELECT "createdById" AS profile_id, id FROM "Client" WHERE "createdById" IS NOT NULL
    UNION
    SELECT "responsibleEmployeeId", id FROM "Client" WHERE "responsibleEmployeeId" IS NOT NULL
  ) p GROUP BY profile_id
) e ON e.profile_id = c."employeeProfileId"
WHERE c."clientsCount" <> e.cnt;
```
- تشغيل دوري (يومي/أسبوعي) + إصلاح صريح عند الحاجة، دون تحديث تلقائي صامت.
- يمكن كشف الانحراف أيضًا بمقارنة `SUM` في الملخص مع العدّاد في اختبارات CI.

---

## 7. الأداء المتوقع (تقدير من شكل الخطة، لا قياس على جدول عدّادات)

قياس شكل القراءة المقترح باستخدام عمود بديل بحجم مشابه (5,000 صف) على Stage C:

| الاستعلام | الحالي (مقاس) | الشكل المقترح (تقدير) |
|---|---:|---:|
| صفحة OWNER clientsCount | 40.4 ms | **~8.0 ms** |
| صفحة MANAGER | 29.4 ms | **~10.9 ms** |
| ملخص OWNER | 55.5 ms | **~24.1 ms** (معظمها متأخرات ~17ms) |
| ملخص MANAGER | 39.9 ms | **~16.1 ms** |

- انخفاض زمن SQL لطلب الدليل ~60%.
- على مستوى الخليط: الدليل ~10–15% من الطلبات، لذا التقدير المتحفظ **+2–5% RPS** في 100-user، وليس تحولًا جذريًا. القيمة الأكبر هي خفض زمن endpoint الدليل نفسه وضغط pool.
- كلفة الكتابة +0.1–0.3ms لكل تغيير عميل.

---

## 8. الأمان والاختبارات المطلوبة (تصميم)

1. منشئ = مسؤول → +1 مرة واحدة.
2. مدير ينشئ عميلًا بمسؤول → +1 للموظف فقط.
3. مدير ينشئ بلا مسؤول (`createdByUserId`) → لا عدّاد لموظف.
4. إعادة إسناد A→B (B ليس المنشئ) → A −1، B +1.
5. إعادة إسناد إلى المنشئ → المسؤول القديم −1، المنشئ ثابت.
6. إزالة المسؤول (null) → −1.
7. إعادة إرسال نفس الإسناد (retry) → لا تغيير (idempotent).
8. تعديلان متزامنان لنفس العميل → لا lost update، العدّ النهائي دقيق.
9. فشل بعد تحديث العميل → rollback يعيد العدّاد.
10. اعتماد إنشاء عميل من المراجعة → +1.
11. Backfill يطابق الاستعلام القديم على >1,000 موظف/عميل.
12. المصالحة تكتشف انحرافًا مُحقنًا.
13. OWNER company-wide، MANAGER فريقه فقط، OWNER-direct مستبعد.
14. ترقيم cursor عبر >1,000 موظف: بلا فجوات/تكرار وترتيب ثابت.
15. الملخص (total/active/clientsTotal/lateTotal) مطابق للقديم.
16. اختبار تزامن: إنشاء/إعادة إسناد متوازية لنفس الموظف → العدّ النهائي دقيق.

---

## 9. الجهد والمخاطر والأسئلة المفتوحة

**الجهد التقديري:** 5–8 أيام مهندس:
- migration + triggers + backfill: 1–2
- تعديل مسار القراءة (صفحة/ملخص/مقاييس الصفحة): 0.5–1
- اختبارات صحة/تزامن/صلاحيات: 2–3
- مصالحة + مراقبة + توثيق: 1

**أسئلة مفتوحة:**
1. اعتماد triggers مقابل إدارة التطبيق نهائيًا (التوصية: triggers + reconciliation).
2. هل سيُضاف حذف/أرشفة للعملاء مستقبلًا؟ (trigger يغطي DELETE، التطبيق يحتاج تعديلًا إن اختير).
3. هل سيوجد استيراد مجمّع للعملاء؟ (يحدد الحاجة إلى statement-level triggers).
4. من يملك تشغيل المصالحة ووتيرتها؟
5. هل يمكن افتراض تشغيل migrations على قاعدة الاختبار تلقائيًا (لاختبار الـtriggers)؟
6. التخلص من الاعتماد على `clientsCount` في `pageMetrics` عند تغطية العدّاد (نفس القيمة مضمونة).

---

## 10. القرار

- **GO لتجربة معزولة معتمدة:** نسخة disposable من Stage C + جدول عدّادات + triggers + backfill + مسار قراءة تجريبي، مع اختبارات الكتابة/التزامن/التراجع وقياس A/B متناوب للصفحة والملخص و50 طلبًا. هذا يثبت الدقة والأداء قبل أي إنتاج.
- **NO-GO للتنفيذ الإنتاجي المباشر** قبل تلك التجربة: التصميم سليم ومطابق للتعريف الحالي، لكنه يضيف trigger مخفيًا وحاجة لمصالحة وترحيل، ويجب إثبات الاتساق تحت التزامن أولًا.

**لا تنفيذ الآن:** لم تُنشأ جداول/triggers، ولم تُعدّل أي قاعدة أو كود.

**متوقف للمراجعة اليدوية.**
