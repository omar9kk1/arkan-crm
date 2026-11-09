# إنهاء صلاحيات المدير والإعدادات

**التاريخ:** 2026-11-08  
**النطاق:** صلاحيات MANAGER مقابل OWNER — المحذوفات، الحذف، الإعدادات، الحضور، ومراجعة العقارات.  
**الحالة:** لم يتم تنفيذ أي تفعيل أو تغيير على قاعدة البيانات الحقيقية، ولا commits أو pushes.

## التغييرات

### 1. المحذوفات والحذف — OWNER فقط

- `apps/backend/src/properties/properties.controller.ts`
  - `GET /properties/trash`
  - `POST /properties/:id/trash`
  - `POST /properties/:id/restore`
  - `DELETE /properties/:id/permanent`
  - جميعها أصبحت `@Roles(Role.OWNER)` بدل `OWNER, MANAGER`.
- `apps/backend/src/properties/properties.service.ts`
  - `assertTrashAccess` أصبح يرفض أي دور غير OWNER بـ `403`.
- `apps/frontend/components/layout/manager/navigation.ts`
  - إخفاء عنصر «المحذوفات» من قائمة MANAGER في الشريط الجانبي وقائمة «المزيد» على الهاتف.
  - OWNER يبقى يرى العنصر كما هو.
- `apps/frontend/app/manager/trash/page.tsx`
  - حماية المسار المباشر بـ `RequireRole role={Role.OWNER}`.
- `apps/frontend/features/manager-properties/components/manager-properties.tsx`
  - `canDelete` = OWNER فقط.
  - تجاهل إجراء `'حذف'` لغير OWNER وعدم فتح نافذة النقل إلى سلة المحذوفات.
- `apps/frontend/features/manager-properties/components/property-details-drawer.tsx`
  - خاصية `canDelete` جديدة، وزر «حذف إلى سلة المحذوفات» لا يظهر إلا عند تمريرها.
- `apps/frontend/features/manager-properties/components/manager-trash.tsx`
  - تحديث التعليقات لتوضيح أن الصفحة OWNER-only. وظائف الاستعادة والحذف النهائي لمالك النظام لم تتغير.

### 2. الإعدادات

- `apps/frontend/features/manager-settings/components/settings-page.tsx`
  - OWNER: يرى جميع الأقسام كما كانت.
  - MANAGER:
    - لا يرى «بيانات الشركة»، «إعدادات الصفقات والعمولات»، «إعدادات الحضور والانصراف»، ولا «الصلاحيات».
    - يرى «إعدادات المتابعات» للقراءة فقط دون زر حفظ.
    - يحتفظ بإعدادات التنبيهات الشخصية والإشعارات الخارجية.
- `apps/frontend/features/manager-settings/components/settings-section-card.tsx`
  - خاصية `readOnly` تعرض الحقول داخل `fieldset disabled` دون إجراء حفظ.
- `apps/frontend/features/manager-settings/components/settings.module.css`
  - تنسيق `readOnly` متوافق مع التصميم الحالي.

### 3. مراجعة العقارات

- لم يتم تغيير منطق `PROPERTY_APPROVE` أو `PROPERTY_REJECT`.
- صلاحيات MANAGER الممنوحة من OWNER بقيت كما هي، وتمت إزالة إجراء الحذف فقط.

## الاختبارات والتحقق

| الفحص | النتيجة |
|---|---|
| `npm run typecheck` (shared + backend + frontend) | ناجح |
| ESLint على الملفات المعدلة | ناجح |
| `test/property-trash.spec.ts` مع قاعدة الاختبار المعزولة | 12/12 ناجح |
| `test/owner-manager-employee-hierarchy.spec.ts` + `test/frontend-owner-drawer.spec.ts` | 22/22 ناجح |
| فحص المتصفح بحساب OWNER | أقسام الإعدادات كاملة، «المحذوفات» ظاهرة وتعمل، وزر الحذف في درج العقار ظاهر |

اختبار `property-trash` أضاف حالة MANAGER حقيقية تثبت رفض جميع مسارات المحذوفات بـ `403`، وعدم تغيّر `deletedAt` للعقار.

## قواعد المالية والصفقات — مؤجلة

تم توثيقها فقط دون أي تغيير في الكود:

- المالية OWNER-only.
- MANAGER يسجل صفقاته وصفقات موظفيه المعيّنين فقط.
- MANAGER يرى صفقاته وصفقات فريقه فقط؛ OWNER يرى الجميع.
- توزيع العمولات والإشعارات وسياسة الاعتماد تُحدد لاحقًا.

## الفجوات المتبقية

1. **إعدادات الشركة والحضور والمتابعات لا تملك APIs خلفية بعد**؛ الصفحة تجريبية/واجهة فقط. لذلك الحماية الحالية واجهة فقط، ولا يوجد مسار API يمكن تقييده لهذه الأقسام.
2. **الحضور غير مطبّق في الخلفية**: `AttendanceModule` مجرد حدود نطاق بلا controller/service، وصفحة الحضور تعتمد بيانات محلية/تجريبية. لا يمكن فرض «فريق المدير فقط» على الخادم قبل بناء واجهات الحضور الفعلية.
3. **المالية والصفقات** لم تُعدّل عمدًا وفق المطلوب؛ قواعدها موثقة أعلاه فقط.
4. التحقق البصري لصلاحيات MANAGER لم يُنفّذ بحساب MANAGER في المتصفح لعدم توفر بيانات دخول MANAGER في البيئة الحالية؛ تم إثبات المنع عبر اختبار API برمز MANAGER حقيقي.

## السلامة

- لا تغييرات على قاعدة البيانات أو migrations أو seeds أو بيانات الأعمال.
- لا تغييرات على `.env` أو المصادقة أو CSP أو Rate Limiting.
- لا commits أو pushes.
