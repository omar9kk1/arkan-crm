# ربط «الصفقات» و«إجمالي العمولة» في بطاقات الموظفين بالبيانات الحقيقية

**التاريخ:** 2026-11-13
**النطاق:** صفحة المدير ← الموظفون (بطاقة الموظف ودج التفاصيل) + استجابة `GET /employees`.
**الحالة:** مكتمل، بدون ترحيل أو تغيير مبالغ/حالات مالية، وبدون commit/push.

---

## 1. سبب ظهور «—» سابقًا

- `EmployeeDto` في الخادم لم يكن يحتوي على `dealsCount` أو `commissionTotal` أصلًا.
- في الواجهة كان `mapEmployeeListItem` و`mapEmployee` يضعان:
  - `dealsCount: null`
  - `commission: null`
- ثم `EmployeeStats` يعرض `UNAVAILABLE` («—») لأي قيمة `null`، لذلك ظهرت الخانتان فارغتين رغم وجود بيانات حقيقية في `Deal` و`Commission`.

---

## 2. الملفات المتغيرة

### Backend

| الملف | التغيير |
|---|---|
| `apps/backend/src/employees/employee.dto.ts` | إضافة `dealsCount: number` و`commissionTotal: string` إلى `EmployeeDto` |
| `apps/backend/src/employees/employees.service.ts` | إضافة الحقلين إلى `EmployeePageMetric`، وحسابهما داخل نفس استعلام `pageMetrics` المجمّع، وإضافتهما إلى `serializeListItem` |

### Frontend

| الملف | التغيير |
|---|---|
| `apps/frontend/lib/api/employee-types.ts` | إضافة الحقلين إلى عقد `EmployeeDto` |
| `apps/frontend/features/manager-employees/model.ts` | تمرير القيم الحقيقية بدل `null`، وإضافة `commissionMoney` لتنسيق 3 خانات |
| `apps/frontend/features/manager-employees/components/employee-stats.tsx` | عرض العدد والمبلغ الحقيقيين بدل «—» |

### Tests

| الملف | التغيير |
|---|---|
| `apps/backend/test/employees-deal-metrics.spec.ts` | اختبارات الصفر، عدّ الصفقة مرة واحدة، جمع PENDING+PAID، استبعاد عمولة الشركة، صلاحيات المدير/الموظف، وثبات الحالة |
| `apps/backend/test/frontend-employee-metrics.spec.ts` | اختبار تمرير القيم وتنسيق `0.000 د.ك` |

لا تغيير على CSS أو التصميم أو أسماء الخانات أو ترتيبها أو باقي الإحصاءات.

---

## 3. معيار حساب صفقات الموظف

العلاقات الفعلية في Prisma:

```
Deal.propertyEmployeeId → EmployeeProfile.id → EmployeeProfile.userId → User.id
Deal.clientEmployeeId   → EmployeeProfile.id → EmployeeProfile.userId → User.id
```

الحساب داخل `pageMetrics`:

```sql
deal_pairs AS (
  propertyEmployeeId → Deal.id
  UNION
  clientEmployeeId  → Deal.id
)
COUNT(DISTINCT deal.id) per user
```

- تُحسب الصفقة **مرة واحدة** حتى لو كان الموظف هو موظف العقار وموظف العميل في نفس الصفقة (UNION + COUNT DISTINCT).
- لا توجد حاليًا حالات `CANCELLED` أو `deletedAt` على `Deal`، لذلك كل صفقات الجدول مؤهلة؛ لا يوجد شرط حالة مفقود.
- يعتمد الربط على `User.id` عبر `EmployeeProfile`، وليس على الاسم.
- الموظف بلا صفقات يحصل على `0` صراحةً.

---

## 4. مصدر إجمالي العمولة والدقة

- المصدر: `Commission.employeeId → EmployeeProfile.id`.
- يشمل `PENDING` و`PAID` كما هو مطلوب، ويستبعد `CANCELLED` (الحالة الوحيدة الملغاة في `PaymentStatus`).
- لا تُجمع `Deal.companyCommission` إطلاقًا؛ عمولة الشركة ليست صفًا في `Commission`.
- الحساب في PostgreSQL:
  `COALESCE(SUM(c.amount), 0)::text`
  ثم يُنسّق في الخادم إلى 3 خانات عشرية دون أي عملية JavaScript عائمة:
  `formatCommissionTotal` يضمن `0.000` عند عدم وجود عمولات.
- لا تغيير على `Commission.amount` أو `status` أو `paidAt` أو أي منطق صرف.

---

## 5. الصلاحيات وعدم حدوث N+1

- `GET /employees` محمي بـ`@Roles(OWNER, MANAGER)`، والموظف يحصل على **403**.
- `pageEmployeeIds` يقيّد المدير بـ`e.managerUserId = viewer.id`؛ لا تظهر بيانات موظفي فريق آخر.
- `pageMetrics` يُستدعى مرة واحدة بقائمة معرّفات الموظفين الظاهرين في الصفحة فقط (`userIds`)، ويجمع:
  - العقارات
  - العملاء
  - التعيينات
  - الصفقات والعمولات
  في استعلام SQL واحد. لا يوجد استعلام لكل موظف.
- `deal_pairs` نفسها مقيّدة بـ`ids` الخاص بالصفحة، فلا تُحمّل صفقات كل الشركة.
- لا تُعاد تفاصيل مالية إضافية؛ فقط عدد الصفقات والإجمالي في بطاقة الموظف المصرح بها.

---

## 6. الاختبارات والتحقق

تم التحقق أولًا من أن قاعدة الكتابة هي `arkan_crm_api_test` عبر `SELECT current_database()` (وليس `arkan_crm`).

| الأمر | النتيجة |
|---|---|
| `test/employees-deal-metrics.spec.ts test/employees.spec.ts test/frontend-employee-metrics.spec.ts` | **15/15 نجحت** |
| `test/employees-pagination.spec.ts` | **7/7 نجحت** |
| `npm run typecheck -w @arkan/backend` | 0 |
| `npm run typecheck -w @arkan/frontend` | 0 |
| ESLint على الملفات المتأثرة | 0 |

تغطية الاختبار الجديد:

1. موظف بلا صفقات/عمولات → `dealsCount=0` و`0.000`.
2. صفقة واحدة → العدد 1.
3. الموظف في نفس الصفقة بدورين → يُحسب مرة واحدة (الإجمالي 2 لصفقتين).
4. عدة عمولات → `1.234 + 2.345 + 0.001 = 3.580`.
5. `PENDING` و`PAID` مجموعان دون تغيير حالتهما.
6. `companyCommission=9.999` غير محتسبة.
7. المدير يرى فريقه فقط؛ موظف الفريق الآخر غير ظاهر؛ الموظف يحصل على 403.
8. الاختبار يتحقق من القيم عبر قائمة واحدة لكل الصفحة؛ التنفيذ نفسه استعلام SQL واحد (لا N+1).
9. باقي الحقول (`propertyCount`, `clientsCount`, `assignedCount`) لم تتغير.

---

## 7. جاهزية الرفع

**نعم، التعديل جاهز للرفع بعد المراجعة.** لا يحتاج Migration، ولا يغيّر منطق الصفقات/العمولات/الصرف. التغييرات الحالية غير مُودَعة في Git، ولم يُنفّذ commit أو push.

### ملاحظات/قيود

- الحساب يعتمد على أدوار الموظف المسجلة في `Deal` (`propertyEmployeeId` / `clientEmployeeId`)، وليس `recordedById` (من سجّل الصفقة).
- لا توجد حاليًا حالات إلغاء/حذف للصفقة في المخطط؛ إن أُضيفت لاحقًا فيجب استبعادها من `deal_pairs`.
- إجمالي العمولة يعرض المبلغ الإجمالي (Pending + Paid) وليس المدفوع فقط، وفق المطلوب.
- يظل اختبار `resetDatabase` في المشروع بلا حارس اسم قاعدة (ملاحظة تدقيق سابقة)؛ تم التحقق يدويًا من اسم قاعدة الاختبار قبل التشغيل، ولم يُعدّل هذا الملف ضمن هذه المهمة.
