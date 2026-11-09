# إصلاح تغطية توصيات العملاء بعد pagination

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** توصيات العقارات للموظف + تغطية جميع العملاء المؤهلين.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو تغييرات schema.  
> لا تعديل على `arkan_crm` أو `.env`.  
> لا commits أو pushes.

---

## 1. السبب الجذري

بعد تحويل `GET /clients` إلى cursor pagination بافتراضي 50، كان مكوّن:

`apps/frontend/features/employee-dashboard/components/employee-property-recommendations.tsx`

يستدعي `listClients()` بدون pagination. لذلك أصبح يرى **أول 50 عميلًا فقط** بدل حتى 1000 سابقًا، فانخفضت تغطية التوصيات للسجلات الواقعة بعد الصفحة الأولى.

---

## 2. الإصلاح

### مسار خادمي مخصص

أُضيف:

```http
GET /clients/recommendation-candidates
```

- يعيد **كل العملاء المؤهلين** في نطاق المشاهد، وليس صفحة واحدة.
- لا يوجد سقف 1000 أو أي سقف إجمالي.
- يفلتر بـ`requestData != null` فقط: العملاء الذين لديهم وثيقة طلب منظمة يمكن أن يشاركوا في المطابقة.
- يعيد فقط الحقول التي يحتاجها المطابق: `id`, `name`, `requestData`.
- لا يعيد الهاتف أو الملاحظات أو أي علاقات ثقيلة.
- النطاق مطبق في قاعدة البيانات عبر `clientOwnershipWhere(viewer)`:
  - EMPLOYEE: عملاؤه/المسؤول عنهم فقط.
  - MANAGER: فريقه الحالي + عملاؤه.
  - OWNER: كل الشركة.
- المسار مُعرّف قبل `:id` حتى لا يُلتقط كمعرّف عميل.

### الواجهة

- `employee-property-recommendations.tsx` أصبح يستخدم:
  - `listClientRecommendationCandidates()`
  - بدل `listClients()`.
- **منطق المطابقة والترتيب الحالي لم يُعدّل**: نفس `buildRecommendations`، نفس قواعد النوع/المنطقة/الميزانية/نوع العقار، ونفس `recs.slice(0, 4)` بعد الترتيب.
- لذلك يتم التطابق والترتيب على كل المرشحين المؤهلين، ثم يُعرض top-N فقط.

---

## 3. الاختبارات

### مجموعة العملاء المركزة

```powershell
npm run test -w @arkan/backend -- `
  test/clients.spec.ts `
  test/clients-pagination.spec.ts
```

**النتيجة: 2/2 حزمة — 34/34 اختبارًا ناجحًا.**

### الاختبار الجديد للتوصيات

داخل `clients-pagination.spec.ts`:

- تم إنشاء **1,005 عميل**، جميعهم لديهم `requestData` منظم.
- `GET /clients/recommendation-candidates` كـOWNER أعاد **1,005 مرشحًا** — أي لا يوجد سقف 1000.
- العميل رقم **697** (`clientIds[696]`، خارج أول 50 بكثير) موجود في النتائج.
- الاستجابة تحتوي فقط على `id`, `name`, `requestData` ولا تسرّب الهاتف/العلاقات.
- MANAGER A وEMPLOYEE A حصلا على **700 مرشح** فقط (فريقهما)، ولا يظهر لديهما:
  - عميل فريق B (`clientIds[700]`).
  - عميل المالك المباشر (`clientIds[1004]`).
- EMPLOYEE B حصل على **200 مرشح** فقط، ولا يرى عميل الفريق A.
- اختبارات pagination والتفاصيل السابقة بقيت ناجحة ضمن نفس الحزمة.

### Typecheck وLint

- `npm run typecheck -w @arkan/backend`: ناجح.
- `npm run typecheck -w @arkan/frontend`: ناجح.
- ESLint على الملفات المعدلة: ناجح.

---

## 4. الملفات المعدلة

- `apps/backend/src/clients/client.dto.ts`
  - `ClientRecommendationCandidateDto` و`ClientRecommendationCandidateListDto`.
- `apps/backend/src/clients/clients.controller.ts`
  - `GET /clients/recommendation-candidates`.
- `apps/backend/src/clients/clients.service.ts`
  - `recommendationCandidates(viewer)` بنطاق DB و`requestData` فقط.
- `apps/backend/test/clients-pagination.spec.ts`
  - توسيع البيانات إلى 1,005 عميل مؤهل + اختبار التغطية والعزل.
- `apps/frontend/lib/api/client-types.ts`
  - نوع مرشحي التوصيات.
- `apps/frontend/lib/api/clients-api.ts`
  - `listClientRecommendationCandidates()`.
- `apps/frontend/features/employee-dashboard/components/employee-property-recommendations.tsx`
  - استخدام المسار الجديد بدل الصفحة الأولى.

---

## 5. تحقق الواجهة

لم يتوفر في هذه الجلسة جلسة متصفح موثقة لحساب MANAGER/EMPLOYEE، ولم تُعدّل حسابات أو بيانات حقيقية للحصول على واحدة. لذلك:

- لم يُجرَ smoke بصري فعلي لصفحتي العملاء manager/employee.
- تم التحقق عبر:
  - typecheck للواجهة.
  - ESLint.
  - اختبارات API المركزة (بما فيها عزل الأدوار وpagination).
- يبقى التحقق البصري (Search / Filters / Load More / Drawer / RTL / mobile) مطلوبًا يدويًا في جلسة آمنة.

---

## 6. القيود المتبقية

1. مسار المرشحين يعيد **كل العملاء المؤهلين** (id/name/requestData) إلى المتصفح. لا يوجد سقف، وهو مطلوب للحفاظ على المطابقة الكاملة، لكنه قد يصبح كبيرًا جدًا مع نمو هائل. الحل المستقبلي: نقل المطابقة/الترتيب إلى الخادم وإرجاع top-N فقط.
2. لم تُضف فهارس؛ `requestData IS NOT NULL` قد يستفيد لاحقًا من فهرس جزئي، ويحتاج migration بموافقة منفصلة.
3. لم يُعدّل منطق المطابقة نفسه، لذا لا تغيير في ترتيب الأسباب أو قواعد الأعمال.

---

## 7. السلامة

- لا تغييرات على `arkan_crm` أو بيانات الأعمال.
- لا migrations أو schema.
- لا `.env`.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
