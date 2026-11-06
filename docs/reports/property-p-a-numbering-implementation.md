# تقرير: نظام ترقيم P/A للعقارات

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** الكود والاختبارات مكتملة — **migration جاهز وغير مطبَّق على قاعدة التطوير، بانتظار موافقة صريحة**

---

## 1. سلوك الترقيم السابق

- كان `Property.reference` يحمل كوداً واحداً بصيغة `A-000001` يُخصَّص **عند إنشاء العقار** (موظفاً كان أو مديراً) من عدّاد `PropertyCodeSequence` (id = 1).
- التخصيص كان يحدث **قبل** معاملة الإنشاء عبر `generateUniqueReference()`، أي أن فشل الإنشاء (مثل 409) كان يستهلك رقماً.
- لم يكن هناك تمييز بين كود الإرسال وكود الاعتماد.

---

## 2. سلوك الترقيم الجديد

### 2.1 عند إرسال الموظف
- يُخصَّص **P-000001، P-000002، …** داخل معاملة الإنشاء، **بعد** اجتياز فحص التكرار.
- `Property.reference` = كود P (كود الإرسال).
- `Property.approvedReference = null`.
- الحالة `PENDING`؛ لا يُستهلك أي رقم A.
- 409 للتكرار المطابق لا يستهلك P ولا A (التخصيص بعد الفحص، وداخل معاملة تُلغى).

### 2.2 عند اعتماد المدير
- داخل معاملة الاعتماد فقط: يُخصَّص **A-000001، A-000002، …** من العدّاد id = 1 ويُخزَّن في `approvedReference`.
- `Property.reference` يبقى كود P (للتاريخ/التدقيق).
- الـ API يعرض `reference` = الكود الرسمي (`approvedReference ?? reference`)، ويضيف:
  - `submissionReference` = P.
  - `approvedReference` = A.
- إذا كان العقار قد اعتُمد سابقاً ثم أُعيد للمراجعة، يبقى A كما هو (هوية مستقرة).
- فشل الاعتماد (نسخة قديمة/حالة غير صالحة) يلغي التخصيص مع المعاملة.

### 2.3 الرفض/الحذف المؤقت
- يبقى كود P، ولا يُستهلك A.
- إشعارات الرفض/الحذف تعرض P.
- استعادة عقار مرفوض ثم اعتماده لاحقاً: يُخصَّص A عند الاعتماد فقط.

### 2.4 المدير ينشئ عقاراً
- المدير يُنشئ عقاراً معتمداً مباشرة: يُخصَّص A فوراً ويُضبط `approvedReference = reference` (بدون كود P) للحفاظ على السلوك المعتمد.

### 2.5 الاستقلالية والتزامن
- عدّادان مستقلان في نفس الجدول: `id = 1` للـ A و`id = 2` للـ P.
- كل تخصيص يتم بـ `INSERT … ON CONFLICT DO NOTHING` ثم `UPDATE … RETURNING` داخل المعاملة؛ قفل الصف يمنع التكرار تحت التزامن.
- تخصيص A يتحقق أيضاً من عدم وجود الكود في `reference` أو `approvedReference` (لسجلات قديمة)، ويتخطاه إن وُجد.
- لا إعادة استخدام: العدّادات تتزايد فقط، والتومبستون يحتفظ بالكود.

### 2.6 العرض والإشعارات والبحث
- `reference` في كل الواجهات = الكود الرسمي (A للمعتمد، P للمعلّق/المرفوض).
- البحث في العقارات يدعم الآن `approvedReference` أيضاً.
- إشعارات القرار تعرض الكود النشط؛ ونمط `resolvePropertyCode` في الواجهة أصبح يتعرف على `P-\d{6}` ليستبدل كود P التاريخي بالكود الرسمي A عند توفره.
- جهات التواصل/العملاء/مراجعات العملاء المرتبطة بعقار تعرض الكود النشط.

---

## 3. الملفات المعدّلة

### Backend
- `apps/backend/prisma/schema.prisma` — `Property.approvedReference String? @unique`.
- `apps/backend/prisma/migrations/20261104160000_property_pa_numbering/migration.sql` (جديد).
- `apps/backend/src/properties/property-reference.ts` — `nextSubmissionCode` (P)، `formatSubmissionCode`، `allocateOfficialCode` (A مع تجنب التعارض)، وإبقاء `nextPropertyCode` للـ A.
- `apps/backend/src/properties/properties.service.ts`
  - تخصيص P داخل معاملة الإنشاء بعد فحص التكرار.
  - تخصيص A داخل معاملة الاعتماد + ترقية السجلات القديمة A.
  - `approvedReference` في بيانات الإنشاء للمدير.
  - البحث بـ `approvedReference`.
  - مرشحو التكرار يعرضون الكود النشط.
  - التومبستون يحفظ `submissionReference` و`approvedReference`.
- `apps/backend/src/properties/property-serializer.ts` + `property.dto.ts` — `reference` النشط + `submissionReference`/`approvedReference`.
- `apps/backend/src/notifications/notifications.service.ts` — `propertyReference` النشط في الصندوق وإثراء التكرار.
- `apps/backend/src/contacts/contacts.service.ts` + `contact.dto.ts` — الكود النشط.
- `apps/backend/src/clients/clients.service.ts` + `client-reviews.service.ts` — الكود النشط.

### Frontend
- `apps/frontend/lib/api/property-types.ts` — `submissionReference`/`approvedReference` (اختيارية).
- `apps/frontend/features/notifications/view.ts` — نمط `P-\d{6}` لعرض الكود الحالي.

### Tests
- `apps/backend/test/property-codes.spec.ts` — أُعيدت كتابته بالكامل للـ P/A (10 اختبارات).
- تحديث توقعات P في `properties.spec.ts`, `property-duplicate-priority.spec.ts`, `frontend-properties-contract.spec.ts`.

---

## 4. متطلبات قاعدة البيانات ومعالجة البيانات القديمة

### 4.1 الـ migration
```sql
ALTER TABLE "Property" ADD COLUMN "approvedReference" TEXT;
CREATE UNIQUE INDEX "Property_approvedReference_key" ON "Property"("approvedReference");
INSERT INTO "PropertyCodeSequence" ("id","value") VALUES (2,0) ON CONFLICT ("id") DO NOTHING;
```
- إضافي فقط؛ لا يحذف أو يعيد كتابة أي صف.
- طُبِّق على قاعدة الاختبار المعزولة فقط.
- **لم يُطبَّق على `arkan_crm`** (`migrate status` يؤكد أنه معلّق).

### 4.2 البيانات الفعلية في قاعدة التطوير (قراءة فقط)
| reference | status | in_trash |
|---|---|---|
| A-000001 | PENDING | نعم |
| A-000003 | PENDING | نعم |

- `PropertyCodeSequence`: id=1، value=3 (تسلسل A). لا يوجد صف P بعد (يُضاف بالـ migration).
- هذان سجلان قديمان بكود A وهما معلّقان (legacy pending A-coded). **لم يُعدَّلا.**

### 4.3 الاستراتيجية الآمنة
1. تطبيق الـ migration بعد موافقة المالك (يضيف العمود والفهرس وصف P = 0).
2. لا backfill ولا إعادة تسمية:
   - العقارات المعتمدة القديمة تُعرض عبر `approvedReference ?? reference` = كودها A الحالي.
   - العقارات المعلّقة القديمة A-000001/A-000003 تبقى كما هي؛ عند اعتمادها يُرقّى كودها نفسه إلى `approvedReference` **دون استهلاك رقم A جديد**.
3. العدّاد A الحالي = 3، لذا أول اعتماد جديد (لعقار P) سيحصل على **A-000004** (A-000002/A-000003 صدرت/محجوزة تاريخياً). تخصيص A يتحقق من التعارض مع `reference` و`approvedReference` ويتخطى أي كود مستخدم.
4. أول إرسال جديد للموظف سيحصل على **P-000001** (عدّاد P يبدأ من 0).
5. تنظيف اختياري (يتطلب تفويضاً منفصلاً): تحويل السجلات القديمة المعلّقة A إلى P مع حفظ A الأصلي في `approvedReference`/سجل تدقيق — **لم يُنفَّذ**.

---

## 5. نتائج الاختبارات

| المجموعة | النتيجة |
|---|---|
| `property-codes.spec.ts` (P/A الجديد) | **10/10** |
| `contacts` + `clients` + `client-review-workflow` + `property-codes` | **71/71** |
| `properties` + `contacts` + `notifications` + `property-trash` + `owner-lifecycle` + `duplicate-priority` + `frontend-properties-contract` + `property-codes` | **140/140** |
| `notifications` + `employee-decision-notifications` + `property-trash` + `owner-lifecycle` + `duplicate-priority` + `frontend-properties-contract` + `frontend-notification-target` + `frontend-property-adapter` + `employee-property-filters` + `manager-notification-display` | **167/167** |

تغطي اختبارات P/A:
1. أول إرسال → P-000001.
2. إرسالات متعددة → P متسلسلة فريدة.
3. أول اعتماد → A متاح.
4. الرفض لا يستهلك A.
5. التكرار المطابق 409 لا يستهلك أي عدّاد.
6. الاعتمادات المتزامنة لا تكرر A.
7. الاعتماد الفاشل (stale) لا يستهلك A.
8. التكرار المحتمل يحتاج قراراً صريحاً قبل A.
9. Trash/Restore يحفظان الكود، والإشعارات تعرض الكود النشط.
10. البحث بالكود A الرسمي يعمل.

### TypeScript / ESLint / Builds
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| ESLint (ملفات الخلفية/الواجهة المعدلة) | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |

---

## 6. ما ينتظر الموافقة

- **تطبيق migration `20261104160000_property_pa_numbering` على قاعدة التطوير `arkan_crm`** — لم يُطبَّق.
- خادم الـ backend متوقف مؤقتاً (لإعادة توليد Prisma Client) وسيبقى متوقفاً حتى تطبيق الـ migration والموافقة.
- لا تنظيف/إعادة تسمية للسجلات القديمة A-000001/A-000003.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية والموافقة على تطبيق الـ migration.**
