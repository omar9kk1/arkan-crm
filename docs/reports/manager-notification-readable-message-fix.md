# تقرير: إصلاح نص إشعار المدير (UUIDs وتنسيق RTL)

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية  

---

## 1. السبب الجذري

في `PropertiesService.notifyPotentialDuplicate` كان نص الإشعار يُبنى هكذا:

```ts
body: `عقار ${propertyReference} (مقدّم من ${viewer.id}) يشبه العقار ${matchRef}. يُرجى المراجعة.`
```

- `viewer.id` هو **UUID خام** لمستخدم الموظف (لأن `AuthUser` لا يحمل الاسم)، فظهر في نص الإشعار.
- العنوان كان قديماً: «عقار محتمل التكرار — بانتظار المراجعة».
- لا توجد بيانات منظمة (كود العقار المشابه، اسم الموظف، الحالة)؛ الاعتماد كان على نص حر.

---

## 2. ما تم تغييره

### 2.1 إنشاء الإشعار (Backend)
`apps/backend/src/properties/properties.service.ts` — `notifyPotentialDuplicate`:
- العنوان: **«عقار مشابه يحتاج إلى مراجعة»**.
- الرسالة: **«تم اكتشاف تشابه محتمل بين عقارين في النظام. يُرجى مراجعة البيانات قبل اتخاذ القرار.»**
- لا UUIDs ولا أي معرف تقني داخل النص.
- يبقى `propertyId` و`eventKey` (`POTENTIAL_DUPLICATE:...`) كما هما دون تغيير دلالات الحدث.

### 2.2 إثراء وقت القراءة (Backend)
`apps/backend/src/notifications/notification.dto.ts` + `notifications.service.ts`:
- أُضيف حقل `duplicate` إلى `NotificationDto`:
  ```ts
  {
    newPropertyReference: string | null;      // كود العقار الجديد
    existingPropertyReference: string | null; // كود العقار المشابه
    employeeName: string | null;              // اسم الموظف (للمدير فقط)
    status: PropertyStatus | null;            // الحالة
  }
  ```
- `potentialDuplicateContexts()` يجمع بيانات الإشعارات من نوع `POTENTIAL_DUPLICATE` دفعة واحدة:
  - العقار الجديد (الكود، الحالة، اسم المُنشئ).
  - آخر `PropertyApprovalRequest` → `duplicateCandidateIds` → كود العقار المشابه.
- **الإشعارات القديمة** تُصلَح وقت العرض أيضاً، دون أي تعديل على صفوفها أو نصها المخزّن.
- **الأمان:** الإثراء يُعاد فقط عندما يكون المستلم `MANAGER`؛ للموظف `duplicate = null`. لا تُكشف هوية موظف آخر أو تفاصيل مقارنة للموظف.

### 2.3 الواجهة الأمامية
`apps/frontend/features/notifications/view.ts`:
- `isPotentialDuplicateNotification` (حسب `eventKey`).
- `stripInternalIds` — يزيل أي UUID من النصوص القديمة.
- `duplicateNotificationDetails` — تفاصيل مختصرة (كود جديد، كود مشابه، الموظف، الحالة «بانتظار المراجعة»).
- `notificationDisplay` — عرض موحّد: عنوان/رسالة قانونية + تفاصيل، أو رسالة عادية منقّاة.

طُبّق على:
- جرس الإشعارات `notification-bell.tsx` (القائمة المنسدلة).
- صفحة إشعارات المدير `notification-card.tsx` و`notification-details-drawer.tsx`.
- إشعارات الموظف `employee-notification-card.tsx` و`employee-notification-details-drawer.tsx` (تنقية UUID فقط؛ لا تفاصيل مقارنة).

### 2.4 RTL والتنسيق
- `notification-bell.module.css` و`notifications.module.css`:
  - `.duplicateDetails` شبكة مضغوطة بمسافات صغيرة.
  - `.duplicateRow` صف `flex` مع `space-between` (RTL سليم).
  - `.duplicateCode`: `direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums` لعرض الأكواد.
  - `.itemMessage` يحتفظ بـ `overflow-wrap: anywhere`، و`min-width: 0` على الحاويات لمنع التمدد.
- لا بطاقات ضخمة ولا فراغات زائدة؛ التصميم الزجاجي (Astra-glass) كما هو.

---

## 3. الإشعارات القديمة (إثبات فعلي)

في قاعدة التطوير وُجد إشعار قديم **أُنشئ قبل الإصلاح** يحتوي حرفياً على:

```
عقار A-000003 (مقدّم من ab2b3744-d9ae-4494-9feb-367b07cdd11b) يشبه العقار A-000001. يُرجى المراجعة.
```

بعد الإصلاح (دون تعديل الصف):
- API أعاد:
  ```json
  "duplicate": {
    "newPropertyReference": "A-000003",
    "existingPropertyReference": "A-000001",
    "employeeName": "كريم",
    "status": "PENDING"
  }
  ```
- الواجهة عرضت: العنوان والرسالة القانونيين + «العقار الجديد A-000003»، «العقار المشابه A-000001»، «الموظف كريم»، «الحالة بانتظار المراجعة» — **بدون UUID**.

---

## 4. التحقق

### اختبارات آلية
| الاختبار | النتيجة |
|---|---|
| `manager-notification-display.spec.ts` (جديد) | 6/6 |
| `property-duplicate-priority.spec.ts` (يتضمن `REG-NOTIF-READABLE`) | ناجح |
| `notifications.spec.ts` | ناجح |
| `property-owner-lifecycle.spec.ts` + `property-trash.spec.ts` + `duplicate-comparison.spec.ts` | ناجحة |
| **إجمالي المجموعة المركّزة** | **80/80** |

`REG-NOTIF-READABLE` يثبت أن إشعار المدير يعرض الكودين واسم الموظف والحالة، وأن الرسالة لا تحتوي UUID.

### Typecheck / Lint / Build
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ (أُعيد تشغيله منفرداً بعد البناء) |
| ESLint (ملفات الإشعارات + الخلفية) | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |

### المتصفح (Runtime)
- جرس الإشعارات (Manager): عرض العنوان والرسالة القانونيين + التفاصيل، **لا UUID**، ولا أخطاء console.
- صفحة `/manager/notifications`: البطاقة تعرض نفس المحتوى القانوني + التفاصيل.
- فحص التنسيق المحسوب:
  - كود العقار: `direction: ltr` و`unicode-bidi: isolate`.
  - الرسالة: `overflow-wrap: anywhere`.
  - صف التفاصيل: `flex` + `space-between`.
  - لا تجاوز أفقي في اللوحة أو المستند (`scrollWidth - clientWidth = 0`).
- لم يتم النقر على الإشعار لتجنب تغيير حالة القراءة (readAt) في قاعدة البيانات؛ منطق التوجيه `notificationRoute` لم يُعدّل.

---

## 5. القيود
- لم تُختبر حالة «المرجع المفقود» بصرياً على بيانات حقيقية (لا إشعار بمرجع محذوف)، لكنها مغطاة باختبار الوحدة (تُحذف التفاصيل غير المتاحة).
- النص الطويل جداً لم يُختبر ببيان حقيقي طويل؛ التغليف مضمون عبر `overflow-wrap: anywhere` و`min-width: 0`.
- لم تُنفَّذ أي تغييرات على قاعدة البيانات أو migrations أو commits.
- أُعيد تشغيل خادم الواجهة المحلي لأن الحزمة القديمة كانت مخزّنة مؤقتاً؛ الخادم يعمل الآن على `localhost:3001`.

**متوقف للمراجعة اليدوية.**


---

## 6. تحديث لاحق: تعتيم خلفية لوحة الإشعارات

بطلب من مالك العمل (الخلفية كانت شفافة أكثر من اللازم):

| | قبل | بعد |
|---|---|---|
| خلفية اللوحة | `rgba(255, 253, 248, 0.48)` | `rgba(247, 242, 233, 0.94)` |
| الضبابية | `blur(20px)` | `blur(24px)` |
| الظل | `0 8px 32px rgba(60,45,25,0.12)` | `0 14px 44px rgba(50,38,22,0.18)` |
| الحدود | أبيض شفاف | بني هادئ `rgba(120,100,70,0.14)` |
| خلفية الصف غير المقروء | `0.25` | `0.55` |

- الملف: `apps/frontend/features/notifications/components/notification-bell.module.css`.
- تم التحقق بصرياً في المتصفح (لقطة شاشة): اللوحة أصبحت شبه معتمة، ونصوص لوحة المؤشرات خلفها لم تعد تنفذ، مع بقاء التصميم الزجاجي.
- لا تغييرات على المنطق أو قاعدة البيانات أو الـ APIs.


## 7. تحديث لاحق: فصل كل إشعار في بطاقة مستقلة

بطلب من مالك العمل (كانت الإشعارات متلاصقة كقائمة واحدة):

- `.list`: من `display: block` إلى `display: grid; gap: 8px`.
- كل `.item` أصبح بطاقة مستقلة: حدود `1px` بلون بني هادئ، `border-radius: 16px`، ظل خفيف، وخلفية بيضاء شفافة.
- أُزيل `border-bottom` القديم وقاعدة `:last-child`.
- تمييز المقروء/غير المقروء بقي عبر الخلفية، مع تأثير hover أوضح.

**التحقق البصري:** لقطة شاشة فعلية أكدت ظهور إشعارين منفصلين بمسافة واضحة بينهما، دون أخطاء console، وبقاء RTL والتصميم الزجاجي.
