# صلاحيات حذف المدير وتصحيح مسار إشعارات المراجعة

**التاريخ:** 2026-11-11  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** منع MANAGER من أي حذف/محذوفات، وإزالة fallback الإشعار إلى OWNER عند غياب مدير نشط، وتحديث الاختبارات القديمة.  
**الحالة:** مكتمل.

---

## 1. جرد مسارات الحذف والواجهات

### Backend — مسارات الحذف الفعلية

كل مسارات العقارات موجودة في `properties.controller.ts` ومحمية مسبقًا بـ`@Roles(Role.OWNER)` و`assertTrashAccess`:

| المسار | الحماية |
|---|---|
| `GET /properties/trash` | `@Roles(OWNER)` + `assertTrashAccess` |
| `POST /properties/:id/trash` | `@Roles(OWNER)` + `assertTrashAccess` |
| `POST /properties/:id/restore` | `@Roles(OWNER)` + `assertTrashAccess` |
| `DELETE /properties/:id/permanent` | `@Roles(OWNER)` + `assertTrashAccess` |

**لا توجد** مسارات حذف/محذوفات للعملاء أو جهات الاتصال أو المتابعات أو الصفقات.  
`DELETE /push/subscriptions` هو إلغاء اشتراك جهاز المستخدم نفسه، وليس حذف سجل أعمال، ولم يُغيّر.

### Frontend

- `managerMoreNavigation` كانت تُخفي `trash` و`finance` عن غير OWNER؛ تم نقل القاعدة إلى `navigation-permissions.ts` وجعلها قابلة للاختبار.
- صفحة `/manager/trash` محمية بـ`RequireRole role={Role.OWNER}`.
- زر «حذف إلى سلة المحذوفات» في بطاقة العقار يظهر فقط عند `canDelete = user.role === 'OWNER'`.
- صفحة `ManagerTrash` تُستخدم فقط عبر المسار المحمي بـOWNER.
- لا توجد أزرار حذف للعملاء أو أي سجل آخر في واجهات المدير.

**النتيجة:** MANAGER لا يرى Trash في القائمة الجانبية أو قائمة الموبايل، ولا يستطيع فتح الصفحة أو استدعاء أي endpoint حذف. OWNER يحتفظ بكل ذلك.

تم تحديث نصوص الإشعارات المرتبطة بالحذف/الاستعادة لتعكس أن المنفّذ هو مالك النظام، وليس المدير:

- `تم حذف العقار بقرار مالك النظام`
- `قام مالك النظام باستعادة عقارك من المحذوفات...`
- شارة العقار المحذوف: `محذوف بقرار مالك النظام`

---

## 2. تصحيح مسار الإشعارات

تم تعديل `reviewNotificationRecipientIds` في `apps/backend/src/common/access/access-policy.ts`:

| الحالة | المستلم |
|---|---|
| موظف تابع لمدير **نشط** | المدير المباشر فقط |
| موظف `managerUserId = null` | مالك/ملوك النظام النشطون فقط |
| موظف تابع لمدير **غير نشط** | **لا أحد** — لا fallback إلى المالك أو مدير آخر |
| موظف تابع لمدير بدور غير MANAGER أو غير موجود | **لا أحد** |
| فاعل MANAGER/OWNER | المالكون النشطون فقط (سلوك سابق) |

### ماذا يحدث عند المدير غير النشط؟

- يُحفظ طلب المراجعة في حالته `PENDING` كما هو.
- لا يُعاد تعيين المراجع.
- لا يُعدّل `managerUserId` للموظف.
- لا يُرسل إشعار إلى المالك أو أي مدير آخر.
- يمكن للمالك لاحقًا معالجة الطلب أو إعادة تفعيل/تعيين الموظف عبر مسارات الموظفين الحالية.

هذا ينطبق على العقارات ومراجعات العملاء وسجلات الموظف (عميل/جهة اتصال/متابعة) لأنها كلها تستخدم نفس دالة المستلمين.

---

## 3. الاختبارات المعدلة والمضافة

### تحديث الاختبارات القديمة

`employee-decision-notifications.spec.ts`:

- أُضيف حساب OWNER.
- عمليات `trash` و`permanent delete` أصبحت بـOWNER.
- أُضيف تحقق أن MANAGER يحصل على **403** ولا يتغيّر السجل.
- تحقق أن إشعارات الحذف ما زالت تصل للموظف صاحب العقار بعد إجراء OWNER.
- تحديث عنوان الإشعار إلى «بقرار مالك النظام».

`employee-property-restoration-notification.spec.ts`:

- أُضيف OWNER.
- عمليات trash/restore أصبحت بـOWNER (المدير لا يستعيد ولا يحذف).
- الإشعارات بعد الاستعادة ما زالت تعمل.

### اختبارات جديدة/موسعة

`review-routing-system-log.spec.ts`:

- مدير نشط → المدير فقط.
- مالك مباشر → المالك فقط.
- مدير غير نشط → لا إشعار لأي طرف، والطلب يبقى `PENDING`.
- سجل النظام لمالك النظام ما زال يعمل ومرتبًا.

`frontend-manager-navigation.spec.ts`:

- MANAGER لا يرى Trash أو Finance.
- OWNER يرى Trash.

`property-trash.spec.ts` الحالي (1b) يتحقق أصلًا من 403 لكل endpoints Trash/Permanent Delete للمدير.

---

## 4. نتائج التحقق

### الاختبارات

```text
30/30 passed
review-routing-system-log + employee-decision-notifications
+ property-trash + employee-property-restoration-notification
+ frontend-manager-navigation

84/84 passed
notifications + employee-record-notifications
+ owner-manager-employee-hierarchy + manager-review-change-notifications
+ client-edit-notifications + client-review-workflow
+ property-change-coverage + property-duplicate-priority
```

### الفحص الثابت

```text
npm run typecheck → 0
npm run lint      → 0
```

لم يُشغَّل build كامل لأن التعليمات طلبت تجنّب البناء غير الضروري؛ التغييرات اجتازت typecheck وlint والاختبارات المركزة.

### الخدمات

- `/health` و`/health/ready` → **200**.
- `/properties/trash` بدون مصادقة → **401**.
- `/notifications/system-log` بدون مصادقة → **401**.
- 3001 و4001 يعملان.

---

## 5. ملاحظات متبقية

1. **لا migration جديدة** — لم يُمسّ مخطط قاعدة البيانات.
2. لا يوجد حاليًا أي endpoint لحذف العملاء/جهات الاتصال/المتابعات/الصفقات. إذا أُضيف مستقبلًا، يجب أن يستخدم نفس `@Roles(ROLE_OWNER)` + `assertOwner`.
3. الحالة «مدير محذوف» لا يمكن تمثيلها منفصلة عن `managerUserId = null` بسبب `ON DELETE SET NULL`، لكن لا توجد واجهة لحذف المستخدمين. المدير **غير النشط أو غير الصالح الدور** يُعامل كـ«لا مستلم» ولا يُحوَّل للمالك.
4. لم تُعدّل بيانات أعمال حقيقية، ولا `.env`، ولا commits/pushes.
5. واجهة Trash وسجل النظام بقيتا بنفس تصميم Astra-glass الحالي.

**النتيجة: مكتمل — متوقف للمراجعة اليدوية.**
