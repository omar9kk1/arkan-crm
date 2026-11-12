# تفعيل ترحيل ملكية مراجعات العملاء على `arkan_crm`

**التاريخ:** 2026-11-11  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تطبيق الترحيل المعتمد `20261111120000_client_review_assigned_reviewer` على قاعدة التطوير المحلية `arkan_crm`.  
**الحالة:** **GO** — طُبّق بنجاح بعد نسخة احتياطية كاملة ومُتحقَّق من استعادتها.

---

## 1. هوية القاعدة والتحقق المسبق

| البند | القيمة |
|---|---|
| `current_database()` | **`arkan_crm`** |
| المستخدم | `postgres` |
| الخادم | PostgreSQL **16.15** داخل `arkan-crm-postgres-1`، منفذ **5433** |
| الترحيلات قبل | **25** |
| الترحيل المعلّق | **واحد فقط**: `20261111120000_client_review_assigned_reviewer` (أكّده `prisma migrate status`) |
| العمود `assignedReviewerId` قبل | غير موجود |
| استعلامات نشطة | 0 |
| حجم القاعدة | 12 MB |
| مساحة D: الحرة | ~630 GB |

### فحص مراجعات العملاء قبل الترحيل

| الطلب | الحالة | المقدّم | المدير الحالي | المراجع الفعلي |
|---|---|---|---|---|
| `0da25fae-...` | PENDING | `mohamed` | `3amro` (نشط) | — |
| `14b5ca82-...` | REJECTED | `mohamed` | `3amro` (نشط) | `Demo Manager` |

- **0** صفوف مكتملة بلا `reviewedById`.
- **0** صفوف PENDING بمدير غير نشط/غير صالح.
- `mohamed` موظف نشط ومديره `3amro` مدير نشط.
- **لا حالات غامضة**؛ الباكفيل آمن.

**ملاحظة تشغيلية:** 4001 كان في حالة `DEGRADED` (watcher يعمل بلا listener) قبل النسخ. أُوقف بالطريقة المدارة أثناء النسخ والترحيل، ثم أُعيد و`/health` = 200.

---

## 2. النسخة الاحتياطية والاستعادة

**المجلد:** `D:\ArkanBackups\review-ownership-20261111-054829`

| الملف | الحجم | ملاحظة |
|---|---:|---|
| `arkan_crm.dump` | 314,023 | `pg_dump -Fc` قبل الترحيل |
| `schema-before.sql` | 78,676 | مخطط ما قبل |
| `schema-after.sql` | 79,311 | مخطط ما بعد (أثر مقارنة) |
| `storage/…` | 3,438,788 (7 ملفات) | كل الصور الخاصة |
| `manifest-sha256.txt` | 1,213 | SHA-256 + حجم + مسار |
| `backup-summary.json` | 876 | الأعداد ونتيجة الاستعادة |
| `RESTORE.txt` | 1,126 | خطوات الاستعادة |

- **SHA-256 للـdump:** `1BC9AA6B0E4BBCCDEDABD20BA16CCE840E659DB4663465DCD88D8BCCBAA91E91`.
- **`pg_restore --list`:** نجح، `dbname: arkan_crm`، **300 TOC entry**.
- **اختبار استعادة فعلي** إلى `arkan_crm_review_restore_check_20261111_054829`:
  - أُنشئت من الـdump واستُعيدت بنجاح، ثم حُذفت.
  - الأعداد المصدر والمستعادة متطابقة: `2|1|5|4|0|4|18|409|5|25`.
- **الصور:** 7/7، SHA-256 والأحجام مطابقة، missing=0, extra=0, mismatch=0.

---

## 3. الترحيل المطبّق

```text
prisma migrate deploy
Datasource "db": PostgreSQL database "arkan_crm" ...
Applying migration `20261111120000_client_review_assigned_reviewer`
All migrations have been successfully applied.
```

- لم يُطبّق أي ترحيل آخر.
- لم يُستخدم `migrate reset` أو `db push` أو seed/truncate.
- بعد الترحيل: `prisma migrate status` → **Database schema is up to date!**

### تغييرات المخطط

- `ClientReviewRequest.assignedReviewerId UUID NULL`.
- FK: `ClientReviewRequest_assignedReviewerId_fkey` → `User(id)`، `ON DELETE RESTRICT`.
- Index: `ClientReviewRequest_assignedReviewerId_status_idx (assignedReviewerId, status)`.
- مقارنة schema قبل/بعد: الفروق فقط العمود + FK + الفهرس + فروق تنسيق pg_dump. لا حذف جداول/صفوف/فهارس.

---

## 4. التحقق بعد الترحيل

### الأعداد (لم تتغيّر)

| العنصر | قبل | بعد |
|---|---:|---:|
| ClientReviewRequest | 2 | **2** |
| PENDING reviews | 1 | **1** |
| PropertyApprovalRequest | 5 | **5** |
| Property | 4 | **4** |
| Client | 0 | **0** |
| User | 4 | **4** |
| Notification | 18 | **18** |
| AuditLog | 409 | **409** |
| FileAsset | 5 | **5** |
| Migration | 25 | **26** |

- لا سجلات مراجعة مفقودة أو مكررة (`duplicate_review_ids = 0`).
- لم تتغيّر أي حالة أو تاريخ إنشاء أو `reviewedAt` أو `reviewedById`.
- تعيين الموظف لم يتغيّر: `mohamed` → `3amro`.

### إسناد الملكية بعد الترحيل

| الطلب | الحالة | assignedReviewerId | المراجع الفعلي |
|---|---|---|---|
| `0da25fae-...` | PENDING | **`3amro`** | — |
| `14b5ca82-...` | REJECTED | **`Demo Manager`** | **`Demo Manager`** |

هذا يطابق السياسة:
- PENDING يتبع المشرف المباشر الحالي.
- REJECTED يحتفظ بالمراجع التاريخي.
- لا يُنشأ fallback للمالك.

---

## 5. فحوص التطبيق

| الفحص | النتيجة |
|---|---|
| `GET /health` | **200** |
| `GET /health/ready` | **200** |
| `GET /client-reviews` بدون مصادقة | **401** |
| `GET /notifications/system-log` بدون مصادقة | **401** |
| frontend `/login` (3001) | **200** |
| backend logs | بدء نظيف، بلا أخطاء Prisma |
| `prisma migrate status` | **up to date** |

### قراءة مباشرة read-only عبر الخدمة (بدون جلسة/كتابة)

```json
[
  {"role":"OWNER","name":"Demo Manager","visible":1,"pending":0,"statuses":["REJECTED"]},
  {"role":"MANAGER","name":"3amro","visible":1,"pending":1,"statuses":["PENDING"]}
]
```

- المالك يرى السجل المرفوض التاريخي الذي قرره بنفسه، **ولا يرى** الطلب المعلّق المخصص للمدير.
- المدير `3amro` يرى الطلب المعلّق فقط.
- واجهات المراجعة لم تعد ترجع 503 بعد الترحيل.
- سجل النظام ما زال يعمل ويعرض تفاصيل المراجعات.

---

## 6. الاختبارات الوظيفية

الاختبارات الكتابية نُفّذت على `arkan_crm_api_test` فقط:

```text
9 suites / 68 tests passed
+ backend/frontend typecheck = 0
+ lint = 0
```

تغطي: نقل A→B، بقاء القرارات التاريخية، المالك المباشر والعودة لمدير، طلبات العقار/العميل، فشل الوجهة، التزامن/الإعادة، الإشعارات، وسجل النظام.

`arkan_crm_load_test` بقيت **23** ترحيلًا دون تغيير. `arkan_crm_api_test` = **26**.

---

## 7. الاستعادة والطوارئ

- `D:\ArkanBackups\review-ownership-20261111-054829\RESTORE.txt` يحتوي الخطوات.
- **لا rollback تلقائي.** إسقاط العمود يفقد إسناد الملكية والتاريخ، ويحتاج موافقة منفصلة.
- الاستعادة للطوارئ فقط: إيقاف backend → `dropdb/createdb arkan_crm` → `pg_restore` → إعادة الصور → تشغيل backend.

---

## 8. الحكم النهائي

**GO** — الترحيل المعتمد طُبّق على `arkan_crm` فقط، بعد نسخة كاملة ومُتحقَّق من استعادتها. كل الأعداد والتواريخ والمراجعين محفوظة، والإسناد الجديد صحيح، والتطبيق يعمل.

**متوقف للمراجعة اليدوية.**
