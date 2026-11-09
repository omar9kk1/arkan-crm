# فهارس PostgreSQL وتحسين الاستعلامات

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** قياس خطط الاستعلام، فهارس إضافية مبرّرة، وتحسين `/clients/stats` فقط.  
**الحالة:** مكتمل — بانتظار المراجعة والموافقة قبل أي migration على `arkan_crm`.

> Migration طُبّقت على `arkan_crm_api_test` فقط.  
> لا تغيير على `arkan_crm` أو `.env` أو أي بيانات/حسابات حقيقية.  
> لا commits أو pushes.

---

## 1. الملفات المتغيرة

| الملف | التغيير |
|---|---|
| `apps/backend/prisma/schema.prisma` | إضافة 11 فهرسًا فقط بعد قياسها. |
| `apps/backend/prisma/migrations/20261109120000_query_performance_indexes/migration.sql` | Migration إضافية تحتوي الفهارس وحدها. |
| `apps/backend/src/clients/clients.service.ts` | `/clients/stats` أصبح يحسب العدادات في قاعدة البيانات دون تحميل كل معرّفات العملاء إلى الذاكرة. |

لم تُعدّل أي قواعد صلاحيات أو شروط ملكية أو استعلامات بحث/ترتيب قائمة.

---

## 2. بيئة القياس والبيانات الاصطناعية

- قاعدة البيانات: `arkan_crm_api_test` فقط.
- PostgreSQL: **16.15**.
- البيانات المستخدمة في القياس:
  - 1,003 مستخدمًا (1,000 موظف، مديران، مالك).
  - 20,000 عميل.
  - 20,000 عقار (5,000 محذوف ناعمًا).
  - 60,000 متابعة.
  - 20,040 طلب موافقة.
  - 30,000 إشعار.
  - 10,000 صفقة.
  - 30,000 سجل تدقيق.
  - 30,000 موضوع متابعة.
- القياسات via `EXPLAIN (ANALYZE, BUFFERS)` و`ANALYZE` بعد كل تغيير.
- قياسات API in-process عبر Supertest، بعد طلب تسخين ثم **median لثلاث محاولات**.

---

## 3. الفهارس المضافة (مبرّرة بالقياس)

| # | الفهرس | الاستخدام | قبل | بعد |
|---|---|---|---:|---:|
| 1 | `FollowUp(clientId, status, dueAt)` | صفحة/عدادات متابعات العميل | 8.06 ms | **0.18 ms** |
| 2 | `PropertyApprovalRequest(propertyId, createdAt)` | أحدث جولة موافقة/سجل الموافقات | 5.32 ms | **0.06 ms** |
| 3 | `Property(createdAt)` | قائمة/بحث العقارات newest-first | 7.46 ms | **0.34 ms** |
| 4 | `Client(createdAt)` | قائمة العملاء newest-first | 6.60 ms | **0.12 ms** |
| 5 | `Client(createdById)` | عدّ عملاء الموظف في الدليل | جزء من 1,394.7 ms | جزء من **94.3 ms** |
| 6 | `Notification(userId, createdAt)` | صندوق الإشعارات | 10.00 ms | **0.43 ms** |
| 7 | `Deal(closedAt)` | لوحة التحكم للفترة المحددة | 1.72 ms | **0.28 ms** |
| 8 | `Deal(propertyEmployeeId)` | ترتيب الموظفين حسب الصفقات | جزء من 1,052.4 ms | جزء من **39.2 ms** |
| 9 | `Deal(clientEmployeeId)` | نفس السبب أعلاه | جزء من 1,052.4 ms | جزء من **39.2 ms** |
| 10 | `AuditLog(createdAt)` | آخر أنشطة لوحة التحكم | 12.91 ms | **0.06 ms** |
| 11 | `FollowUpSubject(responsibleUserId, nextDueAt)` | قائمة متابعات المدير | 5.73 ms | **0.71 ms** |

> الأرقام هي زمن تنفيذ الخطة (Execution Time) وليست زمن HTTP.

---

## 4. الفهارس المرفوضة وأسبابها

| المرشح | النتيجة |
|---|---|
| `FollowUp(clientId, createdAt)` | لم يُستخدم؛ المخطط اختار `(clientId, status, dueAt)`، والفرق 1.00 → 0.59 ms لا يبرّر فهرسًا ثانيًا. |
| `Property(deletedAt, createdAt)` | لم يُستخدم؛ بقي `Seq Scan + Sort` عند 7.38 ms. البديل `Property(createdAt)` أعطى 0.34 ms. |
| `PropertyApprovalRequest(status, createdAt)` | موجود مسبقًا؛ لا حاجة لتكراره. |
| `FollowUpSubject(responsibleId, nextDueAt)` | الفهرس الحالي `(responsibleId, active, nextDueAt)` يخدم قائمة الموظف عند 0.09 ms؛ الجديد لم يحسّن. |
| `AuditLog(action, createdAt)` | لم يغيّر الخطة (12.62 ms) لأن `action IN (...)` واسع. `AuditLog(createdAt)` أعطى 0.06 ms. |
| `pg_trgm` / GIN للبحث `ILIKE '%...%'` | لم يُفعّل. بحث العملاء ما زال `Seq Scan` عند 27 ms على 20k صف، لكن تفعيل extension + GIN يحتاج قرار نشر وكتابة إضافية. لم يُثبت أنه ضروري الآن. |

---

## 5. تحسين `/clients/stats`

### قبل
- `client.findMany({ select: { id: true } })` يحمّل **20,000 معرّف** إلى Node.
- `followUp.groupBy` يعيد **20,000 صف**.
- `deal.groupBy` يعيد **10,000 صف**.
- حلقة JS على كل عميل لحساب needs/late/without-property.

### بعد
- ثلاثة `count` في قاعدة البيانات:
  - `clientsNeedingFollowUp`: لا يوجد PENDING بعد نهاية اليوم.
  - `clientsLate`: يوجد PENDING قبل بداية اليوم.
  - `clientsWithoutProperty`: لا توجد صفقات.
- لا تُحمّل معرّفات العملاء ولا صفوف groupBy إلى الذاكرة.

### القياس الصريح

| النمط | زمن SQL | الصفوف العائدة إلى Node |
|---|---:|---:|
| القديم (ids + pending + deals) | **49.68 ms** | **50,000 صف** |
| الجديد (3 عدادات) | **57.68 ms** | **3 قيم scalar** |

**الخلاصة بصدق:** زمن قاعدة البيانات لم يتحسن في هذه العيّنة (بل زاد قليلًا)، لكن استهلاك الذاكرة وكمية النقل انخفضا من 20,000 UUID + 30,000 صف مجمّع إلى 3 أعداد. العدّادات الدقيقة محفوظة، واختبارات العملاء نجحت.

> لم أقدّم تحسينًا ماديًا للذاكرة على أنه تحسين زمني.

---

## 6. نتائج API قبل/بعد الفهارس

نفس الكود، والفرق فقط وجود الفهارس. Median لثلاث محاولات:

| Endpoint | قبل الفهارس | بعد الفهارس | ملاحظة |
|---|---:|---:|---|
| `/employees?sort=clientsCount` | 1,839.3 ms | **401.4 ms** | ~4.6× |
| `/employees?sort=dealsCount` | 1,536.9 ms | **240.5 ms** | ~6.4× |
| `/employees?sort=propertiesCount` | 361.8 ms | **228.1 ms** | ~1.6× |
| `/properties?q=...` | 71.3 ms | **35.4 ms** | ~2× |
| `/notifications?limit=20` | 30.4 ms | **17.9 ms** | ~1.7× |
| `/clients?limit=50` (مدير) | 78.1 ms | **58.5 ms** | ~1.3× |
| `/properties?limit=50` | 40.8 ms | 40.3 ms | لا تغيير |
| `/clients?limit=50` | 71.3 ms | 73.7 ms | لا تغيير؛ التسلسل/nested includes يغلب |
| `/clients?filter=late` | 95.4 ms | 98.5 ms | لا تغيير |
| `/clients/stats` | 52.9 ms | 65.8 ms | لا تحسّن زمني؛ التحسين ذاكري |
| `/dashboard/manager?period=month` | 92.9 ms | 96.9 ms | لا تغيير |
| `/dashboard/manager?period=all` | 295.6 ms | 357.6 ms | لا فهرس للنطاق الكامل؛ تباين قياس |
| `/managers` | 88.0 ms | 101.7 ms | لا تغيير |

**ملاحظة:** بعض الـendpoints لا يستفيد من الفهارس لأن تكلفتها الغالبة في Prisma nested includes/TLS/تسلسل JSON أو لأن الفلتر غير انتقائي. لم يتم ادعاء تحسين لها.

---

## 7. الاختبارات

```powershell
$env:TEST_DATABASE_URL="<TEST_DATABASE_URL>"
npm run test -w @arkan/backend -- `
  test/clients.spec.ts `
  test/clients-pagination.spec.ts `
  test/followups-pagination.spec.ts `
  test/employees-pagination.spec.ts `
  test/manager-dashboard.spec.ts `
  test/manager-dashboard-periods.spec.ts `
  test/notifications.spec.ts
```

**النتيجة: 7 suites / 66 اختبارًا ناجحًا.**

```powershell
npm run typecheck -w @arkan/backend    # 0
npm run typecheck -w @arkan/frontend   # 0
npx eslint apps/backend/src/clients/clients.service.ts  # 0
npx prisma validate --schema apps/backend/prisma/schema.prisma  # 0
```

الاختبارات شملت:
- عدادات العملاء وحالات `today/late/unmatched`.
- pagination العملاء والمتابعات والموظفين بما يتجاوز 1,000 سجل.
- عزل المدير/الموظف وعدم ظهور موظفي OWNER-direct.
- لوحة التحكم للفترات المختلفة.
- الإشعارات وعداد غير المقروء.

---

## 8. حالة الـMigration

- المجلد: `apps/backend/prisma/migrations/20261109120000_query_performance_indexes/`
- النوع: **إضافي فقط** — `CREATE INDEX` بلا أي تغيير جداول أو بيانات.
- طُبّق على `arkan_crm_api_test` فقط:

```powershell
$env:DATABASE_URL="<TEST_DATABASE_URL>"
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```

**النتيجة:** `Applying migration 20261109120000_query_performance_indexes` ثم `All migrations successfully applied`.

```powershell
npx prisma migrate status --schema apps/backend/prisma/schema.prisma
# Database schema is up to date! (23 migrations)
```

- لم تُطبّق أي migration على `arkan_crm`.
- لا تغييرات schema غير الفهارس.

---

## 9. مخاطر التوسع المتبقية

1. **البحث النصي:** `ILIKE '%...%'` على العملاء لا يزال Seq Scan (27 ms على 20k). `pg_trgm` مؤجل لحين الحاجة الفعلية وموافقة النشر.
2. **`/clients/stats`:** لم ينخفض زمن SQL؛ فقط الذاكرة/النقل. عند ملايين المتابعات قد يحتاج counters مخزّنة أو materialized views.
3. **قائمة العملاء:** زمن HTTP يغلب عليه nested includes والتسلسل، لا استعلام الفهرس.
4. **لوحة التحكم All-Time:** تحمّل كل الصفقات في الذاكرة لحساب المخطط؛ 10k صفوف = 1.8 ms SQL لكن زمن API ~300 ms. تحسينها يحتاج تجميعًا زمنيًا في SQL (خارج نطاق هذه المهمة).
5. **المدير/الفريق:** الفهارس الحالية لا تحل تسلسل `OR` الكبير في نطاقات الفرق الضخمة.
6. **كلفة الكتابة:** 11 فهرسًا إضافيًا على جداول ساخنة (FollowUp/Notification/Deal/AuditLog) تزيد زمن الإدراج قليلًا؛ يجب مراقبة `pg_stat_user_indexes` بعد النشر.
7. **قياس الإنتاج:** كل الأرقام على بيانات اصطناعية وقاعدة اختبار، وليست ضمانًا لزمن الإنتاج.

---

## 10. خطوات الموافقة قبل `arkan_crm`

1. مراجعة ملف الـmigration والفهارس المرفوضة.
2. التحقق من حجم الجداول والفهارس الحالية في `arkan_crm` (`pg_indexes`, `pg_class`).
3. تشغيل الفهارس على نسخة staging أولًا وقياس `EXPLAIN` و`pg_stat_user_indexes`.
4. في الإنتاج: يُفضّل `CREATE INDEX CONCURRENTLY` خارج معاملة migration لتقليل قفل الكتابة؛ إن استُخدم `prisma migrate deploy` فحدّد نافذة صيانة مناسبة.
5. أخذ نسخة احتياطية/خطة rollback قبل التطبيق.
6. بعد التطبيق: `ANALYZE` ثم التحقق من استخدام الفهارس وعدم تراجع خطط حساسة.
7. **التراجع:** `DROP INDEX CONCURRENTLY IF EXISTS "<name>"` لكل فهرس؛ لا حاجة لعكس بيانات.

**لم يُطلب أو يُنفّذ أي تطبيق على قاعدة البيانات الحقيقية.**

**متوقف للمراجعة اليدوية والموافقة.**
