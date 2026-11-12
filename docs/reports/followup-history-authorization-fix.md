# إصلاح صلاحيات سجل المتابعة عبر الفرق

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**الخطورة:** High — تسريب سجل متابعة/بيانات اتصال بين الفرق.  
**الحالة:** تم الإصلاح والتحقق — بانتظار المراجعة اليدوية.

> لا تغييرات على `arkan_crm` أو `arkan_crm_load_test` أو `.env` أو migrations.  
> لا commits أو pushes.

---

## 1. السبب الجذري

في `apps/backend/src/followups/followups.service.ts` كان نطاق `history()` للمدير فارغًا:

```ts
viewer.role === Role.MANAGER ? {} : { responsible: { userId: viewer.id } }
```

لذلك كان أي `MANAGER` يستطيع قراءة أي `FollowUpSubject` بالمعرّف، بما في ذلك:

- متابعة موظف في فريق مدير آخر.
- متابعة شخصية تخص مديرًا آخر.
- استجابة `history` تحتوي `client.phone` و`property.contact.phone`، أي احتمال كشف بيانات اتصال خاصة.

---

## 2. الملفات المتغيرة

| الملف | التغيير |
|---|---|
| `apps/backend/src/followups/followups.service.ts` | استبدال نطاق `history()` بنطاق مطابق لقواعد بقية مسارات المتابعة. |
| `apps/backend/test/followup-history-authorization.spec.ts` | اختبارات انحدار أمنية جديدة (8 اختبارات). |

لم تُعدّل واجهات أو خدمات أو بيانات أخرى.

---

## 3. السلوك بعد الإصلاح

النطاق أصبح داخل استعلام قاعدة البيانات:

- **OWNER:** `{}` — كل السجلات.
- **MANAGER:** `{ OR: [{ responsibleUserId: viewer.id }, { responsible: { managerUserId: viewer.id } }] }`
  - متابعاته الشخصية.
  - متابعات موظفي فريقه الحالي فقط.
- **EMPLOYEE:** `{ responsible: { userId: viewer.id } }` — متابعاته فقط.
- **OWNER-direct:** `managerUserId = NULL` لا يطابق أي مدير.
- إعادة تعيين الموظف إلى مدير آخر تُحدّث العلاقة فورًا لأن النطاق يُقيَّم في قاعدة البيانات.
- أي معرّف غير مصرّح به يعيد **404** دون كشف وجود السجل أو بيانات الاتصال.

### Before / After

| الحالة | قبل | بعد |
|---|---|---|
| MANAGER A → موظف Team B | 200 | **404** |
| MANAGER A → متابعة MANAGER B الشخصية | 200 | **404** |
| MANAGER A → OWNER-direct employee | 200 | **404** |
| MANAGER A → متابعة فريقه | 200 | **200** |
| MANAGER A → متابعته الشخصية | 200 | **200** |
| OWNER → أي نطاق | 200 | **200** |
| EMPLOYEE A → موظف آخر | 200 (قبل الإصلاح) | **404** |
| EMPLOYEE A → متابعته | 200 | **200** |

---

## 4. تدقيق المسارات المرتبطة

- `list()`: MANAGER → `responsibleUserId = viewer.id` فقط.
- `listSupervision()`: MANAGER → `responsible.managerUserId = viewer.id`.
- `saveBatch()`: MANAGER → `responsibleUserId = viewer.id`؛ EMPLOYEE → `responsible.userId = viewer.id`.
- `sendReminder()`: يتحقق من `subject.responsible.managerUserId === viewer.id` ويعيد 404 لغير الفريق.
- `history()`: كان المسار الوحيد ذا النطاق الفارغ للمدير؛ تم إصلاحه.

لا توجد حاجة لتغيير مسارات أخرى.

---

## 5. الاختبارات

### اختبار جديد
`apps/backend/test/followup-history-authorization.spec.ts` — **8/8 ناجح**:

1. MANAGER A → Team B employee history = 404.
2. MANAGER A → MANAGER B personal history = 404.
3. MANAGER A → OWNER-direct employee history = 404.
4. MANAGER A → own + Team A history = 200.
5. OWNER → Team B + Manager B + OWNER-direct = 200.
6. EMPLOYEE A → Team B = 404، employee A own = 200، employee B → Team A = 404.
7. استجابة 404 لا تحتوي هاتف العميل أو جهة الاتصال الخاصة.
8. إعادة تعيين employee B إلى Manager A: Manager A = 200، Manager B = 404، ومتابعة Manager B الشخصية تبقى محصورة به.

### اختبارات الانحدار
```powershell
npm run test -w @arkan/backend -- `
  test/followups.spec.ts `
  test/followups-manager.spec.ts `
  test/followups-manager-notifications.spec.ts `
  test/followups-pagination.spec.ts
```

**النتيجة: 4 suites / 37 اختبارًا ناجحًا.**

### الفحوصات
- `npm run typecheck -w @arkan/backend`: **0**
- ESLint على الملفين المعدلين: **0**

---

## 6. المخاطر المتبقية

- `history()` ما زال يعيد بيانات الاتصال للمدير المصرّح له داخل فريقه — وهذا هو السلوك المقصود.
- لم يُعد تشغيل load test الكامل؛ تم التحقق باختبارات API مركزة فقط.
- لا تغيير على أداء `sync()` أو باقي المسارات؛ الملاحظات الأدائية السابقة في تقرير الحمل تبقى قائمة.
- لا اختبار UI/browser مطلوب أو منفّذ لهذا الإصلاح الخلفي.
- `arkan_crm_load_test` لم تُلمس، و`arkan_crm` لم تُلمس.

---

## 7. السلامة

- لا migrations أو schema أو `.env`.
- لا تعديل على بيانات أو حسابات حقيقية.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
