# تفعيل فهارس الأداء على قاعدة التطوير الحقيقية `arkan_crm`

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**الهدف المصرّح به:** تطبيق migration الفهارس الإضافية فقط على قاعدة التطوير المحلية `arkan_crm`.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لم تُعدّل `.env`، ولم تُنشأ migrations جديدة، ولم تُطبّق أي تغييرات على بيانات أو حسابات أو أدوار.  
> لا commits أو pushes.

---

## 1. التحقق قبل التطبيق (Pre-flight)

| البند | النتيجة |
|---|---|
| هدف الاتصال | `localhost:5433/arkan_crm` ✅ |
| قاعدة الاختبار | `arkan_crm_api_test` — لم يُستخدم في هذه المهمة |
| قاعدة حقيقية أخرى | لم يُتصل بأي خادم غير محلي |
| عدد migrations المطبّقة قبل | **22** |
| Migration المعلّقة الوحيدة | `20261109120000_query_performance_indexes` |
| محتوى migration.sql | **11 × `CREATE INDEX` فقط** |
| أوامر destructive داخل الملف | **لا شيء** (`DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT` غير موجودة) |
| جلسات نشطة على `arkan_crm` قبل | **0** بعد إيقاف الـbackend المحلي |
| الفهارس الـ11 موجودة قبل | **0** |

### ملاحظة Schema Drift
أظهر `prisma migrate diff` فرقًا واحدًا شكليًا:
- `DROP INDEX "Property_reference_idx"` ثم إعادة إنشائه بنفس التعريف.
- السبب: تمثيل Prisma لـ`text_pattern_ops`، بينما التعريف الفعلي في `arkan_crm` هو:
  `CREATE INDEX "Property_reference_idx" ON public."Property" USING btree (reference text_pattern_ops)`
- لم يكن drift حقيقيًا، ولم يُنفّذ أي تغيير عليه. بقية الفروق كانت فقط الفهارس الـ11 المعلّقة.

### إيقاف الاستخدام
- الـbackend المحلي كان يعمل على `localhost:4001`.
- أُوقف عبر `npm run backend:stop`، ثم أُوقف listener غير المُدار (PID 25892) بعد بقائه نشطًا.
- تأكيد: `/health` أصبح غير متاح، وعدد جلسات `arkan_crm` = **0** قبل النسخ والتطبيق.

---

## 2. النسخة الاحتياطية والتحقق من الاستعادة

| البند | القيمة |
|---|---|
| المسار | `D:\ArkanBackups\arkan_crm-20261109-034452.dump` |
| الصيغة | PostgreSQL custom dump (`-Fc`) |
| الحجم | **297,574 bytes** |
| عدد عناصر الأرشيف | **298** |
| SHA-256 | `7F94079D6D89EA5C9E3BBA0F144CB623030206FDD540D20601C455893F9865DE` |

### اختبار الاستعادة
- أُنشئت قاعدة منفصلة: `arkan_crm_restore_verify_20261109-034452`.
- نُفّذ `pg_restore` بنجاح (`exit 0`).
- قُورنت عدادات **34 جدولًا** بين `arkan_crm` والقاعدة المستعادة: **تطابق كامل**.
- أُعيد التحقق لاحقًا من **ملف النسخة الاحتياطية على القرص نفسه** (`D:\ArkanBackups\...dump`) عبر استعادة ثانية إلى قاعدة مؤقتة أخرى: **تطابق 33 جدولًا تجاريًا**.
- بعد نجاح التحقق أُسقطت قواعد التحقق المؤقتة، وبقيت النسخة الاحتياطية على القرص.
- لم تُستخدم أي استعادة فوق `arkan_crm`.

---

## 3. تطبيق الـMigration

```powershell
$env:DATABASE_URL = <قراءة من apps/backend/.env دون طباعة القيمة>
npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```

**النتيجة:**

```text
Applying migration `20261109120000_query_performance_indexes`
All migrations have been successfully applied.
```

- لم يُستخدم `migrate reset` أو `db push` أو `--force`.
- لم يُنشأ migration جديد.
- لم يُعدّل `.env`.

---

## 4. التحقق بعد التطبيق

### حالة الـMigrations
| البند | قبل | بعد |
|---|---:|---:|
| عدد migrations المطبّقة | 22 | **23** |
| أحدث migration | `20261109120000_query_performance_indexes` | نفسها |
| `prisma migrate status` | Pending | **Database schema is up to date!** |

### الفهارس الـ11
كلها موجودة وحالتها **VALID**:

1. `FollowUp_clientId_status_dueAt_idx`
2. `PropertyApprovalRequest_propertyId_createdAt_idx`
3. `Property_createdAt_idx`
4. `Client_createdAt_idx`
5. `Client_createdById_idx`
6. `Notification_userId_createdAt_idx`
7. `Deal_closedAt_idx`
8. `Deal_propertyEmployeeId_idx`
9. `Deal_clientEmployeeId_idx`
10. `AuditLog_createdAt_idx`
11. `FollowUpSubject_responsibleUserId_nextDueAt_idx`

- فهارس غير صالحة أو غير جاهزة: **0**.
- حجم قاعدة البيانات بعد التطبيق: **12,450,839 bytes**.
- `Property_reference_idx` بقي موجودًا بنفس تعريف `text_pattern_ops`.

### سلامة البيانات التجارية
تمت مقارنة عدادات **33 جدولًا تجاريًا** (باستثناء `_prisma_migrations`) قبل/بعد: **تطابق كامل**.

| المقياس | قبل | بعد |
|---|---:|---:|
| المستخدمون | 4 | **4** |
| الموظفون | 2 | **2** |
| المديرون | 1 | **1** |
| المالك | 1 | **1** |
| تعيينات المدير | 1 | **1** |
| موظفون غير معيّنين | 1 | **1** |
| العقارات | 4 | **4** |
| حالة العقارات | 4 × PENDING | **4 × PENDING** |
| ملفات/صور | 5 | **5** |
| الإشعارات | 12 | **12** |
| AuditLog | 329 | **329** |

- لم تُحذف أو تُعدّل أي حسابات أو أدوار أو تعيينات أو عقارات أو ملفات.
- الجداول التي كانت فارغة (Clients / FollowUps / Deals) بقيت فارغة.
- لم تُنفّذ seeds أو resets أو deletions.

---

## 5. صحة النظام بعد التطبيق

- أُعيد تشغيل الـbackend المحلي:
  - `/health` = **200**
  - `/auth/me` = **401** (متوقع بدون توكن)
  - الحالة: **RUNNING (healthy)**
- `prisma migrate status`: **up to date**.
- لا جلسات عالقة أو أخطاء أثناء التطبيق.
- لم تُطبع أي كلمات مرور أو توكنات أو محتويات النسخة الاحتياطية.

---

## 6. الأخطاء والمخاطر المتبقية

- **لا أخطاء أثناء التطبيق أو الاستعادة.**
- ملاحظة شكلية فقط: `prisma migrate diff` يعرض إعادة إنشاء `Property_reference_idx` بسبب `text_pattern_ops`؛ لم يُنفّذ هذا الفرق.
- النسخة الاحتياطية متاحة للاستعادة عند الحاجة:
  - `D:\ArkanBackups\arkan_crm-20261109-034452.dump`
- لم يُنفّذ `ANALYZE` إضافي بعد إنشاء الفهارس؛ PostgreSQL سيحدّث الإحصاءات تدريجيًا. يمكن تشغيله لاحقًا كعملية صيانة منفصلة عند الحاجة.
- لم تُطبّق أي من هذه الفهارس على بيئة إنتاج خارجية.

---

## 7. تأكيدات السلامة

- التغيير الوحيد على `arkan_crm` هو تطبيق migration الفهارس الإضافية.
- لا تغييرات schema أخرى، ولا تعديل بيانات.
- لا `.env`، ولا migrations إضافية، ولا seeds/resets.
- لا commits أو pushes.

**متوقف للمراجعة اليدوية.**
