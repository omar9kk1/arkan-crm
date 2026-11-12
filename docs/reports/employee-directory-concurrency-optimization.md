# تحسين دليل الموظفين تحت الحمل المتزامن

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** `GET /employees` — القائمة، الفرز العالمي، والملخص فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا تغييرات على الواجهة أو الصلاحيات أو قاعدة `arkan_crm` أو migrations.  
> لا commits أو pushes.

---

## 1. السبب الجذري

### أ) استعلام الصفحة
`pageEmployeeIds` كان يستخدم **correlated subquery لكل موظف**:

```sql
SELECT COUNT(DISTINCT c.id) FROM "Client" c
WHERE c."createdById" = e.id OR c."responsibleEmployeeId" = e.id
```

ويتكرر ذلك لـ properties وdeals. مع 5,000 موظف، يعيد PostgreSQL تنفيذ العمل لكل صف قبل الفرز والـLIMIT.

### ب) الملخص
`directorySummary` كان:

1. يحمّل كل معرفات الموظفين (5,000) إلى Node.
2. يحمّل كل `EmployeeProfile` (5,000).
3. يستخدم قائمة `IN` ضخمة في `clientsCountsByUser`.
4. يستخدم قائمة `IN` أخرى في `lateCountsByProfile`.
5. يعمل بعد استعلام الصفحة، أي إجمالًا متسلسلًا.

الملخص القديم كان يعيد بناء نفس العدادات الكاملة في **كل أول صفحة**.

---

## 2. التغيير

**الملف الوحيد المعدّل:** `apps/backend/src/employees/employees.service.ts`

- استبدال subqueries المترابطة بـ **CTE set-based**:
  - `scoped`: الموظفون المصرّح لهم + الفلاتر.
  - `client_pairs`: `UNION` بين `createdById` و`responsibleEmployeeId` (يحافظ على distinct).
  - `client_counts`: تجميع مرة واحدة.
  - `property_counts`: تجميع مباشر حسب `createdByUserId`.
  - `deal_pairs`: `UNION` بين `propertyEmployeeId` و`clientEmployeeId`.
  - `deal_counts`: تجميع مرة واحدة.
- كل فرز يستخدم CTE الخاص به فقط، فلا تُحسب المقاييس الثلاثة دائمًا.
- استبدال ملخص الدليل باستعلام واحد set-based يعيد:
  - `total`, `active`, `clientsTotal`, `lateTotal`
  - دون تحميل 5,000 معرف/بروفايل إلى Node.
- بدء `directorySummary` **بالتوازي** مع استعلام الصفحة بدل تسلسلهما.
- إزالة `directoryScope` غير المستخدم و`isOwner` غير المستخدم.

لم يتغيّر تعريف أي عدّاد:
- clients = عدد العملاء المميزين حيث الموظف منشئ أو مسؤول.
- properties = `Property.createdByUserId`.
- deals = صفقات مميزة حيث الموظف مسؤول عن العقار أو العميل.
- late = مواضيع متابعة نشطة `nextDueAt < بداية اليوم الكويتي`.

---

## 3. قياس SQL قبل/بعد (Stage C)

`EXPLAIN (ANALYZE, BUFFERS)` + توقيت median لـ5 تنفيذات:

| Query | قبل | بعد |
|---|---:|---:|
| clientsCount sort | 91.7 ms | **31.4 ms** |
| propertiesCount sort | 14.8 ms | **7.8 ms** |
| dealsCount sort | 47.5 ms | **16.4 ms** |
| Manager A clients sort | — | **23.0 ms** |
| Summary (owner) | ~147 ms wall* | **43.6 ms** |
| Summary (Manager A) | — | **30.8 ms** |

\* الملخص القديم: users 25.8 + profiles 56.5 + parallel(clients 64.3, late 60.9) ≈ 147 ms.

الخطة الجديدة تقرأ كل جدول مرة واحدة وتجمّع قبل الربط، بدل تنفيذ subquery لكل موظف.

---

## 4. قياس API قبل/بعد

### طلب واحد (P50 / P95)

| Endpoint | قبل | بعد |
|---|---:|---:|
| Owner list | 347.5 / 447.7 ms | **64.3 / 74.3 ms** |
| Owner clientsCount | 334.5 / 365.5 ms | **48.1 / 55.8 ms** |
| Owner propertiesCount | 230.7 / 337.2 ms | **44.4 / 47.4 ms** |
| Owner dealsCount | 277.7 / 315.4 ms | **48.0 / 55.8 ms** |
| Owner search | 187.1 / 304.1 ms | **42.9 / 55.1 ms** |
| Manager list | 241.8 / 298.6 ms | **42.8 / 45.0 ms** |
| Manager clientsCount | 243.7 / 318.8 ms | **41.9 / 46.4 ms** |

### حمل متزامن على endpoints الدليل فقط

| Level | قبل | بعد |
|---|---:|---:|
| 10 طلبات | 11.48 RPS / P50 587.5 / P95 865.6 / 0% أخطاء | **38.87 RPS / P50 235.8 / P95 250.2 / 0%** |
| 50 طلبًا | 13.89 RPS / P50 3,291 / P95 3,567 / 0% أخطاء | **41.66 RPS / P50 1,112.9 / P95 1,174.3 / 0%** |

- حجم الاستجابة بقي **23 KB** للصفحة.
- ذاكرة backend بعد حمل 50: **499 MB → 246 MB**.
- PostgreSQL CPU sample بعد حمل 50: 55.75% (قراءة لحظية) مقابل 1.37% قبل؛ العمل أصبح set-based/أكثف في DB لكن زمن الاستجابة وذاكرة backend انخفضا. القيمة لحظية وليست peak.
- لم يُجرَ 100-user load في هذه المهمة؛ الشرط يسمح به فقط إذا كان 50 سليمًا، و50 سليم هنا لكن نطاق المهمة طلب 10/50.

---

## 5. صحة النتائج

اختبارات مباشرة على Stage C:

- Owner: **5,000** موظف، جميع المعرفات فريدة.
- كل فرز (`clientsCount`, `propertiesCount`, `dealsCount`): 5,000 صفًا فريدًا.
- أعلى `clientsCount` = الموظف الثقيل المتوقع.
- Manager A: **2,750/2,750** موظفًا، ولا يظهر OWNER-direct.
- `employee0`: clients **350/350**، properties **222/222**.
- البحث باسم آخر موظف وجده.
- Summary:
  - total **5,000**
  - active **4,801/4,801**
  - clientsTotal **13,535/13,535**
  - lateTotal **7,629/7,629**
- Manager summary total **2,750/2,750**.

### الاختبارات الآلية
```powershell
npm run test -w @arkan/backend -- `
  test/employees-pagination.spec.ts `
  test/employees.spec.ts `
  test/owner-manager-employee-hierarchy.spec.ts `
  test/frontend-owner-drawer.spec.ts
```

**النتيجة: 4 suites / 39 اختبارًا ناجحًا.**

- Backend typecheck: **0**
- ESLint على `employees.service.ts`: **0**

هذه الاختبارات تغطي:
- فرزًا عالميًا لأكثر من 1,000 موظف.
- تساوي القيم وعدم التكرار/الفقدان.
- البحث والحالة وLoad More.
- عزل MANAGER/OWNER-direct.
- إنشاء/تعديل/تفعيل الحسابات.
- تفاصيل الموظف وترقيم عقاراته.

---

## 6. السلامة والحدود

- `arkan_crm_load_test` فقط للقياس، ولم تُعدّل بياناته:
  - 5,000 موظف، 15,000 عميل، 15,000 عقار، 23,750 موضوع متابعة.
- `arkan_crm` لم تُلمس (23 migrations).
- لم تُعدّل الواجهة أو الصلاحيات أو `history` أو migrations.
- لا commits أو pushes.
- backend القياس على 4101 أُوقف؛ backend التطوير على 4001 يعمل.

### حدود متبقية
1. الملخص ما زال يُحسب على كامل النطاق في أول صفحة (~44 ms owner)؛ يمكن لاحقًا cache/materialized counters مع ضمان invalidation.
2. 100-user full-mix لم يُعد؛ تحسين الدليل لا يضمن أن كل المسارات الأخرى سليمة عند 100.
3. manager overview / dashboard ما زالت مسارات ثقيلة منفصلة.
4. مراقبة PostgreSQL CPU بعد النشر؛ القياس اللحظي 55.75% يستحق متابعة.

**متوقف للمراجعة اليدوية.**
