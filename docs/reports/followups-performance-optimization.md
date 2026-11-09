# تحسين أداء المتابعات وإلغاء سقف 1000 سجل

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** قوائم المتابعات الشخصية وإشراف المدير فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو تغييرات schema.  
> لا تعديل على `arkan_crm` أو `.env`.  
> لا commits أو pushes.

---

## 1. ما تم تغييره

### الخادم

- **DTO جديد:** `apps/backend/src/followups/dto/list-follow-ups.query.ts`
  - `search`, `tab`, `status`, `cursor`, `limit`.
  - `limit` افتراضي في الخدمة: **50**، وأقصى صفحة: **100**.
  - `employeeUserId` للإشراف فقط.
- **`GET /follow-ups`**
  - cursor-based pagination بترتيب ثابت `nextDueAt ASC, id ASC`.
  - البحث والفلاتر (`tab`, `status`) تُطبق داخل استعلام Prisma على كامل النطاق المصرح به قبل الصفحة.
  - `sync(viewer)` يُنفّذ مرة واحدة عند أول صفحة فقط؛ صفحات cursor لا تعيد المسح الكامل.
  - الاستجابة أصبحت: `items`, `nextCursor`, `truncated`, `generatedAt`, و`summary` (أول صفحة فقط).
- **`GET /follow-ups/manager/overview`**
  - نفس pagination/البحث/الفلاتر، مع فلتر الموظف المسؤول `employeeUserId`.
  - `employees` (خيارات فلتر الموظف) تُعاد من كامل نطاق الإشراف في أول صفحة.
  - `summary` يُحسب بعد فلتر الموظف وقبل pagination.
- **الملخصات (`summary`)**
  - `total`, `overdue`, `today`, `upcoming`, `never`.
  - عدّادات التبويبات الثمانية: `all, owners, buyers, sellers, renters, lessors, inquiries, exchanges`.
  - لا تعتمد على الصفحة المحملة.
- **تاريخ المتابعة**
  - أُزيل حد `HISTORY_LIMIT = 100`؛ `GET /follow-ups/:id/history` يعيد التاريخ الكامل للموضوع عند فتح الدرج.
- **النطاقات محفوظة**
  - EMPLOYEE: موضوعاته المسؤول عنها فقط.
  - MANAGER: مواضيعه الشخصية في `/follow-ups`، وفريقه فقط في `/manager/overview`.
  - OWNER: كل مواضيع الموظفين في الإشراف.

### الواجهة

- `apps/frontend/lib/api/followup-types.ts` و`followups-api.ts`
  - دعم cursor/filters/search و`nextCursor/summary/employees`.
- `apps/frontend/lib/use-debounced-value.ts`
  - debounce 300ms للبحث.
- `apps/frontend/features/employee-followups/components/followups-board.tsx`
  - أول صفحة + Load More، بحث وفلاتر من الخادم.
  - عدّادات البطاقات والتبويبات من `summary` الكامل لا من الصفحة.
  - حماية من النتائج القديمة/التكرار، وإعادة ضبط الصفحة عند تغيير الفلتر.
  - Deep link لموضوع خارج الصفحة الأولى يُجلب عبر history المصرح به.
- `apps/frontend/features/manager-followups/components/supervision-section.tsx`
  - نفس النهج للإشراف، مع فلتر الموظف وخياراته من الخادم.
  - Stats/تبويبات من `summary` بعد فلتر الموظف.
  - Load More وحالات loading/empty/error.
- التصميم العربي RTL والدرج والتفاعلات الحالية محفوظة.

---

## 2. الاختبارات

### اختبار جديد

`apps/backend/test/followups-pagination.spec.ts` — **4/4 ناجح**:

- **1,005 موضوع** للموظف A تُجلب عبر 21 صفحة دون تخطٍّ أو تكرار.
- البحث يجد عميلاً خارج أول 50 صفحة.
- فلتر `status=OVERDUE` يعيد 3 مواضيع فقط، وعدّاد التبويب `buyers` = 1,005.
- OWNER يرى 1,015 موضوعاً، MANAGER A يرى 1,005، MANAGER B يرى 10، والموظف لا يصل إلى `/manager/overview` (403).
- بحث MANAGER A عن عميل فريق B يعيد صفرًا.
- تاريخ 150 إدخالاً لموضوع واحد يُعاد كاملاً.
- الموظف A لا يرى موضوعات فريق B.

### اختبارات الانحدار

```powershell
npm run test -w @arkan/backend -- `
  test/followups.spec.ts `
  test/followups-manager.spec.ts `
  test/followups-manager-notifications.spec.ts `
  test/followup-schedule.spec.ts `
  test/frontend-followups-model.spec.ts
```

**النتيجة: 81/81 اختباراً ناجحاً** (بما فيها الحزمة الجديدة).

- `typecheck` للـbackend والـfrontend: ناجح.
- ESLint على الملفات المعدلة: ناجح.

---

## 3. القياسات الفعلية (600 موضوع)

بيانات اصطناعية على `arkan_crm_api_test`، 600 عميل لديهم طلب `BUYER` وتمت مزامنتهم إلى 600 موضوع.

| القياس | قبل (الخط الأساس) | بعد |
|---|---:|---:|
| `GET /follow-ups/manager/overview` | **170 ms / 420 KB** (600 موضوع، بلا pagination) | **40.0 ms / 30 KB** (أول صفحة 50) |
| `GET /follow-ups` أول صفحة | لم يُقس في التقرير السابق | **77.7 ms / 29 KB** (أول صفحة 50، شاملة المزامنة) |
| كل 600 موضوع عبر 12 صفحة | غير ممكن بعد السقف | **276.8 ms إجمالاً** |

**تحسن الإشراف:** ~4.25× أسرع، وحجم الاستجابة ~14× أصغر.  
**الوصول الكامل:** 600 موضوع عبر 12 صفحة، 1,005 موضوع عبر 21 صفحة في الاختبار الجديد.

> الأرقام in-process على قاعدة الاختبار، بلا شبكة/متصفح؛ للمقارنة النسبية.

---

## 4. تأكيد الوصول الكامل

- لا يوجد `LIST_LIMIT` أو سقف إجمالي.
- `limit` يحد صفحة واحدة فقط.
- يتم التوقف فقط عند `nextCursor = null`.
- اختبار 1,005 موضوع أثبت 1,005 معرّفًا فريدًا بلا نقص أو تكرار.
- البحث والفلاتر تعمل قبل pagination على كامل النطاق.

---

## 5. تحقق الواجهة

لم تتوفر جلسة متصفح موثقة لحساب MANAGER/EMPLOYEE في هذه الجلسة، ولم تُعدّل حسابات أو بيانات حقيقية. لذلك:

- لم يُجرَ smoke بصري فعلي للصفحات (Search/Filters/Load More/Drawer/RTL/mobile).
- تم التحقق عبر typecheck، ESLint، واختبارات API المركزة.
- التحقق البصري يبقى مطلوبًا يدويًا في جلسة آمنة.

---

## 6. القيود المتبقية

1. `summary` يُحسب بعدة استعلامات `count` على أول صفحة فقط؛ دقيق لكنه مرشح لدمجه في استعلام تجميعي واحد لاحقًا.
2. البحث ما زال `ILIKE` على حقول العلاقات؛ لا trigram index (لا migrations في هذه المهمة).
3. Deep link لموضوع خارج الصفحة الأولى يجلب تاريخ ذلك الموضوع مرة إضافية قبل فتح الدرج.
4. `latest` بقي ضمن عناصر القائمة للتوافق مع العقد الحالي؛ الحجم الحالي ~30 KB لأول صفحة.
5. لم تُعدّل مقاييس لوحة التحكم أو أي مجال آخر.

---

## 7. السلامة

- لا تغييرات على بيانات `arkan_crm`.
- لا migrations أو schema.
- لا `.env`.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
