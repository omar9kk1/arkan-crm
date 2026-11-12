# تحسين قائمتي الموظفين والمتابعات تحت الحمل المتزامن

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** `GET /employees?limit=50` (بما فيها الفرز) و`GET /follow-ups?limit=50` على Stage C.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا تغييرات على dashboard أو supervision أو المصادقة أو الصلاحيات.  
> لا migrations أو `.env` أو بيانات حقيقية. لا commits أو pushes.

**الخلاصة:** انخفض عدد استعلامات الصفحة الواحدة من **13.2 إلى 9.2** في دليل الموظفين، ومن **25.0 إلى 11.7** (مدير) و**17.6** (موظف) في المتابعات. النتيجة تحت الحمل: 50 طلبًا للدليل **1,112.9 → 859.9 ms**، و50 طلبًا للمتابعات **492.6 → 298.8 ms**، و100-user keep-alive **77.05 → 91.00 RPS** و**P95 5,073 → 4,312 ms** بصفر أخطاء.

---

## 1. الأسباب الجذرية المؤكدة

قياس مباشر لعدد استعلامات Prisma لكل طلب (50 طلبًا متتاليًا، عدّاد تراكمي مؤقت، دون تسجيل SQL أو معاملات):

| Endpoint | استعلامات/طلب (قبل) | التكوين |
|---|---:|---|
| `GET /employees` — OWNER clientsCount | **13.24** | استعلام الصفحة (1) + `user.findMany` وعلاقاته (employee/manager/capabilities/_count) + 4 استعلامات مقاييس + ملخص الدليل (1) + حارس الجلسة (2) |
| `GET /employees` — MANAGER clientsCount | **12.96** | نفس البنية بنطاق الفريق |
| `GET /follow-ups` — MANAGER | **25.04** | حارس الجلسة (2) + fingerprint المزامنة (5) + الصفحة وعلاقاتها (~7) + **ملخص 12 count** |
| `GET /follow-ups` — EMPLOYEE | **25.0** | نفس البنية مع fingerprint مُقيّد بنطاق الموظف |

المشكلة ليست زمن SQL (p50 لنحو 2–3 ms للاستعلام)، بل **عدد الاقتناءات من pool من 10 اتصالات**: 25 استعلامًا لكل طلب متابعة × تزامن 50 يعني مئات الاستعلامات في الطابور، وهو ما فسّرته مهمة التشخيص السابقة. أبرز الإسراف:

1. **ملخص المتابعات**: 12 استعلام `count()` متوازٍ لنفس النطاق، تُعاد في كل أول صفحة.
2. **fingerprint المزامنة**: 5 استعلامات تجميع لكل أول صفحة (شركة أو موظف).
3. **مقاييس صفحة الموظفين**: 4 استعلامات منفصلة (حالات العقارات، العملاء، الإسنادات، المتأخرات) + `_count.createdProperties` عبر علاقة Prisma.
4. **حارس الجلسة**: استعلامان لكل طلب (`RefreshToken` + `User`) — خارج نطاق هذه المهمة ولم يُلمسا.

---

## 2. التغيير

### `apps/backend/src/employees/employees.service.ts`

- استُبدلت الاستعلامات الأربعة (`propertyStatusByUser`, `clientsCountsByUser`, `assignedCountsByProfile`, `lateCountsByProfile`) باستعلام واحد `pageMetrics` بـ CTEs:
  - `ids` (معرّفات الصفحة)، `props` (عدّ plus `FILTER` لكل حالة)، `client_counts` (DISTINCT عبر `createdById OR responsibleEmployeeId`)، `assigned_counts` (DISTINCT `propertyId`)، `late_counts` (نشط + `nextDueAt < بداية اليوم الكويتي`).
- حُذف `_count.createdProperties` من `EMPLOYEE_SELECT`، ويُشتق `propertyCount` من مجموع حالات العقارات لنفس الموظف (تعريف متطابق: كل صفوف `Property` للمنشئ).
- `serializeListItem` و`readOne` يستخدمان `EmployeePageMetric` الموحّد. لا تغيير في أي حقل أو ترتيب.

### `apps/backend/src/followups/followups.service.ts`

- **`buildListSummary` جديدة**: استعلام واحد بـ `COUNT(*) FILTER (...)` يحسب:
  `total, overdue, today, upcoming, never, owners, buyers, sellers, renters, lessors, inquiries, exchanges`
  مع `LEFT JOIN "Property"` فقط لتصنيف `SALE/RENT`. النطاق: `responsibleUserId = viewer` للمدير/المالك، و`EXISTS` على `EmployeeProfile.userId` للموظف — مطابق تمامًا للفلاتر السابقة.
- **`syncFingerprint`**: لنطاق الشركة (MANAGER والـscheduler) أصبح استعلامًا واحدًا يجمع count/max للأربعة جداول + `User` عبر `CROSS JOIN` على تجميعة واحدة لكل جدول (5 → 1). مسار OWNER/EMPLOYEE المُقيّد بقي كما هو حفاظًا على سياسة الوصول دون تكرارها في SQL.
- **`buildSummary` القديمة بقيت كما هي** لمسار `GET /follow-ups/manager/summary` (supervision) — لم تُلمس.
- لم يتغيّر `sync`, `reconcile`, `createMany`, `updateMany`, ولا منطق الاستحقاق أو الإعادة أو التعطيل.

---

## 3. أعداد الاستعلامات قبل/بعد

| Endpoint | قبل | بعد | التخفيض |
|---|---:|---:|---:|
| employees — OWNER clientsCount | 13.24 | **9.18** | −31% |
| employees — MANAGER clientsCount | 12.96 | ~9.2 (نفس البنية) | ≈−29% |
| follow-ups — MANAGER | 25.04 | **11.70** | −53% |
| follow-ups — EMPLOYEE | 25.0 | **17.64** | −29% |

التفصيل: ملخص المتابعات 12 → 1، fingerprint الشركة 5 → 1، مقاييس الموظفين 4 → 1 + إزالة `_count`. حارس الجلسة (2 استعلامات/طلب) ما زال ضمن الرقم في الحالتين.

---

## 4. قياس الأداء

### طلب واحد (50 طلبًا متتاليًا، نفس الجلسة، P50)

| Endpoint | قبل | بعد |
|---|---:|---:|
| employees — OWNER clientsCount | 46.1–59.8 ms | 56.5 ms (ثابت) |
| employees — MANAGER clientsCount | 45.6 ms | 46.5 ms (ثابت) |
| employees — MANAGER propertiesCount | 38.0–56.5 ms | 38.5 ms |
| follow-ups — MANAGER | 28.6–35.5 ms | **21.6 ms** (−25–39%) |
| follow-ups — EMPLOYEE | 42.2 ms | **35.4 ms** (−16%) |

حجم الاستجابة لم يتغيّر: 23 KB للدليل و31 KB للمتابعات.

### حمل متزامن على كل endpoint (نفس harness التقارير السابقة)

**دليل الموظفين** (`measure-employees.cjs`، 3 أنواع فرز لكل مستوى):

| Level | قبل | بعد |
|---:|---|---|
| 10 | 38.87 RPS, P50 235.8 / P95 250.2 ms, 0% | **43.94 RPS, P50 214.8 / P95 222.9 ms, 0%** |
| 50 | 41.66 RPS, P50 1,112.9 / P95 1,174.3 ms, 0% | **54.57 RPS, P50 859.9 / P95 897.4 ms, 0%** |

**المتابعات** (`measure-sync.cjs`):

| Level | قبل | بعد |
|---:|---|---|
| 10 | P50 168.9 / P95 260.7 ms, 0% | **P50 70.8 / P95 73.1 ms, 0%** |
| 50 | P50 492.6 / P95 584.0 ms, 0% | **P50 298.8 / P95 322.7 ms, 0%** |

### 100-user full-mix keep-alive (تشغيل واحد)

| Metric | قبل (المهمة 14) | بعد |
|---|---:|---:|
| RPS | 77.05 | **91.00** (+18%) |
| P50 | 3,082 ms | **2,738 ms** |
| P95 | 5,073 ms | **4,312 ms** (−15%) |
| Errors | 0 | **0 / 400** |
| Max DB connections | 10 | **10** |
| `/health` max (اتصال منفصل) | 193.7 ms | **178 ms** |
| Backend RSS | 214→286 MB | 255→268 MB |
| PostgreSQL | 274→327 MB | 339→341 MB |

- لا HTTP 5xx ولا timeouts ولا 401/403 loops في التشغيل النهائي.
- انخفاض عدد الاستعلامات لكل طلب هو ما خفّض الاقتناء من pool؛ لم يُرفع حجم pool ولم تُضف أي آلية cache.
- ملاحظة قياس: أرقام 10/50 مأخوذة بنفس الـharness وبجلسة قريبة من خط الأساس، أما 100-user فيتأثر بحمل الجهاز الخلفي؛ المقارنة الأساسية هي مع التشغيل النظيف السابق (77.05 RPS / P95 5,073 ms).
- انتظار pool: لم يُعَد أخذ عينات `pg_stat_activity` في هذه المهمة (يتطلب instrumentation مؤقتًا)، لكن العدد الأقصى للاتصالات بقي 10، ولم يحدث أي `ECONNRESET` في تشغيل 100-user النهائي (400/400 ناجح)، وانخفض عدد الاستعلامات/الاقتناءات لكل طلب كما في الجدول أعلاه.

---

## 5. الصحة والأمان

### تحقق مباشر على Stage C (سكربت قراءة فقط، ثم حُذف)

- **الموظفون:** 3 صفحات (50+50+100) بلا تكرار، ترتيب `clientsCount DESC, id ASC` صحيح، 50 صفًا مطابقًا للحساب القديم في: `propertyCount`, `propertiesByStatus` (6 حالات), `clientsCount`, `assignedCount`, `lateCount`.
- **الملخصات:** OWNER 5,000/5,000، MANAGER A 2,750/2,750.
- **المتابعات:** صفحتان بلا تكرار وبترتيب `dueAt` صحيح. الملخص مطابق تمامًا لحساب الـ12 count القديم:
  - MANAGER A: total 93، overdue 33، today 0، upcoming 60، never 0، owners 20، sellers 20.
  - EMPLOYEE 0: total 542، overdue 215، today 3، upcoming 324، never 415، owners 192، sellers 101، lessors 91.
- **`verify.cjs` الشامل:** 54/55 فحصًا ناجحًا. الفحص الوحيد الفاشل هو توقّع قديم بأن `GET /follow-ups/manager/overview?limit=1` يعيد `summary` — وهو **ليس انحدارًا**: المسار page-only منذ تحسين supervision، والملخص مخصص عبر `GET /follow-ups/manager/summary` الذي أعاد **10,556** بنجاح. سكربت `verify.cjs` يحتاج تحديثًا لاحقًا (أداة قياس غير متتبعة، خارج نطاق المهمة).
- جميع فحوص العزل نجحت: `manager A` لا يرى OWNER-direct، تفاصيل فريق B = 404، سجل متابعة فريق B = 404، الموظف لا يستطيع فتح `/employees` (403)، ولا تسريب أرقام هواتف.

### الاختبارات

```
11 suites passed, 90 tests passed
employees-pagination, employees, owner-manager-employee-hierarchy,
frontend-owner-drawer, followups, followups-manager,
followups-manager-notifications, followups-pagination,
followup-history-authorization, followups-sync-optimization,
followups-supervision-employees
```

تشمل: فرزًا عالميًا لأكثر من 1,000 سجل، عدم التكرار/الفقدان، البحث والفلاتر والـcursor، المزامنة التزايدية، عزل الفرق، و404 لسجل الفرق الأخرى. `typecheck` وESLint على الملفين: نظيفان.

---

## 6. القيود المتبقية والخطوة القادمة

1. **صفحة المتابعات ما زالت fan-out**: استعلام الصفحة + ~7 استعلامات علاقات (Property/Contact/Client/Entry/User) لكل طلب. تحويلها إلى استعلام raw واحد سيكون أكبر مكسب متبقٍ، لكنه يحتاج إعادة بناء DTO المتداخل والـcursor بحذر.
2. **مقاييس دليل الموظفين**: استعلام الصفحة نفسه (فرز عالمي على 5,000 موظف، ~31 ms لـclientsCount) + ملخص الدليل (~44 ms) لا يزالان يعملان على كامل النطاق في أول صفحة. تقليل الاستعلامات حسّن التزامن، لكن زمن الطلب المفرد ثابت.
3. **حارس الجلسة**: استعلامان لكل طلب على كل المسارات. تحسينه (cache قصير لصلاحية الجلسة) تغيير أمني يحتاج قرارًا منفصلًا.
4. **fingerprint الموظف**: ما زال 5 استعلامات (المسار المُقيّد)؛ يمكن توحيده لاحقًا بعد تثبيت ترجمة سياسة الوصول إلى SQL مع اختبارات عزل.

**التوصية التالية المقاسة:** استعلام raw واحد لصفحة المتابعات (صفحة + علاقات + count entries) مع الحفاظ على cursor والـDTO، ثم إعادة قياس 50-user.

---

## 7. السلامة والحالة

- الملفات المعدّلة: `apps/backend/src/employees/employees.service.ts` و`apps/backend/src/followups/followups.service.ts` فقط.
- أداة قياس محفوظة: `scripts/load-test/profile-list-endpoints.cjs` (عدّ الاستعلامات يتطلب instrumentation مؤقتًا أُزيل بالكامل؛ لم يبقَ أي `PRISMA_TIMING` في الكود).
- `arkan_crm_load_test`: 50 MB، دون reset أو seeding (23,750 موضوع متابعة، 0 targetKey مكرر).
- `arkan_crm` لم تُلمس: 23 migrations، لا migration جديدة.
- backend القياس على 4101 أُوقف؛ 4001 يعمل و`/health` = 200.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
