# تحسين إشراف المدير على المتابعات

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** `GET /follow-ups/manager/overview` وواجهة الإشراف فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو `.env` أو تغييرات على بيانات `arkan_crm`.  
> لا commits أو pushes.

---

## 1. السبب الجذري

صفحة الإشراف الأولى كانت تُرجع مع 50 متابعة:

- **summary** كامل النطاق: 12 استعلام count على 10,556 موضوعًا.
- **employees**: كل الموظفين المسؤولين في النطاق (2,545 موظفًا) في كل أول صفحة.
- تسلسل: صفحة + summary + employees + تسلسل JSON.

القياس قبل التعديل:

| القياس | النتيجة |
|---|---:|
| أول صفحة | **485.8 ms P50 / 533.5 ms P95** |
| الحجم | **227 KB** |
| عدد خيارات الموظفين | **2,545** |
| صفحة cursor (بدون summary/employees) | 94.9 ms |

أي أن معظم التكلفة كانت في البيانات الإضافية، لا في صفحة المتابعات نفسها.

---

## 2. التغييرات

### الخادم

| الملف | التغيير |
|---|---|
| `apps/backend/src/followups/followups.service.ts` | صفحة الإشراف أصبحت page-only؛ إضافة `supervisionSummary` و`listSupervisionEmployees` و`supervisionScope`. |
| `apps/backend/src/followups/followups.controller.ts` | `GET /follow-ups/manager/summary` و`GET /follow-ups/manager/employees`. |
| `apps/backend/src/followups/dto/list-follow-ups.query.ts` | DTOs للـsummary وخيارات الموظفين (`search`, `cursor`, `limit`). |

- `GET /follow-ups/manager/overview` لم يعد يُرجع `summary` أو `employees`.
- `GET /follow-ups/manager/summary?employeeUserId=` يحسب 12 عدّادًا على كامل النطاق المصرح به.
- `GET /follow-ups/manager/employees?search=&cursor=&limit=100`:
  - يعيد فقط الموظفين الذين لديهم مواضيع نشطة.
  - Manager team-scoped، OWNER company-wide.
  - ترتيب ثابت `(name, id)` مع cursor.
  - لا سقف إجمالي؛ 100 لكل صفحة.
  - البحث داخل قاعدة البيانات.

### الواجهة

| الملف | التغيير |
|---|---|
| `apps/frontend/features/manager-followups/components/supervision-section.tsx` | تحميل الصفحة والـsummary بالتوازي؛ خيارات الموظفين endpoint منفصل مع بحث وLoad More؛ حماية من الاستجابات القديمة والتكرار. |
| `apps/frontend/features/manager-followups/components/manager-followups.module.css` | تنسيق أدوات بحث الموظفين. |
| `apps/frontend/lib/api/followup-types.ts` | أنواع summary/employee options. |
| `apps/frontend/lib/api/followups-api.ts` | `getSupervisionSummary` و`listSupervisionEmployees`. |

الواجهة تحتفظ بخيار الموظف المحدد عند البحث، وتحمّل 100 خيار أولًا، ثم «المزيد من الموظفين» أو البحث للوصول لأي موظف.

---

## 3. القياس بعد التعديل (Stage C)

| Endpoint | P50 | P95 | الحجم |
|---|---:|---:|---:|
| `overview?limit=50` | **32.6 ms** | **35.7 ms** | **30 KB** |
| `manager/summary` | **27.5 ms** | **32.2 ms** | <1 KB |
| `manager/employees?limit=100` | **23.1 ms** | **59.3 ms** | **8 KB** |
| `manager/employees?search=<last>` | **11.7 ms** | **18.8 ms** | <1 KB |

- **أول صفحة: 485.8 → 32.6 ms** و**227 → 30 KB**.
- Summary كامل النطاق: **10,556**.
- خيارات الموظفين: **2,545** موظفًا عبر **26 صفحة**، جميعها فريدة (692.5 ms لتحميل الكل عند الحاجة).
- البحث عن آخر موظف في الفريق وجده.

### حمل متزامن على endpoints الإشراف

| المستوى | النتيجة |
|---|---|
| 10 طلبات | **66.54 RPS، P50 109.4 / P95 140.3 ms، 0% أخطاء** |
| 50 طلبًا | **79.52 RPS، P50 453.2 / P95 611.6 ms، 0% أخطاء** |

- ذاكرة backend بعد الحمل: **~184 MB**.
- PostgreSQL CPU sample: ~0.02% بعد الحمل.
- لم يُجرَ 100-user load (المطلوب 10/50).

---

## 4. الصحة والصلاحيات

### اختبارات مباشرة
- Manager A summary: **10,556**.
- Manager A employee options: **2,545/2,545** فريدًا.
- OWNER summary في الاختبارات: يشمل Team A + Team B + OWNER-direct.
- Manager A options لا تحتوي Team B ولا OWNER-direct.
- البحث يجد موظفًا بعد الصفحة الأولى.
- صفحة overview لا تحتوي `summary` أو `employees`.

### الاختبارات الآلية
```powershell
npm run test -w @arkan/backend -- `
  test/followups-pagination.spec.ts `
  test/followups-manager.spec.ts `
  test/followups-manager-notifications.spec.ts `
  test/followup-history-authorization.spec.ts `
  test/followups-sync-optimization.spec.ts `
  test/followups-supervision-employees.spec.ts
```

**النتيجة: 6 suites / 43 اختبارًا ناجحًا.**

- اختبار جديد `followups-supervision-employees.spec.ts`:
  - 1,005 موظفًا في Team A + 10 في Team B + OWNER-direct.
  - كل الخيارات عبر 26 صفحة، فريدة، والباقي بعد 1,000.
  - البحث يجد آخر موظف.
  - عزل المدير وOWNER-direct.
  - summary مستقل عن الصفحة.
- اختبارات pagination القديمة تغطي >1,000 متابعة.
- `followup-history-authorization.spec.ts` ما زال ناجحًا: cross-team history = 404.
- Backend + Frontend typecheck: **0**
- ESLint: **0**

---

## 5. الأمان

- `OWNER` يرى كل النطاق المصرح به.
- `MANAGER` يرى فريقه الحالي فقط.
- `OWNER-direct` لا يظهر لمديرين غير مرتبطين.
- `supervisionScope` يطبق `managerUserId` داخل استعلام قاعدة البيانات.
- لم يُلمس إصلاح `history` عبر الفرق؛ اختباره ما زال ناجحًا.
- لا تغيير على الأدوار أو التعيينات.

---

## 6. القيود المتبقية

1. **Summary ما زال 12 count على كامل النطاق**؛ صحيح ومستقل عن الصفحة لكنه يعاد عند تغيير فلتر الموظف. يمكن لاحقًا cache/materialize مع invalidation.
2. **تحميل كل خيارات الموظفين** يتطلب 26 طلبًا (100/صفحة)؛ هذا فقط عند الحاجة، والبحث يغطي الحالة العملية. لا سقف إجمالي.
3. **Employee options query** يعتمد على `FollowUpSubject` النشط و`EmployeeProfile`؛ الموظف بلا مواضيع نشطة لا يظهر، وهو نفس سلوك القائمة السابقة.
4. **لم يُجرَ 100-user full-mix**؛ الاختبار 10/50 فقط على endpoints الإشراف.
5. **لا browser smoke** للواجهة الجديدة (بحث الموظفين وLoad More)؛ تم التحقق بـtypecheck وESLint واختبارات API.

---

## 7. السلامة

- `arkan_crm_load_test` فقط للقياس، ولم تُعدّل/تُreset/تُtruncate (50 MB).
- `arkan_crm` لم تُلمس (23 migrations).
- لا migrations أو `.env` أو commits أو pushes.
- backend القياس 4101 أُوقف؛ backend التطوير 4001 يعمل.

**متوقف للمراجعة اليدوية.**
