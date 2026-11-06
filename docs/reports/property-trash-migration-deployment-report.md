# تقرير: تطبيق migration سلة محذوفات العقارات على قاعدة التطوير

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** تم التطبيق والتحقق بنجاح — بانتظار المراجعة اليدوية  

---

## 1. بيئة قاعدة البيانات المؤكَّدة

| العنصر | القيمة |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` (من `apps/backend/.env`) | `postgresql://postgres:***@localhost:5433/arkan_crm?schema=public` |
| قاعدة البيانات | `arkan_crm` |
| خادم PostgreSQL | PostgreSQL 16.15 (Debian) |
| العنوان داخل الحاوية | `127.0.0.1:5432` (منفذ المضيف 5433) |
| الحاوية | `arkan-crm-postgres-1` |
| الخلفية | تعمل على المنفذ 4001 |
| الواجهة | تعمل على المنفذ 3001 |

تم التأكد أن القاعدة هي `arkan_crm` المحلية للتطوير، ولا توجد أي قاعدة production/staging/shared متصلة. لم تُطبع أي كلمات مرور.

> **ملاحظة تشغيلية:** Docker CLI على Windows أصبح غير مستجيب أثناء هذه المهمة. تم تنفيذ `pg_dump`/`psql`/التحقق عبر الدخول إلى WSL distro `docker-desktop` ثم `nsenter` إلى حاوية PostgreSQL. هذا لا يغيّر أي شيء في قاعدة البيانات، لكنه قيد تشغيلي موثّق.

---

## 2. النسخة الاحتياطية

**المسار:**
```
D:\Projects\arkan-crm-backups\trash-migration-20261104-031953\arkan_crm_before_trash_migration_20261104-031953.dump
```

| الخاصية | القيمة |
|---|---|
| الصيغة | PostgreSQL custom (`pg_dump -Fc`) |
| الحجم | 350,795 بايت (غير فارغ) |
| SHA256 | `8F291AFD77C52DC90C53EF17337F94A827A8407ACFBF70AACA4C1071544536F8` |
| التحقق | `pg_restore --list` قرأ 276 سطراً بنجاح |
| مطابقة النقل | SHA256 داخل الـ VM = SHA256 على المضيف ✅ |

**تعليمات الاستعادة:**
```powershell
# إلى قاعدة موجودة (يستبدل الكائنات):
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm --clean --if-exists <dump-file>

# أو إلى قاعدة فحص جديدة:
createdb -U postgres -h localhost -p 5433 arkan_crm_restore_check
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm_restore_check <dump-file>
```
(يتطلب `pg_restore` من إصدار PostgreSQL 16.)

تم إنشاء النسخة **قبل** أي تعديل.

---

## 3. حالة الـ migration

### قبل التطبيق
```
17 migrations found
Following migration have not yet been applied:
20261104120000_property_trash_and_tombstone
```
لا توجد أي migrations أخرى معلّقة.

### التطبيق
تم استخدام `prisma migrate deploy` (نفس مسار النشر المعتمد في المشروع) مع `DATABASE_URL` لقاعدة التطوير فقط.

```
Applying migration `20261104120000_property_trash_and_tombstone`
All migrations have been successfully applied.
```

### بعد التطبيق
`_prisma_migrations`:
```
20261104120000_property_trash_and_tombstone | 2026-11-04 01:21:26.768976+00
```
أحدث سجل ناجح، ولا توجد migrations معلّقة.

**لم يُستخدم:** `migrate reset`، `db push`، sync تدميري، seeds، أو cleanup.

---

## 4. التحقق من المخطط

### Property
| العمود | النوع | Nullable |
|---|---|---|
| `deletedAt` | timestamp | نعم |
| `deletedByUserId` | uuid | نعم |
| `deletionReason` | text | نعم |

### PropertyTombstone
| العمود | النوع | Nullable |
|---|---|---|
| `id` | uuid | لا (PK) |
| `reference` | text | لا (UNIQUE) |
| `deletedByUserId` | uuid | نعم |
| `deletedAt` | timestamp | لا (default now) |
| `summary` | jsonb | نعم |

### الفهارس
- `PropertyTombstone_reference_key` (UNIQUE)
- `PropertyTombstone_deletedAt_idx`
- `Property_deletedAt_idx`

### المفاتيح الخارجية
- `Property_deletedByUserId_fkey` → `User(id)` `ON DELETE RESTRICT ON UPDATE CASCADE`
- `PropertyTombstone_deletedByUserId_fkey` → `User(id)` `ON DELETE RESTRICT ON UPDATE CASCADE`

كل ما سبق تم التحقق منه عبر `information_schema` و`pg_indexes` و`pg_constraint`.

---

## 5. التحقق من عدم تغيّر البيانات

### العقارات
| reference | status | block | plot | size | floors | price | contactId | createdByUserId | version | deletedAt |
|---|---|---|---|---|---|---|---|---|---|---|
| A-000001 | PENDING | 8 | 22 | 300.00 | 4 | 350.00 | aac3cdcd… | 1f040211… | 1 | **NULL** |
| A-000003 | PENDING | 9 | 22 | 300.00 | 4 | 400.00 | 974957bc… | ab2b3744… | 1 | **NULL** |

- **A-000001 وA-000003 لم يتغيّرا**: نفس المعرّف، الكود، الحالة، الموقع، القطعة/القسيمة، المساحة، السعر، جهة التواصل، المُنشئ، والإصدار.
- **لا يوجد أي عقار في Trash** (`deletedAt IS NOT NULL` = 0).
- **لا يوجد أي tombstone** = 0.

### العدّادات
| الكيان | العدد |
|---|---|
| User | 3 |
| Contact | 3 |
| Property | 2 |
| PropertyApprovalRequest | 2 |
| PropertyFloor | 10 |
| Notification | 2 |
| FollowUp | 0 |
| FollowUpSubject | 0 |
| AuditLog | 109 |

### الحسابات
- `employee@arkan.test` (EMPLOYEE, active)
- `manager@arkan.test` (MANAGER, active)
- `omar9kkomar@gmail.com` (EMPLOYEE, active)

### طلبات الاعتماد
- A-000001: PENDING، `duplicateCandidateIds = null`
- A-000003: PENDING، `duplicateCandidateIds = null`

لم يُنشأ أو يُحذف أي سجل تجاري بواسطة هذا التطبيق.

---

## 6. الخلفية وواجهات API

الخلفية تعمل على `localhost:4001`، وتستخدم Prisma Client المولَّد للمخطط الجديد (بدليل نجاح استعلامات `deletedAt` أدناه).

| الفحص | النتيجة |
|---|---|
| `GET /properties/trash` (Manager) | **200** — `items: []` |
| `GET /properties?limit=5` (Manager) | **200** — A-000003, A-000001 |
| `GET /properties/trash` (Employee) | **403** |
| `POST /properties/<random-uuid>/trash` (Manager) | **404** «Property not found» |
| `POST /properties/<random-uuid>/restore` (Manager) | **404** «Property not found» |
| `DELETE /properties/<random-uuid>/permanent` (Manager) | **404** «Property not found» |

النتائج 404 من داخل الـ handlers (رسالة «Property not found») تُثبت أن المسارات الثلاثة **مسجّلة**، دون أي تعديل على بيانات حقيقية. لم يُنفَّذ أي delete/restore/permanent فعلي.

---

## 7. التحقق من الواجهة (Runtime)

تم فتح `/manager/properties` فعلياً في المتصفح:

- تبويب **«سلة المحذوفات»** ظاهر (العدد 0).
- عند فتح التبويب: رسالة **«سلة المحذوفات فارغة.»** تظهر بشكل صحيح.
- **لا أخطاء console** ولا HTTP 500.
- القائمة العادية تعمل: 2 عقارات، 2 بانتظار الموافقة.
- فتح درج A-000003 يعمل ويعرض «الموقع» و«الأدوار وتفاصيل المبنى» دون أخطاء.
- صفحة عقارات الموظف `/employee/properties` تعمل، وتعرض A-000001 تحت المراجعة.

**ملاحظة:** لم يتم فتح لقطة شاشة بالبكسل (نافذة سطح المكتب غير مرئية)؛ التحقق تم عبر DOM + النص الفعلي + استدعاءات API.

---

## 8. الأخطاء والقيود المتبقية

1. **Docker CLI على Windows غير مستجيب** — تم تجاوزه عبر WSL/nsenter. المشكلة تشغيلية وليست متعلقة بقاعدة البيانات.
2. **الـ migration أحادي الاتجاه**؛ ملف الـ migration يحتوي SQL يدوي للـ rollback (إسقاط الجدول/القيود/الأعمدة).
3. **لم يُختبر حذف/استعادة/حذف نهائي فعلي** على قاعدة التطوير (حماية للبيانات)؛ تم التحقق منها سابقاً باختبارات تكامل على قاعدة الاختبار المعزولة (11/11).
4. **النسخ الاحتياطية** قد تحتفظ بالبيانات حتى انتهاء مدة الاحتفاظ.
5. لا commits أو pushes؛ العمل غير المُودَع محفوظ.

---

## 9. حالة التنفيذ النهائية

- ✅ بيئة التطوير مؤكدة.
- ✅ نسخة احتياطية كاملة ومتحقَّق منها.
- ✅ الـ migration المطلوب فقط تم تطبيقه.
- ✅ المخطط والفهارس والمفاتيح الخارجية صحيحة.
- ✅ A-000001 وA-000003 والبيانات الأخرى سليمة.
- ✅ الخلفية والـ API تعمل، وصول الموظف للسلة مرفوض (403).
- ✅ واجهة المدير تعرض السلة الفارغة دون أخطاء.
- ✅ لا حذف/استعادة/حذف نهائي فعلي.

**متوقف للمراجعة اليدوية.**
