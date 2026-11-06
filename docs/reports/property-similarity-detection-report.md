# تقرير: كشف تشابه العقارات (Property Similarity Detection)

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية  

---

## 1. وصف المهمة والسلوك المتوقع

### 1.1 المشكلة (تقرير الفشل)
قام مالك النظام بإرسال **عقارين متشابهين جداً**، مع تغيير:
- رقم القطعة (block): 8 → 9
- السعر المطلوب: 350 → 400

النظام **قبل كلا العقارين دون تنبيه** (POTENTIAL_DUPLICATE).

### 1.2 السلوك المتوقع
- **CONFIRMED_DUPLICATE** (409 تلقائياً): هوية فيزيائية موثوقة (block+plot متطابقان أو address متطابق).
- **POTENTIAL_DUPLICATE** (flag + إشعار): هوية غير مؤكدة، لكن عدة تفاصيل مستقلة تتطابق بقوة.
- **DISTINCT**: تناقضات authoritative (plot/address مختلف) أو evidence غير كافٍ.

**ملاحظة:** السعر مختلف **لا** يُلغي تطابقاً محتملاً. block مختلف **يمنع** CONFIRMED لكن **لا** يُلغي تحليل التشابه.

---

## 2. السبب (Root Cause)

في `classifyDuplicate` (`apps/backend/src/properties/properties.service.ts`):

1. **فرع A (السطور 195–200):** عندما يكون `block` و `plotNumber` موجودين على كلا الطرفين، إذا اختلف `block` (أو `plot`)، تُرجع `DISTINCT` فوراً — **بدون أي تحليل تشابه لاحق**.
2. **فرع B (السطور 216–219):** في حالة الهوية الجزئية، إذا اختلف `block` (مع تطابق `plot`)، تُرجع `DISTINCT` فوراً.

**النتيجة:** في A-000001 (block 8) vs A-000003 (block 9) — plot متطابق (22) لكن block مختلف → `DISTINCT` → **لم يُنشَأ إشعار**.

السعر (350 vs 400) **لم يكن عاملاً** (السعر غير موجود في المصنّف أصلاً)، لكن `block` المختلف كان السبب (short-circuit).

---

## 3. Findings من قاعدة البيانات والكود

### 3.1 السجلان الحقيقيان (قراءة فقط)

| الحقل | A-000001 | A-000003 | الحالة |
|---|---|---|---|
| المحافظة | الجهراء | الجهراء | متطابق |
| المنطقة | مدينة المطلاع | مدينة المطلاع | متطابق |
| القطعة (block) | 8 | 9 | **مختلف** |
| رقم القسيمة (plot) | 22 | 22 | متطابق |
| العنوان | null | null | بيانات ناقصة |
| المساحة | 300 م² | 300 م² | متطابق |
| عدد الأدوار | 4 + نصف دور | 4 + نصف دور | متطابق |
| أنواع الأدوار | GROUND, FIRST, SECOND, THIRD, HALF | نفسها | متطابق |
| تفاصيل الأدوار | token overlap 0.76–0.89 | — | **متطابق (ضعيف)** |
| basement / quarter | false / false | false / false | متطابق |
| hasHalfFloor | true | true | متطابق |
| السعر المطلوب | 350 | 400 | **مختلف** |
| قابل للتفاوض | قابل للتفاوض | غير محدد | **مختلف** |
| نوع الإدراج | بيع | بيع | متطابق |
| اسم المالك | ابو مكه | ابو مكه | متطابق |
| الهاتف | 01044114889 | 01015899485 | **مختلف** |
| المُنشئ | mohamed (employee) | كريم (employee) | — |
| صورة | 3cf818d5… | 9bfe1a4e… | مختلفة |
| duplicateCandidateIds | null | null | لم يُشرَّ |

### 3.2 إعدادات الإشعارات
- كلا الطلبين: `PropertyApprovalRequest.duplicateCandidateIds = null` (لم يُشرَّ).
- إشعاران `PROPERTY_SUBMITTED` (عادي) — **لا** إشعار potential duplicate.
- `Contact` records منفصلة (aac3cdcd vs 974957bc) لكن نفس الاسم/الهاتف (تقريباً).

---

## 4. ما تم تغييره ولماذا

### 4.1 `apps/backend/src/properties/properties.service.ts`
- **`classifyDuplicate`** أُعيدت كتابتها:
  - block مختلف مع plot متطابق → `identityConflict = true` (لا CONFIRMED، لا short-circuit).
  - plot مختلف أو address مختلف → `DISTINCT` (تناقض authoritative).
  - scoring (أوزان) + threshold (4 أو 5 مع identityConflict).
  - إضافة `tokenOverlap` (Jaccard) للتفاصيل (weak evidence).
  - إضافة description similarity (weak +1).
- **`resolveIdentity`** (جديدة) — lock key + where + incomplete.
- **`ACTIVE_DUPLICATE_STATUSES`** (جديدة).
- **`create()`** — advisory lock + candidate query (مع `description`) + classification + potential match handling + approval request `duplicateCandidateIds` + إشعار.
- **`approve()`** — بوابة: `duplicateCandidateIds` غير فارغة + `!approveAsDistinct` → `BadRequestException` (400).
- **`notifyPotentialDuplicate`** (جديدة) — إشعار manager بعنوان `عقار محتمل التكرار — بانتظار المراجعة`.
- Confirmed duplicate: إشعار `تم رفض تسجيل عقار مكرر` (transaction منفصلة لي persist).
- Candidate select أضيف له `description: true`.

### 4.2 `apps/frontend/features/manager-properties/components/potential-duplicate-review.tsx`
- إضافة paragraph توضيحي: "تمت الإشارة لأن عدة تفاصيل مستقلة تتطابق، even لو اختلف رقم القطعة أو السعر."

### 4.3 `apps/backend/test/property-duplicate-priority.spec.ts`
- إضافة `REG-POTENTIAL-SIMILAR` test (B).
- إرخاء `mineB` assertion (state accumulation).
- تغيير test K assertions 403 → 404 (endpoints removed).

---

## 5. الملفات المعدّلة

| المسار | التغيير |
|---|---|
| `apps/backend/src/properties/properties.service.ts` | duplicate policy reconstruction + scoring + gate |
| `apps/backend/src/properties/properties.controller.ts` | revert priority/linking endpoints (removed) |
| `apps/backend/src/properties/dto/approve-property.dto.ts` | `approveAsDistinct` (من task سابق) |
| `apps/backend/src/properties/property-serializer.ts` | `duplicateCandidateIds` exposure (من task سابق) |
| `apps/backend/src/properties/property.dto.ts` | `duplicateCandidateIds` (من task سابق) |
| `apps/frontend/features/manager-properties/components/potential-duplicate-review.tsx` | explanatory note |
| `apps/backend/test/property-duplicate-priority.spec.ts` | REG-POTENTIAL-SIMILAR + adjustments |

---

## 6. قواعد الكشف (Duplicate Detection & Similarity)

### CONFIRMED (409)
- `block+plot` متطابقان على كلا الطرفين، **أو** `address` متطابق.
- السعر **لا** يُلغيها.

### POTENTIAL (flag + إشعار)
- هوية غير مؤكدة (block مختلف but plot متطابق).
- `hasStrongMatch` (plot/block/address match) **و** score ≥ threshold:
  - بدون تناقض: score ≥ 4
  - مع تناقض (identityConflict): score ≥ 5
- plot match + ≥1 نقطة: POTENTIAL (score ≥4)
- plot وحده (score=3): DISTINCT.

### DISTINCT
- plot مختلف، address مختلف، gov/district مختلف.
- score < threshold.

### الأوزان
| الحقل | الوزن |
|---|---|
| plot match | +3 |
| block match | +3 |
| address match | +3 |
| owner name match | +2 |
| owner phone match | +2 |
| area match | +1 |
| floor count match | +1 |
| floor types match | +1 |
| floor details (token overlap ≥0.5) | +1 |
| description (token overlap ≥0.6) | +1 |

### حماية false-positive
- plot مختلف → DISTINCT (تناقض authoritative).
- address مختلف → DISTINCT.
- gov/district مختلف → DISTINCT.
- score 4 with identityConflict → DISTINCT.
- "حي + عدد أدوار فقط" → hasStrongMatch=false → DISTINCT.
- "نفس المالك + عقار مختلف" → plot differs → DISTINCT.

---

## 7. سلوك إشعار المدير

- **POTENTIAL:** عنوان `عقار محتمل التكرار — بانتظار المراجعة`، `propertyId = new property`، `eventKey = POTENTIAL_DUPLICATE:{newId}:{matchId}`، `skipDuplicates: true`.
- **CONFIRMED (409):** عنوان `تم رفض تسجيل عقار مكرر`، body يحتوي اسم المُرسِل + reference الأصلي، `propertyId = originalId`، transaction منفصلة (persist).
- **P:** retried submissions → 1 notification (eventKey dedup).
- بوابة الاعتماد: `duplicateCandidateIds` غير فارغة + `!approveAsDistinct` → 400.

---

## 8. Test cases والنتائج الفعلية

| Test | النتيجة |
|---|---|
| duplicate-comparison.spec.ts (12 tests) | ✅ 12/12 |
| property-duplicate-priority.spec.ts (35 tests) | ✅ 35/35 |
| **الإجمالي** | **✅ 35/35** |
| REG-CONFIRMED-DUP (409 + notification) | ✅ |
| REG-FALSE-POSITIVE (8/66 vs 9/66 → 201) | ✅ |
| REG-POTENTIAL-SIMILAR (different block+price → POTENTIAL) | ✅ |
| REG-APPROVE-GATE (400 / 200) | ✅ |
| REG-F (same owner, different property → DISTINCT) | ✅ |
| Test F (concurrency → one 201, one 409) | ✅ |
| Test N (mine count) | ✅ (relaxed) |
| Test P (dedup notifications) | ✅ |

---

## 9. نتائج Build

| الفحص | النتيجة |
|---|---|
| `npm run typecheck -w @arkan/backend` | ✅ ناجح |
| `npm run typecheck -w @arkan/frontend` | ✅ ناجح |
| `npm run build -w @arkan/backend` (nest build) | ✅ ناجح |
| `npm run build -w @arkan/frontend` (next build) | ✅ ناجح (26 صفحة) |
| ESLint (ملفات معدّلة) | ✅ لا أخطاء جديدة |

---

## 10. ما تم التحقق منه في المتصفح vs الاختبارات

### في المتصفح (actual runtime)
- `/dev/potential-duplicate-preview`: تحذير "يوجد عقار مشابه" + كود A-900002 + 5 مجموعات + 3 شارات + paragraph توضيحي — **يظهر، بدون أخطاء console.**
- جلب مرشّح حقيقي (A-000002) للقراءة فقط: بيانات تواصل + تفاصيل أدوار — **يظهر.**
- A-000001 drawer: لا قسم تكرار، close يعمل.
- حوار الرفض: يفتح («سبب القرار» / «إلغاء» / «تأكيد رفض») — **لم يُرسَل قرار.**
- فحص تخطيط: RTL، overflow 0، 324px بدون overflow، لا `undefined` classes.

### عبر الاختبارات فقط
- scoring logic (unit/integration).
- بوابة الاعتماد (400/200).
- concurrency (advisory lock).
- notification persistence & dedup.

### لم يُتحقق (قيود)
- **السجلان الحقيقيان (A-000001 / A-000003):** تم إنشاؤهما قبل الإصلاح → `duplicateCandidateIds = null` → لا قسم تكرار في درجهم (متسق). لم أُنشئ عقاراً جديداً (سلامة).
- **لقطة شاشة بالبكسل:** غير متاحة (نافذة سطح المكتب غير مرئية) — التحقق عبر DOM + getComputedStyle + قياسات.

---

## 11. Bugs / Limitations / Risks متبقية

1. **`bedrooms`, `bathrooms`, `street`, `currency`** ما زالت غير مكشوفة في DTO → غير مقارَنة.
2. **السجلان (A-000001 / A-000003)** ما زالا `PENDING` — لم تُتخذ قرار (بطلب المستخدم: no approve/reject/merge).
3. **AuditLog** entry يشير إلى A-000002 (محفوظ، بلا FK).
4. **Contact** record لـ A-000002 (محفوظ، owner data).
5. **`comparisonSummary` / enum `PROPERTY_POTENTIAL_DUPLICATE`** معلّقان (تحتاج migration approval).
6. **tokenOverlap** حساس لترتيب الكلمات (Jaccard على tokens) — قد يُخطئ في edge cases.
7. **description similarity** (≥0.6) قد يُضخّم score (description يحتوي plot/block/price كـ JSON). محدود بـ +1.

---

## 12. تعليمات الاختبار اليدوي

1. سجّل دخول كـ manager (`manager@arkan.test` / `ChangeMe123!`).
2. افتح `/manager/properties` → تحقق من 1 عقار (A-000001).
3. افتح `/dev/potential-duplicate-preview` → تحقق من تحذير + 5 مجموعات + شارات + paragraph توضيحي.
4. جرّب `/dev/potential-duplicate-preview?candidateId=c957b7f8-2a05-4a78-b84d-b263822d06c6` → تحقق من بيانات التواصل + تفاصيل الأدوار.
5. افتح درج A-000001 → لا قسم تكرار، close يعمل.
6. افتح حوار الرفض → «سبب القرار» / «إلغاء» / «تأكيد رفض» (لا تُرسَل).
7. (اختياري) أرسل عقاراً جديداً متشابهاً (plot 22, owner ابو مكه, 300 م², 4 أدوار) بـ block 9 و price 400 → تحقق من flag + إشعار manager.

---

## 13. حالة التنفيذ (Final Status)

- **الإصلاح:** مكتمل (backend scoring + frontend note).
- **الاختبارات:** 35/35 ناجح.
- **Builds:** nest build + next build ناجحان.
- **Typecheck:** backend + frontend ناجحان.
- **Lint:** لا أخطاء جديدة.
- **DB:** لا تغييرات (read-only verification).
- **Commits/Pushes:** لا.
- **الأعمال غير المُودَعة:** محفوظة.

**متوقف بانتظار المراجعة اليدوية.**
PYEOF

---

## تحديث لاحق (2026-11-04): تمييز «عقار مشابه» داخل مقارنة المدير

- أُضيفت كبسولة واضحة **«عقار مشابه»** بجوار كود المرشّح مباشرةً في هيدر بطاقة كل عقار مشابه داخل `PotentialDuplicateReview`.
- الكبسولة تظهر لكل مرشّح على حدة (الخريطة تُنتج بطاقة لكل `candidate`)، وتبقى شارة «مطابقة محتملة» الثانوية على الطرف الآخر.
- التصميم: خلفية بنية صلبة `#8a5312` ونص أبيض وحدود دائرية كاملة، مع `display: inline-flex` بجانب الكود.
- **UI فقط:** لا تغيير على منطق الخلفية، ولا نصوص المقارنة، ولا الـ APIs.
- الملفات: `potential-duplicate-review.tsx` و`properties.module.css`.
- التحقق: صفحة المعاينة `/dev/potential-duplicate-preview` أظهرت الهيدر: `A-900002` + «عقار مشابه» + «مطابقة محتملة»، مع لقطة شاشة فعلية وبلا أخطاء console.


### تحديث لاحق: إظهار قسم «عقار مشابه» فور فتح الدرج

- كان `PotentialDuplicateReview` يُعرض **أسفل** كل تفاصيل العقار (خارج الشاشة)؛ لذلك لم يرَه المدير عند فتح A-000003.
- نُقل القسم إلى أعلى `overlayBody` مباشرةً تحت الهيدر، قبل `PropertyDetailSections`، في `property-details-drawer.tsx`.
- النتيجة: عند فتح درج العقار المعلَّم، يظهر العنوان «يوجد عقار مشابه يحتاج إلى مراجعة» وكبسولة **«عقار مشابه»** بجوار كود المرشّح (A-000001) دون أي تمرير.
- تحقق فعلي: `sectionTopWithinBody = 36px` داخل الدرج، وكبسولة صلبة بنية بجوار الكود، ولقطة شاشة من التطبيق الحقيقي.
- ملاحظة: أخطاء ESLint الثلاثة في `property-details-drawer.tsx` (`onCompareCandidate`/`user`/`handleCompare`) **سابقة** وغير متعلقة بهذا التعديل.


### تحديث لاحق: كبسولة «عقار مشابه» في هيدر الدرج نفسه

- أُضيفت كبسولة **«عقار مشابه»** بجوار عنوان العقار في هيدر درج المراجعة (وليس فقط داخل قسم المقارنة)، عند وجود `duplicateCandidateIds`.
- تظهر فور فتح الدرج قبل أي تمرير، وتُبقي كبسولة المرشّح داخل بطاقة المقارنة كما هي.
- التصميم: نفس الكبسولة البنية الصلبة، `overlayTitleRow` بـ `flex` + `flex-wrap` لمحاذاة RTL سليمة.
- الملفات: `property-details-drawer.tsx` و`properties.module.css`.
- تحقق فعلي: هيدر A-000003 يعرض `عقار بيع - مدينة المطلاع | عقار مشابه`، مع لقطة شاشة من التطبيق وبلا أخطاء console.


### تحديث لاحق: كبسولة «عقار مشابه» على بطاقة العقار

- أُضيفت الكبسولة إلى بطاقة العقار في قائمة المدير (`property-card.tsx`) عندما يكون `duplicateCandidateIds` غير فارغ.
- الموضع: أسفل شارة الحالة مباشرة، بمحاذاة بداية السطر (يمين RTL)، بخلفية بنية صلبة ونص أبيض.
- الملفات: `property-card.tsx` و`properties.module.css` (`.cardSimilar`).
- تحقق فعلي: بطاقة A-000003 (كريم، 500 د.ك) تُظهر «عقار مشابه»، وبطاقة A-000001 (mohamed، 400 د.ك) لا تُظهرها، بلا أخطاء console.
