# تحسين أداء مزامنة المتابعات

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** `GET /follow-ups` وأول صفحة فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو `.env` أو تغييرات UI أو بيانات حقيقية.  
> لا commits أو pushes.

---

## 1. السبب الجذري

`FollowUpsService.list()` كان ينفّذ:

```ts
if (!query.cursor) await this.sync(viewer);
```

و`sync(viewer)` للمدير كان يستخدم نطاقًا كاملًا للشركة:

```ts
propertyScope = null; // manager
clientScope = null;   // manager
```

لذلك كل طلب أول صفحة كان:

1. يقرأ كل العقارات (15,000) وكل العملاء (15,000) وعلاقاتها.
2. يبني خريطة `expected` لكل المواضيع.
3. يقرأ كل `FollowUpSubject` (23,750 في Stage C).
4. يقارن ويكتب عند الحاجة.

النتيجة المقاسة سابقًا في Stage C: **P50 995 ms / P95 1,117 ms**.

---

## 2. التغيير

**الملف:** `apps/backend/src/followups/followups.service.ts`

أُضيف تحسين incremental خفيف دون تغيير منطق المزامنة نفسه:

- **Fingerprint رخيص** يعتمد على البيانات الموجودة:
  - `Property`: count + max `updatedAt`.
  - `PropertyAssignment`: count + max `createdAt`.
  - `Client`: count + max `updatedAt`.
  - `ClientPropertyInterest`: count + max `updatedAt`.
  - `User`: count + max `updatedAt` (يغطي تغييرات الدور/الحالة).
- إذا لم يتغيّر fingerprint منذ آخر مزامنة ناجحة، تُتخطى المزامنة بالكامل.
- **Single-flight** لكل نطاق:
  - `company` للـOWNER/MANAGER/الـscheduler.
  - `employee:<id>` للموظف.
  - الطلبات المتزامنة تشارك نفس الـPromise بدل تشغيل مزامنات متوازية.
- عند نجاح المزامنة فقط يُحفظ fingerprint الجديد؛ الخطأ لا يثبّت حالة كاذبة.
- `sync(null)` من الـscheduler يستخدم نفس الحماية.
- لم يتغيّر `reconcile` أو `createMany` أو `updateMany` أو قواعد المسؤولية/الإعادة/التعطيل.

---

## 3. القياس الفعلي على Stage C

قاعدة `arkan_crm_load_test` فقط، دون truncate أو إعادة توليد:

| القياس | قبل | بعد |
|---|---:|---:|
| Cold first page (أول طلب بعد تشغيل العملية) | — | **1,457.1 ms** |
| Warm repeated first page P50 | **995 ms** (تقرير الحمل) | **38.1 ms** |
| Warm repeated first page P95 | **1,117 ms** (تقرير الحمل) | **48.0 ms** |
| 10 طلبات متزامنة P50 / P95 | — | **168.9 / 260.7 ms** |
| 10 طلبات متزامنة أخطاء | — | **0%** |
| 50 طلبًا متزامنًا P50 / P95 | — | **492.6 / 584.0 ms** |
| 50 طلبًا متزامنًا أخطاء | — | **0%** |

- حجم الاستجابة: **31 KB**.
- عدد `FollowUpSubject`: **23,750 قبل → 23,750 بعد**.
- `targetKey` مكرر: **0 قبل → 0 بعد**.
- Cold still ينفّذ مزامنة كاملة أول مرة؛ التحسين يستهدف الطلبات المتكررة/المتزامنة.

### سلوك قاعدة البيانات في 8 طلبات warm

بعد إجبار flush الإحصاءات (1.5s انتظار فقط للقياس):

- `xact_commit`: +44
- `tup_returned`: +81,776
- `tup_fetched`: +1,645
- لا يوجد `INSERT` أو `UPDATE` في:
  - `Property`
  - `Client`
  - `FollowUpSubject`
  - `PropertyAssignment`
  - `ClientPropertyInterest`
- `FollowUpSubject`: 0 seq scan، 19 index scans.
- `Property`: 2 seq scan، 72 index scan (fingerprint aggregates).
- `Client`: 3 seq scan، 39 index scan (fingerprint aggregates).

أي أن الطلبات المتكررة تقرأ fingerprint aggregates فقط ولا تعيد كتابة/مسح المزامنة الكاملة.

---

## 4. الاختبارات

### اختبار جديد
`apps/backend/test/followups-sync-optimization.spec.ts` — **3/3 ناجح**:

1. طلبان متتاليان لأول صفحة: `syncProperties`/`syncClients` يُستدعيان مرة واحدة فقط.
2. عميل جديد يُزامَن ويظهر، وتغيّر `nextDueAt` إلى تاريخ متأخر يُحدّث `summary.overdue` **دون** إعادة مزامنة.
3. خمسة طلبات أول صفحة متزامنة تُدمج في مزامنة واحدة، وينتج عنها **صف واحد فقط** للموضوع.

### اختبارات الانحدار
```powershell
npm run test -w @arkan/backend -- `
  test/followups.spec.ts `
  test/followups-manager.spec.ts `
  test/followups-manager-notifications.spec.ts `
  test/followups-pagination.spec.ts `
  test/followup-history-authorization.spec.ts `
  test/followups-sync-optimization.spec.ts
```

**النتيجة: 6 suites / 48 اختبارًا ناجحًا.**

يشمل ذلك:
- أكثر من 1,000 متابعة مع pagination بلا skip/duplicate.
- إعادة التعيين وتحديث الرؤية.
- إشعارات المدير.
- منع سجل المتابعة عبر الفرق بعد إصلاح `history` (404).
- عدم ظهور OWNER-direct للمديرين.

### الفحوصات
- `npm run typecheck -w @arkan/backend`: **0**
- ESLint على الملف والاختبار: **0**

---

## 5. القيود المتبقية

1. **Cold start ما زال مزامنة كاملة**: أول طلب بعد restart/deploy قد يستغرق ~1.5s في Stage C. الخطوة التالية المقترحة: watermark دائم في `Setting` أو outbox/queue للمزامنة الدورية بدل الاعتماد على أول طلب.
2. **Fingerprint لا يكتشف الكتابات المباشرة عبر SQL التي لا تُحدّث `updatedAt`/counts**. كل مسارات التطبيق الحالية تمر عبر Prisma وتحدّث هذه الحقول، لكن التعديلات اليدوية خارج التطبيق تبقى خارج الضمان.
3. **نطاق المدير ما زال company-wide عند تغيّر البيانات**: التكرار المتسلسل أصبح رخيصًا، لكن أول مزامنة بعد تغيير شركة قد تظل كاملة. يمكن تضييق نطاق مزامنة المدير إلى فريقه لاحقًا بعد التأكد من عدم تأثر مزامنة الإشراف.
4. **تغيّر `User.updatedAt` العالمي** قد يسبب مزامنة شركة كاملة عند تعديل أي مستخدم (نادر). يمكن استبعاده أو قصره على منشئي العقارات/العملاء.
5. لم يُعد تشغيل load test الكامل؛ القياس مركز على `GET /follow-ups` فقط.
6. لا browser/UI verification؛ التغيير خلفي فقط.

---

## 6. السلامة

- `arkan_crm` لم تُلمس.
- `arkan_crm_load_test` لم تُعدّل هيكليًا ولم تُreset أو تُtruncate؛ عدد الموضوعات بقي 23,750.
- لا migrations أو `.env` أو تغييرات UI.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
