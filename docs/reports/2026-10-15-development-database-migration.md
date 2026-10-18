# تطبيق ترحيل مخطط العقار على قاعدة بيانات التطوير (نسخ احتياطي ← استعادة معزولة ← اختبار ← تطبيق)

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **النوع:** عملية قاعدة بيانات (نسخ احتياطي + استعادة معزولة + اختبار ترحيل + تطبيق على قاعدة التطوير المحلية)
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات غير مُلتزمة، لم يُنفَّذ commit أو push.
- **الترحيل المُطبَّق:** `20261015100000_property_schema_expansion`
- **مراجع سابقة:** [property-schema-migration-preparation](./2026-10-15-property-schema-migration-preparation.md)، [optional-legacy-owner-schema-fix](./2026-10-15-optional-legacy-owner-schema-fix.md)، [backend-architecture-audit](./2026-10-15-backend-architecture-audit.md)

> **نطاق هذه المهمة:** تطبيق الترحيل المُعتمَد على **قاعدة بيانات التطوير المحلية فقط**، بعد نسخ احتياطي موثّق، واستعادة معزولة في قاعدة اختبار، واختبار كامل للترحيل والقيود. **لم تُنفَّذ أي API، ولم تُعدَّل الواجهة الأمامية أو معالج Astra، ولم تُعدَّل بيئة أو تُثبَّت حزم، ولم يُنفَّذ reset ولا seed، ولم يُحذف أي صف/جدول، ولم يُلمَس أي ترحيل سابق.**

> ⚠️ **تنبيه بيئي مهم (اكتُشف أثناء المهمة):** منفذ `5433` على هذا الجهاز كان له **مستمعان**: `com.docker.backend` (IPv4 `0.0.0.0` و IPv6 `[::]`) و`wslrelay` على `[::1]`. لذلك فإن `localhost` قد يُترجَم أحيانًا إلى `::1` فيتّجه إلى مسار WSL الوسيط. ما يزال الهدف النهائي هو حاوية Docker نفسها (لا يوجد PostgreSQL آخر داخل WSL — التوزيعة الوحيدة هي `docker-desktop`)، لكن هذا التباس في العنوان أدّى إلى محاولة تطبيق أولى غير فعّالة. التفاصيل في §8 و§12.

---

## 1. التحقّق المسبق: هوية قاعدة البيانات وحالة الترحيلات

### 1.1 هوية الهدف (بدون أسرار)

| البند | القيمة |
| --- | --- |
| المضيف/المنفذ | `localhost:5433` (منفذ التطوير) |
| اسم قاعدة البيانات | `arkan_crm` |
| المخطط | `public` |
| الحاوية الفعليّة | `arkan-crm-postgres-1` (صورة `postgres:16`، إصدار المحرّك 16.15 Debian) |
| نوع الهدف | **محلي / تطوير فقط** — ليست قاعدة إنتاج ولا بعيدة |
| المستخدم | مذكور في `.env` فقط — **لم تُطبع كلمة المرور ولا قيمة `DATABASE_URL` الكاملة** |

- تأكيد عدم وجود قاعدة بعيدة أو إنتاجية مستهدَفة.
- لا يوجد متغيّر `DATABASE_URL` على مستوى العملية أو المستخدم أو الجهاز يعارض `.env` (تحقُّق صريح).

### 1.2 حالة الترحيلات قبل التطبيق

```
3 migrations found in prisma/migrations
Following migration have not yet been applied:
20261015100000_property_schema_expansion
```

| الترحيل | الحالة |
| --- | --- |
| `20260907000000_initial` | مُطبَّق (`finished = t`, `rolled_back = f`) |
| `20260907100000_mvp_schema_refinements` | مُطبَّق (`finished = t`, `rolled_back = f`) |
| `20261015100000_property_schema_expansion` | **غير مُطبَّق** (شرط الدخول) |

- **لا انحراف (drift):** `prisma migrate status` لم يُبلّغ عن أي انحراف، وسجل `_prisma_migrations` سليم (لا ترحيلات failed أو rolled back).
- الجداول قبل التطبيق: 18 جدول أعمال + `_prisma_migrations`، **ولا وجود** لجداول `Contact` / `PropertyFloor` / `RequestedProperty` / `PropertyRevision`.

### 1.3 مراجعة SQL للعمليات المدمّرة

- فحص ملف الترحيل بحثًا عن `DROP | DELETE | TRUNCATE | RENAME | SET NOT NULL`:
  - المطابقات الوحيدة: تعليق توضيحي، و`ALTER COLUMN "ownerId" DROP NOT NULL;` (المقصودة)، وسياسات `ON DELETE RESTRICT/CASCADE` للمفاتيح الأجنبية (ليست عمليات حذف وقت الترحيل).
- **لا توجد عملية مدمّرة** (لا حذف عمود، لا حذف جدول، لا حذف صفوف، لا backfill).
- تأكيد: `Property.ownerId` يصبح **اختياريًا** دون حذف العمود (`ownerId`) ودون حذف المفتاح الأجنبي `Property_ownerId_fkey` ودون حذف الفهرس `Property_ownerId_idx`.
- تأكيد تناسق تعريفات `Contact` و`PropertyFloor` و`RequestedProperty` و`PropertyRevision` مع المخطط.

### 1.4 عدّادات الأساس (Baseline) قبل أي كتابة

| الجدول | العدد |
| --- | --- |
| `User` | 2 |
| `EmployeeProfile` | 1 |
| `Owner` | 0 |
| `Property` | 0 |
| `Client` / `Deal` / `FileAsset` | 0 |
| `AuditLog` | 35 |
| `RefreshToken` | 33 |
| `PropertyApprovalRequest` / `PropertyAssignment` | 0 |

**بوابة المرحلة 1: `Completed` (اجتازت).**

---

## 2. النسخة الاحتياطية: الطريقة والمسار

| البند | القيمة |
| --- | --- |
| الأداة | `pg_dump` من داخل حاوية `postgres:16` (16.15)، صيغة **custom** (`-Fc`) مع ضغط gzip |
| الأمر (مختصر) | `docker exec arkan-crm-postgres-1 pg_dump -U postgres -Fc -f /tmp/<name> arkan_crm` ثم `docker cp` إلى المضيف |
| الطابع الزمني | `2026-10-15 16:12:01` محليًا (13:12:01 UTC) |
| المسار المُتحقَّق | `C:\Users\omar9\AppData\Local\Temp\opencode\arkan-db-backups\arkan_crm_dev_20261015_161201.dump` |
| الحجم | 65,869 بايت (غير فارغ) |
| SHA-256 | `186381F0A0BE275C46F50CB48EA79FE7EC8C7D1AF1F308AAD4537576E4C0136B` |
| الموقع | **خارج ملفات المشروع المتعقَّبة**، مجلد محلي خاص (لا يُرفع ولا يُلتزم في Git) |
| نتائج الأوامر | `pg_dump` = exit 0، `docker cp` = exit 0 |

- لم تُستبدل أي نسخة احتياطية سابقة (اسم فريد بالطابع الزمني).
- **لم تُطبع أي بيانات اعتماد**؛ استُخدمت متغيّرات عملية فقط.

---

## 3. التحقّق من سلامة أرشيف النسخة الاحتياطية

| الفحص | النتيجة |
| --- | --- |
| `pg_restore --list` (من الحاوية) | ✅ Exit 0 |
| عدد الأسطر في فهرس الأرشيف (TOC) | 162 سطرًا (151 مُدخلًا) |
| الصيغة | `CUSTOM`، الضغط `gzip` |
| وجود الجداول الرئيسية في الأرشيف | ✅ `User`, `Owner`, `Property`, `Client`, `AuditLog`, `RefreshToken`, `_prisma_migrations` |

**المرحلة 2: `Completed` — النسخة الاحتياطية موجودة، غير فارغة، وقابلة للقراءة، وتم إثبات قابليتها للاستعادة في المرحلة 3.**

---

## 4. الاستعادة في قاعدة اختبار معزولة

| البند | القيمة |
| --- | --- |
| اسم قاعدة الاختبار | `arkan_crm_migtest_20261015_161201` (اسم فريد جديد) |
| الإنشاء | `createdb` = exit 0 (لم تُعَد استخدام/استبدال أي قاعدة قائمة) |
| الاستعادة | `pg_restore -d <testdb>` = **exit 0** (بدون أخطاء) |
| `--clean` أو أي خيار مدمّر | **لم يُستخدم إطلاقًا** تجاه قاعدة التطوير |

نتائج التحقّق بعد الاستعادة:

- **19 جدولًا** (نفس بنية قاعدة التطوير).
- سجل الترحيلات يحتوي على **الترحيلين المُطبَّقين سابقًا** فقط (`initial` و`mvp_schema_refinements`).
- عدّادات الصفوف مطابقة للأساس تمامًا: `User=2`, `EmployeeProfile=1`, `Owner=0`, `Property=0`, `AuditLog=35`, `RefreshToken=33`.

**المرحلة 3: `Completed` (اجتازت). لو فشلت الاستعادة لتوقفنا ولم نطبّق شيئًا.**

---

## 5. نتيجة تطبيق الترحيل على قاعدة الاختبار

- الأمر: `prisma migrate deploy` مع `DATABASE_URL` **مقيّد بقاعدة الاختبار فقط**.
- المصدر المُبلَّغ: `PostgreSQL database "arkan_crm_migtest_20261015_161201" ... at "localhost:5433"`.

```
Applying migration `20261015100000_property_schema_expansion`
The following migration(s) have been applied:
migrations/
  └─ 20261015100000_property_schema_expansion/
All migrations have been successfully applied.
```

- بعد التطبيق: `prisma migrate status` = «Database schema is up to date!» — **لا ترحيلات معلّقة**.
- سجل الترحيلات في قاعدة الاختبار: 3 ترحيلات (الطابع الزمني للتطبيق: `2026-10-15 13:13:07 UTC`).
- **لم تُدخل أي بيانات اختبار إلى قاعدة التطوير.** كل بيانات الاختبار أُدخلت في قاعدة الاختبار المعزولة فقط (وفي معاملة أُلغيت لاحقًا — §6).

**المرحلة 4 (التطبيق على قاعدة الاختبار): `Completed`.**

---

## 6. التحقّق من القيود والمفاتيح الأجنبية (على قاعدة الاختبار)

أُجريت اختبارات السلوك داخل معاملة (`BEGIN … ROLLBACK`) لضمان عدم بقاء أي بيانات اختبار. **كل النتائج كما هو متوقّع:**

| # | الاختبار | المتوقّع | النتيجة |
| --- | --- | --- | --- |
| 1 | عقار بـ`ownerId = NULL` + نوع البيع | يُقبل | ✅ `TST-1 / ownerId = NULL / SALE` |
| 2 | نوع `EXCHANGE` | يُقبل | ✅ `TST-2 / EXCHANGE` |
| 3 | سجل `Owner` + عقار بـ`ownerId` غير فارغ (يُحفظ) | يُقبل ويُحفظ | ✅ `TST-3 / ownerId = <owner>` |
| 4 | `Contact` بنوعَي `OWNER` و`BROKER` | يُقبل | ✅ 2 صفوف |
| 5 | `PropertyFloor` لكل أنواع الطوابق المعتمدة | كلها تُقبل | ✅ 14 نوعًا (GROUND…CUSTOM) |
| 6 | `RequestedProperty`: ميزانية فارغة تمامًا / حد أدنى فقط / حد أعلى فقط | تُقبل | ✅ 3 صفوف |
| 7 | `RequestedProperty`: `min > max` | يُرفض (`check_violation`) | ✅ مرفوض |
| 8 | `RequestedProperty`: `min < 0` | يُرفض | ✅ مرفوض |
| 9 | `RequestedProperty`: `max < 0` | يُرفض | ✅ مرفوض |
| 10 | `PropertyRevision`: إصدار `PENDING` أول | يُقبل | ✅ |
| 11 | `PropertyRevision`: إصدار `PENDING` ثانٍ لنفس العقار | يُرفض (`unique_violation`) | ✅ مرفوض |
| 12 | بعد حل الأول: `PENDING` + عدة `APPROVED`/`REJECTED` تاريخية | مسموح | ✅ `PENDING=1, APPROVED=2, REJECTED=1` |
| 13 | `Property.primaryImageId` اختياري (صورة واحدة) | يُقبل حقل فارغ | ✅ `TST-2/TST-3` بصورة رئيسية فارغة |
| 14 | إسناد نفس الصورة الرئيسية لعقارين | يُرفض (`unique_violation`) | ✅ مرفوض |
| 15 | `ROLLBACK` | عودة للوضع الأساسي | ✅ `Owner=0, Property=0, Contact=0, User=2, AuditLog=35` |

**القيود والفهارس المُتحقَّق من وجودها فعليًا في قاعدة الاختبار:**

| العنصر | موجود |
| --- | --- |
| الجداول `Contact`, `PropertyFloor`, `RequestedProperty`, `PropertyRevision` | ✅ |
| `PropertyRevision_one_pending_per_property` (فهرس فريد جزئي، `WHERE status='PENDING'`) | ✅ |
| `RequestedProperty_budget_range_check` (CHECK) | ✅ |
| `Property_primaryImageId_key` (فريد) | ✅ |
| `Property_ownerId_fkey` + الفهرس `Property_ownerId_idx` (محفوظان) | ✅ |
| المفاتيح الأجنبية الجديدة للعقار/الجهات/الطوابق/الإصدارات/المطلوب | ✅ |
| `Property.area` (نوعه `text` وقيد `NOT NULL` دون تغيير) | ✅ |

**المرحلة 4 (اختبار القيود): `Completed` (اجتازت).**

---

## 7. التحقّق من الحفاظ على البيانات الحالية (قاعدة الاختبار)

عدّادات الصفوف بعد الترحيل مطابقة للأساس تمامًا (`User=2`, `EmployeeProfile=1`, `Owner=0`, `Property=0`, `AuditLog=35`, `RefreshToken=33`) — **لم يُحذف أو يُعَد كتابة أي صف**، ولم تُضَف أي صفوف إلى الجداول الجديدة.

**بوابة المرحلة 4: `Completed` — الترحيل والقيود ناجحة، والبيانات محفوظة.**

---

## 8. تطبيق الترحيل على قاعدة بيانات التطوير الفعلية

### 8.1 إعادة تأكيد البوابات قبل التطبيق

| الشرط | النتيجة |
| --- | --- |
| إعادة تأكيد الهدف | ✅ `localhost:5433` / `arkan_crm` (محلي، حاوية `arkan-crm-postgres-1`) |
| مسار النسخة الاحتياطية | ✅ موثّق ومُتحقَّق (65,869 بايت، SHA-256 مطابق) |
| حالة الترحيل | ✅ التوسيع «not yet applied» |
| عدم تغيّر SQL المراجَع منذ الاختبار | ✅ SHA-256 للملف `97B65A22A38433298C8881F8DB1EF9A8E9E36D3D172A77BB6F5C430A5108D27F` (مطابق) |
| لا عملية ترحيل/تغيير مخطط أخرى جارية | ✅ |

### 8.2 ⚠️ انحراف: محاولة أولى غير فعّالة عبر `localhost`

- المحاولة الأولى: `prisma migrate deploy` (عبر `.env` → `localhost:5433`) بلّغت عن النجاح (`DEPLOY_EXIT=0` و«All migrations have been successfully applied»).
- لكن التحقّق الفوري عبر الحاوية أظهر أن `arkan_crm` ما زالت بـ**ترحيلين فقط** ولا جداول جديدة.
- التشخيص: `netstat` أظهر **مستمعين اثنين على 5433**: `com.docker.backend` (IPv4/IPv6) و`wslrelay` (`[::1]`)، وقد يُترجَم `localhost` إلى `::1`. توزيعات WSL تحتوي فقط على `docker-desktop` (لا PostgreSQL مستقل)، أي أن الهدف النهائي واحد (الحاوية) لكن المسار عبر `localhost` كان غير حتمي.
- **إجراء التخفيف:** أُعيد التطبيق مع تثبيت المضيف صراحةً على IPv4: `127.0.0.1` (لتجنّب مسار `::1` الوسيط).

### 8.3 التطبيق الحتمي (موثّق، ناجح)

```
Datasource "db": PostgreSQL database "arkan_crm", schema "public" at "127.0.0.1:5433"
Applying migration `20261015100000_property_schema_expansion`
All migrations have been successfully applied.
```

- التحقّق الفوري عبر الحاوية: `_prisma_migrations = 3`، وجود `Contact` و`PropertyRevision`، و`Property.ownerId` أصبح `is_nullable = YES`.
- **الترحيل طُبِّق مرة واحدة فقط** (ثلاثة صفوف، بلا تكرار).

> **ملاحظة أمان:** المحاولة الأولى **لم تُغيّر قاعدة التطوير المستهدفة**؛ لم يُطبَّق الترحيل مرتين، ولم تُصَب أي قاعدة أخرى. الحالة النهائية = تطبيق واحد نظيف ومُتحقَّق منه.

**المرحلة 5: `Completed` (مع انحراف موثّق).**

---

## 9. التحقّق بعد التطبيق (قاعدة التطوير)

| الفحص | النتيجة |
| --- | --- |
| `prisma migrate status` (عبر `localhost` و`127.0.0.1`) | ✅ «Database schema is up to date!» |
| سجل `_prisma_migrations` | ✅ 3 ترحيلات، `finished = t` للجميع |
| الجداول الجديدة | ✅ `Contact`, `PropertyFloor`, `RequestedProperty`, `PropertyRevision` |
| `Property.ownerId` | ✅ `uuid`، `is_nullable = YES` |
| `Property.area` | ✅ `text`، `NOT NULL` (دون تغيير) |
| `Property.contactId` / `createdByUserId` / `primaryImageId` | ✅ اختيارية (`YES`) |
| `DealType` | ✅ `SALE, RENT, EXCHANGE` |
| `ContactType` | ✅ `OWNER, BROKER` |
| `FloorType` | ✅ 14 قيمة معتمدة |
| `PropertyRevision_one_pending_per_property` | ✅ موجود (فهرس فريد جزئي) |
| `RequestedProperty_budget_range_check` | ✅ موجود |
| `Property_ownerId_fkey` + `Property_ownerId_idx` | ✅ محفوظان (RESTRICT) |
| المفاتيح الأجنبية الجديدة | ✅ 11 مفتاحًا |
| عدّادات الصفوف | ✅ مطابقة للأساس (`User=2`, `EmployeeProfile=1`, `AuditLog=35`) |
| جداول المصادقة | ✅ `User` (2) و`RefreshToken` (33 قبل اختبار الدخول) سليمة، والأدوار: `manager`/`employee` |
| علاقات `Owner`/`Property` القديمة | ✅ محفوظة |

**المرحلة 6: `Completed` — النجاح مُثبَت بالتحقّق من المخطط والبيانات، لا بمجرّد نجاح أمر الترحيل.**

---

## 10. توليد Prisma Client

- `npx prisma validate` → ✅ «The schema ... is valid».
- `npx prisma generate` → ❌ **محجوب**:

```
Error:
EPERM: operation not permitted, rename
'...\node_modules\.prisma\client\query_engine-windows.dll.node.tmpXXXX'
-> '...\node_modules\.prisma\client\query_engine-windows.dll.node'
```

- تمّ **تأكيد القفل** عمليًا: محاولة فتح الملف حصريًا فشلت («being used by another process»).
- **العمليات القافلة المحدَّدة (عمليات تطوير Arkan الجارية):**

| PID | الأمر |
| --- | --- |
| 22292 | `node --enable-source-maps D:\Projects\arkan-crm\apps\backend\dist\main` |
| 4416 | `node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch` |
| 17244 | `node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch` |

- **الإجراء المطلوب قبل التوليد:** يجب **إيقاف خادم تطوير الخلفية** (العمليات أعلاه) ثم إعادة تشغيله بعد التوليد — لأن العملية الجارية تُبقي ملف محرّك الاستعلام محمّلًا في الجهاز.
- **لم نُنهِ أي عملية، ولم نحذف أي ملف مقفل، ولم نُثبّت/نُحدّث أي حزمة، ولم نلمس `node_modules`.** (غير مُصرَّح بهذه المهمة.)
- التوليد غير حاجز حاليًا: لا كود خلفي يشير إلى النماذج الجديدة بعد.

**حالة توليد العميل: `Blocked` (EPERM، مُوثّق).**

---

## 11. فحوص الخلفية (typecheck/tests) والمصادقة/الصحة

| الأمر | النتيجة |
| --- | --- |
| `npm run typecheck -w @arkan/backend` (`tsc --noEmit`) | ✅ Exit 0 |
| `npm run test -w @arkan/backend` (Jest) | ✅ **3 suites / 12 tests passed** |
| `npx prisma validate` | ✅ صالح |
| `npx prisma migrate status` | ✅ محدّث |

فحوص وقت التشغيل (بدون تغيير بيانات أعمال):

| الفحص | النتيجة |
| --- | --- |
| `GET http://localhost:4001/health` | ✅ 200 — `{"data":{"status":"ok","service":"arkan-api"}}` |
| `GET /auth/me` بدون رمز | ✅ 401 (الحارس `JwtAuthGuard` العام يعمل) |
| `POST /auth/login` (مدير) | ✅ 200 — أُصدر `accessToken` و`refreshToken` |
| جدول `RefreshToken` بعد الدخول | 33 → 34 (صف مصادقة فقط، لا بيانات أعمال) |

---

## 12. العوائق والانحرافات

1. **انحراف العنوان المزدوج على 5433 (مُوثّق ومُعالَج):** وجود `wslrelay` على `[::1]` مع `com.docker.backend` جعل `localhost` غير حتمي، فأدّى لمحاولة تطبيق أولى بلّغت بالنجاح دون أثر على قاعدة التطوير. **العلاج:** تثبيت المضيف على `127.0.0.1` عند تنفيذ `prisma migrate deploy`، مع التحقّق الفوري عبر الحاوية. **التوصية:** استخدام `127.0.0.1` بدل `localhost` في أدوات قاعدة البيانات على هذا الجهاز لتفادي الغموض.
2. **قيد `EPERM` عند توليد Prisma Client** (قفل محرّك الاستعلام من عمليات الخلفية الجارية) — §10.
3. **الفهرس الفريد الجزئي غير منمذج في Prisma:** أي `prisma migrate dev` مستقبلي يجب مراجعته لتفادي توليد `DROP INDEX` له.
4. **الترحيل الثاني `20260907100000_mvp_schema_refinements`:** مُطبَّق فعلًا هنا؛ في أي بيئة جديدة يفشل عن قصد إن لم تكن جداول المال فارغة، ويحتاج backfill مرحليًا مُراجَعًا (دون حذف بيانات).
5. **قاعدة الاختبار `arkan_crm_migtest_20261015_161201` ما زالت موجودة** (لم تُحذف) للحفاظ على أدلة الاختبار؛ يمكن إسقاطها بعد المراجعة.
6. **النسخة الاحتياطية محفوظة** خارج المشروع قابلة للاستعادة للطوارئ.

---

## 13. تأكيد عدم لمس أي قاعدة إنتاج/بعيدة

- ✅ كل العمليات نُفِّذت على قاعدة **التطوير المحلية** فقط: `localhost:5433` / `arkan_crm` داخل الحاوية المحلية `arkan-crm-postgres-1`.
- ✅ **لم تُلمس** أي قاعدة إنتاج أو staging أو بعيدة.
- ✅ لم يُشغَّل `prisma migrate reset` ولا `prisma db push` ولا أي مزامنة مدمّرة.
- ✅ لم يُحذف أي صف/جدول، ولم تُستبدل أي نسخة احتياطية، ولم يُنفَّذ seed، ولم تُعدَّل ملفات البيئة، ولم تُلمَس واجهة أمامية أو معالج Astra، ولم يُثبَّت/يُحدَّث أي اعتماد، ولم يُنفَّذ commit/push، ولم يُحدَّث Git.

---

## 14. الحالة النهائية والخطوة التالية المقترحة

| البند | الحالة |
| --- | --- |
| التحقّق المسبق (هوية/حالة/عدم تدمير) | `Completed` |
| النسخة الاحتياطية + التحقّق من الأرشيف | `Completed` |
| قاعدة اختبار معزولة + استعادة | `Completed` |
| تطبيق الترحيل على قاعدة الاختبار | `Completed` |
| اختبار القيود/المفاتيح/الميزانية/الإصدارات | `Completed` |
| تطبيق الترحيل على قاعدة التطوير | `Completed` (بعد انحراف موثّق وعلاج بالتثبيت على IPv4) |
| التحقّق بعد التطبيق | `Completed` |
| توليد Prisma Client | `Blocked` (EPERM) |
| typecheck / اختبارات Jest | `Completed` (12 اختبارًا) |
| فحوص المصادقة/الصحة | `Completed` |
| أي API أعمال / تعديل واجهة أمامية | `Not Implemented` (مقيّد بالمهمة) |

**الخلاصة:** تمّت نسخ قاعدة التطوير احتياطيًا (موثّق ومُتحقَّق)، واستُعيدت في قاعدة اختبار معزولة، واختُبر الترحيل هناك بالكامل، ثم طُبِّق بأمان على قاعدة التطوير المحلية، مع التحقّق من سلامة البيانات والقيود والفهارس. بقيت جدولة `ownerId` اختيارية، وأُضيفت جداول `Contact`/`PropertyFloor`/`RequestedProperty`/`PropertyRevision` مع القيود المعتمدة. لم تُلمس أي قاعدة إنتاج ولا أي كود API/واجهة.

### الخطوة التالية المقترحة (بانتظار الموافقة)

1. **إعادة توليد Prisma Client** بعد إيقاف/إعادة تشغيل خادم تطوير الخلفية (لتحرير ملف المحرّك) ليصبح النماذج الجديدة متاحة للكود.
2. **المرحلة 2B:** تنفيذ خدمات الـAPI للعقارات (إنشاء/قراءة) مع تفويض على مستوى الصف (Row-level authorization) و**تنقيح (redaction) جهات التواصل في DTO** — وهي خطوة منفصلة تتطلّب موافقة صريحة.
3. **عند أي بيئة جديدة:** التأكد من تطبيق `20260907100000_mvp_schema_refinements` أولًا، ومراجعة أي `prisma migrate dev` لعدم إسقاط الفهرس الفريد الجزئي.
4. **اختياريًا:** إسقاط قاعدة الاختبار `arkan_crm_migtest_20261015_161201` بعد اعتماد النتائج.

> التقرير لا يُصرّح بأي جاهزية إنتاجية، ويلتزم بقواعد `AGENTS.md` و`PROJECT_CONTEXT.md` وتوثيق `docs/reports/`.
