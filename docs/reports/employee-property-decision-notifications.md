# تقرير: إشعارات الموظف عند رفض أو حذف عقاره

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية  

---

## 1. ما تم تنفيذه

### 1.1 إشعار الرفض (Manager Reject)
يُرسل **للموظف صاحب العقار فقط** داخل نفس معاملة الرفض:
- العنوان: **«تم رفض تسجيل العقار»**
- الرسالة: «تم رفض طلب تسجيل عقارك. يمكنك الاطلاع على سبب الرفض وتفاصيل العقار.»
- سطر `رقم العقار: <الكود>`
- سطر `سبب الرفض: <السبب الفعلي>`
- سطر `التاريخ: <تاريخ القرار>`
- سطر **`عقار مشابه`** فقط إذا كان سبب القرار يتضمن تكراراً/تشابهاً (مكرر/تكرار/مشابه/تشابه).
- لا يُرسل لأي موظف آخر، ولا للمدير.

### 1.2 إشعار الحذف المؤقت (Manager Soft Delete)
يُرسل للموظف صاحب العقار فقط:
- العنوان: **«تم حذف العقار بقرار المدير»**
- الرسالة: «تم نقل عقارك إلى المحذوفات. يمكنك الاطلاع على تفاصيله وسبب الحذف.»
- `رقم العقار` + `سبب الحذف` (إن وُجد) + `التاريخ` + **`عقار مشابه`** عند وجود سبب تكرار/تشابه.
- النوع `SYSTEM` (بدون enum جديد أو migration).
- لا يُرسل عند غياب منشئ العقار.

### 1.3 منع التكرار
- الرفض المتكرر مرفوض بـ 409 من الخدمة.
- الحذف المؤقت المتكرر مرفوض (العقار في Trash بالفعل).
- `eventKey` فريد (`PROPERTY_REJECTED:<round>` / `PROPERTY_TRASHED:<propertyId>`) مع `skipDuplicates`.

---

## 2. فتح العقار من الإشعار (Read-only)

### 2.1 نقطة قراءة آمنة
`GET /properties/:id/history`:
- تُعيد تفاصيل العقار **للمُنشئ الأصلي فقط** حتى لو كان `REJECTED` أو ناعم الحذف.
- أي موظف آخر → **404** غير كاشف.
- تشمل الاستجابة: الموقع، المالك/جهة التواصل، المساحة، الأدوار، السعر، الصورة، الوصف، `reviewStatus`/`reviewNotes` (سبب الرفض)، و`deletedAt`/`deletionReason`.
- العقار المحذوف نهائياً → **404** برسالة: «تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.»

### 2.2 الواجهة
- الإشعار يحتوي `propertyId`، ودالة التوجيه تفتح `/employee/properties?property=<id>&decision=1` لإشعارات القرار.
- `usePropertyList` يجرّب `GET /properties/:id` أولاً (يكفي للمرفوض)، وعند الفشل للموظف يجرّب `history` (للمحذوف مؤقتاً).
- الصفحة تمرّر `decision=1` إلى درج الموظف فيصبح **read-only** (تُخفى أزرار التعديل).
- زر **الرجوع** في الدرج يعيد إلى سياق الإشعار (router.back) كما كان.
- الحالة تظهر «مرفوض» للمرفوض و**«محذوف بقرار المدير»** للمحذوف (عبر `displayStatus`).
- يظهر سبب الرفض/الحذف داخل قسم معلومات المراجعة في الدرج.
- إشعار قرار لِعقار محذوف نهائياً: يبقى سجل الإشعار في الصندوق (بلا رابط)، وعند النقر تظهر رسالة «تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.»

### 2.3 الحذف النهائي
عند الحذف النهائي:
- تُحذف إشعارات العقار العادية.
- تُحفظ إشعارات القرار (`PROPERTY_REJECTED:` / `PROPERTY_TRASHED:`) ويُفصل `propertyId` (`NULL`) حتى لا يكسر قيد المفتاح الخارجي، وتبقى الرسالة/الكود/السبب في السجل.

---

## 3. الملفات المعدّلة

### Backend
- `apps/backend/src/properties/properties.service.ts`
  - `reject`: تمرير السبب/التاريخ/علامة التشابه.
  - `softDelete`: إنشاء إشعار الحذف داخل المعاملة.
  - `history`: قراءة تاريخية للمُنشئ فقط.
  - `permanentDelete`: حفظ إشعارات القرار وفصل `propertyId`.
  - `isDuplicateDecisionReason`.
- `apps/backend/src/properties/properties.controller.ts` — `GET /properties/:id/history`.
- `apps/backend/src/notifications/notification-events.ts` — عنوان الرفض الجديد + `TRASHED` + مفتاح `trashed`.
- `apps/backend/src/notifications/notifications.service.ts`
  - `notifyPropertyRejected` مع السبب/التاريخ/التشابه.
  - `notifyPropertyTrashed` جديد.
  - `decisionBody` + تنسيق التاريخ.
  - `visiblePropertyIds`: المنشئ يرى رابط إشعار عقاره المحذوف.
- `apps/backend/src/properties/property-serializer.ts` — `deletedByName` للمدير فقط.
- `apps/backend/test/employee-decision-notifications.spec.ts` (جديد، 6 اختبارات).
- تحديث `notifications.spec.ts` و`frontend-properties-contract.spec.ts` ليتوافقا مع دورة المالك المؤقت/التفاصيل الجديدة.

### Frontend
- `apps/frontend/lib/api/properties-api.ts` — `getPropertyHistory`.
- `apps/frontend/lib/use-property-list.ts` — fallback للموظف.
- `apps/frontend/lib/property-adapter.ts` — «محذوف بقرار المدير» + حقول الحذف.
- `apps/frontend/lib/property-details.ts` — `deletedAt`/`deletionReason`.
- `apps/frontend/features/manager-properties/components/property-detail-sections.tsx` — عرض سبب الحذف.
- `apps/frontend/features/employee-properties/components/employee-property-details-drawer.tsx` — `readOnly`.
- `apps/frontend/features/employee-properties/components/employee-properties-page.tsx` — `decision=1`.
- `apps/frontend/features/employee-properties/model.ts` — حقول الحذف.
- `apps/frontend/features/notifications/notification-target.ts` — `&decision=1`.
- `apps/frontend/features/notifications/view.ts` — `isDecisionNotification`.
- `apps/frontend/features/notifications/components/notification-bell.tsx` — رسالة عدم الإتاحة + `pre-line`.
- `apps/frontend/features/employee-notifications/components/employee-notification-details-drawer.tsx` — رسالة عدم الإتاحة.
- CSS: `notifications.module.css` + `notification-bell.module.css`.

---

## 4. الاختبارات والتحقق

### اختبارات معزولة
```
notifications.spec.ts
employee-decision-notifications.spec.ts   (6 جديدة)
property-trash.spec.ts
property-owner-lifecycle.spec.ts
property-duplicate-priority.spec.ts
frontend-properties-contract.spec.ts
frontend-notification-target.spec.ts
frontend-property-adapter.spec.ts
employee-property-filters.spec.ts
manager-notification-display.spec.ts
→ 10 suites, 167 tests passed
```

`employee-decision-notifications` يثبت:
1. الرفض → إشعار للمُنشئ فقط بالكود/السبب/التاريخ، بلا علامة تشابه زائفة.
2. الحذف المؤقت بسبب «عقار مشابه...» → العلامة تظهر، والتاريخ المحفوظ للمُنشئ فقط.
3. الحذف العادي → السبب صحيح وبلا علامة تشابه.
4. الرفض المتكرر → 409 وإشعار واحد فقط.
5. الحذف النهائي → إشعار القرار يبقى (`propertyId = NULL`) وسجل التفاصيل يعطي الرسالة اللطيفة.
6. مسار الإشعار → `&decision=1` لإشعارات القرار فقط.

### Typecheck / Lint / Build
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| ESLint (ملفات الخلفية/الواجهة/الاختبارات المعدلة) | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |

### المتصفح
- تم التحقق القرائي فقط: `GET /properties/:id/history` بمعرّف غير موجود يعيد 404 برسالة «تفاصيل العقار لم تعد متاحة بعد الحذف النهائي.»، و`/notifications` يعمل، و`/health` = 200.
- **لم يتم** رفض/حذف أي عقار حقيقي في قاعدة التطوير لاختبار النقر بصرياً، التزاماً بقيد «عدم تعديل سجلات التطوير الموجودة». سلوك النقر والدرج مغطى باختبارات التكامل + بناء الواجهة.

---

## 5. القيود والملاحظات
1. إشعار الحذف نوعه `SYSTEM` (لا enum جديد)؛ العنوان يوضح القرار.
2. الإشعارات القديمة التي أُنشئت قبل هذا التغيير لا تحتوي السبب في نصها؛ لا يُعاد كتابة السجل. (لا توجد إشعارات قرار قديمة في قاعدة التطوير الحالية.)
3. بطاقة إشعار الموظف تعرض سطراً مختصراً؛ التفاصيل الكاملة (الكود/السبب/التاريخ/العلامة) تظهر في الجرس والدرج.
4. لا migrations، لا reseeds، لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
