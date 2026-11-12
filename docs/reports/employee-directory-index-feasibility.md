# دراسة جدوى فهارس PostgreSQL لدليل الموظفين

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تجميع عملاء دليل الموظفين والفرز العالمي — **تحليل فقط**.  
**الحالة:** مكتمل — **القرار B: UNLIKELY** (لا يوجد فهرس يستحق تجربة معزولة الآن).

> لم تُنشأ أو تُحذف أي فهارس. لم تُعدَّل أي قاعدة بيانات أو مخطط أو كود. كل القياسات قراءة فقط على `arkan_crm_load_test`.

**الخلاصة:** تكلفة الاستعلام ليست في قراءة `Client` (5.5ms من 40ms)، بل في **تجميع 27,070 صفًا إلى 13,535 زوجًا، وربطها بـ5,000 موظف، ثم الفرز العالمي** (~35ms). الفهارس الحالية كافية، وإجبار المخطط على استخدامها (`enable_seqscan=off`) **أبطأ** (42.4ms مقابل 40.4ms مع buffers أكثر). أفضل فهرس مرشح (covering) قد يوفر 2–4ms فقط أي <10% وضمن الضوضاء، مع كلفة كتابة إضافية.

---

## 1. جرد الفهارس الحالية

### الجداول ذات الصلة

| الجدول | الصفوف | الحجم الكلي | الفهارس |
|---|---:|---:|---|
| Client | 15,000 | 4.2 MB | `pkey(id)`، `createdById`، `responsibleEmployeeId`، `createdByUserId`، `createdAt`، `phone` |
| EmployeeProfile | 5,000 | 1.0 MB | `pkey(id)`، `userId` UNIQUE، `managerUserId` |
| User | 5,021 | 2.3 MB | `pkey(id)`، `email` UNIQUE |
| PropertyAssignment | 3,000 | 0.9 MB | `employeeId`، UNIQUE `(propertyId, employeeId, purpose)` |
| FollowUpSubject | 22,602 (حي) | 11 MB | `pkey`، `(responsibleId, active, nextDueAt)`، `(responsibleUserId, active, nextDueAt)`، `(responsibleUserId, nextDueAt)`، `(active, kind)`، `targetKey` UNIQUE |
| Property / Deal | 15,000 / 5,000 | 7.2 / 2.2 MB | فهارس الأعمدة المستخدمة في الفرز الآخر |

### ملاحظات التكرار والاستخدام

- `Client.createdById` و`Client.responsibleEmployeeId`: فهرسان منفصلان، وكلاهما **مستخدم بكثافة** (~4.8M idx_scan لكل منهما) من قوائم العملاء والصلاحيات — ليسا زائدين.
- `Client.createdByUserId` عمود مختلف (منشئ الحساب) ومستخدم 1,224 مرة — ليس بديلًا عن `createdById`.
- `EmployeeProfile.userId` UNIQUE و`managerUserId` فهران مختلفان.
- `PropertyAssignment.employeeId` ضروري لأن فريد `(propertyId, employeeId, purpose)` يبدأ بـpropertyId.
- **تكرار محتمل خارج نطاق هذه المهمة:** `FollowUpSubject(responsibleUserId, nextDueAt)` هو بادئة من `(responsibleUserId, active, nextDueAt)`; قد يكون زائدًا لبعض الاستعلامات لكنه مستخدم 23,270 مرة، ولا يُقترح حذفه هنا.
- **لا يوجد فهرس على `User(role, isActive)`** — لكن الجدول 5,000 صف فقط ومسحه 1.7ms.

---

## 2. خطط الاستعلامات والتكاليف الفعلية

`EXPLAIN (ANALYZE, BUFFERS)` على Stage C (كل الصفحات في shared buffers، لا spill، Batches=1):

### صفحة OWNER (clientsCount) — 40.4 ms، 789 buffers

| العملية | الزمن | Buffers |
|---|---:|---:|
| `scoped` (Seq Scan User 5,000 + EmployeeProfile 5,000 + Hash Join) | 4.5 ms | 256 |
| Seq Scan ×2 على Client (13,535 صفًا لكل عمود) | 3.1 + 2.4 ms | 265 + 265 |
| Append 27,070 صفًا + HashAggregate على `(createdById, id)` → 13,535 | 15.4 → 17.5 ms | 1,809 kB |
| Sort pairs حسب profile_id | 21.7 → 22.5 ms | 702 kB |
| Merge Join مع scoped (13,535) + GroupAggregate (4,501 مجموعة) | 27.6 → 33.3 ms | 723 |
| Hash Left Join + top-N Sort + Limit | 36.4 → 40.4 ms | — |

### MANAGER (clientsCount) — 29.4 ms

نفس الشكل مع 2,750 موظفًا و7,460 زوجًا؛ الحجم الأصغر يفسّر الفرق.

### ملخص OWNER — 55.5 ms، 1,407 buffers

- تجميع العملاء: ~31–35 ms.
- **المتأخرات**: Seq Scan على `FollowUpSubject` (8,432 من 23,750 صفًا) + Sort + Merge Join + GroupAggregate ≈ **17 ms / 621 buffer**. الفهرس `(responsibleId, active, nextDueAt)` لا يناسب هذا الفلتر لأن `responsibleId` غير مقيّد.
- الملخص MANAGER: 39.9 ms.

### أهم الملاحظات

1. **التقديرات مقابل الفعلي:** مجموعة `client_counts` المقدّرة 200 صفًا مقابل 4,501 فعليًا (وكذلك late_counts 200 مقابل 4,526). تقدير منخفض، لكنه لا يسبب خطة سيئة هنا (Hash/Merge، ذاكرة كافية، لا spill).
2. **لماذا Seq Scan؟** جدول Client 4.2MB/265 صفحة، وقراءته كاملة أرخص من فهرسين + heap fetches. عند إجبار `enable_seqscan=off` صار الزمن **42.4ms** وbuffers **10,591** (بدل 789) — أي أن الفهارس الحالية **لا تفيد** هذا التجميع.
3. **محاولة index-only scan** على `createdById` أعطت **Bitmap Heap Scan** (2.7ms، 265 heap + 45 index) لأن `id` غير موجود في الفهرس؛ لا توجد فهارس تغطية.
4. **الفرز العالمي** على `metric DESC, id` حيث `metric` مُحسب — لا يمكن لأي فهرس توفيره دون عدّاد مُسبق (ممنوع في هذه المهمة).

---

## 3. الفهارس المرشحة (DDL للمراجعة فقط — غير منفّذ)

### المرشح 1: فهارس تغطية جزئية على Client

```sql
-- للمراجعة فقط. لا يُنفَّذ.
CREATE INDEX CONCURRENTLY "Client_createdById_id_cover_idx"
  ON "Client" ("createdById") INCLUDE (id) WHERE "createdById" IS NOT NULL;

CREATE INDEX CONCURRENTLY "Client_responsibleEmployeeId_id_cover_idx"
  ON "Client" ("responsibleEmployeeId") INCLUDE (id)
  WHERE "responsibleEmployeeId" IS NOT NULL;
```

- **ماذا يحسّن:** قد يحوّل المسحين إلى Index Only Scan بدل Seq/Bitmap Heap.
- **الحد الأعلى النظري:** المسحان 5.5ms من 40ms؛ أفضل توفير ~3–4ms (**7–10%**) في الصفحة، ولا يمس 35ms الخاصة بالتجميع والربط والفرز.
- **احتمال استخدامه:** غير مضمون؛ المخطط رفض حتى الفهارس الحالية لصالح Seq Scan، والمقاس عند الإجبار أبطأ.
- **التكلفة:** ~0.6–0.8MB لكل فهرس. لا يمكن استبدال الفهارس الحالية بها لأن استعلامات أخرى تفلتر العمودين بدون `IS NOT NULL`؛ إضافتها تعني فهرسين إضافيين وصيانة كتابة على Client.
- **كتابة/تحديث:** كل INSERT/UPDATE على Client يحدّث فهرسين إضافيين (أو أكثر عند الاستبدال).
- **التكرار:** تكرر الأعمدة الأمامية مع الفهارس الحالية (لكن مع INCLUDE).

### المرشح 2 (ثانوي): فهرس جزئي للمتأخرات

```sql
-- للمراجعة فقط. لا يُنفَّذ.
CREATE INDEX CONCURRENTLY "FollowUpSubject_active_nextDueAt_cover_idx"
  ON "FollowUpSubject" ("nextDueAt") INCLUDE ("responsibleId") WHERE active;
```

- **ماذا يحسّن:** مسح المتأخرات (8,432 صفًا، 621 buffer، ~7ms) داخل الملخص.
- **الفائدة المتوقعة:** 3–5ms من 55ms (**5–9%**) للملخص فقط، وتبقى الحاجة إلى فرز حسب responsibleId.
- **التكلفة:** فهرس جزئي على جدول كتابة كثيف (المزامنة تحدّث `active`/`nextDueAt`)، وفهرس `(active, kind)` قائم لا يغطي هذا النمط.
- **الاحتمال:** متوسط؛ 35% من الجدول فقط، لكن قد يفضّل المخطط Seq Scan مجددًا.

### مرشحات مرفوضة

| المرشح | سبب الرفض |
|---|---|
| `Client (createdById, responsibleEmployeeId)` | لا يخدم UNION ولا إزالة التكرار؛ لا يوفّر `id`. |
| `User (role, isActive)` | 5,000 صف، 1.7ms، و21 صفًا فقط مستبعد؛ لا فائدة. |
| `EmployeeProfile (managerUserId) INCLUDE (userId,id)` | المسح 0.57ms؛ لا فائدة. |
| أي فهرس للفرز على `metric` | العمود مُحسب؛ يتطلب precomputed counter (ممنوع). |
| فهرس كامل بدل الجزئي على Client | نفس مشكلة التغطية دون مكسب إضافي. |

---

## 4. هل يمكن للفهرس تحسين العمل الحالي؟

**لا بشكل جوهري.** التوزيع المقاس:

- المسحان: ~14% من زمن الصفحة.
- التجميع/إزالة التكرار/الربط/الفرز: ~85%.
- الملخص: تجميع العملاء ~60%، المتأخرات ~30%، الباقي joins صغيرة.

حتى لو أصبح مسح Client مجانيًا، تبقى الصفحة ~35ms. والفهرس لا يغيّر عدد المجموعات (4,501) ولا تكلفة الفرز العالمي.

---

## 5. القرار والتوصية

**B. UNLIKELY** — الفهارس الحالية كافية، والتكلفة المتبقية ناتجة عن **التجميع على كامل النطاق** وليس عن نقص فهرس.

- **NO-GO لتجربة معزولة الآن:** لا يوجد دليل كافٍ على مكسب يتجاوز الضوضاء (>10%)، والمكسب النظري <10% مع كلفة كتابة مؤكدة.
- إذا أُريد لاحقًا اختبار المرشح 1 رغم ذلك، فيجب:
  1. موافقة منفصلة.
  2. نسخة قاعدة **قابلة للتلف** (disposable copy) وليس `arkan_crm_load_test`.
  3. إنشاء الفهارس على النسخة فقط، ثم `EXPLAIN (ANALYZE, BUFFERS)` + قياس A/B متناوب لخدمة الدليل و50 طلبًا.
  4. عدم لمس `arkan_crm` أو `arkan_crm_load_test`.
- البديل الحقيقي للتحسين يبقى خارج نطاق الفهارس: عدّادات مُحدَّثة (materialized counters) أو تغيير متطلبات الفرز — وكلاهما يحتاج قرارًا معماريًا منفصلًا.

---

## 6. الحالة

- لا تعديلات على أي قاعدة بيانات أو مخطط أو كود أو `.env`.
- 4001 يعمل و`/health = 200`؛ 4101 لم يُستخدم.
- `arkan_crm_load_test` (51 MB) و`arkan_crm` (12 MB / 23 migrations) دون تغيير.
- لا commits أو pushes؛ حُذفت أدوات القياس المؤقتة.

**متوقف للمراجعة اليدوية.**
