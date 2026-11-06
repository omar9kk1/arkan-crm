# تقرير: تطبيق migration المالك المؤقت (Proposed Owner) على قاعدة التطوير

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** تم التطبيق والتحقق بنجاح — بانتظار المراجعة اليدوية  

---

## 1. تأكيد البيئة

| العنصر | القيمة |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` | `postgresql://postgres:***@localhost:5433/arkan_crm?schema=public` |
| قاعدة البيانات | `arkan_crm` |
| الخادم | PostgreSQL 16.15 (Debian) |
| العنوان | `127.0.0.1:5432` داخل الحاوية / المنفذ `5433` على المضيف |
| الحاوية | `arkan-crm-postgres-1` |
| الواجهة | `localhost:3001` |
| الخلفية | `localhost:4001` (`/health` = 200) |

تم التأكد أن الهدف هو قاعدة التطوير المحلية فقط، ولا توجد production/staging/shared. لم تُطبع كلمات المرور.

---

## 2. النسخة الاحتياطية

**المسار:**
```
D:\Projects\arkan-crm-backups\proposed-owner-migration-20261104-150225\arkan_crm_before_proposed_owner_20261104-150225.dump
```

| الخاصية | القيمة |
|---|---|
| الصيغة | PostgreSQL custom (`pg_dump -Fc`) |
| الحجم | 359,193 بايت (غير فارغ) |
| SHA256 | `2458F6F55D932EE05312C0CBB3DBEA85785F2FA6ED52F68B956761AC96F8F3A8` |
| مطابقة النقل | SHA256 داخل الـ VM = SHA256 على المضيف ✅ |
| التحقق | `pg_restore --list` قرأ 284 TOC entry بنجاح |

**تعليمات الاستعادة:**
```powershell
# استعادة إلى قاعدة موجودة (يستبدل الكائنات):
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm --clean --if-exists <dump-file>

# أو إلى قاعدة فحص جديدة:
createdb -U postgres -h localhost -p 5433 arkan_crm_restore_check
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm_restore_check <dump-file>
```

---

## 3. حالة الـ migration

### قبل التطبيق
```
18 migrations found
Following migration have not yet been applied:
20261104130000_property_proposed_owner
```
لا توجد migrations أخرى معلّقة. ملف الـ migration **إضافي فقط**:
```sql
ALTER TABLE "Property" ADD COLUMN "proposedOwner" JSONB;
-- rollback: ALTER TABLE "Property" DROP COLUMN "proposedOwner";
```

### التطبيق
`prisma migrate deploy` (مسار النشر المعتمد) مع `DATABASE_URL` لقاعدة التطوير:
```
Applying migration `20261104130000_property_proposed_owner`
All migrations have been successfully applied.
```

### بعد التطبيق
`_prisma_migrations`:
```
20261104130000_property_proposed_owner      | 2026-11-04 13:03:11.859532+00
20261104120000_property_trash_and_tombstone | 2026-11-04 01:21:26.768976+00
```

لم يُستخدم `migrate reset` ولا `db push` ولا seeds ولا cleanup.

---

## 4. التحقق من المخطط

| العنصر | النتيجة |
|---|---|
| `Property.proposedOwner` | `jsonb`، Nullable ✅ |
| `Property.contactId` | بقي Nullable كما هو (لم تُغيَّر العلاقة) |
| القيود/الفهارس الحالية | لم تُمسّ |
| `PropertyTrash` / `PropertyTombstone` | لم تُمسّ |

---

## 5. البيانات قبل وبعد (متطابقة)

| الكيان | قبل | بعد |
|---|---|---|
| User | 3 | 3 |
| Contact | 3 | 3 |
| Property | 2 | 2 |
| PropertyApprovalRequest | 2 | 2 |
| PropertyFloor | 10 | 10 |
| Notification | 2 | 2 |
| FollowUp | 0 | 0 |
| FollowUpSubject | 0 | 0 |
| PropertyTombstone | 0 | 0 |
| AuditLog | 125 | 125 |

### A-000001 وA-000003
| reference | status | block | plot | price | contactId | version | in_trash | proposedOwner |
|---|---|---|---|---|---|---|---|---|
| A-000001 | PENDING | 8 | 22 | 350 | aac3cdcd… | 1 | نعم | NULL |
| A-000003 | PENDING | 9 | 22 | 400 | 974957bc… | 1 | نعم | NULL |

- الحالة **PENDING** كما هي، والكود والبيانات والمالك لم تتغير.
- كلاهما موجود في **سلة المحذوفات** (Soft delete سابق بواسطة المدير) — لم أُعدّلهما.
- `proposedOwner` غير مضبوط على أي سجل قديم (0 صفوف) — الـ migration لم يغيّر أي بيانات.
- جهات التواصل الثلاث باقية كما هي (بما فيها السجل اليتيم `c8bc8db0`).
- طلبات الاعتماد لم تتغير.

---

## 6. الخلفية وواجهات API

- أُعيد توليد Prisma Client ثم أُعيد تشغيل الخلفية عبر `backend:start` → **healthy (HTTP 200)**.
- فحوصات قراءة فقط (Manager):
  | الطلب | النتيجة |
  |---|---|
  | `GET /properties?limit=100` | 200 (items فارغة لأن العقارين في Trash) |
  | `GET /properties/trash` | 200 — A-000001, A-000003 |
  | `GET /contacts?limit=100` | 200 — 3 مالكين |
  | `GET /clients/stats` | 200 — `owners: 3` (لم يتغيّر) |
- الموظف: `GET /properties/trash` → **403**.
- لا أخطاء 500 في أي من الطلبات.

---

## 7. التحقق من الواجهة (Runtime)

- صفحة `manager/properties` تعمل، وتبويب **سلة المحذوفات** ظاهر.
- سلة المحذوفات تعرض **A-000001 وA-000003** مع تاريخ الحذف واسم المدير وأزرار الاستعادة/الحذف النهائي.
- لا أخطاء console.
- صفحة `employee/properties` تعمل (A-000001 في Trash، لذا لا يظهر ضمن النشط).
- لم يُنفَّذ أي حذف/استعادة/حذف نهائي/إنشاء/اعتماد/رفض على قاعدة التطوير.

---

## 8. الاختبارات المعزولة (Isolated Test DB)

```
property-owner-lifecycle.spec.ts
contacts.spec.ts
properties.spec.ts
property-duplicate-priority.spec.ts
property-trash.spec.ts
duplicate-comparison.spec.ts
→ 6 suites passed, 111 tests passed
```

تغطي: المالك المؤقت، عدم إنشاء Contact قبل الاعتماد، رؤية المدير، الترقية/إعادة الاستخدام، الرفض وطلب التعديل، عدم تكرار المالك، الخصوصية، رفض التكرار، Trash/الحذف النهائي.

---

## 9. تنظيف تاريخي مطلوب (بدون تنفيذ)

البيانات القديمة أُنشئت قبل الإصلاح ولم تُعدّل:

1. **`c8bc8db0-ab5b-486c-8828-349c599023ed`** — «ابو مكه / 01044114889» — **0 عقارات** (بقايا A-000002 المحذوف). تكرار مؤكد مع `aac3cdcd` (نفس الهاتف).
2. **`aac3cdcd-c1ca-415f-9f69-4b9e3b9be630`** — مربوط بـ A-000001 (PENDING + Trash).
3. **`974957bc-c8d2-4778-807f-3a70edcd737f`** — مربوط بـ A-000003 (PENDING + Trash)، هاتفه مختلف.

**الاقتراح (يتطلب موافقة منفصلة):**
- الاحتفاظ بـ `aac3cdcd` وحذف `c8bc8db0` اليتيم فقط، بعد التأكد من عدم وجود مراجع أخرى.
- A-000001/A-000003: إن أُعيدا واعتُمدا، تصبح جهات التواصل الحالية رسمية؛ إن حُذفا نهائياً تُعالج جهات التواصل يدوياً (لن تُحذف تلقائياً).
- لا دمج بالاسم وحده؛ الهاتف هو المفتاح.

---

## 10. ملاحظات وقيود

- `Property.contactId` كان Nullable أصلاً، لذا لم يُحتَج لتغيير العلاقة.
- الخلفية كانت متوقفة قبل التطبيق (لإعادة توليد Prisma Client) وأُعيد تشغيلها بنجاح بعده.
- Docker CLI على Windows غير مستجيب؛ تم تنفيذ النسخ الاحتياطي/التحقق عبر WSL/nsenter. لا تأثير على البيانات.
- لم تُجرَ أي تغييرات على كود Trash أو الحذف النهائي أو كشف التكرار.
- لا commits ولا pushes.

---

## 11. الحالة النهائية

- ✅ البيئة مؤكدة (`arkan_crm` محلي).
- ✅ نسخة احتياطية كاملة ومتحقَّق منها.
- ✅ الـ migration المعتمد فقط طُبِّق.
- ✅ `proposedOwner` موجود، والبيانات القائمة لم تتغير.
- ✅ الخلفية صحية، وواجهات Manager/Employee تعمل، ولا 500.
- ✅ 111/111 اختبار معزول ناجح.
- ⏸️ تنظيف السجلات التاريخية لم يُنفَّذ (بانتظار موافقة منفصلة).

**متوقف للمراجعة اليدوية.**
