# تدقيق الأداء وتنظيف الكود — المرحلة 3 / المهمة 1

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**النوع:** تدقيق فقط — لم تُنفّذ تحسينات أو حذف أو refactor.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لم تُعدّل بيانات `arkan_crm` أو `.env` أو schema/migrations.  
> القياسات الاصطناعية أُجريت على `arkan_crm_api_test` فقط.  
> لا commits أو pushes.

---

## 1. منهجية القياس

- **API:** تطبيق NestJS داخل الاختبار (in-process) + `supertest`، على قاعدة `arkan_crm_api_test`.
- **البيانات الاصطناعية:** 3,000 عقار، 1,000 عميل، 15,000 متابعة، 3,000 إشعار، 600 FollowUpSubject، 300 صفقة، 3,000 AuditLog، 6 موظفين، 3 مديرين.
- **القياس:** طلب تسخين واحد ثم 3 قياسات؛ الرقم المعروض هو **الوسيط**.
- **ملاحظة:** الأرقام لا تتضمن زمن الشبكة أو المتصفح؛ هي زمن الخادم + ORM + serialization داخل نفس العملية.
- **الواجهة:** أحجام الحزم من build الإنتاج الحالي `.next` (gzip level 9) بدون إعادة build.
- **قاعدة البيانات:** `EXPLAIN (ANALYZE, BUFFERS)` على نفس البيانات الاصطناعية.
- **قاعدة الأعمال:** فحص قراءة فقط: 4 عقارات، 0 عملاء، 1 جهة اتصال، 5 ملفات صور، 322 AuditLog. لم تُكتب أي بيانات.

---

## 2. خط الأساس — API

| المسار | الدور | الوسيط | حجم الاستجابة |
|---|---|---:|---:|
| `GET /properties?limit=100` | OWNER | **65.9 ms** | 118 KB |
| `GET /properties?limit=100` | MANAGER | **45.8 ms** | 118 KB |
| `GET /properties?q=الكرادة&limit=100` | OWNER | **54.6 ms** | 118 KB |
| `GET /properties?q=الكرادة&limit=100` | MANAGER | **98.1 ms** | 118 KB |
| `GET /properties/:id` | OWNER | **15.5 ms** | 1 KB |
| `GET /clients?limit=100` | OWNER | **556.1 ms** | 1,045 KB |
| `GET /clients?limit=250` | OWNER | **1,396.6 ms** | 2,622 KB |
| `GET /clients?limit=1000` | OWNER | **1,974.4 ms** | 3,440 KB |
| `GET /clients?limit=1000` | MANAGER | **1,923.5 ms** | 3,440 KB |
| `GET /clients?search=...&limit=1000` | OWNER | **614.2 ms** | 1,166 KB |
| `GET /clients/stats` | OWNER | **97.1 ms** | — |
| `GET /clients/stats` | MANAGER | **96.7 ms** | — |
| `GET /employees` | OWNER | **99.0 ms** | 18 KB |
| `GET /employees` | MANAGER | **77.1 ms** | 18 KB |
| `GET /notifications?limit=20` | OWNER | **13.2 ms** | 8 KB |
| `GET /notifications?limit=20` | MANAGER | **16.7 ms** | 8 KB |
| `GET /notifications/unread-count` | OWNER | **9.1 ms** | — |
| `GET /dashboard/manager?period=all` | OWNER | **23.9 ms** | 1 KB |
| `GET /dashboard/manager?period=all` | MANAGER | **29.1 ms** | 1 KB |
| `GET /follow-ups/manager/overview` | MANAGER | **170.2 ms** | 420 KB |
| `GET /contacts?limit=100` | OWNER | **22.2 ms** | 55 KB |
| `GET /client-reviews/count` | OWNER | **8.9 ms** | — |
| `GET /properties/stats/mine` | EMPLOYEE | **15.3 ms** | — |

**الخلاصة:** أكبر مشكلة أداء حالية ليست قاعدة البيانات وحدها، بل **حجم استجابة `/clients`** بسبب nested includes. حتى `limit=100` يعيد 1 MB ويستغرق ~556 ms.

---

## 3. خط الأساس — الواجهة والحزم

### 3.1 أحجام حزم المسارات (JS فقط، gzip)

| المسار | Chunks | Raw | Gzip |
|---|---:|---:|---:|
| `/employee/clients` | 6 | 216 KB | **66 KB** |
| `/manager/clients` | 6 | 217 KB | **66 KB** |
| `/manager/properties` | 7 | 201 KB | **63 KB** |
| `/employee/properties` | 6 | 177 KB | **56 KB** |
| `/manager/employees` | 5 | 139 KB | **45 KB** |
| `/manager/followups` | 5 | 143 KB | **45 KB** |
| `/manager/finance` | 4 | 109 KB | **36 KB** |
| `/login` | 2 | 53 KB | **17 KB** |

- إجمالي ملفات JS في build الحالي: **45 ملفًا / 1.51 MB غير مضغوط**.
- أكبر chunk مشترك: 224 KB raw، ثم 156 KB، ثم 110 KB.
- **لا توجد مشكلة bundle حرجة حاليًا**؛ أكبر مسار ~66 KB gzip. الأولوية للحزم ليست عالية مقارنة بحجم استجابات API.

### 3.2 TTFB للـdev server

على `localhost:3001` (خادم تطوير، وليس إنتاجًا):

| المسار | الوسيط | ملاحظة |
|---|---:|---|
| `/login` | 59 ms | HTML 15 KB |
| `/manager/properties` | 85 ms | HTML 16 KB |
| `/manager/clients` | 97 ms | HTML 15 KB |

الحد الأقصى ظهر مرتفعًا بسبب إعادة تجميع Next dev (حتى 5.3s)، لذلك **لا تُستخدم هذه الأرقام كقياس إنتاجي**. لم يتوفر قياس متصفح موثّق للجلسة بسبب عدم توفر بيانات دخول؛ القياسات الفعلية للـAPI هي الأساس.

### 3.3 الموارد

| العملية | Working Set | Private | CPU تراكمي |
|---|---:|---:|---:|
| Frontend Node (3001) | 146 MB | 257 MB | 22s منذ التشغيل |
| Backend Node (4001) | 114 MB | 111 MB | 6.9s منذ التشغيل |
| PostgreSQL | 87 MB | — | 0.01% لحظيًا |
| Redis | 7.5 MB | — | 0.79% لحظيًا |

لا يوجد ضغط ذاكرة أو CPU حالي. الأرقام مرجعية فقط، وليست اختبار حمل.

---

## 4. قاعدة البيانات — خطط الاستعلام والفهارس

### 4.1 نتائج `EXPLAIN (ANALYZE, BUFFERS)`

| الاستعلام | الخطة | الزمن الفعلي | الملاحظة |
|---|---|---:|---|
| قائمة العقارات (OWNER) | Seq Scan + Sort (top-N) | 1.36 ms | لا فهرس `createdAt` للفرز |
| قائمة العقارات (MANAGER) | Index Scan على `deletedAt` + subplan + Sort | 1.56 ms | الفرز والتصفية ما زالا في الذاكرة |
| بحث العقارات `ILIKE %...%` | Seq Scan + Sort | 7.27 ms | لا trigram/GIN |
| قائمة العملاء | Seq Scan + Sort | 0.99 ms | لا فهرس `createdAt` |
| بحث العملاء `ILIKE` | Seq Scan | 1.49 ms | لا trigram/GIN |
| إشعارات المستخدم | Seq Scan/Bitmap على `userId` + Sort | 0.93 ms | الفهرس الحالي `(userId, readAt, createdAt)` لا يطابق ترتيب `createdAt` |
| عدّاد غير المقروء | Seq Scan/Bitmap | 0.53 ms | يحتاج `(userId, readAt)`؛ متاح كبادئة للفهرس الحالي |
| موافقات عقار واحد | **Seq Scan على 3,000 صف** | 0.31 ms | **لا فهرس `propertyId`** |
| صفقات آخر 30 يومًا | Seq Scan | 0.40 ms | لا فهرس `closedAt` |
| نشاط لوحة التحكم | Seq Scan + Sort | 1.20 ms | لا فهرس `(action, createdAt)` |
| إشراف المتابعات للمدير | Hash Join + Seq Scan على FollowUpSubject | 0.54 ms | مقبول حاليًا؛ لا يطابق فهرس المدير |

**مهم:** أزمنة DB صغيرة جدًا حاليًا؛ البطء في `/clients` سببه تحميل العلاقات المتداخلة وserialization، وليس مسح الجدول. الفهارس تصبح حرجة مع النمو.

### 4.2 الفهارس الناقصة المؤكدة

| الجدول | الفهرس المقترح | السبب |
|---|---|---|
| `FollowUp` | `@@index([clientId, createdAt])` | nested include لقائمة العملاء + stats groupBy |
| `PropertyApprovalRequest` | `@@index([propertyId, createdAt])` | كل قراءة تفاصيل عقار + قرارات المراجعة |
| `Property` | `@@index([deletedAt, createdAt])` | قائمة العقارات وفرزها |
| `Property` | `@@index([createdByUserId, deletedAt, createdAt])` اختياري | نطاق المدير/الموظف |
| `Client` | `@@index([createdAt])` أو `([responsibleEmployeeId, createdAt])` | قائمة العملاء والفرز |
| `Notification` | `@@index([userId, createdAt])` | صندوق الإشعارات مرتبًا بالوقت؛ يبقى الفهرس الحالي لعدّاد غير المقروء |
| `Deal` | `@@index([closedAt])` | لوحة التحكم بالفترات |
| `AuditLog` | `@@index([action, createdAt])` | نشاط لوحة التحكم |
| `FollowUp` | `@@index([clientId, status, dueAt])` اختياري | stats العملاء |
| بحث نصي | `pg_trgm` GIN على حقول العقار/العميل | `ILIKE '%...%'` لا يستخدم B-tree |

> أي فهرس جديد يحتاج **migration additive وموافقة صريحة**، ولم يُنفّذ في هذا التدقيق.

### 4.3 Pagination

| المجال | الحالة |
|---|---|
| العقارات | cursor + `limit` (100) — جيد |
| الإشعارات | cursor + 20 — جيد |
| جهات الاتصال | cursor + 100 — جيد |
| العملاء | **بلا cursor؛ حتى 1000 صف** + بحث client-side — يحتاج إصلاحًا |
| الموظفون | **بلا pagination**؛ يحمّل كل الموظفين وكل عقاراتهم/عملائهم/تعييناتهم |
| إشراف المتابعات | `LIST_LIMIT = 1000` مع nested details — ثقيل |
| Trash | كل الصفوف بلا pagination (OWNER فقط) — أقل خطورة حاليًا |

---

## 5. الاختناقات المؤكدة مرتبة

### P1 — `/clients` يحمّل 1000 عميل مع علاقات ثقيلة — **أعلى أولوية**

- الملفات: `apps/frontend/lib/use-clients.ts` (يستدعي `listClients()` بلا limit)، `apps/backend/src/clients/clients.service.ts` (`MAX_CLIENTS_PER_PAGE = 1000` و`CLIENT_LIST_INCLUDE`)، `manager-clients/components/clients-page.tsx` (بحث client-side).
- الدليل: 100 عميل = **556 ms / 1,045 KB**؛ 250 = **1.4s / 2.6 MB**؛ 1000 = **2.0s / 3.4 MB**.
- السبب: لكل عميل حتى 100 متابعة + 100 صفقة + 100 interest، ثم JSON.
- الإصلاح: pagination من الخادم (50–100)، بحث server-side، وإزالة/تقليص العلاقات الثقيلة من قائمة العملاء (تحميلها عند فتح التفاصيل فقط)، وإضافة فهرس `FollowUp(clientId, createdAt)`.
- الأثر المتوقع: من ~2 ثانية إلى أقل من 150–250 ms، ومن 3.4 MB إلى أقل من 200 KB (تقدير بعد تقليص payload).
- الجهد: **Medium** — تغيير frontend/backend معًا، بلا migration إلزامية (الفهرس migration منفصل).

### P2 — إشراف المتابعات يعيد 420 KB في طلب واحد

- الملف: `apps/backend/src/followups/followups.service.ts` (`LIST_LIMIT = 1000`، `SUBJECT_SELECT` يتضمن property/contact/client + آخر entries).
- الدليل: **170 ms / 420 KB** عند 600 موضوع.
- الإصلاح: تقليل `LIST_LIMIT` أو pagination، وإرجاع الحقول الأساسية فقط في القائمة مع تحميل التفاصيل عند فتح الدرج.
- الجهد: **Medium**.

### P3 — دليل الموظفين غير محدود

- الملف: `apps/backend/src/employees/employees.service.ts` (`propertiesByEmployee`, `clientsByEmployee`, `assignmentsByEmployee`, `lateFollowUpsByEmployee`).
- الدليل: **99 ms** للمالك و**77 ms** للمدير عند 3 موظفين و3,000 عقار فقط.
- المشكلة: `propertiesByEmployee` يحمّل كل العقارات للمستخدمين، و`clientsByEmployee` كل العملاء؛ ثم يُقتطع في الذاكرة.
- الإصلاح: `groupBy`/aggregate + `take`، وpagination لدليل الموظفين.
- الجهد: **Medium**.

### P4 — بحث العقارات والموافقات والفهارس

- الملفات: `properties.service.ts` (`contains/insensitive`، `orderBy createdAt`)، `property-serializer.ts` (`approvals` include)، `schema.prisma`.
- الدليل: بحث العقارات 54–98 ms عند 3,000 عقار؛ موافقات عقار = Seq Scan على 3,000 صف.
- الإصلاح: `PropertyApprovalRequest(propertyId, createdAt)`، `Property(deletedAt, createdAt)`، وpg_trgm/بحث prefix عند الحاجة.
- الجهد: **Medium** (migration + قياس EXPLAIN).

### P5 — طلب `/auth/me` عند كل تنقّل + استطلاع الإشعارات

- `auth-provider.tsx`: `useEffect` يعتمد على `pathname` ويستدعي `restoreSession()` عند كل انتقال.
- `notifications/store.ts`: كل تبويب ظاهر يرسل طلبين كل 15 ثانية (قائمة + عدّاد)؛ التبويب المخفي لا يرسل (جيد).
- الأثر: طلب شبكة إضافي لكل صفحة، وضغط DB خطي مع عدد المستخدمين.
- الإصلاح: cache قصير للجلسة مع إعادة التحقق عند 401/refresh فقط؛ رفع فترة الاستطلاع أو SSE لاحقًا.
- الجهد: **Small/Medium**.

### P6 — لوحة التحكم والصفقات

- `dashboard.service.ts` يحمّل كل صفقات الفترة إلى الذاكرة ويحسب dailyCounts في JS؛ لا فهرس `Deal.closedAt`.
- الدليل الحالي: 24–29 ms عند 300 صفقة — ليس اختناقًا الآن.
- الإصلاح عند النمو: SQL aggregation + فهرس `closedAt`.
- الجهد: **Medium**.

---

## 6. مرشحات تنظيف الكود

### 6.1 SAFE TO REMOVE — بعد المراجعة النهائية

تم التحقق من عدم وجود أي import/استخدام (بما في ذلك `app/` والاختبارات):

| الملف | الحجم | الدليل |
|---|---:|---|
| `apps/frontend/components/layout/workspace-shell.tsx` | 22 سطرًا | تعريف فقط، بلا أي مستورد |
| `apps/frontend/components/ui/placeholder-panel.tsx` | 17 سطرًا | تعريف فقط، بلا أي مستورد |
| `apps/frontend/features/manager-properties/components/approval-property-card.tsx` | 64 سطرًا | بلا أي مستورد |
| `apps/frontend/features/manager-properties/components/property-status-badge.tsx` | صغير | يُستخدم فقط داخل `approval-property-card` الميت |
| `apps/frontend/features/manager-clients/components/contact-card.tsx` | 55 سطرًا | بلا أي مستورد |
| `apps/frontend/features/manager-clients/components/owner-employee-follow-up-tabs.tsx` | 41 سطرًا | بلا أي مستورد؛ `follow-up-timeline` يبقى لأنه مستخدم في `client-details-drawer` |
| `apps/frontend/lib/property-privacy.ts` | 34 سطرًا | لا مستوردين ولا استخدام لـ`canViewPropertyContact`/`contactRoleLabel` |

**Exports ميتة داخل ملفات حيّة (لا تُحذف الملفات):**

- `apps/frontend/lib/contact-registry.ts` → `useContactList` (الصفحات تستخدم `useRegistryContacts`).
- `apps/frontend/features/employee-properties/components/employee-property-card.tsx` → `PropertyStatusBadge` (النسخة الحية في `manager-properties/property-status-badge`).
- `apps/frontend/features/employee-dashboard/components/dashboard-cards.tsx` → `FollowUpCard`, `EmployeePropertyCard`, `ClientMiniCard`؛ يبقى `EmployeeStatCard` فقط.

### 6.2 REQUIRES VERIFICATION

| العنصر | السبب |
|---|---|
| `apps/frontend/app/dev/potential-duplicate-preview/` | fixture محلي مستبعد من Git عبر `.gitignore`، لكنه موجود في build المحلي (25 KB gzip). لا مراجع runtime. يُزال محليًا أو يُستبعد من build الإنتاج بعد تأكيد عدم الحاجة. |
| `apps/frontend/features/manager-marketing/components/marketing-page.tsx` | المسار الآن `ComingSoon` ولا يستورد الصفحة. قرار منتج: هل ستعود الميزة؟ |
| `apps/frontend/features/manager-reports/components/reports-page.tsx` | المسار الآن `ComingSoon` ولا يستورد الصفحة. قرار منتج. |
| `apps/frontend/features/employee-attendance/components/employee-attendance-page.tsx` | مسار الموظف الآن `ComingSoon`؛ بقية `employee-attendance` (nfc/use-attendance) حية. لا تُحذف قبل قرار الحضور. |
| `apps/backend/src/jobs/jobs.module.ts` | يسجّل طابور `system` بلا `@Processor`؛ Redis مطلوب للطابور الفارغ. Health فقط يستخدمه. يُراجع قبل الإنتاج. |
| `apps/backend/src/{owners,deals,commissions,payroll,finance,attendance,smart-paste}` | وحدات نطاق فارغة ومستوردة في `app.module`. ليست ميتة تقنيًا؛ تُبقى كحدود مستقبلية. |
| ازدواج `property-card.tsx` مع `employee-property-card.tsx`، وdrawers الإشعارات | ازدواج مقصود/تاريخي؛ refactor مشترك يحتاج اختبارات بصرية. |
| `new-property-modal-v2.tsx` (62.6 KB) و`properties.service.ts` (96.6 KB) | ملفات ضخمة حيّة؛ تقسيم لاحقًا مع اختبارات، وليس حذفًا. |

### 6.3 KEEP — لا تُحذف

- `apps/frontend/features/manager-attendance/**` — ميزة مؤجلة؛ `attendance.module.css` مستخدم فعليًا في `employee-attendance-page` (الذي هو نفسه مؤجل).
- `apps/frontend/features/manager-finance/**` — صفحة المالية الحيّة (mock) و`mock-sources`.
- `apps/frontend/features/manager-deals/**` — صفحة الصفقات الحيّة و`mock-data`/`use-mock-deals`.
- `apps/frontend/features/manager-properties/preview-data.ts` — أنواع/بيانات مشتركة حية.
- `apps/frontend/features/employee-properties/components/duplicate-submit-guard.ts` — الدوال المصدّرة مستخدمة في اختبار `duplicate-submit-guard.spec.ts`.
- `apps/frontend/scripts/csp-*.mjs` — build/CSP pipeline.
- `apps/backend/prisma/promote-owner.cjs` — أداة ترقية موثقة.
- `apps/backend/src/jobs`, Redis/Throttler Storage، `ioredis`, `bullmq` — مستخدمة في health/rate limiting؛ لا تُزال دون قرار معماري.
- جميع اختبارات `apps/backend/test` (79 ملفًا) — لا يوجد دليل على تكرار كافٍ للحذف.
- `.next/`, `dist/`, `.dev/`, `node_modules/`, `backups/`, `prototype/` — مولّدات/محلية مستبعدة من Git؛ لا تُحذف كجزء من تنظيف المصدر.

### 6.4 التبعيات

- لا توجد تبعية runtime مؤكدة غير مستخدمة:
  - `ioredis` مستخدم في `common/rate-limit/redis-throttler.storage.ts`.
  - `bullmq`/`@nestjs/bullmq` في `jobs` وhealth.
  - `sharp` في معالجة الصور، `web-push` في Push، `joi` في الإعدادات، `class-validator/transformer` في DTOs.
- لم يُشغّل `depcheck` لأنه يتطلب أداة إضافية، وهو خارج نطاق هذه المهمة.

---

## 7. قابلية التوسع

| النمو | الأثر الحالي | التوصية |
|---|---|---|
| عقارات/صور | قائمة 100 عقار ~46–66 ms؛ الصور lazy عبر IntersectionObserver وجلبها private/no-store | فهارس `deletedAt/createdAt` + pagination موجودة؛ راقب تخزين الصور والتنظيف عند الحذف |
| عملاء/جهات اتصال | قائمة العملاء هي الأخطر: 3.4 MB / 2s؛ جهات الاتصال 100 = 22 ms | pagination + بحث خادمي + تقليل nested includes |
| مديرون/موظفون | دليل الموظفين يحمّل كل العقارات/العملاء لكل موظف | groupBy/aggregate + pagination |
| إشعارات/جلسات | 2,000 إشعار = 13 ms؛ poll كل 15s؛ RefreshToken ينمو | فهرس `(userId, createdAt)`، تنظيف دوري للـtokens، ومراقبة poll عند تعدد المستخدمين |
| لوحة التحكم | 24–29 ms عند 300 صفقة/3,000 AuditLog | SQL aggregates + فهارس `Deal.closedAt` و`AuditLog(action, createdAt)` |

لا حاجة لإضافة Redis/queue/بنية جديدة الآن؛ الفهارس + pagination + SQL aggregates كافية حتى تثبت القياسات الحاجة.

---

## 8. أفضل 5 تحسينات موصى بها

1. **إصلاح `/clients` (P1):** pagination من الخادم + بحث خادمي + تقليل nested includes + فهرس `FollowUp(clientId, createdAt)`.  
   **الجهد: Medium — الأثر: الأكبر فورًا (~2s → مئات ms وحجم أقل بكثير).**

2. **تقليل payload إشراف المتابعات (P2):** pagination/حدود أقل وحقول قائمة خفيفة، وتحميل التفاصيل عند الطلب.  
   **الجهد: Medium — الأثر: 170 ms/420 KB حاليًا، ويتضاعف مع النمو.**

3. **تحويل دليل الموظفين إلى aggregates + pagination (P3):** إزالة تحميل كل العقارات/العملاء لكل موظف.  
   **الجهد: Medium — الأثر: يمنع تدهورًا خطيًا مبكرًا.**

4. **Migration فهارس additive + تحسين البحث (P4):**  
   `PropertyApprovalRequest(propertyId, createdAt)`، `Property(deletedAt, createdAt)`، `Client(createdAt)`، `Notification(userId, createdAt)`، `Deal(closedAt)`، `AuditLog(action, createdAt)`، ثم قياس EXPLAIN قبل/بعد.  
   **الجهد: Medium — يحتاج موافقة migration.**

5. **تقليل طلبات التنقّل/الاستطلاع (P5):** cache قصير لـ`/auth/me` بدل كل `pathname`، ومراجعة فترة poll الإشعارات.  
   **الجهد: Small/Medium — الأثر: أسرع تنقّلًا وأقل حملًا على DB.**

---

## 9. ما لا يجب حذفه

- `apps/frontend/features/manager-attendance/**` ومكوّنات الحضور/الـNFC المؤجلة.
- `apps/frontend/features/manager-finance/**` و`manager-deals/mock-data.ts` و`mock-sources.ts` (صفحات حية).
- `apps/frontend/features/manager-properties/preview-data.ts`.
- `apps/frontend/features/employee-properties/components/duplicate-submit-guard.ts` (الاختبارات تعتمد على دواله).
- `apps/frontend/scripts/csp-*.mjs` و`apps/backend/prisma/promote-owner.cjs`.
- `apps/backend/src/jobs`, `ioredis`, `bullmq`, Redis throttler storage.
- جميع اختبارات `apps/backend/test` (79 ملفًا) وملفات الأمان.
- وحدات النطاق الفارغة (`owners`, `deals`, `commissions`, `payroll`, `finance`, `attendance`, `smart-paste`).
- `.next/`, `dist/`, `.dev/`, `node_modules/`, `backups/`, `prototype/`.

---

## 10. حدود القياس

- البيانات اصطناعية على `arkan_crm_api_test`، وليست بيانات إنتاج.
- القياس in-process بلا شبكة/متصفح؛ الأرقام نسبية وليست SLA.
- لا قياس authenticated production build أو Lighthouse بسبب عدم توفر جلسة دخول.
- لا قياس لتحميل الصور فعليًا (لم تُزرع ملفات صور)؛ تم فحص lazy loading و`Cache-Control: private, no-store` من الكود.
- لا اختبار حمل/ضغط متعمد.
- لم يُعَد بناء الواجهة؛ استُخدم build الحالي لقياس الحزم.
- `EXPLAIN` أُجري على بيانات اصطناعية؛ بعض الخطط قد تتغير مع الإحصاءات الحقيقية.

---

## 11. الحالة النهائية

- تم تحديد اختناق رئيسي مؤكد: **`/clients`**.
- تم تحديد اختناقات ثانوية: إشراف المتابعات، دليل الموظفين، بحث العقارات/الموافقات.
- تم التحقق من مرشحات حذف آمنة محدودة، مع قائمة صريحة لما يجب إبقاؤه.
- **لم يُعدّل أي كود إنتاجي أو schema أو بيانات `arkan_crm`.**
- لا commits أو pushes.

**متوقف للمراجعة اليدوية قبل تنفيذ أي تحسين أو حذف.**
