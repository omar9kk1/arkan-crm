# تطبيق ترحيل دقة KWD وملاحظات الصفقات على قاعدة `arkan_crm` الحقيقية

**التاريخ:** 2026-11-10  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تطبيق الترحيل المعتمد `20261110120000_deal_kwd_precision_and_notes` على قاعدة `arkan_crm` المحلية.  
**الحالة:** مكتمل — **GO**. الترحيل طُبّق بنجاح، والنسخة الاحتياطية موثّقة ومُتحقَّق من استعادتها.

---

## 1. تأكيد هوية القاعدة (قبل أي تعديل)

| البند | القيمة |
|---|---|
| `current_database()` | **`arkan_crm`** |
| المستخدم | `postgres` |
| الخادم | PostgreSQL 16 المحلي داخل `arkan-crm-postgres-1` على `localhost:5433` |
| الترحيلات المطبّقة | **23** |
| الترحيل المعلّق | **واحد فقط**: `20261110120000_deal_kwd_precision_and_notes` (أكّده `prisma migrate status`) |
| مخطط `Deal` / `Commission` | `price`/`companyCommission`/`amount` = `numeric(14,2)`، لا عمود `notes` |
| السجلات | 4 مستخدمين (2 موظفان)، 4 عقارات، 0 عملاء، **0 صفقات**، **0 عمولات**، 361 AuditLog، 5 FileAsset، 0 سجل `DEAL_CREATE` |
| القيم المالية | مجموع الصفقات 0، مجموع العمولات 0 (لا صفقات بعد) |
| التخزين | `%USERPROFILE%\.arkan-crm\storage` — 7 ملفات، 3,438,788 بايت |
| مساحة D: | ~626 GB حرة |

**مراجعة SQL:** الترحيل لا يحذف جداول/صفوفًا؛ يوسّع ثلاثة أعمدة رقمية، يضيف `Deal.notes TEXT`، وينسخ ملاحظات `DEAL_CREATE` إن وُجدت. لا توجد عمليات destructive. مع 0 صفقات/0 سجلات `DEAL_CREATE`، الـbackfill لا يغيّر أي صف.

---

## 2. النسخة الاحتياطية والتحقق

**المجلد:** `D:\ArkanBackups\deals-kwd-20261110-192629`

| الملف | الحجم | ملاحظة |
|---|---:|---|
| `arkan_crm.dump` | 305,596 | pg_dump custom format قبل الترحيل |
| `schema-before.sql` | 78,173 | مخطط ما قبل الترحيل |
| `schema-after.sql` | 78,189 | مخطط ما بعد الترحيل (أثر تحقق) |
| `storage/…` | 3,438,788 (7 ملفات) | نسخة كاملة من مجلد التخزين الخاص |
| `manifest-sha256.txt` | 1,213 | SHA-256 + الحجم + المسار لكل ملفات النسخة (9) |
| `backup-summary.json` | 704 | الملخص والأعداد وحالة التحقق |
| `RESTORE.txt` | 918 | خطوات الاستعادة |

- **SHA-256 للـdump:** `3F211ADB2829F3D5C98B1A8A38AD31F23707CF98182BAA19FF262C37FBD91E02`.
- `manifest-sha256.txt` يغطي ملفات النسخة قبل الترحيل (dump + schema-before + 7 صور = 9 ملفات). `schema-after.sql` أُضيف بعد الترحيل كأثر مقارنة وليس ضمن النسخة الأصلية.
- **`pg_restore --list`:** نجح، 298 TOC entry، `dbname: arkan_crm`، Dump Version 1.15-0.
- **مطابقة الصور:** 7/7 ملفات، الأحجام والـSHA-256 مطابقة للمصدر (`STORAGE_MATCH=True`, missing=0, extra=0, mismatch=0).
- **اختبار استعادة فعلي** إلى قاعدة disposable جديدة `arkan_crm_restore_check_20261110`:
  - `pg_restore` exit 0.
  - أعداد القاعدة المستعادة: `Deal=0 | Commission=0 | Property=4 | Client=0 | User=4 | AuditLog=361 | FileAsset=5 | Migrations=23` — مطابقة تمامًا للمصدر.
  - حُذفت القاعدة التجريبية بعد التحقق (لم تُمس `arkan_crm`).

---

## 3. الترحيل المطبّق

```
prisma migrate deploy  →  Datasource "db": PostgreSQL database "arkan_crm"
Applying migration `20261110120000_deal_kwd_precision_and_notes`
All migrations have been successfully applied.
```

- لم يُطبَّق أي ترحيل آخر (الترحيل المعلّق الوحيد).
- لم يُستخدم `migrate reset` / `db push` / seed.
- لم يتطلب الترحيل إيقاف 4001 (طُبّق أثناء عمله، والجداول شبه فارغة).

---

## 4. التحقق بعد الترحيل

### المخطط

| الجدول | العمود | بعد |
|---|---|---|
| `Deal` | `price` | `numeric(15,3)` |
| `Deal` | `companyCommission` | `numeric(15,3)` |
| `Commission` | `amount` | `numeric(15,3)` |
| `Deal` | `notes` | `text` (nullable) |

- `_prisma_migrations`: **24**، وآخر سجل هو الترحيل المعتمد.
- **الفهارس:** 10 كما كانت (Deal/Commission)، **القيود:** 10 كما كانت — لا حذف/تغيير.
- **مقارنة schema قبل/بعد:** الفروق فقط: أنواع الأعمدة الثلاثة، إضافة `notes`، والفاصلة في نهاية `createdAt` (بسبب العمود الجديد). تظهر أيضًا أسطر `\restrict` العشوائية التي يضيفها pg_dump 16.15 — ليست تغييرات مخطط.

### البيانات

| العنصر | قبل | بعد |
|---|---:|---:|
| Deal | 0 | **0** |
| Commission | 0 | **0** |
| Property | 4 | **4** |
| Client | 0 | **0** |
| User | 4 | **4** |
| AuditLog | 361 | **361** |
| `DEAL_CREATE` AuditLog | 0 | **0** |
| FileAsset | 5 | **5** |
| مجموع `price` / `companyCommission` | 0 / 0 | **0 / 0** |
| `Deal.notes` غير الفارغة | — | **0** |

- الـbackfill من `AuditLog` كان no-op لأن `DEAL_CREATE` = 0؛ سجل التدقيق سليم.
- لم يُنشأ/يُحذف/يُعدَّل أي سجل أعمال حقيقي؛ التغيير الوحيد هو المخطط (والعمود الجديد).

### الدقة المالية

- قاعدة `arkan_crm` الحقيقية **لا تحتوي أي صفقات/عمولات**، لذا لا توجد قيم مالية حالية للمقارنة الرقمية.
- التوسيع `numeric(14,2) → numeric(15,3)` تحويل دقيق (لا تقريب)؛ أُثبت على قاعدة الاختبار: `300000.50 → 300000.500`، و`1.234` و`0.001` والحد `999999999999.999` محفوظة بدقة بعد الترحيل، مع رفض 4 منازل.
- لا JavaScript floats في مسار الخادم أو جمع الواجهة (fils/BigInt).

---

## 5. فحوص التطبيق

| الفحص | النتيجة |
|---|---|
| `GET /health` | **200** |
| `GET /health/ready` | **200** (DB + Redis) |
| `GET /deals` بدون مصادقة | **401** (المسار مسجّل والحارس يعمل) |
| `GET /deals/options` بدون مصادقة | **401** |
| `GET /login` (frontend 3001) | **200** |
| إنشاء صفقة `1.234` د.ك | على `arkan_crm_api_test`: **9/9 اختبارات deals ناجحة** |

- لم يُجرَ تسجيل دخول على `arkan_crm` الحقيقية لتجنب إنشاء صف RefreshToken (سجل جلسة) في قاعدة الإنتاج؛ 401 يكفي لإثبات تسجيل المسار والحارس.
- لم يُعدَّل أي كود واجهة؛ التصميم/RTL كما هو.

---

## 6. المشاكل وخطة الاستعادة

- **لا مشاكل.** ظهرت فقط أسطر `\restrict` العشوائية في فرق pg_dump (سلوك أداة، ليست تغييرات).
- الاستعادة (طوارئ فقط، تحتاج موافقة يدوية):
  1. `npm run backend:stop`
  2. `docker cp D:\ArkanBackups\deals-kwd-20261110-192629\arkan_crm.dump arkan-crm-postgres-1:/tmp/arkan_crm_restore.dump`
  3. `dropdb/createdb arkan_crm` (تأكيد الاسم أولًا)
  4. `pg_restore -d arkan_crm --no-owner --no-privileges /tmp/arkan_crm_restore.dump`
  5. إعادة الصور من `storage/` إلى `%USERPROFILE%\.arkan-crm\storage` ومطابقة `manifest-sha256.txt`
  6. `npm run backend:start`
- **لا يُنفَّذ `rollback.sql` تلقائيًا:** العودة إلى `numeric(14,2)` تقرّب أي فلوس؛ يلزم تصدير/تدقيق أولًا وموافقة منفصلة.

---

## 7. النطاق والسلامة

- `arkan_crm_load_test`: **لم تُمس** (23 migration، 14,2، بلا `notes`) — تحقق نهائي.
- لا تغييرات على `arkan_crm_load_test` أو قواعد أخرى.
- لا تغييرات على الكود/الواجهة/الصلاحيات في هذه المهمة.
- لا migrations أخرى، لا reset/seed/truncate، لا commits/pushes.
- 4001 و3001 يعملان (200/200) دون انقطاع أثناء الترحيل.

**الحكم النهائي: GO** — الترحيل المعتمد طُبّق على `arkan_crm` فقط، بعد نسخة كاملة موثّقة ومُتحقَّق من استعادتها، وكل الفحوص بعد الترحيل سليمة.

**متوقف للمراجعة اليدوية.**
