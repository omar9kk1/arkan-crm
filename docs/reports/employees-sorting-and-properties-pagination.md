# فرز الموظفين العالمي وترقيم عقارات الموظف

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** دليل الموظفين ودرج تفاصيل الموظف فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو تغييرات schema.  
> لا تعديل على `arkan_crm` أو `.env` أو حسابات/تعيينات حقيقية.  
> لا commits أو pushes.

---

## 1. الملفات المتغيرة

### الخادم

| الملف | التغيير |
|---|---|
| `apps/backend/src/employees/dto/list-employees.query.ts` | إضافة `sort` (`clientsCount`/`propertiesCount`/`dealsCount`) وcursor بصيغة `<metric>:<uuid>` مع تحقق UUID صارم. |
| `apps/backend/src/employees/dto/list-employee-properties.query.ts` | DTO جديد لصفحة عقارات الموظف: `cursor`, `limit`. |
| `apps/backend/src/employees/employee.dto.ts` | `EmployeePropertyPageDto` (`items`, `nextCursor`, `total`). |
| `apps/backend/src/employees/employees.controller.ts` | `GET /employees/:id/properties` بنفس صلاحيات `GET /employees/:id`. |
| `apps/backend/src/employees/employees.service.ts` | فرز SQL عالمي قبل الصفحة، cursor ثابت، صفحة عقارات الموظف، ونطاق وصول موحّد `assertEmployeeVisible`. |

### الواجهة

| الملف | التغيير |
|---|---|
| `apps/frontend/lib/api/employee-types.ts` | نوع صفحة عقارات الموظف. |
| `apps/frontend/lib/api/employees-api.ts` | `sort` في استعلام الدليل + `listEmployeeProperties`. |
| `apps/frontend/lib/use-employees.ts` | تمرير `sort` إلى الخادم وإعادة التحميل عند تغييره. |
| `apps/frontend/features/manager-employees/components/employees-page.tsx` | إزالة الفرز المحلي للمقاييس؛ الخادم هو مصدر الترتيب. |
| `apps/frontend/features/manager-employees/model.ts` | `mapEmployeeProperty` لصفوف العقارات المرقّمة. |
| `apps/frontend/features/manager-employees/components/employee-details-drawer.tsx` | جلب صفحة العقارات الأولى + زر «تحميل المزيد» مع منع التكرار. |

### الاختبارات

| الملف | التغيير |
|---|---|
| `apps/backend/test/employees-pagination.spec.ts` | بيانات 1,005 موظف + 60/70 عقاراً + 101 عميل + 5 صفقات، واختبارات الفرز العالمي وترقيم العقارات. |

---

## 2. الفرز العالمي

### الآلية

- يُطبّق النطاق المصرح به أولاً:
  - OWNER: كل حسابات `EMPLOYEE`.
  - MANAGER: `employee.managerUserId = viewer.id` فقط.
  - OWNER-direct (`managerUserId = NULL`) لا يطابق أي مدير.
- يُطبّق البحث وحالة الحساب داخل نفس استعلام SQL قبل الترتيب والصفحة.
- يُحسب المقياس لكل الموظفين المصرح بهم، ثم:

```sql
ORDER BY metric DESC, id ASC
LIMIT page_size + 1
```

- الـcursor يحمل `metric:id`، والشرط التالي:

```sql
metric < cursor_metric
OR (metric = cursor_metric AND id > cursor_id)
```

وهذا يطابق `metric DESC, id ASC` تماماً، ويضمن عدم تكرار أو فقدان أي صف عند تعادل القيم.

### تعريف المقاييس

| الخيار | المعنى المحفوظ |
|---|---|
| `clientsCount` | عدد العملاء المميزين حيث الموظف منشئ أو مسؤول. |
| `propertiesCount` | عدد `Property.createdByUserId`. |
| `dealsCount` | عدد الصفقات المميزة حيث الموظف مسؤول عن العقار أو العميل. |

الاتجاه في كل الخيارات يبقى تنازلياً كما في الواجهة السابقة.

### أدلة الاختبار

على 1,005 موظف:

- `sort=clientsCount`: الموظف صاحب 60 عميلاً (آخر موظف بالدليل) هو **الأول**، يليه موظف الفريق A صاحب 40 عميلاً، ثم موظف بـ1 عميل.
- `sort=propertiesCount`: صاحب 70 عقاراً أولاً، ثم صاحب 60 عقاراً.
- `sort=dealsCount`: صاحب 5 صفقات أولاً.
- MANAGER A: الأول هو موظف فريقه صاحب 40 عميلاً، ولا يظهر أي موظف OWNER-direct.
- `sort=dealsCount` مع 1,004 تعادلات عند 0: جُمعت **1,005 معرّفات فريدة** عبر 21 صفحة، بلا نقص أو تكرار.
- الفلتر `status=inactive` أعاد 55 موظفاً فقط، بينما `summary.total` بقي 1,005 (مستقل عن الفلتر والصفحة).
- البحث باسم آخر موظف أعاد صفاً واحداً صحيحاً حتى مع الفرز العالمي.

---

## 3. ترقيم عقارات الموظف

- Endpoint جديد: `GET /employees/:id/properties?cursor=&limit=`.
- الحجم الافتراضي: **50**، والحد الأقصى للصفحة: **100**.
- لا يوجد سقف إجمالي لعدد العقارات.
- الترتيب محفوظ: `createdAt DESC, id DESC`.
- الحقول المرجعة فقط: `id`, `reference`, `title`, `status` — بلا علاقات متداخلة.
- `total` يُعاد مع كل صفحة ويعتمد على كامل عقارات الموظف.
- الصلاحية تُفحص بنفس نطاق الدرج:
  - OWNER: أي موظف مصرح.
  - MANAGER: موظف فريقه فقط.
  - غير ذلك: `404`.

### دليل الاختبار

موظف لديه **60 عقاراً**:

- الصفحة الأولى (بدون `limit`) أعادت **50** عنصراً + `nextCursor` و`total=60`.
- الصفحة التالية أعادت **10** عناصر + `nextCursor=null` و`total=60`.
- مجموع المعرّفات عبر الصفحتين **60 معرّفاً فريداً** بلا تكرار.
- MANAGER A استطاع قراءة عقارات موظف فريقه، وحصل على `404` لموظف فريق B وللموظف التابع مباشرةً للمالك.
- تفاصيل الموظف `GET /employees/:id` بقيت متوافقة: `propertyCount=60`، `PENDING=2`، `AVAILABLE=58`، وأول 50 عقاراً فقط داخل الحقل القديم `properties`.

---

## 4. الواجهة

- اختيار الفرز في دليل الموظفين يُرسل `sort` إلى الخادم؛ لم يعد الفرز يقتصر على الصفحات المحملة.
- تغيير البحث/الحالة/الفرز يلغي الصفحات السابقة ويبدأ من جديد بلا نتائج قديمة.
- «تحميل المزيد» في الدليل ما زال يعمل، مع منع التكرار.
- درج الموظف:
  - يعرض العدد الكامل من `total`.
  - يحمّل أول 50 عقاراً من الـendpoint الجديد.
  - يعرض زر «تحميل المزيد» عند وجود `nextCursor`.
  - يمنع تكرار العقارات عند الدمج.
- التصميم العربي RTL والبطاقات والدرج والتبويبات وأزرار الإدارة محفوظة.

---

## 5. نتائج الاختبارات والأوامر

```powershell
$env:TEST_DATABASE_URL="<TEST_DATABASE_URL>"
npm run test -w @arkan/backend -- test/employees-pagination.spec.ts
```

**النتيجة: 7/7 ناجح** (25.4 ثانية).

```powershell
$env:TEST_DATABASE_URL="<TEST_DATABASE_URL>"
npm run test -w @arkan/backend -- `
  test/employees.spec.ts `
  test/owner-manager-employee-hierarchy.spec.ts `
  test/frontend-owner-drawer.spec.ts
```

**النتيجة: 32/32 ناجح.**

```powershell
npm run typecheck -w @arkan/backend    # 0
npm run typecheck -w @arkan/frontend   # 0
npx eslint <الملفات المعدلة>          # 0
```

---

## 6. التحقق من الصلاحيات

- `GET /employees` و`GET /employees/:id` و`GET /employees/:id/properties` كلها محمية بـ`JwtAuthGuard` + `RolesGuard` (OWNER/MANAGER فقط).
- MANAGER لا يستطيع قراءة موظف خارج فريقه، ولا عقاراته (`404`).
- OWNER-direct لا يظهر لأي مدير ولا يمكن الوصول لعقاراته من مدير غير مصرح.
- لا تغيير على إنشاء/نقل/تفعيل/تعطيل الحسابات أو ManagerCapability أو إبطال الجلسات.
- لا تُعاد أي حقول حساسة أو علاقات غير لازمة.

---

## 7. تأكيد عدم وجود سقف إجمالي

- لا يوجد `MAX_TOTAL` أو حد ثابت لعدد الموظفين أو العقارات.
- `limit` يحد صفحة واحدة فقط:
  - الموظفون: افتراضي 50، أقصى 100.
  - العقارات: افتراضي 50، أقصى 100.
- اختبار 1,005 موظف وصل للجميع عبر 21 صفحة.
- اختبار 60 عقاراً وصل للجميع عبر صفحتين.
- `nextCursor=null` هو المؤشر الوحيد على نهاية البيانات.

---

## 8. القيود المتبقية

1. `summary` يُحسب على كامل النطاق في أول صفحة؛ دقيق لكنه قد يحتاج cache/materialized counters عند نمو كبير جداً.
2. تفاصيل الموظف ما زالت ترجع أول 50 عقاراً للتوافق مع العقد السابق، بينما الدرج يعتمد على الـendpoint المرقّم الجديد. هذا يعني تحميل 50 صفاً مكرراً عند فتح الدرج (مقبول حالياً، ويمكن إزالته لاحقاً بعقد جديد).
3. مقياس `dealsCount` متاح للفرز، لكن بطاقة الموظف ما زالت تعرضه كـ«غير متاح» لأن DTO الحالي لا يتضمنه؛ لم يُوسّع العقد خارج نطاق المهمة.
4. الـcursor يعتمد على قيمة المقياس وقت الطلب؛ إذا تغيّرت بيانات الموظف بين صفحتين فقد تتغير مواضع الصفوف (سلوك cursor متوقع، ولا يسبب تكراراً داخل نفس اللقطة).
5. لا فهارس جديدة؛ الاستعلامات الحالية مقبولة لبيانات الاختبار.
6. لم يُجرَ smoke بصري بجلسة متصفح موثقة (لا حسابات حقيقية/جلسات)، وتم التحقق عبر typecheck وESLint واختبارات API المركزة.

---

## 9. السلامة

- لا تغييرات على `arkan_crm` أو `.env`.
- لا migrations أو schema.
- لا commits أو pushes.
- الاختبارات استخدمت `arkan_crm_api_test` وبيانات اصطناعية فقط.

**متوقف للمراجعة اليدوية.**
