# مسار المراجعات المباشر + سجل النظام داخل الإشعارات

**التاريخ:** 2026-11-11  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تصحيح مستلمي إشعارات المراجعة ليكونوا المشرف المباشر فقط، وإضافة تبويب «سجل النظام» لمالك النظام داخل صفحة الإشعارات.  
**الحالة:** مكتمل.

---

## 1. ما تم تنفيذه

### أولًا: مسار إشعارات المراجعة

أصبحت `reviewNotificationRecipientIds` في `apps/backend/src/common/access/access-policy.ts` تُرجع **جهة واحدة فقط**:

- موظف تابع لمدير نشط → **المدير المباشر فقط**.
- موظف تابع للمالك مباشرة (بدون مدير) → **مالك/ملوك النظام النشطون فقط**.
- إذا كان المدير المعيّن غير نشط أو غير موجود → يتم الرجوع للمالك، وليس إرسال نسخة للمدير والمالك معًا.
- فاعل من دور MANAGER/OWNER → المالكون النشطون فقط، وليس مديرًا غير مرتبط.

هذه الدالة مشتركة بالفعل بين كل مسارات المراجعة، لذلك تصحيحها غطّى:

- إرسال العقار للمراجعة.
- إعادة إرسال العقار.
- تعديل عقار تحت المراجعة.
- محاولة تسجيل عقار مكرر.
- إرسال/إعادة إرسال مراجعة العميل.
- أحداث سجلات الموظف (عميل/جهة اتصال/متابعة) التي تستخدم نفس المستلم.
- إشعارات المراجعة في `properties.service.ts` و`notifications.service.ts`.

لم يُغيَّر منطق `(userId, eventKey)` ولا منع التكرار ولا قراءة الإشعارات ولا الصلاحيات الأخرى.

### ثانيًا: سجل النظام

أُضيف API حقيقي:

```text
GET /notifications/system-log?limit=50&cursor=...
```

**OWNER فقط** عبر `@Roles(Role.OWNER)` و`assertOwner` داخل الخدمة. المدير والموظف يحصلان على **403** حتى عبر طلب مباشر.

المصدر هو `AuditLog` الحقيقي، وليس بيانات وهمية:

- مرتب من الأحدث إلى الأقدم (`createdAt desc, id desc`).
- Cursor pagination.
- يستبعد أحداث `AUTH_*` (تسجيل الدخول/التجديد/الخروج) لأنها ليست أحداثًا تشغيلية.
- يعرض لكل حدث:
  - عنوانًا عربيًا يتضمن اسم الفاعل.
  - وصفًا مختصرًا.
  - الفاعل ودوره.
  - المستلم المباشر/مقدّم الطلب إن وجد.
  - نوع العنصر، الكود أو الاسم من الجداول الحقيقية.
  - التاريخ والوقت.
- يحل أسماء العقار/العميل/جهة الاتصال/المتابعة/طلب العميل/المستخدم من قاعدة البيانات.
- لا يعيد أي JSON خام من `AuditLog`.

أمثلة النصوص المولدة:

- «محمد أحمد أرسل عقاراً للمراجعة» + إلى: المدير + العقار `A-000123`.
- «المدير أحمد علي وافق على طلب عميل» + العميل + مقدّم الطلب + الوقت.
- «المدير … استعاد عقاراً من المحذوفات».
- «مالك النظام … حدّث صلاحيات مدير».

الأحداث غير المعروفة تظهر بعنوان إداري عام بدل إسقاطها، مع الحفاظ على الفاعل والعنصر والتاريخ.

---

## 2. الواجهة

داخل صفحة الإشعارات الحالية (`/manager/notifications`):

- عند **مالك النظام فقط** يظهر شريط تبويبين:
  - **الإشعارات**
  - **سجل النظام**
- تبويب الإشعارات الحالي بقي كما هو (الفلاتر الستة، القراءة، التفاصيل، تحميل المزيد).
- تبويب «سجل النظام» جديد ويستخدم نفس بطاقات/شارات/خطوط Astra-glass الحالية.
- يعرض حالات: تحميل، خطأ مع إعادة المحاولة، فراغ، و«تحميل المزيد».
- المدير لا يرى التبويب؛ صفحة الموظف مستقلة ولم تُضف إليها أي تبويبات.
- لم تُجرَ إعادة تصميم أو تغييرات في صفحات أخرى.

---

## 3. الملفات المعدلة/المضافة

**Backend:**

- `apps/backend/src/common/access/access-policy.ts` — منطق المستلم المباشر.
- `apps/backend/src/notifications/notifications.service.ts` — تحديث التعليقات التوضيحية فقط (المنطق عبر الدالة المشتركة).
- `apps/backend/src/notifications/notifications.controller.ts` — مسار `system-log`.
- `apps/backend/src/notifications/notifications.module.ts` — تسجيل الخدمة.
- `apps/backend/src/notifications/system-log.dto.ts` — عقود الاستجابة.
- `apps/backend/src/notifications/system-log.service.ts` — بناء السجل من AuditLog.
- `apps/backend/test/review-routing-system-log.spec.ts` — اختبارات المسار والسجل.
- تحديث توقعات الاختبارات القديمة التي كانت تفترض وصول الإشعار للمدير والمالك معًا:
  - `notifications.spec.ts`
  - `employee-record-notifications.spec.ts`
  - `owner-manager-employee-hierarchy.spec.ts`
  - `manager-review-change-notifications.spec.ts`
  - `client-edit-notifications.spec.ts` (عنوان اختبار فقط)

**Frontend:**

- `apps/frontend/features/manager-notifications/components/notifications-page.tsx` — تبويب المالك.
- `apps/frontend/features/manager-notifications/components/system-log-panel.tsx` — لوحة السجل.
- `apps/frontend/features/manager-notifications/components/notifications.module.css` — أنماط additive فقط.
- `apps/frontend/lib/api/system-log-api.ts`
- `apps/frontend/lib/api/system-log-types.ts`

**لا migration جديدة:** السجل يقرأ `AuditLog` الموجود.

---

## 4. نتائج التحقق

### اختبارات المسار والسجل

```text
review-routing-system-log.spec.ts                         4/4
notifications + employee-record + hierarchy              33/33
manager-review-change-notifications                       6/6
new + manager-review + client-edit +
client-review + property-change                          31/31
```

غطّت:

- موظف تابع لمدير → إشعار واحد للمدير، صفر للمالك.
- موظف تابع للمالك مباشرة → إشعار واحد للمالك، صفر للمدير.
- نفس المنطق لمراجعات العملاء.
- سجل النظام يعيد أحداثًا حقيقية مرتبة تنازليًا.
- الفاعل/المستلم/العنصر/الكود/الوقت صحيحة.
- Cursor pagination دون تكرار.
- Manager/Employee → 403، بلا مصادقة → 401.
- استبعاد `AUTH_*`.

**ملاحظة اختبار غير مرتبط:** `employee-decision-notifications.spec.ts` ما زال يفشل في 3 اختبارات لأنها تستخدم حساب Manager لعمليات `Trash/Permanent Delete` المحصورة حاليًا بـOWNER (403 قبل الوصول لمنطق الإشعارات). هذا لا علاقة له بتعديل مسار المراجعات ولم يُعدّل.

### البناء والفحص

```text
npm run build       → 0 (shared + backend + frontend + CSP manifest)
npm run typecheck   → 0
npm run lint        → 0
```

### فحص القاعدة الحقيقية (قراءة فقط)

تم استدعاء `SystemLogService.list` على `arkan_crm` بهوية OWNER موجودة، دون تسجيل دخول أو كتابة:

```json
{"ownerFound":true,"items":5,"firstTitle":"mohamed أرسل عميلاً للمراجعة","firstAction":"CLIENT_REVIEW_SUBMIT","nextCursor":true}
```

- `/notifications/system-log` بدون مصادقة → **401**.
- `/health` و`/health/ready` → **200**.
- 3001 و4001 يعملان.

---

## 5. ملاحظات متبقية

- سجل النظام للقراءة فقط، ولا يضيف إجراءات إدارية جديدة.
- يعتمد على `AuditLog` الموجود؛ الأحداث القديمة غير المعروفة تُعرض بعنوان عام بدل إخفائها.
- لا تغيير على منطق الإشعارات العامة خارج تصحيح المستلم.
- لا commits أو pushes، ولا تعديل بيانات أعمال حقيقية.

**النتيجة: مكتمل.**  
**التقرير:** `docs/reports/owner-notifications-and-system-log.md`
