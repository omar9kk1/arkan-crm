# تقرير: ربط لوحة المدير الرئيسية ببيانات قاعدة البيانات الحقيقية

**التاريخ:** 2026-11-05  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية

---

## 1. مكوّنات اللوحة الحالية التي تم فحصها

تم الحفاظ على كل مكوّن وترتيبه وحجمه ونمطه:

1. **أربع بطاقات إحصائية** (`DashboardStats`):
   - إجمالي العقارات.
   - إجمالي العملاء.
   - إجمالي الملاك.
   - إجمالي الموظفين.
2. **لوحة «الصفقات والعمولات»** (`DealsChartPlaceholder`):
   - شارة العمولات.
   - منحنى الصفقات.
   - ثلاث قيم: عدد الصفقات، قيمة الصفقات، متوسط الصفقة.
3. **لوحة «أفضل الموظفين»** (`TopEmployeesPlaceholder`): ثلاثة صفوف.
4. **لوحة «قسم العقارات»** (`PropertiesSummary`): أربع حالات + أشرطة تقدم.
5. **لوحة «العملاء والملاك»** (`PeopleSummary`): أربع قيم.
6. **«تنبيهات مهمة»** (`DashboardFeed`).
7. **«آخر الأنشطة»** (`DashboardFeed`).
8. **محدّد الفترة** (معطّل) وملاحظة أعلى اللوحة.

---

## 2. البيانات التجريبية التي أُزيلت

كانت كل القيم تأتي من `apps/frontend/features/manager-dashboard/dashboard-preview.ts`:

- 32 عقارًا، 43 عميلًا، 16 مالكًا، 4 موظفين.
- 18 متاحًا، 8 بانتظار الموافقة.
- 14 صفقة، 1.84M قيمة، 131K متوسط، 18.6K عمولة.
- أسماء وأرقام «أفضل الموظفين».
- 7 متابعات متأخرة و54 متابعة تمت.
- ثلاث تنبيهات وثلاثة أنشطة ثابتة.

أصبح الملف الآن يصدّر فقط:

- `emptyManagerDashboard`: حالة صفرية حقيقية للتحميل الأول/الفشل.
- `compactMetric` / `compactKwd`: تنسيق العرض بنفس نمط الأرقام السابق.

لا توجد أي قيمة تجريبية متبقية في أي مكوّن.

---

## 3. المصدر الحقيقي لكل بطاقة

أُضيف endpoint واحد للقراءة فقط:

```
GET /dashboard/manager
```

Manager-only عبر `@Roles(Role.MANAGER)`؛ الموظف يحصل على `403`.

### 3.1 بطاقات الإحصاء

| البطاقة | القيمة | المصدر |
|---|---|---|
| إجمالي العقارات | كل `Property` حيث `deletedAt = null` | `Property.groupBy(status)` |
| إجمالي العملاء | كل `Client` | `Client.count()` |
| إجمالي الملاك | `Contact` من نوع `OWNER` فقط | `Contact.count({ type: OWNER })` — **لا** تُحتسب `Property.proposedOwner` المؤقتة |
| إجمالي الموظفين | `User` بدور `EMPLOYEE` | `User.count()` |

**الملاحظات (hints):**

- العقارات: `${available} متاح · ${pending} بانتظار الموافقة`.
- العملاء: `${newThisMonth} عملاء جدد هذا الشهر`.
- الملاك: `${newThisMonth} ملاك جدد هذا الشهر` (Contact OWNER فقط).
- الموظفون: `${active} حساب نشط` بدل «متواجدين الآن»، لأن حالة الحضور اللحظية غير مدعومة في الواجهة الحالية.

### 3.2 الصفقات والعمولات

- العدد: `Deal` حيث `closedAt` داخل الشهر الحالي (تقويم الكويت UTC+3).
- قيمة الصفقات: مجموع `Deal.price`.
- متوسط الصفقة: `totalValue / count`.
- شارة العمولات: مجموع `Deal.companyCommission`.
- المنحنى: عدد الصفقات لكل يوم من أيام الشهر (`dailyCounts`)، بنفس إطار SVG والخط والتدرج والألوان السابقة.
- عند عدم وجود صفقات: القيم 0 والخط أفقي، بلا أي بيانات تجريبية.

### 3.3 أفضل الموظفين

- أكثر موظف عملاء: `Client.responsibleEmployeeId` خلال الشهر الحالي.
- أكثر موظف عقارات: `Property.createdByUserId` خلال الشهر الحالي، مع استبعاد المحذوف.
- أكثر موظف صفقات: `Deal.propertyEmployeeId ?? Deal.clientEmployeeId` للصفقات المغلقة هذا الشهر.
- الأسماء مربوطة بـ `User.name` الحقيقي، وليس بنص قديم.
- عند التعادل يُستخدم ترتيب اسم ثابت، فلا تتغيّر الأسماء بين التحديثات.

### 3.4 قسم العقارات

| الحالة | المصدر |
|---|---|
| متاح | `Property.status = AVAILABLE` |
| تم البيع | `SOLD` |
| تم التأجير | `RENTED` |
| بانتظار الموافقة | `PENDING` (يشمل طلبات التعديل ما دامت الحالة PENDING) |

كل الاستعلامات تستبعد `deletedAt != null`. العقارات المحذوفة لا تدخل في أي عدّاد نشط.

### 3.5 العملاء والملاك

- عملاء جدد: `Client.createdAt` داخل الشهر الحالي.
- ملاك جدد: `Contact.type = OWNER` و`createdAt` داخل الشهر.
- متابعات متأخرة: `FollowUpSubject.active = true` و`nextDueAt` قبل بداية اليوم الحالي في الكويت.
- متابعة تمت: `FollowUpEntry` المسجلة داخل الشهر الحالي.

### 3.6 تنبيهات مهمة

- متابعات متأخرة = نفس عدّاد `followUps.late`.
- عقارات تحتاج اعتماد = `PENDING`.
- محاولات تسجيل مكرر = إشعارات `DUPLICATE_ATTEMPT:*` الخاصة بالمدير الحالي خلال آخر 7 أيام.
- شارة العدد = عدد الفئات التي قيمتها أكبر من صفر.

### 3.7 آخر الأنشطة

- آخر 3 `AuditLog` من إجراءات الأعمال المعروفة فقط:
  - عقار جديد/تعديل/اعتماد/رفض/حذف/استعادة/منع تكرار.
  - عميل جديد/تعديل.
  - جهة تواصل جديدة/تعديل.
- التفاصيل: `بواسطة {اسم المنفّذ}`.
- عند عدم وجود نشاط: صف واحد «لا يوجد نشاط حديث» (حالة فارغة حقيقية).

---

## 4. التحديث التلقائي

`apps/frontend/features/manager-dashboard/use-manager-dashboard.ts`:

- قراءة أولية عند فتح الصفحة.
- إعادة قراءة صامتة كل **20 ثانية** أثناء ظهور الصفحة فقط.
- إعادة قراءة فورية عند `focus` أو `visibilitychange`.
- الاشتراك في إشارتي التحديث الموجودتين:
  - `usePropertyRefreshSignal()` لإشعارات العقارات.
  - `useClientsDataRefreshSignal()` لتغييرات العملاء/الملاك/المتابعات.
- لا يتم تفريغ القيم أو إظهار تحميل كامل عند التحديث؛ تبقى آخر لقطة ناجحة حتى تصل الجديدة.
- تنظيف المؤقّت والمستمعين عند إلغاء التركيب.

---

## 5. القيود والمقاييس غير المدعومة

1. **محدّد الفترة** ما زال معطّلًا وثابتًا على «الشهر الحالي» كما كان. لم تُنفّذ فترات اليوم/الأسبوع/كل الوقت لأنها خارج نطاق ربط البيانات.
2. **إنشاء الصفقات** في صفحة الصفقات ما زال Mock/غير مربوط. لوحة المدير تقرأ جدول `Deal` الحقيقي؛ إذا لم توجد صفقات حقيقية تظهر 0، وهذا مقصود.
3. **«متواجدون الآن»** غير مدعوم (لا يوجد حضور لحظي في واجهة الموظف). استُبدل النص بـ «حساب نشط» دون تغيير البطاقة.
4. **تنبيه «صفقة مشتركة»** لم يكن مدعومًا ببيانات حقيقية. استُبدل بمحتوى حقيقي لتنبيهات منع التكرار.
5. **موبايل 390px:** شبكة بطاقات الإحصائيات كانت أصلًا 4 أعمدة بعرض 170px وتتجاوز العرض. هذا سلوك سابق لم يُغيَّر التزامًا بقاعدة عدم تعديل التصميم؛ القياسات قبل/بعد متطابقة.

---

## 6. النتائج والاختبارات

### اختبارات لوحة المدير
```
manager-dashboard.spec.ts → 3/3 passed
manager-dashboard-format.spec.ts → 2/2 passed
```

تغطي:

- حالة قاعدة فارغة → كل القيم 0 (لا أرقام تجريبية).
- رفض الموظف (403).
- Manager فقط يرى الإحصاءات.
- استبعاد العقارات المحذوفة.
- PENDING لا يُحتسب ضمن AVAILABLE.
- عدم احتساب `proposedOwner` كمالك رسمي قبل الاعتماد.
- احتساب المالك الرسمي بعد الاعتماد.
- العملاء/الملاك الجدد داخل الشهر فقط.
- الصفقات الشهرية والقيم والمتوسط والعمولة.
- المتابعات المتأخرة والمكتملة.
- أفضل الموظفين.
- تنبيهات التكرار خلال 7 أيام.
- آخر الأنشطة من AuditLog.
- إنشاء عقار ثم اعتماده يحرّك العدّادات فعليًا.

### الانحدار
```
manager-dashboard + manager-dashboard-format + clients + employees +
properties + notifications
→ 6 suites / 85 tests passed
```

### الفحوصات
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| ESLint للملفات المعدلة | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |
| Console errors بعد الإصلاح النهائي | ✅ لا أخطاء |

> أثناء التحقق البصري ظهر تحذير React عن مفاتيح قائمة مكررة في «آخر الأنشطة» عند تكرار نفس نوع النشاط. أُصلح المفتاح ليكون فريدًا دون أي تغيير مرئي، وأُعيد التحقق بلا أخطاء Console.

---

## 7. المقارنة البصرية قبل/بعد

تم أخذ اللقطات بمتصفح Chromium Headless على نفس المقاس، وبنفس بيانات التطوير (قراءة فقط).

### سطح المكتب — 1440×1200

- ارتفاع المستند: **2157px** قبل و**2157px** بعد.
- أبعاد ومواقع بطاقات الإحصاء الأربع: **متطابقة تمامًا**.
- أبعاد ومواقع اللوحات الست: **متطابقة تمامًا**.
- شبكة البطاقات وشبكة اللوحات (الأعمدة والمسافات): **متطابقة**.
- التغيير الوحيد: القيم النصية أصبحت أرقامًا حقيقية (0/1/2) بدل الأرقام التجريبية، والمنحنى أصبح أفقيًا لأن عدد الصفقات الحقيقي 0.

- [لقطة سطح المكتب قبل](./assets/manager-dashboard-before-desktop.png)
- [لقطة سطح المكتب بعد](./assets/manager-dashboard-after-desktop.png)

### موبايل — 390×844

- ارتفاع المستند: **3112px** قبل و**3112px** بعد.
- مواقع وأبعاد كل البطاقات واللوحات: **متطابقة**.
- شبكة البطاقات واللوحات: **متطابقة**.
- تجاوز بطاقات الإحصاء الأفقي كان موجودًا قبل التغيير وبقي كما هو (لم نغيّر CSS).

- [لقطة الموبايل قبل](./assets/manager-dashboard-before-mobile.png)
- [لقطة الموبايل بعد](./assets/manager-dashboard-after-mobile.png)

**ملاحظة:** بيانات التطوير الحالية أظهرت لوحة بقيم حقيقية: عقار واحد نشط (PENDING)، 3 عقارات في المحذوفات، 0 عملاء، 0 ملاك رسميين، 2 موظفين، 0 صفقات، وتنبيه تكرار واحد. هذه القيم طابقت استعلامات SQL للقراءة فقط.

---

## 8. الملفات المعدّلة/المضافة

### الخلفية
- `apps/backend/src/dashboard/dashboard.module.ts` (جديد)
- `apps/backend/src/dashboard/dashboard.controller.ts` (جديد)
- `apps/backend/src/dashboard/dashboard.service.ts` (جديد)
- `apps/backend/src/dashboard/dashboard.dto.ts` (جديد)
- `apps/backend/src/app.module.ts`
- `apps/backend/test/support/test-app.ts`
- `apps/backend/test/manager-dashboard.spec.ts` (جديد)
- `apps/backend/test/manager-dashboard-format.spec.ts` (جديد)

### الواجهة
- `apps/frontend/lib/api/dashboard-types.ts` (جديد)
- `apps/frontend/lib/api/dashboard-api.ts` (جديد)
- `apps/frontend/features/manager-dashboard/use-manager-dashboard.ts` (جديد)
- `apps/frontend/features/manager-dashboard/dashboard-preview.ts` (استُبدلت البيانات التجريبية بحالة صفرية + تنسيق)
- `apps/frontend/features/manager-dashboard/components/manager-dashboard.tsx`
- `apps/frontend/features/manager-dashboard/components/dashboard-stats.tsx`
- `apps/frontend/features/manager-dashboard/components/deals-chart-placeholder.tsx`
- `apps/frontend/features/manager-dashboard/components/top-employees-placeholder.tsx`
- `apps/frontend/features/manager-dashboard/components/properties-summary.tsx`
- `apps/frontend/features/manager-dashboard/components/people-summary.tsx`
- `apps/frontend/features/manager-dashboard/components/dashboard-feed.tsx`

### الأصول
- `docs/reports/assets/manager-dashboard-before-desktop.png`
- `docs/reports/assets/manager-dashboard-after-desktop.png`
- `docs/reports/assets/manager-dashboard-before-mobile.png`
- `docs/reports/assets/manager-dashboard-after-mobile.png`

---

## 9. الالتزامات

- لا migrations.
- لا reset أو seed أو تعديل لبيانات التطوير.
- الاختبارات الكتابية استخدمت `arkan_crm_api_test` فقط.
- لا commits أو pushes.
- لم تُغيَّر أي بطاقة/لوحة/رسم/لون/حجم/ترتيب/تصميم.

**متوقف للمراجعة اليدوية.**
