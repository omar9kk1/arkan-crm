# تقرير: إشعار الموظف عند استعادة عقاره من المحذوفات

**التاريخ:** 2026-11-05  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية  

---

## 1. السبب

عملية `restore` كانت تُحدّث `deletedAt` وتكتب سجل تدقيق فقط، **دون إنشاء أي إشعار للموظف**. لذلك لم يعرف الموظف بالاستعادة، وبقيت قائمته بحاجة إلى تحديث يدوي (وإن كان الـ polling أضاف تحديثاً دورياً لاحقاً).

---

## 2. ما تم تنفيذه

### 2.1 إشعار الاستعادة
أُضيف `NotificationsService.notifyPropertyRestored` ويُستدعى **داخل معاملة الاستعادة** بعد نجاح التحديث:
- العنوان: **«تم استعادة العقار»**.
- الرسالة: «قام مدير النظام باستعادة عقارك من المحذوفات، وأصبح متاحًا مرة أخرى في قائمة عقاراتك.»
- سطر `رقم العقار: <الكود الحالي>` — يستخدم `approvedReference ?? reference`، أي **A** للعقار المعتمد و**P** للمعلّق.
- سطر `التاريخ: <تاريخ الاستعادة>`.
- النوع `SYSTEM` (بدون enum/migration جديد).
- `propertyId` مضبوط ليُفتح العقار من الإشعار.

### 2.2 المستلم والتفرد
- يُرسل إلى `createdByUserId` (الموظف المُرسِل الأصلي) **فقط**؛ لا مدير ولا موظف آخر.
- `eventKey = PROPERTY_RESTORED:<propertyId>:<trashedAt.getTime()>`:
  - إعادة محاولة نفس الاستعادة بعد نجاحها → 400 (العقار ليس في Trash) → لا إشعار مكرر.
  - دورة جديدة (حذف ثم استعادة لاحقاً) → حدث جديد مشروع بإشعار جديد.
- الإنشاء داخل المعاملة: أي فشل في الاستعادة (تعارض هوية/حالة) لا يُرسل إشعاراً.

### 2.3 الحفاظ على الحالة والكود
- الاستعادة لا تزال تُفرّغ فقط `deletedAt`/`deletedByUserId`/`deletionReason`.
- `status` يبقى كما هو: `PENDING` يبقى `PENDING`، والمعتمد يبقى `AVAILABLE`.
- لا اعتماد تلقائي، ولا تخصيص A جديد. الكود الرسمي يبقى كما هو:
  - معلّق: `reference` = P و`approvedReference` = null.
  - معتمد: `reference` = P و`approvedReference` = A.

### 2.4 فتح الإشعار والمزامنة
- الإشعار يحمل `propertyId`؛ لذلك `notificationRoute` يوجّه إلى:
  `/employee/properties?property=<id>` (بدون `decision=1`) ويُفتح درج الموظف الحالي.
- العقار المستعاد صار نشطاً (`deletedAt = null`)، لذا `GET /properties/:id` يعمل ويُظهر الحالة الأصلية.
- إشعار الاستعادة `SYSTEM` لكنه مرتبط بعقار؛ `notificationAffectsPropertyLists` يرجع `true`، فيُنشر تحديث قائمة العقارات فور وصوله، إضافة إلى الـ polling كل 20 ثانية وfocus/visibility من المزامنة السابقة.

---

## 3. الملفات المعدّلة

- `apps/backend/src/notifications/notification-events.ts`
  - عنوان `RESTORED: 'تم استعادة العقار'`.
  - مفتاح `restored(propertyId, trashedAt)`.
- `apps/backend/src/notifications/notifications.service.ts`
  - `notifyPropertyRestored`.
- `apps/backend/src/properties/properties.service.ts`
  - استدعاء الإشعار داخل معاملة `restore` مع `restoredAt` و`trashedAt`.
- `apps/backend/test/employee-property-restoration-notification.spec.ts` (جديد، 5 اختبارات).

لم تُغيَّر الواجهة الأمامية أو التصميم.

---

## 4. الاختبارات والتحقق

### اختبارات معزولة (Test DB)
```
employee-property-restoration-notification.spec.ts
property-trash.spec.ts
notifications.spec.ts
employee-decision-notifications.spec.ts
property-codes.spec.ts
property-owner-lifecycle.spec.ts
→ 6 suites, 59 tests passed
```

الاختبارات الجديدة تغطي:
1. استعادة عقار معلّق → إشعار للمُنشئ فقط، بالكود P والتاريخ، والحالة تبقى PENDING.
2. استعادة عقار معتمد → الإشعار يعرض الكود A، والحالة تبقى AVAILABLE، و`reference`/`approvedReference` محفوظان.
3. إعادة محاولة الاستعادة → 400، وإشعار واحد فقط.
4. فشل الاستعادة (غير محذوف أو تعارض هوية 409) → لا إشعار.
5. مسار الإشعار → `/employee/properties?property=<id>` بلا `decision=1`، والإشعار يُفعّل تحديث قوائم العقارات.

### TypeScript / ESLint / Builds
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| ESLint (الملفات المعدلة) | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |
| `/health` | 200 |

**قيود:** قاعدة التطوير فارغة (بعد التنظيف المصرح به)، ولم يُنشأ عقار حقيقي لاختبار الاستعادة بصرياً عبر جلستي مدير/موظف؛ السلوك مغطى باختبارات التكامل المعزولة + التحقق من المسار ومنطق المزامنة.

---

## 5. ملاحظات
- لا تغييرات على قاعدة البيانات أو migrations أو commits.
- صلاحيات المدير/الموظف، الخصوصية، سلة المحذوفات، وعدّادات غير المقروء كما هي.
- تصميم Astra-glass لم يتغير.

**متوقف للمراجعة اليدوية.**
