# تقرير: دورة حياة المالك — Provisional إلى Contact رسمي عند اعتماد المدير

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** الكود والاختبارات مكتملة على قاعدة الاختبار المعزولة — **الـ migration غير مطبَّق على قاعدة التطوير، بانتظار موافقة صريحة**

---

## 1. السبب الحقيقي (Root Cause)

عند إنشاء عقار بواسطة **موظف**، كانت دالة `resolveContactInTx` في `PropertiesService.create()` تُنشئ سجل `Contact` رسمياً **فوراً** عند وجود `payload.newContact`، ثم يربطه بالعقار عبر `contactId` — قبل أي اعتماد من المدير.

هذا ينتهك القاعدة: العقار يبقى `PENDING` لكن المالك يصبح سجلاً رسمياً في قوائم العملاء وعدّادات الـ CRM.

**نقطة الإنشاء الفعلية:** `apps/backend/src/properties/properties.service.ts` → `resolveContactInTx()` → `tx.contact.create(...)` عند `payload.newContact`.

كما أن `update()` كانت تُنشئ Contact جديداً عند تعديل `newContact` من الموظف.

---

## 2. السجلات الحقيقية التي تم فحصها (قراءة فقط)

### جهات التواصل الثلاث
| id | الاسم | الهاتف | responsibleUserId | createdAt | العقارات |
|---|---|---|---|---|---|
| `aac3cdcd-c1ca-415f-9f69-4b9e3b9be630` | ابو مكه | 01044114889 | محمد (employee) | 2026-11-03 16:41:40.198 | A-000001 |
| `c8bc8db0-ab5b-486c-8828-349c599023ed` | ابو مكه | 01044114889 | كريم (employee) | 2026-11-03 16:46:37.284 | **0** (A-000002 محذوف) |
| `974957bc-c8d2-4778-807f-3a70edcd737f` | ابو مكه | 01015899485 | كريم (employee) | 2026-11-03 23:18:50.309 | A-000003 |

### العقارات
| reference | status | contactId | createdByUserId | deletedAt |
|---|---|---|---|---|
| A-000001 | PENDING | aac3cdcd… | محمد | 2026-11-04 12:30:51 (في Trash) |
| A-000003 | PENDING | 974957bc… | كريم | 2026-11-04 12:30:25 (في Trash) |

### لماذا يظهر «أبو مكة» ثلاث مرات؟
- `aac3cdcd` أُنشئ قبل A-000001 بـ 4 مللي ثانية (أثناء الإرسال).
- `c8bc8db0` أُنشئ قبل A-000002 (المحذوف) — سجل يتيم الآن.
- `974957bc` أُنشئ قبل A-000003 بـ 4 مللي ثانية.
- الأول والثاني يحملان **نفس الهاتف بالضبط** (01044114889) → تكرار مؤكد لنفس الشخص.
- الثالث هاتفه مختلف (01015899485) → قد يكون شخصاً مختلفاً (لا يجوز الدمج بالاسم وحده).

> **ملاحظة:** A-000001 وA-000003 أصبحا في سلة المحذوفات (Soft delete) بواسطة المدير أثناء الاختبار اليدوي بعد تطبيق migration السلة. لم أُعدّلهما.

---

## 3. المعمارية الجديدة (Provisional Owner)

### نموذج التخزين
أُضيف عمود واحد فقط إلى `Property`:

```prisma
proposedOwner Json?  // { type, name, phone, notes }
```

- `Property.contactId` كان **nullable أصلاً** — لا حاجة لتغيير علاقته.
- لا جدول جديد ولا كسر للعلاقات الحالية.

### دورة الحياة
1. **إرسال الموظف (`POST /properties`)**:
   - `newContact` → يُخزَّن في `Property.proposedOwner`، ويبقى `contactId = null`.
   - `contactId` (مالك رسمي موجود مسبقاً) → يبقى الربط كما هو دون إنشاء سجل جديد.
   - لا يُنشأ Contact، ولا يظهر في قوائم العملاء/العدّادات، ولا تُنشأ متابعات مالك.
2. **تعديل الموظف (`PATCH /properties/:id`)**:
   - `newContact` → يُحدَّث `proposedOwner`؛ `contactId` يُفصل (بدون حذف الـ Contact القديم).
   - `contactId` → يربط المالك الرسمي ويُفرّغ `proposedOwner`.
3. **اعتماد المدير (`POST /properties/:id/approve`)**:
   - داخل نفس المعاملة: البحث عن Contact رسمي بنفس **الهاتف المطبع** (وليس الاسم).
   - إن وُجد → إعادة استخدامه؛ وإلا → إنشاء Contact واحد.
   - `pg_advisory_xact_lock` على مفتاح الهاتف يمنع التكرار تحت الاعتمادات المتزامنة.
   - ثم `contactId = <id>` و`proposedOwner = NULL` واعتماد العقار — كلها ذرّية.
4. **الرفض / طلب التعديل**:
   - لا يُنشأ Contact، ولا يُحذف Contact قديم.
   - `proposedOwner` يبقى للتدقيق والمراجعة.
5. **إعادة الإرسال**: `proposedOwner` يبقى كما هو؛ الاعتماد لاحقاً هو نقطة الترقية الوحيدة.

### كشف التكرار
أُضيف `proposedOwner` إلى استعلام المرشحين، ويُستخدم كبديل عن `contact` عند مقارنة اسم/هاتف المالك — حتى لا تتأثر حماية التكرار بغياب Contact رسمي.

### الخصوصية
`proposedOwner` يُعاد فقط للمدير أو مُنشئ العقار (نفس قواعد `contact`). الموظف الآخر يحصل على 404 للعقار PENDING، ولا يرى بيانات المالك.

---

## 4. الملفات المعدّلة

### Schema/Migration
- `apps/backend/prisma/schema.prisma` — `proposedOwner Json?`
- `apps/backend/prisma/migrations/20261104130000_property_proposed_owner/migration.sql` (جديد)
  ```sql
  ALTER TABLE "Property" ADD COLUMN "proposedOwner" JSONB;
  -- rollback: ALTER TABLE "Property" DROP COLUMN "proposedOwner";
  ```

### Backend
- `apps/backend/src/properties/properties.service.ts`
  - `create`: staging بدل إنشاء Contact للموظف.
  - `update`: staging عند تعديل الموظف.
  - `approve`: `promoteProvisionalOwner` + advisory lock.
  - `parseProposedOwner` / `toProposedOwner`.
  - مرشحو التكرار يقرؤون `proposedOwner`.
- `apps/backend/src/properties/property-serializer.ts` — إرجاع `proposedOwner` للمدير/المنشئ.
- `apps/backend/src/properties/property.dto.ts` — `proposedOwner` في `PrivatePropertyDto`.
- `apps/backend/test/property-owner-lifecycle.spec.ts` (جديد، 12 اختباراً).
- تحديث اختبارات قديمة افترضت الإنشاء الفوري:
  - `apps/backend/test/properties.spec.ts` (فحص `proposedOwner` للمنشئ).
  - `apps/backend/test/contacts.spec.ts` (قراءة `contactId` بعد الاعتماد).

### Frontend
- `apps/frontend/lib/api/property-types.ts` — `proposedOwner`.
- `apps/frontend/lib/property-adapter.ts` — عرض المالك المؤقت.
- `apps/frontend/lib/property-details.ts` — fallback إلى `proposedOwner`.

---

## 5. الاختبارات (فعلية)

### `property-owner-lifecycle.spec.ts` — 12/12 ناجح
1. إرسال الموظف → عقار PENDING، **بدون** Contact، و`proposedOwner` محفوظ.
2. عدّاد عملاء المدير لا يتغير قبل الاعتماد.
3. المدير يرى المالك المؤقت أثناء المراجعة (والمنشئ يراه أيضاً).
4. الاعتماد ينشئ Contact رسمياً ويُفرّغ `proposedOwner`.
5. عقاران معتمدان لنفس المالك → **Contact واحد**.
6. الرفض لا ينشئ Contact.
7. طلب التعديل + إعادة الإرسال يحافظان على `proposedOwner`، ثم الاعتماد يرقّيه.
8. رفض عقار مكرر (409) لا ينشئ Contact.
9. إعادة استخدام مالك رسمي موجود + بقاء تاريخ المتابعة.
10. اعتمادان متزامنان → Contact واحد فقط.
11. موظف آخر لا يرى العقار PENDING ولا بيانات المالك المؤقت.
12. Trash + الحذف النهائي لا يحذفان المالك.

### الانحدار
```
contacts.spec.ts
properties.spec.ts
property-duplicate-priority.spec.ts
property-trash.spec.ts
duplicate-comparison.spec.ts
property-owner-lifecycle.spec.ts
→ 6 suites, 111 tests passed
```

### Typecheck / Build / Lint
| الفحص | النتيجة |
|---|---|
| backend typecheck | ✅ |
| frontend typecheck | ✅ |
| nest build | ✅ |
| next build | ✅ |
| ESLint (ملفات معدّلة) | ✅ |

---

## 6. حالة الـ migration (مهم)

- الـ migration الجديد `20261104130000_property_proposed_owner` **طُبِّق على قاعدة الاختبار المعزولة فقط**.
- `prisma migrate status` على قاعدة التطوير يؤكد أنه **لم يُطبَّق** بعد:
  ```
  Following migration have not yet been applied:
  20261104130000_property_proposed_owner
  ```
- **لم يُطبَّق أي شيء على `arkan_crm`.**
- خادم الـ backend أُوقف مؤقتاً لإعادة توليد Prisma Client (كان يمنع الكتابة على الـ DLL). سيبقى متوقفاً حتى تطبيق الـ migration بعد الموافقة، لأن الكود الجديد يقرأ العمود الجديد.

### الأثر على السجلات الحالية
- الأعمدة الجديدة nullable → لا تتأثر أي سجلات.
- A-000001/A-000003 يبقون كما هم (PENDING + في Trash) بدون أي تغيير.
- جهات التواصل الثلاث تبقى كما هي.

---

## 7. اقتراح تنظيف البيانات (لا يُنفَّذ بدون إذن)

### التكرار المؤكد
- `c8bc8db0-ab5b-486c-8828-349c599023ed` — «ابو مكه / 01044114889» — **0 عقارات** (بقايا A-000002 المحذوف).
- `aac3cdcd-c1ca-415f-9f69-4b9e3b9be630` — «ابو مكه / 01044114889» — مربوط بـ A-000001.
- هذان السجلان لنفس الشخص (نفس الهاتف). **اقتراح:** بعد موافقة صريحة، الاحتفاظ بـ `aac3cdcd` (الأقدم) وحذف `c8bc8db0` اليتيم فقط — أو إبقاؤه إن كان مطلوباً لأغراض التدقيق.

### A-000001 / A-000003
- كلاهما PENDING وموجود الآن في Trash، ولكل منهما Contact أُنشئ قبل الاعتماد.
- **لا تغيير تلقائي.** الخيارات بعد قرار المالك:
  1. إن أُعيدا واعتُمدا → الـ Contacts الحالية تصبح رسمية بشكل صحيح.
  2. إن سيُحذفان نهائياً → تُعالج جهات التواصل يدوياً بعد الحذف (لن تُحذف تلقائياً).
  3. إن أُعيدا كمسودات جديدة → يمكن (بموافقة) فصل `contactId` وتحويل البيانات إلى `proposedOwner` يدوياً.

---

## 8. القيود المتبقية

1. **الـ migration غير مطبَّق على قاعدة التطوير** → واجهة الـ runtime لم تُتحقق؛ الـ backend متوقف مؤقتاً.
2. **البيانات القديمة**: السجلات الثلاثة أُنشئت قبل الإصلاح؛ الإصلاح لا يعالجها تلقائياً (مقصود).
3. **مطابقة الهاتف** تعتمد على التطبيع (أرقام فقط)؛ الأسماء لا تُستخدم للمطابقة وحدها.
4. **تعديل الموظف لمالك عقار قديم** يفصل `contactId` دون حذف الـ Contact السابق (قد يبقى سجل يتيم حتى التنظيف اليدوي).
5. **النسخ الاحتياطية** قد تحتفظ بالبيانات حتى انتهاء مدة الاحتفاظ.

---

## 9. خطوات الاختبار اليدوي بعد الموافقة والتطبيق

1. طبّق الـ migration على `arkan_crm` بعد موافقة المالك، ثم أعد تشغيل الـ backend.
2. سجّل كموظف وأرسل عقاراً جديداً بمالك جديد → تحقق أن «العملاء/الملاك» لم يزد.
3. سجّل كمدير → افتح العقار تحت المراجعة → تحقق من ظهور بيانات المالك المؤقتة.
4. اعتمد العقار → تحقق من ظهور المالك مرة واحدة في العملاء، ومن ربط العقار به.
5. أرسل عقاراً ثانياً بنفس هاتف المالك → اعتمده → تحقق من عدم تكرار المالك.
6. ارفض عقاراً بمالك جديد → تحقق من عدم إنشاء مالك.
7. اطلب تعديلاً ثم أعد الإرسال → تحقق من بقاء بيانات المالك.
8. أرسل عقاراً مكرراً → تحقق من 409 وعدم إنشاء مالك.
9. تحقق من بقاء Trash/الاستعادة/الحذف النهائي وحماية المالك.

---

## 10. حالة التنفيذ

- ✅ السبب الجذري محدد وموثّق.
- ✅ الكود والواجهة محدثان.
- ✅ 12 اختبار دورة حياة + 111 اختبار انحدار ناجح.
- ✅ Builds/typecheck/lint ناجحة.
- ⛔ **migration `20261104130000_property_proposed_owner` غير مطبَّق على قاعدة التطوير.**
- ⛔ لم يُنفَّذ أي تنظيف للبيانات.
- لا commits أو pushes.

**متوقف بانتظار الموافقة الصريحة على تطبيق الـ migration على `arkan_crm`، ثم المراجعة اليدوية.**
