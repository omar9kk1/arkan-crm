# تفعيل ترحيل المالية على قاعدة `arkan_crm` — تحقق نهائي

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تطبيق الترحيل المعتمد `20261110130000_finance_ledger_precision_payouts` على قاعدة التطوير المحلية `arkan_crm`.  
**الحالة:** **GO** — الترحيل طُبّق بنجاح بعد نسخة احتياطية كاملة ومُتحقَّق من استعادتها.

---

## 1. هوية القاعدة والتحقق المسبق

| البند | القيمة |
|---|---|
| `current_database()` | **`arkan_crm`** |
| المستخدم | `postgres` |
| الخادم | PostgreSQL **16.15** داخل `arkan-crm-postgres-1`، على منفذ **5433** |
| الترحيلات المطبّقة قبل | **24** |
| الترحيل المعلّق | **واحد فقط**: `20261110130000_finance_ledger_precision_payouts` (أكّده `prisma migrate status`) |
| تكرارات `FinanceMovement(sourceType, sourceId)` | **0** |
| استعلامات نشطة وقت الفحص | **0** |
| مساحة D: الحرة | ~626 GB |
| حجم القاعدة | 12 MB |

**ملاحظة تشغيلية:** ظهر نشاط حقيقي حديث (اعتماد عقار وتحديث جلسة) أثناء الفحص. لذلك أُوقف خادم 4001 مؤقتًا، وأُخذت النسخة الاحتياطية والترحيل دون كتابات متزامنة، ثم أُعيد الخادم فورًا.

**حالة المخطط قبل الترحيل:**
- `Commission.amount`: `numeric(15,3)`.
- `FinanceMovement.amount` و`ManualExpense.amount` و`PayrollEntry` المالية: `numeric(14,2)`.
- `Commission.paidById`: غير موجود.
- فهرس `FinanceMovement(sourceType, sourceId)`: **غير فريد**.

**مراجعة SQL:** الترحيل يوسّع 6 أعمدة رقمية توسيعًا دقيقًا، يضيف `paidById` مع FK/index، يستبدل فهرس المصدر بفهرس فريد، ثم يعمل backfill idempotent للصفقات والعمولات. لا `DROP TABLE`، لا حذف صفوف، ولا إعادة كتابة بيانات مالية.

---

## 2. النسخة الاحتياطية والاستعادة

**المجلد:** `D:\ArkanBackups\finance-activation-20261110-223706`

| الملف | الحجم | ملاحظة |
|---|---:|---|
| `arkan_crm.dump` | 306,431 | `pg_dump -Fc` قبل الترحيل |
| `schema-before.sql` | 78,189 | مخطط ما قبل الترحيل |
| `schema-after.sql` | 78,676 | مخطط ما بعد الترحيل (أثر مقارنة) |
| `storage/…` | 3,438,788 (7 ملفات) | نسخة كاملة من التخزين الخاص |
| `manifest-sha256.txt` | 1,213 | 9 ملفات: dump + schema-before + 7 صور |
| `backup-summary.json` | 879 | الأعداد ونتيجة الاستعادة |
| `RESTORE.txt` | 1,129 | خطوات الاستعادة |

- **SHA-256 للـdump:** `41BC174C9F89883634A4C339A57A434B3A730E97D864E20DD52DE2055363D7DE`.
- **`pg_restore --list`:** نجح، `dbname: arkan_crm`، **298 TOC entry**.
- **اختبار استعادة فعلي** إلى قاعدة disposable `arkan_crm_finance_restore_check_20261110_223706`:
  - أُنشئت من الـdump، ثم استُعيدت بنجاح.
  - الأعداد المستعادة **مطابقة تمامًا** للمصدر: `0|0|0|0|0|4|0|4|366|5|24`.
  - حُذفت القاعدة التجريبية بعد التحقق.
- **مطابقة الصور:** 7/7 ملفات، SHA-256 والأحجام مطابقة (`MATCH=True`, missing=0, extra=0, mismatch=0).

---

## 3. الترحيل المطبّق

```text
prisma migrate deploy
Datasource "db": PostgreSQL database "arkan_crm" ...
Applying migration `20261110130000_finance_ledger_precision_payouts`
All migrations have been successfully applied.
```

- طُبّق الترحيل المعتمد فقط؛ لا ترحيلات أخرى.
- لم يُستخدم `migrate reset` أو `db push` أو seed.
- بعد الترحيل: `prisma migrate status` → **Database schema is up to date!** (exit 0).

---

## 4. التحقق بعد الترحيل

### المخطط

| الجدول | العمود | بعد |
|---|---|---|
| `FinanceMovement` | `amount` | `numeric(15,3)` |
| `ManualExpense` | `amount` | `numeric(15,3)` |
| `PayrollEntry` | `baseSalary`, `deductions`, `bonus`, `netAmount` | `numeric(15,3)` |
| `Commission` | `paidById` | `uuid NULL` + FK إلى `User` + index |

- **الفهرس الفريد:** `FinanceMovement_sourceType_sourceId_key` على `("sourceType","sourceId")` موجود، والفهرس غير الفريد القديم أُزيل.
- **القيود:** `Commission_paidById_fkey` موجود، و`FinanceMovement_source_matches_relation` سليم كما هو.
- **مقارنة schema قبل/بعد:** الفروق فقط: الأعمدة الستة إلى `15,3`، `paidById`، الفهرس/الـFK الجديد، واستبدال فهرس المصدر. ظهرت أسطر `\restrict` العشوائية من `pg_dump 16.15` فقط — ليست تغييرات مخطط.

### البيانات

| العنصر | قبل | بعد |
|---|---:|---:|
| Migration | 24 | **25** |
| Deal | 0 | **0** |
| Commission | 0 | **0** |
| FinanceMovement | 0 | **0** |
| ManualExpense | 0 | **0** |
| PayrollEntry | 0 | **0** |
| Property | 4 | **4** |
| Client | 0 | **0** |
| User | 4 | **4** |
| AuditLog | 366 | **366** |
| FileAsset | 5 | **5** |
| مجموع price / companyCommission | 0 / 0 | **0 / 0** |
| مجموع Commission.amount | 0 | **0** |
| مجموع FinanceMovement.amount | 0 | **0** |

- **لا توجد صفقات أو عمولات مؤهلة للـbackfill** (0/0)، لذلك عدد حركات `DEAL` = 0 و`COMMISSION` = 0، وهو مطابق تمامًا للمتوقع.
- **لا تكرارات** في المصادر بعد الترحيل.
- سجل التدقيق محفوظ بالكامل (366).
- لم يُنشأ أو يُحذف أو يُعدّل أي سجل أعمال حقيقي.

---

## 5. فحوص التطبيق والمالية

| الفحص | النتيجة |
|---|---|
| `GET /health` | **200** |
| `GET /health/ready` | **200** |
| `GET /finance` بدون مصادقة | **401** (وليس 503) |
| `GET /finance/options` بدون مصادقة | **401** |
| `financeSchemaReady()` على `arkan_crm` | **true** |
| قراءة `FinanceService.list` مباشرة (OWNER حقيقي، بدون HTTP/جلسة) | **نجحت**: `items=0`, `summaries=0`, `parties=0` |
| `GET /login` الواجهة 3001 | **200** |
| backend logs | بدء نظيف، مسارات `FinanceController` مسجّلة، بلا أخطاء Prisma |
| اختبارات الكتابة على `arkan_crm_api_test` | **5/5 Finance tests passed** |

**بخصوص جلسة OWNER:** لم تكن هناك جلسة OWNER آمنة متاحة للاستخدام (لا cookies/credentials)، ولم يُجرَ تسجيل دخول على القاعدة الحقيقية لتجنّب إنشاء سجل جلسة/تدقيق. بدلًا من ذلك:
- المسار غير المصادق يرجع **401** بدل 503.
- `financeSchemaReady` = **true** على القاعدة الحقيقية.
- استُدعيت `FinanceService.list` مباشرة بقراءة فقط باستخدام هوية OWNER موجودة، وأعادت سجلًا فارغًا بنجاح (`items=0`) دون أي كتابة أو إنشاء جلسة.

اختبار الوصول الكامل بدور OWNER عبر HTTP مغطّى على قاعدة الاختبار (200/403 semantics).

---

## 6. الاستعادة والطوارئ

- **لا rollback تلقائي.** `rollback.sql` قد يقرّب أي مبالغ بثلاث منازل؛ لا يُنفّذ دون موافقة/تدقيق.
- **استعادة طوارئ فقط** (تحتاج موافقة يدوية):
  1. `npm run backend:stop`
  2. `docker cp D:\ArkanBackups\finance-activation-20261110-223706\arkan_crm.dump arkan-crm-postgres-1:/tmp/arkan_crm_finance_restore.dump`
  3. `dropdb/createdb arkan_crm` بعد تأكيد الاسم.
  4. `pg_restore -d arkan_crm --no-owner --no-privileges /tmp/arkan_crm_finance_restore.dump`
  5. إعادة محتوى `storage/` إلى `%USERPROFILE%\.arkan-crm\storage`.
  6. `npm run backend:start`
- النسخة السابقة (Deals KWD) محفوظة أيضًا في `D:\ArkanBackups\deals-kwd-20261110-192629`.

---

## 7. النطاق والسلامة

- لم تُلمس `arkan_crm_load_test`: بقيت **23** ترحيلًا.
- `arkan_crm_api_test`: **25** ترحيلًا (مُختبرة فقط).
- لا تغييرات على `.env` أو `.env.local`.
- لا تغييرات على الواجهة أو التصميم في هذه المهمة.
- لا commits أو pushes.
- 3001 يعمل (200). 4001 أُوقف لثوانٍ لأخذ نسخة متسقة وتطبيق الترحيل، ثم أُعيد و`/health` و`/health/ready` = **200**.

---

## 8. القيود المتبقية (ليست موانع تفعيل)

هذه قيود منتج/سياسات من Task 5، وليست أخطاء ترحيل:

1. لا يوجد زر تأكيد صرف عمولة في واجهة المالية الحالية؛ التأكيد متاح عبر API فقط.
2. وحدة الرواتب غير منفّذة؛ بطاقة المرتبات تقرأ حركات `PAYROLL` إن وُجدت.
3. تحصيل عمولة الشركة غير معرّف كحالة نقدية منفصلة؛ تُسجّل `EARNED`.
4. لا توجد APIs لتعديل/إلغاء الصفقات أو عكس الحركات؛ أي تصحيح مستقبلي يحتاج نموذج `ADJUSTMENT/REVERSAL` وسياسة موافقة.

---

## 9. الحكم النهائي

**GO** — الترحيل المعتمد طُبّق على `arkan_crm` فقط، بعد نسخة احتياطية كاملة ومُتحقَّق من استعادتها، وكل فحوص المخطط والبيانات والتطبيق سليمة. لا حاجة لأي إجراء إضافي لتفعيل السجل المالي.

**متوقف للمراجعة اليدوية.**
