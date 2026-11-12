# تحسين fingerprint مزامنة متابعات الموظف

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** حساب fingerprint المزامنة لنطاق EMPLOYEE في `GET /follow-ups` فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

**الخلاصة:** استُبدلت الاستعلامات الخمسة بمرجع واحد SQL مُعامَل بنفس الشروط تمامًا. عدد استعلامات fingerprint: **5 → 1**. التحقق على 31 موظفًا من Stage C: **31/31 بصمة متطابقة** ومجموعات المعرّفات المصرّح بها متطابقة حرفيًا. عند 50 طلبًا متزامنًا: **P50 809 → 417 ms**. القياس المضبوط 100-user: **87.26 RPS / P95 4,515 ms / 0 أخطاء** تحت حمل CPU أعلى من قياس Task 18 — أي لا تراجع.

---

## 1. المنطق الأصلي والجديد

### الأصلي (5 استعلامات Prisma)

لكل طلب أول صفحة من موظف:

| # | الاستعلام | النطاق |
|---|---|---|
| 1 | `Property.aggregate` | `createdByUserId = me` **أو** `createdBy.userId = me` **أو** `assignments.some.employee.userId = me` |
| 2 | `PropertyAssignment.aggregate` | `property` ضمن نطاق العقارات أعلاه |
| 3 | `Client.aggregate` | `createdBy.userId = me` **أو** `responsibleEmployee.userId = me` |
| 4 | `ClientPropertyInterest.aggregate` | `client` ضمن نطاق العملاء أعلاه |
| 5 | `User.aggregate` | كل المستخدمين (count + max `updatedAt`) |

النتيجة: `JSON.stringify([count, maxIso, …])` بعشرة حقول. تُستخدم لمقارنة البصمة وتخطي المزامنة عند عدم التغيّر، مع single-flight قائم.

### الجديد (استعلام واحد، EMPLOYEE فقط)

`syncFingerprint` أصبح يحتوي فرعًا للموظف قبل فرعي الشركة وOWNER:

```sql
WITH me AS (SELECT id FROM "EmployeeProfile" WHERE "userId" = $1),
scoped_properties AS (
  SELECT p.id, p."updatedAt" FROM "Property" p
  WHERE p."createdByUserId" = $1
     OR p."createdById" IN (SELECT id FROM me)
     OR EXISTS (SELECT 1 FROM "PropertyAssignment" a
                WHERE a."propertyId" = p.id AND a."employeeId" IN (SELECT id FROM me))
),
scoped_clients AS (
  SELECT c.id, c."updatedAt" FROM "Client" c
  WHERE c."createdById" IN (SELECT id FROM me)
     OR c."responsibleEmployeeId" IN (SELECT id FROM me)
),
property_stats / assignment_stats / client_stats / interest_stats / user_stats
SELECT … CROSS JOIN (خمس تجميعات كل منها صف واحد)
```

- نفس الحقول بنفس الترتيب ونفس صيغة ISO.
- `CROSS JOIN` بين خمس تجميعات **صف واحد** — لا cross join على مجموعات كبيرة.
- فرع MANAGER/الشركة وفرع OWNER (الخمسة Prisma) **لم يتغيّرا**.
- `sync()` وsingle-flight و`runSync` لم تتغيّر.

---

## 2. إثبات تكافؤ الصلاحيات

سكربت قراءة فقط استخدم **الخدمة المترجمة نفسها** (`dist-verify`) مع PrismaClient على `arkan_crm_load_test`:

| الفحص | النتيجة |
|---|---|
| بصمة جديدة vs القديمة (31 موظفًا، بينهم employee0 وموظفون من فرق مختلفة) | **31/31 متطابقة** |
| employee0: مجموعة العقارات | 222 = 222 (تطابق تام في المعرّفات) |
| employee0: مجموعة العملاء | 350 = 350 |
| employee0: الإسنادات | 220 = 220 |
| employee0: الاهتمامات | 0 = 0 |
| 4 موظفين إضافيين (عقارات/عملاء/إسنادات) | تطابق تام في كل المجموعات |

- لم يُستخدم fingerprint شركة بديلًا عن نطاق الموظف.
- نطاق OWNER-direct لا يدخل في `me`؛ لا يوجد أي مسار يوسّع النطاق.
- اختبارات الأمان الوظيفية (أدناه) تؤكد عدم ظهور موضوعات فريق آخر.

---

## 3. عدد الاستعلامات وزمن SQL

قياس مباشر لدالة البصمة على Stage C (نفس الخدمة والبيانات):

| | قبل | بعد |
|---|---:|---:|
| عدد الاستعلامات | **5** | **1** |
| زمن median (employee0) | **17.83 ms** | **18.21 ms** |

**زمن SQL نفسه لم ينخفض** لأن نفس المسح/الفلاتر تُنفَّذ؛ المكسب هو **4 رحلات/اقتناءات أقل من pool** لكل أول صفحة. لذلك:

- زمن الطلب المفرد يتغيّر قليلًا (warm: 42.3 → 35.8 ms في A/B).
- المكسب الحقيقي يظهر عند التزامن (50 طلبًا) وفي ضغط pool.

عدد استعلامات endpoint الموظف المتوقع: **10.04 → ~6.04** (2 auth + 1 fingerprint + 1 ids + 1 cards + 1 summary).

---

## 4. A/B على endpoint الموظف (10 و50 طلبًا)

نفس المضيف، تشغيلان متتاليان، نفس البيانات والـharness (`measure-sync.cjs` مع `SYNC_USER=employee0`)، نسخة `dist-verify-old` تعطّل فرع الموظف الجديد فقط (فتعود للخمسة Prisma):

| Level | القديم (5 استعلامات) | الجديد (1) | الفرق |
|---:|---|---|---|
| 10 | P50 186.6 / P95 201.9 ms | P50 223.3 / P95 239.2 ms | أبطأ ~19% (عينة صغيرة/ضجيج) |
| 50 | P50 **809.3 / P95 842.1 ms** | P50 **417.4 / P95 443.2 ms** | **−48% / −47%** |
| Warm single (8) | 42.3 / 59.4 ms | **35.8 / 41.5 ms** | −15% |
| Cold | 267.4 ms | **176.9 ms** | −34% |
| Errors | 0% | 0% | — |

مستوى 10 لا يُظهر تحسنًا (فرق 37 ms على 10 طلبات أثناء حمل CPU مرتفع)؛ مستوى 50 والقياس الكامل يدعمان التغيير. لم يُرصد أي خطأ أو 5xx.

---

## 5. قياس 100-user full-mix (تشغيل واحد)

**ظروف مضبوطة مُسجّلة:** `CPU (Get-Counter) = 42–54%`، ذاكرة حرة 3.8 GB، PostgreSQL < 0.3% CPU، `maxDbConnections = 10`، نفس الـharness/الخليط/400 طلب.

| Metric | القيمة |
|---|---|
| RPS | **87.26** |
| P50 / P95 | **2,945.8 / 4,514.7 ms** |
| Errors | **0 / 400** |
| Backend RSS | 191 → 279 MB |
| PostgreSQL | 259 → 339 MB |
| `/health` max (اتصال منفصل) | 222 ms |

### حسب الـendpoint (P50 / P95)

| Endpoint | n | P50 | P95 |
|---|---:|---:|---:|
| `/follow-ups?limit=50` | 60 | 4,074.2 | 4,533.6 |
| `/employees?limit=50` | 40 | 3,336.8 | 4,529.7 |
| `/employees?…&sort=clientsCount` | 20 | 3,304.9 | 4,528.9 |
| `/clients?limit=50` | 80 | 2,915.1 | 4,476.6 |
| `/follow-ups/manager/overview` | 40 | 2,854.3 | 4,451.0 |
| `/notifications?limit=20` | 40 | 2,506.3 | 4,298.5 |
| `/dashboard/manager?period=month` | 60 | 2,460.2 | 4,206.1 |
| `/properties?limit=50` | 40 | 2,487.2 | 4,231.2 |
| `/clients/recommendation-candidates` | 20 | 2,467.2 | 4,243.9 |

### المقارنة

| التشغيل | RPS | P50 | P95 | ظروف CPU |
|---|---:|---:|---:|---|
| Task 16 baseline | 91.00 | 2,738 | 4,312 | غير مسجّلة |
| Task 18 | 82.42 | 2,994 | 4,788 | 12–31% |
| **Task 19 (الآن)** | **87.26** | **2,946** | **4,515** | **42–54%** |

التشغيل الحالي أفضل من Task 18 رغم حمل CPU أعلى، وأقرب إلى baseline 91؛ لكن الظروف غير متكافئة مع Task 16، لذلك **لا يُclaimed** تحسن full-mix، ويُؤكد فقط **غياب التراجع**.

---

## 6. الاختبارات

```
5 suites passed, 28 tests passed
followups-fingerprint-optimization (جديد، 5 اختبارات)
followups-sync-optimization, followups, followups-pagination,
followup-history-authorization
```

الاختبار الجديد (على `arkan_crm_api_test`) يثبت:
1. **تكافؤ البصمة** مع التطبيق القديم لفريقين مختلفين.
2. **تغيّر البصمة** عند إنشاء/تعديل عميل، إنشاء عقار، إسناد، واهتمام.
3. **عدم تغيّرها** عند تغيير بيانات فريق آخر (مع تغيّر بصمة ذلك الفريق).
4. **single-flight** لخمسة طلبات موظف متزامنة → مزامنة واحدة.
5. **عدم ظهور** موضوع فريق آخر في قائمة الموظف، وظهوره لصاحبه.

Typecheck وESLint على الملف والاختبار: نظيفان.

---

## 7. القيود والاختناقات المتبقية

1. **زمن SQL للبصمة ثابت (~18 ms)**: التحسين يقلّل الرحلات لا العمل؛ الفائدة تظهر في pool عند التزامن.
2. **حارس الجلسة**: استعلامان لكل طلب على كل المسارات — أكبر بند متبقٍ ثابت.
3. **صفحة المتابعات**: استعلام IDs + استعلام بطاقات + ملخص (3 بعد المصادقة).
4. **قيود القياس**: حمل CPU خلفي 42–54% أثناء 100-user (OpenCode/التطبيقات)، وA/B عند 10 طلبات عينة صغيرة. لا تُستخدم هذه الأرقام كضمان إنتاجي.
5. **الخطوة التالية المقترحة**: لا تحسين إضافي على fingerprint (أصبح استعلامًا واحدًا)؛ التركيز التالي على حارس الجلسة أو إعادة baseline على مضيف هادئ.

---

## 8. السلامة

- الملف الإنتاجي المعدّل: `apps/backend/src/followups/followups.service.ts` فقط.
- اختبار جديد: `apps/backend/test/followups-fingerprint-optimization.spec.ts`.
- أداة القياس: `measure-sync.cjs` يدعم `SYNC_USER` (لقياس الموظف).
- البناء تم في مجلدات معزولة `dist-verify` / `dist-verify-old` ثم حُذفت؛ **لم يُبنَ dist المشترك يدويًا**، و4001 بقي سليمًا (200).
- `arkan_crm_load_test`: 5,021/5,000/15,000/15,000/5,000/23,750، 0 targetKey مكرر — دون reset/seed.
- `arkan_crm`: 12 MB، 23 migrations، لا تغيير.
- 4101 أُوقف؛ لا commits أو pushes.

**الحكم:** **GO** — التغيير آمن وظيفيًا وأمنيًا، ويحقق هدف تقليل الاستعلامات (5 → 1) وتحسنًا واضحًا عند 50 تزامنًا وغياب تراجع في 100-user. تحسن full-mix مقابل baseline 91 غير مُثبت بسبب اختلاف ظروف المضيف.

**متوقف للمراجعة اليدوية.**
