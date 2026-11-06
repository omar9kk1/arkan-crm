# تقرير: تفعيل ترقيم P/A وبدء بيانات التطوير من الصفر

**التاريخ:** 2026-11-05  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** تم التنفيذ والتحقق — بانتظار المراجعة اليدوية  

---

## 1. هوية قاعدة البيانات المؤكَّدة

| العنصر | القيمة |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` | `postgresql://postgres:***@localhost:5433/arkan_crm?schema=public` |
| قاعدة البيانات | `arkan_crm` |
| الخادم | PostgreSQL 16.15 (Debian) |
| الحاوية | `arkan-crm-postgres-1` |
| الخلفية | `localhost:4001` (health 200) |
| الواجهة | `localhost:3001` |

تم التأكد أن الهدف هو قاعدة التطوير المحلية فقط. لم تُلمس أي قاعدة production/staging.

---

## 2. النسخة الاحتياطية

**قاعدة البيانات:**
```
D:\Projects\arkan-crm-backups\pa-clean-start-20261105-025217\arkan_crm_before_pa_clean_start_20261105-025217.dump
```
- الحجم: **362,269 بايت** (غير فارغ).
- SHA256: `9A52A4F2CCD2DF7A72827FF826DEC5B4971512E7478400AA507374D5265F2EAE`.
- التحقق: `pg_restore --list` قرأ **284 TOC entry**، وSHA256 داخل الـ VM = على المضيف ✅.

**الصور:**
```
D:\Projects\arkan-crm-backups\pa-clean-start-20261105-025217\property-images\
  a74319fd-667b-4cf6-bdae-de24d7bb81bc.png
  af3c00b0-dc8a-486b-b553-9d90b10437cd.png
```
- نسختان بحجم 3,098,253 بايت لكل منهما، SHA256 `9CF29E…763A`.

**الاستعادة:** `pg_restore -U postgres -h localhost -p 5433 -d arkan_crm --clean --if-exists <dump>`.

---

## 3. العدّادات قبل وبعد

| الكيان | قبل | بعد |
|---|---|---|
| User | 3 | **3** |
| EmployeeProfile | 2 | **2** |
| Property | 2 (كلاهما في Trash) | **0** |
| PropertyTrash | 2 | **0** |
| PropertyFloor | 9 | **0** |
| PropertyApprovalRequest | 2 | **0** |
| PropertyRevision | 0 | 0 |
| FileAsset | 2 | **0** |
| PropertyTombstone | 0 | 0 |
| Contact / Owner / Client | 0 | 0 |
| Notification | 3 | **0** |
| FollowUp / FollowUpSubject | 0 | 0 |
| Deal / Commission / Expenses | 0 | 0 |
| AuditLog | 68 | **0** |
| `PropertyCodeSequence` id=1 (A) | 3 | **0** |
| `PropertyCodeSequence` id=2 (P) | لم يكن موجوداً | **0** |

**إجمالي الصفوف التجارية المحذوفة:** 86 صفاً (3 إشعارات، 2 طلب اعتماد، 9 أدوار، 2 ملف، 2 عقار، 68 سجل تدقيق).

---

## 4. الـ migration

- تم تطبيق **`20261104160000_property_pa_numbering`** فقط.
- النتيجة: `approvedReference` (text, nullable) + فهرس فريد `Property_approvedReference_key` + صف تسلسل P (id=2).
- `_prisma_migrations` يسجّل:
  ```
  20261104160000_property_pa_numbering | 2026-11-05 00:53:42 UTC
  ```
- المخطط وقاعدة البيانات متزامنان، ولا توجد migrations أخرى معلّقة.

---

## 5. التنظيف والملفات

- حُذفت كل البيانات التجارية بترتيب المفاتيح الخارجية الحقيقي داخل معاملة واحدة (بدون `TRUNCATE CASCADE` أو `migrate reset`).
- حُذفت الصور الفيزيائية التجريبية بعد نجاح الحذف؛ مجلد التخزين أصبح فارغاً.
- لم يُحذف أي مستخدم أو كلمة مرور أو دور أو EmployeeProfile أو إعداد نظام أو سجل migration.

---

## 6. الحالة النهائية للعدّادات

```
id = 1 (A) -> 0   => أول اعتماد ناجح = A-000001
id = 2 (P) -> 0   => أول إرسال ناجح  = P-000001
```
- لا توجد خاصية أو tombstone أو مرجع يحجز أي كود.
- لم يُنشأ أي عقار في قاعدة التطوير لإثبات الترقيم؛ الترقيم مُثبت باختبارات معزولة.

---

## 7. إعادة التشغيل والتحقق

- أُعيد توليد Prisma Client ثم أُعيد تشغيل الخلفية: **health 200**.
- أُعيد تشغيل الواجهة على `localhost:3001`.
- تسجيل الدخول: Manager = **200**، Employee = **200** (نفس كلمات المرور الحالية).
- قراءة فقط:
  - `GET /properties` (Manager) = 200، **0** عناصر.
  - `GET /properties/trash` (Manager) = 200، **0**.
  - `GET /notifications` (Manager) = 200، **0**.
  - `GET /clients/stats` = 200، كل القيم **0**.
  - `GET /properties/trash` (Employee) = **403**.
- صفحات المتصفح: عقارات المدير فارغة، سلة المحذوفات «فارغة»، إشعارات المدير فارغة، عقارات الموظف فارغة — **بلا أخطاء console**.

---

## 8. الاختبارات والفحوصات

| الفحص | النتيجة |
|---|---|
| `property-codes.spec.ts` + `notifications` + `employee-decision-notifications` + `property-trash` + `property-owner-lifecycle` + `property-duplicate-priority` | **78/78** |
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| ESLint (ملفات P/A المعدلة) | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |

اختبارات P/A تغطي: أول P، تسلسل P، أول A عند الاعتماد، الرفض لا يستهلك A، 409 لا يستهلك أي عدّاد، التزامن، فشل الاعتماد، التكرار المحتمل، Trash/Restore، والبحث بالكود A.

---

## 9. الحسابات المحفوظة

- `manager@arkan.test` — MANAGER — active.
- `employee@arkan.test` — EMPLOYEE — active.
- `omar9kkomar@gmail.com` — EMPLOYEE — active.
- كلمات المرور لم تُعدَّل، والجلسات الحالية محفوظة (RefreshToken).

---

## 10. ملاحظات
- لم يُنشأ أي عقار تجريبي في قاعدة التطوير؛ التحقق من الترقيم تم على قاعدة الاختبار المعزولة.
- لا commits أو pushes.
- الخلفية والواجهة تعملان الآن على قاعدة التطوير النظيفة.

**متوقف للمراجعة اليدوية.**
