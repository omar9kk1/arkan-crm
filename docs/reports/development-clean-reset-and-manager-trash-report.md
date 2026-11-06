# تقرير: إعادة ضبط بيانات التطوير + صفحة المحذوفات المخصصة للمدير

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** تم التنظيف والتحقق وإنشاء الصفحة — بانتظار المراجعة اليدوية  

---

## 1. بيئة قاعدة البيانات المؤكَّدة

| العنصر | القيمة |
|---|---|
| `NODE_ENV` | `development` |
| `DATABASE_URL` | `postgresql://postgres:***@localhost:5433/arkan_crm?schema=public` |
| قاعدة البيانات | `arkan_crm` |
| خادم PostgreSQL | PostgreSQL 16.15 (Debian) |
| العنوان | `127.0.0.1:5432` داخل الحاوية / `5433` على المضيف |
| الحاوية | `arkan-crm-postgres-1` |
| الخلفية | `localhost:4001` (`/health` = 200) |
| الواجهة | `localhost:3001` |

تم التأكد أن الهدف هو قاعدة التطوير المحلية فقط، ولا توجد production/staging/shared. لم تُطبع كلمات المرور.

---

## 2. النسخة الاحتياطية

**المسار:**
```
D:\Projects\arkan-crm-backups\dev-clean-reset-20261104-151456\arkan_crm_before_dev_clean_reset_20261104-151456.dump
```

| الخاصية | القيمة |
|---|---|
| الصيغة | PostgreSQL custom (`pg_dump -Fc`) |
| الحجم | 360,279 بايت (غير فارغ) |
| SHA256 | `2B9895CAEB67D55391B79E7F4F8C45D5DAB34B568E7A6106DAEAC4D3EC19F074` |
| مطابقة النقل | SHA256 داخل الـ VM = SHA256 على المضيف ✅ |
| التحقق | `pg_restore --list` قرأ 284 TOC entry بنجاح |

**نسخة الصور (قبل الحذف):**
```
D:\Projects\arkan-crm-backups\dev-clean-reset-20261104-151456\property-images\
  05c19969-6d0d-4836-b8a7-4889ef692f43.png
  2e887502-6756-4e6f-b94d-41fb1a1f26a9.png
```

**تعليمات الاستعادة:**
```powershell
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm --clean --if-exists <dump-file>
# أو إلى قاعدة فحص:
createdb -U postgres -h localhost -p 5433 arkan_crm_restore_check
pg_restore -U postgres -h localhost -p 5433 -d arkan_crm_restore_check <dump-file>
```

---

## 3. العدّادات قبل وبعد

| الكيان | قبل | بعد |
|---|---|---|
| User | 3 | 3 |
| EmployeeProfile | 2 | 2 |
| RefreshToken | 1502 | 1502 |
| PushSubscription | 1 | 1 |
| Setting | 0 | 0 |
| PropertyCodeSequence | 1 | 1 |
| PropertyTombstone | 0 | 0 |
| Property | 2 | **0** |
| PropertyApprovalRequest | 2 | **0** |
| PropertyFloor | 10 | **0** |
| FileAsset | 2 | **0** |
| Contact | 3 | **0** |
| Client | 0 | 0 |
| Owner | 0 | 0 |
| FollowUp | 0 | 0 |
| FollowUpSubject | 0 | 0 |
| FollowUpEntry | 0 | 0 |
| FollowUpReminder | 0 | 0 |
| ClientReviewRequest | 0 | 0 |
| ClientPropertyInterest | 0 | 0 |
| Deal / Commission / PayrollEntry | 0 | 0 |
| ManualExpense / FinanceMovement | 0 | 0 |
| AttendanceRecord | 0 | 0 |
| Notification | 2 | **0** |
| AuditLog | 131 | **0** |
| PropertyAssignment / Registrant / Revision / RequestedProperty | 0 | 0 |

**إجمالي الصفوف التجارية المحذوفة:** 152 صفاً (عقاران، طلبا اعتماد، 10 أدوار، 2 ملف، 3 جهات تواصل، إشعاران، 131 سجل تدقيق).

---

## 4. ما تم حذفه بالضبط

تم تنفيذ سكربت واحد داخل معاملة (`BEGIN … COMMIT`) بترتيب تبعيات المفاتيح الخارجية الحقيقي:

1. `FinanceMovement` → `Notification` → `Commission` → `Deal` → `PayrollEntry` → `ManualExpense`.
2. `FollowUpReminder` → `FollowUpEntry` → `FollowUp` → `FollowUpSubject`.
3. `ClientReviewRequest` → `ClientPropertyInterest`.
4. `PropertyRevision` → `PropertyApprovalRequest` → `PropertyRegistrant` → `PropertyAssignment` → `PropertyFloor` → `RequestedProperty`.
5. تحرير `Property.primaryImageId` ثم `FileAsset`.
6. `Property` → `Owner` → `Contact` → `Client`.
7. `AttendanceRecord` → `AuditLog`.

**لم يُستخدم** `TRUNCATE CASCADE` ولا `prisma migrate reset` ولا أي endpoint حذف إنتاجي.

---

## 5. الحسابات والإعدادات المحفوظة

- **3 مستخدمين** بنفس المعرّفات والأدوار وكلمات المرور (لم يُنفَّذ أي `DELETE/UPDATE` على `User`).
  - `manager@arkan.test` — MANAGER
  - `employee@arkan.test` — EMPLOYEE
  - `omar9kkomar@gmail.com` — EMPLOYEE
- **2 EmployeeProfile** محفوظان.
- `RefreshToken` (1502) و`PushSubscription` (1) محفوظة.
- `Setting` و`PropertyCodeSequence` و`PropertyTombstone` و`_prisma_migrations` محفوظة.
- لا تغيير على المخطط أو الـ migrations في هذه المهمة.

**تحقق تسجيل الدخول:** Manager = 200، Employee = 200.حساب كريم لم يُعدَّل؛ محاولة الدخول بكلمة المرور الافتراضية تُرجع 401 لأن كلمة مروره مختلفة (لم تُمسّ).

---

## 6. ملفات التخزين

- تم نسخ الصورتين التجاريتين احتياطياً أولاً.
- بعد نجاح الحذف، حُذف الملفان الفيزيائيان من:
  `C:\Users\omar9\.arkan-crm\storage\property-images\2026\11\`
- مجلد التخزين أصبح فارغاً.
- لم يُحذف أي شعار/أصول/كود/ملفات مشتركة (لا توجد داخل مجلد property-images).

---

## 7. تسلسل أكواد العقارات

- `PropertyCodeSequence.value = 3` (لم يُلمس).
- الأكواد الصادرة سابقاً: A-000001، A-000002 (حُذف يدوياً في مهمة سابقة)، A-000003.
- **الكود التالي المتوقع: `A-000004`** (وليس A-000001)، احتراماً لسياسة عدم إعادة الاستخدام.
- `PropertyTombstone` = 0.
- لم يُنفَّذ أي reset أو إعادة استخدام لكود.

---

## 8. صفحة المحذوفات المخصصة

### التغييرات
- عنصر تنقل جديد في الشريط الجانبي: **«المحذوفات»** → `/manager/trash` (أُضيف أيقونة `trash`).
- صفحة جديدة: `apps/frontend/app/manager/trash/page.tsx`.
- مكوّن جديد: `apps/frontend/features/manager-properties/components/manager-trash.tsx`.
- **أُزيل تبويب «سلة المحذوفات» من صفحة العقارات**، مع بقاء تبويبي «العقارات» و«تحت المراجعة» دون تغيير.
- زر «حذف إلى سلة المحذوفات» داخل درج العقار ما زال يعمل (نقل إلى Trash).

### محتوى الصفحة
- عنوان الصفحة: «المحذوفات».
- بحث بالكود أو الموقع.
- بطاقة لكل عقار: الكود، الموقع، تاريخ الحذف، اسم المدير الذي حذفه، سبب الحذف (إن وُجد)، زر استعادة، زر حذف نهائي.
- حالات: تحميل، خطأ مع إعادة المحاولة، فارغة → **«سلة المحذوفات فارغة»**.
- إعادة استخدام APIs الحالية: `GET /properties/trash`, `POST /:id/restore`, `DELETE /:id/permanent`.
- الحذف النهائي يتطلب كتابة كود العقار حرفياً في حوار منفصل.

### الأمان
- المسار محمي بـ `RequireRole(MANAGER)`.
- الخلفية تفرض `@Roles(Role.MANAGER)` على كل endpoints السلة.
- الموظف عند فتح `/manager/trash` يُعاد توجيهه إلى `/employee`.
- `GET /properties/trash` بالموظف → **403**.

---

## 9. التحقق من الحالة النظيفة (Runtime)

| الفحص | النتيجة |
|---|---|
| `GET /properties?limit=100` (Manager) | 200 — 0 |
| `GET /properties/trash` (Manager) | 200 — 0 |
| `GET /contacts?limit=100` (Manager) | 200 — 0 |
| `GET /clients?limit=100` (Manager) | 200 — 0 |
| `GET /clients/stats` (Manager) | 200 — كل القيم 0 (`owners: 0`) |
| `GET /properties/trash` (Employee) | **403** |
| `/health` | **200** |
| صفحة المحذوفات | تظهر، حالة فارغة، بحث موجود، بلا أخطاء console |
| صفحة عقارات المدير | فارغة، بلا تبويب سلة المحذوفات |
| صفحة العملاء (المدير) | 0 عملاء/ملاك/وسطاء، «أرقام فعلية من قاعدة البيانات» |
| صفحة المتابعات (المدير) | 0 ورسالة «لا توجد متابعات بعد» |
| لوحة الموظف | كل العدّادات 0 |
| صفحة عقارات الموظف | فارغة (تحت المراجعة 0) |

لا أخطاء HTTP 500، ولا أخطاء console في الصفحات المفحوصة.

> **ملاحظة:** لوحة المدير الرئيسية (`/manager`) هي صفحة معاينة تجريبية سابقة (بيانات ثابتة ومكتوب عليها «معاينة ببيانات تجريبية فقط»)، ولم تُربط ببيانات حقيقية. لم يتم تغييرها احتراماً لقيد «عدم إجراء refactor غير متعلق». الصفحات التجارية الفعلية (العقارات/العملاء/المتابعات/المحذوفات) تعرض أصفاراً حقيقية.

---

## 10. الاختبارات والبناء

### اختبارات معزولة (Test DB)
```
property-trash.spec.ts
property-owner-lifecycle.spec.ts
property-duplicate-priority.spec.ts
duplicate-comparison.spec.ts
properties.spec.ts
contacts.spec.ts
→ 6 suites passed, 111 tests passed
```

تشمل: Trash/الاستعادة/الحذف النهائي، دورة حياة المالك، كشف التكرار/التشابه، حماية الخصوصية. لم تُنشأ/تُحذف عقارات في قاعدة التطوير أثناء التحقق.

### Typecheck / Build / Lint
| الفحص | النتيجة |
|---|---|
| Backend `tsc --noEmit` | ✅ |
| Frontend `tsc --noEmit` | ✅ |
| `nest build` | ✅ |
| `next build` (يتضمن `/manager/trash`) | ✅ |
| ESLint (ملفات Trash/التنقل/الأيقونة) | ✅ |

---

## 11. الأخطاء والقيود وخطوات الاختبار اليدوي

### قيود
1. **لوحة المدير** صفحة معاينة تجريبية سابقة ولم تُربط بالبيانات الحقيقية (كما هو موثق أعلاه).
2. **Docker CLI على Windows** غير مستجيب؛ تم تنفيذ النسخ الاحتياطي/التنظيف/التحقق عبر WSL/nsenter.
3. لم تُنفَّذ عمليات حذف/استعادة/حذف نهائي فعلية على قاعدة التطوير (حماية للبيانات)؛ غطّتها الاختبارات المعزولة.
4. لا commits أو pushes؛ العمل غير المُودَع محفوظ.

### خطوات الاختبار اليدوي
1. سجّل دخول كمدير.
2. تحقق من ظهور «المحذوفات» في القائمة الجانبية وفتح `/manager/trash` → «سلة المحذوفات فارغة».
3. افتح «العقارات» → لا يوجد تبويب سلة محذوفات، والقائمة فارغة.
4. افتح «العملاء» و«المتابعات» → أصفار.
5. سجّل كموظف → لوحة أصفار، صفحات العقارات/العملاء فارغة.
6. حاول فتح `/manager/trash` كموظف → يُعاد توجيهك.
7. أضف عقاراً تجريبياً (يدوياً) لتأكيد أن الكود التالي `A-000004`، ثم احذفه مؤقتاً/نهائياً لاختبار الصفحة.

---

## 12. الحالة النهائية

- ✅ البيئة مؤكدة.
- ✅ نسخة احتياطية كاملة ومتحقَّق منها.
- ✅ كل البيانات التجارية محذوفة (0) مع حفظ المستخدمين/الصلاحيات/الإعدادات/التسلسل.
- ✅ صفحة «المحذوفات» المخصصة تعمل، والتبويب القديم أُزيل.
- ✅ الأمان: المدير فقط (403 للموظف، وحماية المسار).
- ✅ 111/111 اختبار معزول، والبناء والفحوصات ناجحة.
- ⚠️ لوحة المدير ما زالت معاينة تجريبية (قيد قائم).

**متوقف للمراجعة اليدوية.**


---

## 13. تعديل لاحق: إعادة ضبط تسلسل أكواد العقارات (2026-11-04)

### 13.1 تفويض المالك
وافق مالك العمل صراحةً على إعادة ضبط تسلسل أكواد العقارات في **قاعدة التطوير المحلية فقط** ليبدأ العقار الجديد التالي بالكود `A-000001`، بعد أن ترك التنظيف السابق `PropertyCodeSequence.value = 3`.

### 13.2 فحوصات السلامة (قبل التعديل)
| الفحص | النتيجة |
|---|---|
| قاعدة البيانات | `arkan_crm` (تطوير محلي) |
| `Property` (كل الحالات + Trash) | 0 / 0 |
| `PropertyTombstone` | 0 |
| `PropertyApprovalRequest` / `Contact` / `Client` / `Owner` | 0 |
| `PropertyFloor` / `FileAsset` / `FollowUp*` / `Notification` | 0 |
| `PropertyCodeSequence` | صف واحد، `value = 3` |

### 13.3 النسخ الاحتياطي
- النسخة السابقة من التنظيف: `dev-clean-reset-20261104-151456` — 360,279 بايت، SHA256 `2B9895CA…F074`.
- نسخة جديدة قبل هذا التعديل:
  `D:\Projects\arkan-crm-backups\code-seq-reset-20261104-153858\arkan_crm_before_code_seq_reset_20261104-153858.dump`
  - 351,743 بايت، SHA256 `7B3C4274072C3AF5F84AB428B8C4FECB9606439BDD60D418430C3FF7DCC04262`
  - تم التحقق بـ `pg_restore --list` (284 TOC entry) ومطابقة SHA256 بين الـ VM والمضيف.

### 13.4 الخوارزمية والقيمة
- `nextPropertyCode` ينفّذ `value = value + 1 RETURNING value` ثم `A-` + `lpad(value, 6, '0')`.
- لذلك `value = 0` يجعل أول تخصيص = 1 → **`A-000001`**.
- التعديل: `UPDATE "PropertyCodeSequence" SET value = 0 WHERE id = 1;` داخل معاملة واحدة مع فحوصات قبل/بعد.

| | قبل | بعد |
|---|---|---|
| `PropertyCodeSequence.value` | 3 | **0** |
| الكود التالي المتوقع | A-000004 | **A-000001** |

### 13.5 ما تم الحفاظ عليه
- 3 مستخدمين بنفس المعرّفات والأدوار وكلمات المرور (`manager@arkan.test`, `employee@arkan.test`, `omar9kkomar@gmail.com`).
- Employee profiles، جلسات المصادقة (`RefreshToken`)، `PushSubscription`، الإعدادات، وسجل Prisma migrations.
- تطبيق Trash، دورة حياة المالك المؤقت، وكشف التكرار/التشابه — لم تُمسّ.
- لم يُنفَّذ أي `DELETE` أو تعديل آخر؛ التغيير الوحيد هو صف واحد في `PropertyCodeSequence`.

### 13.6 التحقق بعد التعديل
| الفحص | النتيجة |
|---|---|
| `value` | 0 |
| `next_code` (محسوب من الخوارزمية) | **A-000001** |
| Property / Trash / Tombstone | 0 / 0 / 0 |
| Contact / Client / Approvals / Notifications | 0 |
| تسجيل دخول المدير | 200 |
| تسجيل دخول الموظف | 200 |
| `/health` | 200 |

### 13.7 المخاطر والقيود
- هذا **إجراء لمرة واحدة على قاعدة التطوير المحلية فقط**؛ لم تُغيَّر سياسة توليد الأكواد في الكود.
- الأكواد `A-000001`..`A-000003` صدرت سابقاً ثم حُذفت بياناتها؛ إعادة استخدامها الآن مسموحة صراحةً بموجب تفويض المالك لهذه البيئة فقط.
- لا migrations، لا seeds، لا commits، ولا pushes.
- النسخ الاحتياطية تسمح بالتراجع إن لزم.
