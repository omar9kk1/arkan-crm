# تحسين أداء دليل الموظفين وإلغاء سقف 1000

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** دليل الموظفين (`GET /employees`) وإدارة الفرق التابعة له فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو تغييرات schema.  
> لا تعديل على `arkan_crm` أو `.env` أو حسابات/تعيينات حقيقية.  
> لا commits أو pushes.

---

## 1. ما تم تغييره

### الخادم

- **DTO جديد:** `apps/backend/src/employees/dto/list-employees.query.ts`
  - `search`, `status`, `cursor`, `limit`.
  - `limit` افتراضي في الخدمة: **50**، وأقصى صفحة: **100**.
  - لا يوجد سقف إجمالي للموظفين.
- **`GET /employees`**
  - cursor pagination بترتيب ثابت `createdAt ASC, id ASC`.
  - البحث (الاسم/الهاتف) وحالة الحساب تُطبقان داخل استعلام Prisma قبل الصفحة.
  - النطاق محفوظ: OWNER كل الموظفين، MANAGER فريقه فقط، و`managerUserId = NULL` لا يطابق أي مدير.
- **إحصائيات فعالة بدون تحميل كل الصفوف**
  - `propertiesByStatus`: `property.groupBy(createdByUserId, status)`.
  - `propertyCount`: من `_count.createdProperties`.
  - `clientsCount`: استعلام SQL تجميعي `COUNT(DISTINCT client)` عبر `EmployeeProfile`.
  - `assignedCount`: `COUNT(DISTINCT propertyId)` من `PropertyAssignment`.
  - `lateCount`: `followUpSubject.groupBy(responsibleId)` مع حد اليوم الكويتي.
  - لا N+1: كل الاستعلامات مجمعة لصفحة واحدة.
- **`summary`** في أول صفحة فقط:
  - `total`, `active`, `clientsTotal`, `lateTotal` محسوبة على كامل النطاق المصرح به.
- **`GET /employees/:id`** جديد:
  - يعيد تفاصيل الموظف الكاملة للدرج (بما فيها خصائصه حتى الحد الحالي 50).
  - OWNER: أي موظف. MANAGER: موظف فريقه فقط، وغيره 404.
- **قائمة المديرين `/managers`**
  - أصبحت تتضمن `team` كاملة (id/name/isActive) لكل مدير، مع `teamCount`.
  - يمنع انقطاع أسماء الفريق عند pagination دليل الموظفين.

### الواجهة

- `apps/frontend/lib/api/employee-types.ts` و`employees-api.ts`
  - نوع صف خفيف للدليل + `summary` + `nextCursor`.
  - `listEmployees(query)` و`getEmployee(id)`.
  - `ManagerDto.team`.
- `apps/frontend/lib/use-employees.ts` جديد:
  - تحميل أول صفحة، Load More، بحث/فلتر خادمي، debounce، منع النتائج القديمة والتكرار.
- `employees-page.tsx`
  - دليل من الخادم مع Load More.
  - الإحصائيات من `summary` وليس من الصفحة.
  - فتح الدرج يجلب `GET /employees/:id` الكامل.
  - التعديل/التفعيل يحدّث السجل، والخادم يبقى مصدر الحقيقة.
- `employee-stats.tsx`
  - يدعم `summary` للعدّادات الكاملة.
- `owner-managers-tab.tsx`
  - يعرض فريق كل مدير من `manager.team` بدل الاعتماد على صفحة الموظفين المحملة.
- التصميم العربي RTL والدرج والتبويبات وأزرار الإدارة محفوظة.

---

## 2. القياسات الفعلية

بيانات اصطناعية على `arkan_crm_api_test`:

- 1,005 موظف.
- 3 عقارات و2 عميل لكل موظف = 3,015 عقاراً و2,010 عميلاً.
- 1,005 تعيينات و1,005 متابعات متأخرة.

| القياس | قبل (نمط التحميل الكامل) | بعد |
|---|---:|---:|
| بناء الدليل كاملاً (كل الصفوف + serialize) | **435.3 ms / 912 KB** | — |
| `GET /employees` أول صفحة 50 (OWNER) | — | **191.4 ms / 20 KB** |
| `GET /employees` أول صفحة 50 (MANAGER) | — | **119.4 ms / 22 KB** |
| `GET /employees/:id` تفاصيل | — | **19 ms / 1 KB** |
| كل 1,005 موظف عبر 21 صفحة | غير ممكن بسقف سابق | **794.8 ms** |

**النتيجة:** الصفحة الأولى أخف بحوالي **45×** في الحجم، وأسرع من نمط التحميل الكامل مع إمكانية الوصول لكل السجلات.

> القياسات in-process على قاعدة الاختبار، بلا شبكة/متصفح؛ للمقارنة النسبية.

---

## 3. الاختبارات

### اختبار جديد

`apps/backend/test/employees-pagination.spec.ts` — **4/4 ناجح**:

- 1,005 موظف عبر 21 صفحة، 1,005 معرّفًا فريدًا بلا نقص أو تكرار.
- البحث يجد موظفاً خارج أول صفحة.
- OWNER يرى 1,005، MANAGER A يرى 550، MANAGER B يرى 300، والموظفون المباشرون للمالك لا يظهرون لأي مدير.
- `summary.total/active/clientsTotal/lateTotal` صحيحة على كامل النطاق.
- `GET /employees/:id` يعيد العقارات/العدّادات، وMANAGER لا يصل إلى موظف خارج فريقه (404).
- `/managers` يعيد فرقاً كاملة (550/300) مستقلة عن صفحة الموظفين.

### اختبارات الانحدار

```powershell
npm run test -w @arkan/backend -- `
  test/employees.spec.ts `
  test/owner-manager-employee-hierarchy.spec.ts `
  test/frontend-owner-drawer.spec.ts
```

**النتيجة: 32/32 اختباراً ناجحاً.**

- `typecheck` للـbackend والـfrontend: ناجح.
- ESLint على الملفات المعدلة: ناجح.

---

## 4. التحقق من الصلاحيات

- OWNER: كل حسابات EMPLOYEE عبر الصفحات.
- MANAGER: `employee.managerUserId = viewer.id` فقط.
- OWNER-direct (`managerUserId = NULL`): لا يطابق شرط أي مدير.
- MANAGER لا ينشئ/ينقل/يفعّل/يعطّل؛ جميع هذه المسارات ما زالت OWNER-only.
- ManagerCapability وسلوك إبطال الجلسات لم يُعدّلا.
- تفاصيل الموظف محمية بنفس النطاق: 404 لغير المصرح.

---

## 5. تأكيد عدم وجود سقف

- لا يوجد `MAX_TOTAL` أو `LIST_LIMIT` للدليل.
- `limit` يحد صفحة واحدة فقط (50/100).
- اختبار 1,005 موظف مرّ عبر 21 صفحة حتى `nextCursor = null`.
- البحث/الفلتر يعملان قبل pagination على كامل النطاق.

---

## 6. تحقق الواجهة

لم تتوفر جلسة متصفح موثقة لحساب MANAGER/OWNER في هذه الجلسة، ولم تُعدّل حسابات حقيقية. لذلك:

- لم يُجرَ smoke بصري فعلي لصفحة الدليل/الدرج/Load More/RTL/mobile.
- تم التحقق عبر typecheck وESLint واختبارات API المركزة.
- التحقق البصري يبقى مطلوبًا يدويًا.

---

## 7. القيود المتبقية

1. **Summary** يُحسب في أول صفحة عبر استعلامات تجميع على كامل الموظفين (بما فيها raw SQL)؛ دقيق لكنه قد يحتاج cache/materialized counters عند نمو كبير جدًا.
2. **الفرز** الحالي يتم على الصفحات المحملة في الواجهة (clients/properties/deals)؛ البحث والفلتر خادميان، لكن الترتيب العالمي لكل الموظفين غير مطبق في SQL.
3. البحث يستخدم `contains/insensitive` على الاسم/الهاتف؛ لا trigram/تطبيع أرقام عربي على الخادم.
4. تفاصيل الموظف تُرجع أول 50 عقاراً (نفس العقد الحالي) مع `propertyCount` كامل.
5. `/managers` يعيد فرق كل المديرين كاملة بدون pagination؛ عدد المديرين/الفرق الكبير قد يحتاج endpoint فريق مستقل لاحقاً.
6. لا migrations أو فهارس جديدة؛ لم تكن ضرورية للتنفيذ الحالي.

---

## 8. السلامة

- لا تغييرات على `arkan_crm` أو الحسابات الحقيقية.
- لا migrations أو schema.
- لا `.env`.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
