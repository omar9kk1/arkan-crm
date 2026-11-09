# تفعيل هيكل OWNER / MANAGER / EMPLOYEE على قاعدة `arkan_crm` الحقيقية

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**الهدف:** تفعيل الهيكل الثلاثي على قاعدة التطوير الحقيقية مع نسخة احتياطية موثقة، والحفاظ على كل بيانات الأعمال.  
**الحالة:** **ناجح** — قاعدة `arkan_crm` مُفعّلة، الحساب الوحيد النشط أصبح `OWNER`، والـbackend/الـfrontend يعملان.

> لم تُجرَ أي إعادة تعيين أو seed أو حذف لبيانات الأعمال.  
> لم تُعدّل `.env` أو `.env.local`.  
> لا commits ولا pushes — `HEAD=d43cae5`.  
> لم يبدأ أي عمل على إعادة تصميم تبويب Managers/Employees.

---

## 1. التحقق المسبق (Preflight)

| البند | النتيجة |
|---|---|
| قاعدة البيانات | **`arkan_crm`** على `localhost:5433` |
| السيرفر | PostgreSQL **16.15** داخل Docker `arkan-crm-postgres-1` (postgres:16) |
| التطبيق | `NODE_ENV=development`، **cookie auth**، `COOKIE_SECURE=false`، origin `http://localhost:3001` |
| Migrations قبل | **19 مطبّقة**، **3 معلّقة** |
| مديرو النظام | **مدير واحد نشط فقط** — لا يوجد غموض |
| الموظفون | 2 موظفين |
| بيانات أساسية | User=3، Property=4، Client=0، Contact=1، FileAsset=5، EmployeeProfile=2 |
| الصور | `%USERPROFILE%\.arkan-crm\storage\property-images` — **7 ملفات / 3,438,788 بايت** |
| الـbackend | كان يعمل كـunmanaged listener؛ أُوقف قبل الترحيل فقط |

**مراجعة الـmigrations الثلاثة:** كلها additive:
1. إضافة قيمة `OWNER` إلى enum الدور.
2. أعمدة `authVersion` بقيمة افتراضية 0، `EmployeeProfile.managerUserId` nullable + index/FK، جدول `ManagerCapability` + enum + unique/index/FK.
3. Trigger إبطال الجلسات عند تغيير الدور/التعطيل (`DROP TRIGGER IF EXISTS` فقط لتعريفاته، لا حذف بيانات).

لا توجد عمليات `DROP TABLE` أو `TRUNCATE` أو `DELETE` أو تغيير أعمدة قائمة بشكل هدّام.

---

## 2. النسخة الاحتياطية — تم التحقق منها

**المسار (خارج Git، وصول مقيد للمستخدم الحالي وSYSTEM):**
`D:\ArkanBackups\owner-hierarchy-20261108-034605`

| العنصر | النتيجة |
|---|---|
| ملف القاعدة | `arkan_crm.dump` — **284,312 بايت** |
| SHA-256 للـdump | `8B530D170D21636890068BD41F2921C090C13686A571364A5583BCA2BFDC76CC` |
| `pg_restore --list` | ناجح — 285 مدخلًا |
| استعادة إلى DB مؤقتة | ناجحة — كل الأعداد مطابقة (User 3 / Property 4 / Client 0 / Contact 1 / FileAsset 5 / EmployeeProfile 2) |
| تاريخ migrations في النسخة المستعادة | 19 — مطابق للمصدر |
| صور | 7 ملفات / 3,438,788 بايت — نسخة كاملة |
| SHA-256 لمانيفست الصور | `2A2E3F5DD84DAEC05631B15BC915EB77826BE3EB0FE875CFDF625631244B5DFD` |
| فحص صور | العدد/الحجم/SHA-256 مطابق للمصدر |
| التعليمات | `RESTORE.txt` داخل مجلد النسخة |

**لم تُستبدل النسخة الاحتياطية.** لم تُطبع كلمات مرور أو tokens أو بيانات شخصية.

---

## 3. تطبيق Migrations

- أُوقف **الـbackend فقط** (PID 15308) قبل الترحيل.
- استُخدم:
  ```powershell
  cd apps\backend
  npx prisma migrate deploy
  ```
- لم يُستخدم `migrate dev` أو `reset` أو `db push` أو `seed`.

| قبل | بعد |
|---|---|
| 19 applied / 3 pending | **22 applied / 0 pending** |

الترحيلات الثلاثة المطبّقة:
- `20261108090000_add_owner_role`
- `20261108090100_owner_hierarchy`
- `20261108090200_auth_revocation_triggers`

**التحقق بعد الترحيل:**
- enum Role: `MANAGER, EMPLOYEE, OWNER`.
- `User.authVersion` و`RefreshToken.authVersion`: Integer NOT NULL DEFAULT 0.
- `EmployeeProfile.managerUserId`: UUID nullable.
- جدول `ManagerCapability` موجود، **0 صفوف** (الافتراضي false).
- `User_auth_version_on_change` و`User_revoke_sessions_on_change` موجودان.
- `authVersion=0` لكل المستخدمين قبل الترقية.
- **0 موظفين معيّنين** (كل الموجودين غير معيّنين، مرئيون للمالك فقط).
- الأعداد بعد الترحيل مطابقة تمامًا لما قبلها.

### مطابقة الصفوف (Row Checksums)
تمت مقارنة checksums بين النسخة الاحتياطية المستعادة والقاعدة الحية:

| الجدول | النتيجة |
|---|---|
| Property | مطابق |
| Contact | مطابق |
| FileAsset | مطابق |
| EmployeeProfile | مطابق |
| Client | مطابق (فارغ) |
| User | مطابق قبل الترقية؛ تغيّر لاحقًا فقط بسبب `role=OWNER` و`authVersion` المقصودين |

---

## 4. ترقية الحساب إلى OWNER

- تم تشغيل السكربت **dry-run** أولًا:
  ```powershell
  node --env-file=apps/backend/.env apps/backend/prisma/promote-owner.cjs
  ```
- النتيجة: **مرشح واحد فقط**، لا غموض. تم التحقق من تطابق الـID مع Preflight.
- ثم:
  ```powershell
  node --env-file=apps/backend/.env apps/backend/prisma/promote-owner.cjs --email <owner-email> --apply --confirm
  ```

| البند | النتيجة |
|---|---|
| الحساب | الحساب الوحيد النشط، معروض في التقرير بصيغة مقنّعة `m***@arkan.test` |
| User ID | **لم يتغيّر** |
| Email / Name / Password Hash | **لم تتغيّر** (تمت مقارنة hash كلمة المرور قبل/بعد) |
| Role | `MANAGER` → **`OWNER`** |
| `authVersion` | 0 → **1** |
| Refresh tokens النشطة قبل | 83 |
| Refresh tokens النشطة بعد | **0** |
| Audit | صف `OWNER_PROMOTE` أُضيف |
| User count | 3 → 3 (لم يُنشأ حساب بديل) |
| ManagerCapability | 0 صفوف |
| Employees assigned | 0 |

**الجلسات القديمة أُبطلت بالكامل، ويلزم login جديد.**

---

## 5. إعادة التشغيل والتحقق

### الخدمات
- Backend: `npm run backend:start` — **RUNNING/healthy** على `4001`.
- Frontend: `npm run dev:frontend` — **READY** على `3001`.
- `/health` = `200`، `/auth/me` بدون جلسة = 401 (متوقع).

### تسجيل الدخول الجديد (OWNER)
- `POST /auth/login` = 200، والدور **OWNER**.
- لا tokens في جسم الاستجابة.
- access cookie: **HttpOnly**، `SameSite=Lax`، `Path=/`.
- refresh cookie: **HttpOnly**، `SameSite=Lax`، `Path=/auth`.
- CSRF cookie: قابل للقراءة (ليس HttpOnly)، `Path=/`.
- `/auth/me`: `role=OWNER`، `approveProperties=true`، `rejectProperties=true`.
- `/employees`: **2 موظفين غير معيّنين**، بدون المدير المرقّى (أصبح OWNER)، و`/managers` = 0.
- `/properties`: عقار نشط واحد `P-000001` مع `A-000001`، وTrash=3.
- `/clients` = 0، `/contacts` = 1.
- صورة عقار عبر API = 200، `image/jpeg`، `Cache-Control: private, no-store`، `nosniff`.

### Browser Smoke (قراءة فقط)
- OWNER logged in via cookie/CSRF.
- لوحة `/manager`: عقارات 1، موظفون 2، مالك 1.
- `/manager/employees`: «إدارة الفرق والصلاحيات» و«إضافة موظف» ظاهران، «لا يوجد مديرون بعد»، والموظفان غير معيّنين.
- `/manager/trash`: 3 عقارات محذوفة (P-000002/3/4) بلا أي إجراء.
- لم يُنشأ/يُعتمد/يُرفض/يُحذف أي سجل أعمال.

### CSP وRate Limiting
- CSP محليًا: **Report-Only** — الرأس `Content-Security-Policy-Report-Only` موجود، ولا يوجد `Content-Security-Policy` مفروض.
- `script-src 'self'` بدون `unsafe-inline` في الرأس.
- Production build + CSP manifest: 27 route / 29 hash / رأس 2055B، و`csp:verify` ناجح.
- Rate limiting: 61 طلبًا متتاليًا إلى `/auth/csrf` أعاد **429** مع `Retry-After: 60` — الحماية تعمل (اختبار محدود غير هدّام).

### إصلاح صغير ضروري لتسجيل الدخول
أثناء الـbrowser smoke ظهر سباق بين طلبي `/auth/csrf` متزامنين، ما سبب 403 أول تسجيل دخول. أُصلح بتوحيد الطلب الجاري (in-flight promise) في:
`apps/frontend/features/auth/api/auth-api.ts`

- إعادة تسجيل الدخول عبر المتصفح نجحت بعد الإصلاح.
- `typecheck` و`lint` و`build` و`csp:verify`: ناجحة.
- لا تغيير في واجهة أو سلوك أعمال آخر.

---

## 6. سلامة البيانات النهائية

| العنصر | قبل | بعد |
|---|---|---|
| Users | 3 | 3 |
| Properties | 4 | 4 |
| Clients | 0 | 0 |
| Contacts | 1 | 1 |
| FileAsset | 5 | 5 |
| EmployeeProfile | 2 | 2 |
| AuditLog | 275 | 276 (إضافة OWNER_PROMOTE فقط) |
| P-codes | 4 | 4 |
| approvedReference A-* | 1 | 1 |
| Trash | 3 | 3 |
| Storage images | 7 / 3,438,788B | 7 / 3,438,788B |

- P/A numbering، duplicate prevention، المالك المؤقت، Trash والصور: لم تتغيّر.
- الصور لم تُعدّل؛ نسخة احتياطية كاملة ومطابقة بالـchecksums.
- لا بيانات أعمال جديدة أو محذوفة.

---

## 7. المتبقي / ملاحظات

1. **لا يوجد مديرون حاليًا** بعد ترقية المدير الوحيد إلى OWNER. أي مدير يُنشأ لاحقًا يحصل على صلاحيات اعتماد/رفض **معطلة افتراضيًا** حتى يمنحها المالك.
2. **الموظفان الحاليان غير معيّنين** لأي مدير؛ المالك يراهما، والمديرون الجدد لن يروهما حتى يتم تعيينهما.
3. 3 عقارات ما زالت في Trash؛ لم يُتخذ أي إجراء عليها.
4. Backup موجود في `D:\ArkanBackups\owner-hierarchy-20261108-034605` مع `RESTORE.txt` وتعليمات الاستعادة.
5. الـbackend والـfrontend يعملان الآن؛ لا حاجة لإعادة التشغيل.
6. لم يبدأ عمل إعادة تصميم تبويب Managers/Employees.

---

## 8. الحالة النهائية

- **قاعدة `arkan_crm`:** 22 migrations مطبّقة، `OWNER` موجود، triggers الجلسات فعالة.
- **الحساب:** الحساب الوحيد النشط أصبح `OWNER` مع الحفاظ على ID/email/password/history، وجلساته القديمة مُبطلة.
- **البيانات:** جميع السجلات والصور وP/A سليمة ومطابقة بالـchecksums.
- **الخدمات:** Backend 4001 healthy، Frontend 3001 ready.
- **Git:** لا تغييرات تاريخية، لا commits/pushes.
- **التوقف هنا** — لا بدء لأي عمل إضافي على تبويب Managers/Employees.
