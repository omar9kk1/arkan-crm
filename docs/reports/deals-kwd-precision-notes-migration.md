# دقة KWD (3 منازل) وملاحظات الصفقة — ترحيل وتحقّق

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تحويل حقول الصفقات/العمولات المالية إلى `DECIMAL(15,3)` (فلس كويتي)، وإضافة `Deal.notes`.  
**الحالة:** مكتمل — الترحيل طُبّق على **`arkan_crm_api_test` فقط**. **`arkan_crm` و`arkan_crm_load_test` لم يُمسّا.**

> **تنبيه تشغيلي:** الكود الجديد يتوقع الأعمدة الجديدة. لا تستخدم صفحة الصفقات على `arkan_crm` قبل تطبيق الترحيل عليها بموافقة منفصلة (الترتيب: migration ثم نشر/استخدام الكود). التفاصيل في §8.

---

## 1. الأعمدة المتأثرة

| الجدول | العمود | قبل | بعد |
|---|---|---|---|
| `Deal` | `price` | `DECIMAL(14,2)` | **`DECIMAL(15,3)`** |
| `Deal` | `companyCommission` | `DECIMAL(14,2)` | **`DECIMAL(15,3)`** |
| `Commission` | `amount` | `DECIMAL(14,2)` | **`DECIMAL(15,3)`** |
| `Deal` | `notes` | — | **`TEXT NULL`** |

لم تُلمس `Property.askingPrice` ولا أي حقل Finance/Payroll/Attendance (خارج النطاق).

---

## 2. الترحيل

**المجلد:** `apps/backend/prisma/migrations/20261110120000_deal_kwd_precision_and_notes/`  
**SQL:**

```sql
ALTER TABLE "Deal" ALTER COLUMN "price" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "Deal" ALTER COLUMN "companyCommission" SET DATA TYPE DECIMAL(15, 3);
ALTER TABLE "Deal" ADD COLUMN "notes" TEXT;
ALTER TABLE "Commission" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(15, 3);

-- نقل الملاحظات المؤقتة من AuditLog إلى العمود الجديد (مع إبقاء سجل التدقيق).
UPDATE "Deal" AS d
SET "notes" = src.notes
FROM (
  SELECT DISTINCT ON (a."entityId")
         a."entityId" AS deal_id,
         btrim(a."after"->>'notes') AS notes
  FROM "AuditLog" AS a
  WHERE a."entityType" = 'Deal'
    AND a."action" = 'DEAL_CREATE'
    AND a."after"->>'notes' IS NOT NULL
    AND btrim(a."after"->>'notes') <> ''
  ORDER BY a."entityId", a."createdAt" ASC
) AS src
WHERE d."id" = src.deal_id
  AND d."notes" IS NULL;
```

- `ALTER TYPE` توسيع رقمي **دقيق**: لا يُعاد إنشاء الجداول، ولا تُحذف صفوف/علاقات/فهارس.
- `rollback.sql` مرفق في نفس المجلد (طوارئ فقط) مع تحذير أن العودة إلى 14,2 **تقرّب** أي قيمة بثلاث منازل؛ يجب تصدير/تدقيق قيم الفلوس أولًا. يُفضّل الإصلاح الأمامي على التراجع.

---

## 3. تغييرات الكود

### Backend

- `deals.service.ts`
  - التحقق المالي يقبل حتى **3 منازل**؛ يرفض أكثر برسالة عربية واضحة.
  - التسلسل يُرجع `toFixed(3)` لجميع المبالغ.
  - `notes` تُكتب في `Deal.notes` عند الإنشاء، وتُقرأ من `Deal.notes` في القائمة/التفاصيل.
  - أُزيل مسار قراءة الملاحظات من `AuditLog`؛ سجل `DEAL_CREATE` ما زال يُكتب كسجل تدقيق كامل.
  - بقيت المعاملة وانتحال حالة العقار (`AVAILABLE→SOLD/RENTED` + version) والصلاحيات كما هي.
- `dashboard.service.ts`
  - استُبدلت مساعدات «cents» بمساعدات **fils** (`decimalToFils`/`filsToDecimalString`، ×1000 و`%1000`)، مع دعم قراءة قيم قديمة `14,2` (مثل "1.50" = 1.500). المجاميع/العمولات تبقى دقيقة (BigInt).
- `dto/create-deal.dto.ts` و`schema.prisma` (تعليقات/أنواع).

### Frontend

- `deal-model.ts`: `toCents/centsMoney` → **`toFils/filsMoney`** و`priceFils/...` (×1000).
- `deals-page.tsx`: إحصاءات القيمة/العمولات تُجمع بالفلس بدل السنت.
- بقيت الواجهة كما هي (تخطيط/نصوص/بطاقات/معالج/RTL)؛ `money()` يدعم 3 منازل أصلًا.

---

## 4. نتائج ترحيل قاعدة الاختبار

- `prisma migrate deploy` أظهر صراحة: **`database "arkan_crm_api_test"`**، وطبّق migration واحدًا بنجاح.
- `_prisma_migrations`: **23 → 24**.
- الأعمدة: `Deal.price/companyCommission` = **15,3**، `Commission.amount` = **15,3**، `Deal.notes` موجود (TEXT).
- **قيم ما قبل الترحيل محفوظة بدقة:** كانت 5 صفقات بقيمة `300000.50`؛ بعد الترحيل أصبحت **`300000.500`**، والعمولة `3000.250`، وعمولات الموظفين `1000.100` و`2000.150` — نفس القيم مع صفر ثالث.
- إثبات تحويل النوع على جدول مؤقت داخل جلسة: `300000.50 → 300000.500`، `0.10 → 0.100`، `123456789.99 → 123456789.990`، ثم `ROLLBACK` (لا أثر دائم).

---

## 5. الاختبارات (قاعدة الاختبار المرحّلة فقط)

```
4 suites / 18 tests passed
deals.spec (9) + frontend-deal-model.spec (3)
+ manager-dashboard.spec + manager-dashboard-periods.spec (6)
```

تشمل:
- `1.234` د.ك تُحفظ وتُقرأ وتظهر في التفاصيل كما هي.
- عمولات `0.001` / `0.010` دقيقة في `Commission.amount`.
- الحد الأقصى `999999999999.999` (12 رقمًا صحيحًا + 3 منازل) يُحفظ ويُعاد كما هو.
- `1.2345` (4 منازل) → **400** برسالة «ثلاث منازل…».
- `notes` تُحفظ في `Deal.notes`، وتظهر بعد إعادة القراءة، وسجل `DEAL_CREATE` ما زال موجودًا.
- عمولات الشركة/الموظفين صحيحة، وحالة العقار `SOLD/RENTED` و`version` تتصرف كما قبل.
- لوحة المدير: `countInPeriod` و`totalValueInPeriod` يطابقان مجموع قاعدة البيانات الفعلي (بما فيه قيم 3 منازل).
- عزل OWNER/MANAGER، OWNER-direct، 404 للفرق الأخرى، ومنع البيع المتزامن (اختبارات سابقة أُعيد تشغيلها ضمن الحزمة).
- typecheck للباكند والفرونت **0**، وESLint المستهدف **0**.

---

## 6. النسخ الاحتياطي والاستعادة

- نسخة **قبل الترحيل** لقاعدة الاختبار:
  - `backups/arkan_api_test_pre_kwd_20261110.dump` (130,484 بايت، pg_dump custom format)
  - SHA-256: `5D5A1FB6007A734FFF6F746F4E63FEBBDC0B2DB9A13FF7C849E8862464DD9B92`
  - تم التحقق من الأرشيف بـ`pg_restore --list` (298 TOC entry).
- استعادة (طوارئ، قاعدة الاختبار فقط):
  1. إيقاف أي backend يستخدم قاعدة الاختبار.
  2. `dropdb/createdb arkan_crm_api_test` (بعد التأكد من الاسم).
  3. `pg_restore -d arkan_crm_api_test --no-owner --no-privileges`.
- لقاعدة الإنتاج لاحقًا: نفس الإجراء مع `pg_dump -Fc` قبل الترحيل + التحقق + نسخة صور التخزين (راجع `RESTORE.txt` في `D:\ArkanBackups`).

## 7. التحقق من عدم مسّ القواعد الأخرى

| القاعدة | `_prisma_migrations` | `Deal.price/companyCommission` | `Deal.notes` |
|---|---:|---|---|
| `arkan_crm_api_test` | **24** | **15,3** | **موجود** |
| `arkan_crm` (حقيقية) | **23** | **14,2** | **غير موجود** |
| `arkan_crm_load_test` | 23 (دون تغيير) | **14,2** | **غير موجود** |

**تأكيد صريح: لم يُطبَّق أي ترحيل على `arkan_crm` ولا على `arkan_crm_load_test`، ولم تُعدَّل أي بيانات أعمال فيهما.**

## 8. المخاطر والخطوات المتبقية

1. **ترتيب النشر إلزامي:** طبّق الترحيل على `arkan_crm` (بموافقة منفصلة) **قبل** تشغيل الكود الجديد عليها. حتى ذلك الحين:
   - `GET /deals` على `arkan_crm` سيفشل لأن الاستعلام يطلب `Deal.notes` غير الموجود.
   - إدخال 3 منازل على عمود 14,2 قد يُقرَّب بصمت.
   - بيئة التطوير 4001 تعمل بالكود الجديد؛ لا تستخدم صفحة الصفقات عليها قبل الترحيل.
2. **`arkan_crm_load_test`** بقيت 14,2 عن قصد؛ قراءة الداشبورد تعمل (المساعد يدعم 14,2 و15,3)، لكن لا تُكتب صفقات هناك.
3. **المتوسط في الداشبورد** يُشتق من الإجمالي الدقيق (3 منازل) مقسومًا على العدد؛ العرض النهائي يقتصر على 3 منازل. الإجماليات/العمولات نفسها دقيقة تمامًا (BigInt).
4. **الملاحظات القديمة**: تُنقل من `AuditLog` في الترحيل؛ سجل التدقيق يبقى كما هو.
5. **بيئة التوليد**: توقف 4001 لثوانٍ ضروري أثناء `prisma generate` بسبب قفل ملف محرك Prisma على Windows؛ أُعيد تشغيله فورًا و`/health=200`. لم تُلمس البيانات.

## 9. الحالة

- لا commits أو pushes.
- لا migrations على قواعد حقيقية؛ لا reset/seed/truncate.
- 3001 و4001 يعملان (200) بعد إعادة تشغيل 4001 المُدارة.
- الترحيل جاهز للمراجعة اليدوية قبل تطبيقه على `arkan_crm`.

**متوقف للمراجعة اليدوية قبل تطبيق الترحيل على أي قاعدة حقيقية.**
