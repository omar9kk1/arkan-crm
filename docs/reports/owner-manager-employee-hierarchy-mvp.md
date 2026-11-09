# MVP — هيكل المالك / المدير / الموظف (Owner / Manager / Employee)

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**الحالة:** MVP منفّذ ومختبر في قاعدة الاختبار المعزولة — **بانتظار المراجعة قبل تفعيل قاعدة `arkan_crm` الحقيقية**.  
**قاعدة الاختبار:** `arkan_crm_api_test` فقط (22 migration مطبّقة).  
**قاعدة التطوير الحقيقية:** لم تُلمس؛ لا migrations ولا promotion ولا تعديل بيانات.  
**الخدمات:** تم إيقاف الـbackend والـfrontend التطويريين أثناء التنفيذ/البناء. الـbackend يعمل ضد مخطط قديم (19 migration)؛ يلزم تفعيل المخطط ثم `npm run dev` لإعادة تشغيلهما.

> لا commits ولا pushes. لا تعديل `.env` أو `.env.local`. CSP/Rate Limiting/SSRF/Multer/CSRF/Cookies محفوظة.

---

## 1. ما تم تنفيذه

### 1.1 الأدوار والهيكل

- إضافة `OWNER` إلى enum `Role` (قيمة مُضافة في نهاية الـenum، دون إعادة ترتيب القيم الحالية).
- `OWNER`: أعلى سلطة، رؤية شركة كاملة.
- `MANAGER`: نفس صفحات الإدارة، لكن مقيد بفريقه الحالي.
- `EMPLOYEE`: تجربته الحالية محفوظة.
- ربط الموظف بالمدير عبر `EmployeeProfile.managerUserId` (FK مفهرس، `ON DELETE SET NULL`). إعادة التعيين/النقل تحدّث هذا الحقل فقط؛ لا تُحذف سجلات تاريخية.
- الموظف غير المعيّن يبقى مرئيًا للمالك فقط، وغير مرئي للمديرين.

### 1.2 نموذج صلاحيات المدير

- جدول `ManagerCapability` + enum `ManagerCapabilityType`:
  - `PROPERTY_APPROVE`
  - `PROPERTY_REJECT`
- غياب الصف = **false**. الافتراضي: لا اعتماد ولا رفض.
- المالك يمنح/يسحب كل صلاحية بشكل مستقل عبر:
  - `GET /managers`
  - `PATCH /managers/:id/permissions`
- الصلاحية تُقرأ من DB عند كل قرار؛ لا تُخزّن في JWT ولا يُعتمد على الواجهة.

### 1.3 إدارة الحسابات (OWNER فقط)

- `POST /employees` — إنشاء `MANAGER` أو `EMPLOYEE` (لا يمكن إنشاء `OWNER`).
- `PATCH /employees/:id` — إعادة تسمية مدير/موظف (ليس المالك).
- `PATCH /employees/:id/manager` — تعيين/نقل/إلغاء تعيين موظف (يتحقق أن المدير نشط ودوره `MANAGER`).
- `PATCH /employees/:id/activation` — تفعيل/تعطيل مدير أو موظف.
- `GET /employees` — المالك: كل الموظفين؛ المدير: فريقه فقط؛ الموظف: 403.
- `GET /managers` — دليل المديرين + الصلاحيات + عدد الفريق (OWNER فقط).

### 1.4 نطاق الرؤية (Backend)

| المجال | OWNER | MANAGER | EMPLOYEE |
|---|---|---|---|
| العقارات | الكل (غير المحذوف) | عقاراته + عقارات موظفيه الحاليين فقط | AVAILABLE + PENDING/REJECTED الخاصة به |
| العملاء | الكل | عملاء فريقه + عملاؤه | منشأه/المسؤول عنه |
| جهات الاتصال | الكل | جهات فريقه + سجلات الشركة (بدون مسؤول) | جهاته فقط |
| المتابعات | إشراف على الجميع | إشراف على فريقه + متابعاته | متابعاته فقط |
| مراجعات العملاء | الكل | مراجعات فريقه | مراجعاته |
| لوحة التحكم | كل الشركة | فريقه + نشاطه | ممنوع |
| الإشعارات | صندوقه فقط | صندوقه فقط | صندوقه فقط |
| Trash | الكل | عقارات فريقه/عقاراته | ممنوع |
| Push | حسابه | حسابه | ممنوع |

- **لا مشاركة عقارات معتمدة بين الفرق في هذا MVP**: مدير الفريق لا يرى عقارات فريق آخر حتى لو كانت AVAILABLE. هذه هي القراءة الحرفية لقاعدة «المشاركة المستقبلية». الموظفون يحتفظون برؤية AVAILABLE الحالية.
- لا تُستخدم أي `managerId` من العميل للتفويض؛ كل النطاقات مبنية على `request.user` والعلاقات في DB.

### 1.5 دورة اعتماد العقارات

- الموظف والمدير: كل إرسال يدخل PENDING مع P-code وسجل مراجعة.
- المالك: إنشاء مباشر AVAILABLE مع A-code (أعلى سلطة).
- المدير لا يستطيع اعتماد/رفض/طلب تعديل افتراضيًا.
- عند منح الصلاحية:
  - الاعتماد يتطلب `PROPERTY_APPROVE`.
  - الرفض يتطلب `PROPERTY_REJECT`.
  - طلب التعديل يتطلب واحدة منهما.
  - النطاق مقيد بفريقه الحالي فقط؛ خارج الفريق → 404.
  - المدير لا يعتمد عقاره الخاص → 403.
- P/A numbering، منع التكرار، المالك المؤقت، معاملات الاعتماد، idempotency وTrash: محفوظة ومختبرة.

### 1.6 أمان الجلسات

- `User.authVersion` + `RefreshToken.authVersion` + claim `av` في access token.
- أي تغيير دور أو تعطيل:
  - يزيد `authVersion` ذريًا،
  - ويُبطل كل refresh tokens،
  - والـGuard يرفض أي access/refresh قديم.
- **Trigger في قاعدة البيانات** يضمن نفس السلوك حتى عند التعديل المباشر بـSQL:
  - `BEFORE UPDATE OF role, isActive` → زيادة `authVersion`.
  - `AFTER UPDATE OF role, isActive` → إبطال refresh tokens.
- لا يمكن لـRefresh قديم إصدار دور جديد (لا ترقية Employee→Manager، ولا عودة Manager→Employee→Manager).
- إعادة التفعيل لا تحيي الجلسات القديمة؛ يلزم login جديد.
- Cookie mode وCSRF وHttpOnly/rotation/Push lineage: محفوظة ومختبرة.

### 1.7 ترقية المدير الحالي إلى OWNER

- خدمة `OwnerPromotionService` + سكربت `apps/backend/prisma/promote-owner.cjs`.
- **Dry-run افتراضي**؛ لا كتابة بدون `--apply --confirm`.
- يرفض الترقية إذا:
  - يوجد `OWNER` بالفعل،
  - لا يوجد مدير نشط،
  - يوجد أكثر من مدير نشط دون `--email` صريح.
- لا يرقّي كل المديرين، ولا يخمّن حسابًا.
- يحافظ على `User.id`، credentials، properties، history وكل العلاقات.
- يزيد `authVersion` ويُبطل كل جلسات الحساب في نفس المعاملة، ويضيف audit `OWNER_PROMOTE`.

### 1.8 الواجهة (Frontend)

- `OWNER` يدخل `/manager` بنفس تخطيط المدير (Astra-glass/RTL دون إعادة تصميم).
- صفحة الموظفين:
  - المالك: زر إضافة حساب، تعيين/نقل الموظفين، تفعيل/تعطيل، ولوحة «إدارة الفرق والصلاحيات» لكل مدير (اعتماد/رفض مستقلان).
  - المدير: عرض فريقه فقط، بدون إنشاء/تعيين/تفعيل/صلاحيات.
- أزرار اعتماد/رفض العقارات تختفي للمدير غير الممنوح (وبالنسبة للمدير تُقرأ القدرات من `/auth/me`).
- روابط الإشعارات وأدوار الإدارة تعامل `OWNER` كإدارة.
- التفويض الحقيقي يبقى في الـbackend دائمًا.

---

## 2. قاعدة البيانات والـMigrations

| Migration | المحتوى |
|---|---|
| `20261108090000_add_owner_role` | `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OWNER'` |
| `20261108090100_owner_hierarchy` | `authVersion` في User/RefreshToken، `EmployeeProfile.managerUserId` + index/FK، `ManagerCapability` + enum + unique/index/FK |
| `20261108090200_auth_revocation_triggers` | triggers إبطال الجلسات عند تغيير الدور/التعطيل |

- كلها **additive** وآمنة/idempotent (`IF NOT EXISTS` / DO blocks).
- لم تُنفّذ على `arkan_crm` الحقيقي؛ فقط `arkan_crm_api_test` (22 migrations).
- لا backfill إلزامي: `authVersion=0` و`managerUserId=NULL` للصفوف الحالية. تعيين الموظفين الحاليين قرار تشغيلي للمالك.

### Rollback (بعد اعتماد منفصل)
- استعادة نسخة `arkan_crm` الاحتياطية.
- إسقاط الـtriggers/functions، ثم `ManagerCapability`، ثم الأعمدة الجديدة.
- قيمة enum `OWNER` يمكن تركها غير مستخدمة (إزالتها تعيد بناء النوع وتحتاج نافذة صيانة)؛ لا حاجة لحذفها لعمل الكود القديم.

---

## 3. الاختبارات

- اختبارات الهيكل الجديدة: `apps/backend/test/owner-manager-employee-hierarchy.spec.ts` — **11/11**:
  - رؤية المالك للشركة، عزل الفريق، الموظف غير المعيّن.
  - منع مدير الفريق A من بيانات B (عملاء/جهات/عقارات/صور/إشعارات/متابعات).
  - إدارة الحسابات للمالك فقط.
  - default-deny + منح/سحب مستقل + نطاق الفريق.
  - نقل الموظف وتغيّر الرؤية المستقبلية دون حذف التاريخ.
  - التكرار وP/A.
  - إبطال الجلسات عند تغيير الدور/التعطيل، وإعادة التفعيل.
  - Cookie mode + CSRF.
- `role-change-session-revocation.spec.ts` أُعيدت كتابته للسياسة الجديدة — **7/7**.
- مجموعة الانحدار المركزة بعد الـtrigger والرؤية الصارمة: **24 حزمة / 289 اختبارًا — كلها ناجحة**.
- **Full backend suite النهائي (بعد trigger والرؤية الصارمة): 79 حزمة / 799 اختبارًا — 0 فشل.**
- `typecheck` backend/frontend: 0 أخطاء.
- `lint` root (`eslint apps packages`): 0 أخطاء.
- `build` backend: ناجح.
- `build` frontend النهائي (Next 16 + CSP manifest): ناجح — 27 route، 29 hash، رأس 2055B.
- `csp:verify`: manifest سليم (build `uNShJTVFSvQMf84WGPPtT`).
- اختبارات CSV/HTML السابقة، أمان الصور/الرفع، SSRF/Push، Rate Limit، CSP، cookie/CSRF: بقيت ناجحة.

**Browser smoke معزول (test DB، 2026-11-08):**
- تسجيل دخول OWNER عبر cookie/CSRF → `/manager`؛ لوحة الشركة أظهرت العقارات/العملاء/الموظفين.
- `/manager/employees` للمالك: ظهرت «إدارة الفرق والصلاحيات» و«إضافة موظف» وقائمتا المديرين مع خيارات الاعتماد/الرفض/التنشيط وتعيين الموظفين.
- تسجيل دخول MANAGER A → `/manager/employees`: ظهر «موظف أ» فقط، **بدون** لوحة الصلاحيات أو زر إضافة أو «موظف ب».
- `/manager/properties`: ظهر عقار الفريق PENDING، و**بدون** أزرار اعتماد/رفض (default-deny).
- لا أخطاء CSP/hydration؛ طلبات `/auth/me` الأولية قبل تسجيل الدخول أعادت 401 كما هو متوقع.

---

## 4. ما يعمل في الاختبار المعزول

- المالك يرى ويقرر كل شيء.
- المدير يرى فريقه فقط؛ لا يستطيع قراءة فريق آخر.
- الموظف غير المعيّن مرئي للمالك فقط.
- إنشاء/تعيين/نقل/تفعيل الحسابات مالك فقط.
- المدير read-only افتراضيًا؛ 403 للاعتماد/الرفض/طلب التعديل.
- منح/سحب صلاحية لكل مدير يعمل فورًا ومقيد بالفريق.
- نقل الموظف يغيّر من يرى عقاره PENDING مستقبلًا، مع بقاء historical creator/history.
- P/A، التكرار 409، المالك المؤقت، Trash، الصور، الإشعارات: سليمة.
- الجلسات القديمة لا تعود بعد تغيير الدور/التعطيل، حتى عند SQL مباشر.
- إعادة التفعيل تتطلب login جديد.
- Cookie/CSRF محفوظان.

---

## 5. المشاكل/الحدود المتبقية

1. **لم تُطبّق migrations ولا ترقية المالك على `arkan_crm` الحقيقي** — هذا هو سبب التوقف للمراجعة.
2. **الـbackend التطويري متوقف** لأن الكود الجديد يتوقع 22 migrations بينما قاعدة التطوير ما زالت على 19. لا تشغيل قبل التفعيل.
3. **الموظفون الحاليون غير معيّنين** (`managerUserId=NULL`)؛ سيراهم المالك فقط حتى يعيّنهم. يلزم قرار/خطوة تعيين.
4. **العملاء القدامى الذين أنشأهم مدير مع موظف مسؤول** قد يحملون `createdByUserId=NULL`؛ قد لا يظهرون لمدير الفريق بعد الهيكلة، لكن المالك يراهم. يمكن backfill اختياري بعد مراجعة البيانات.
5. **لا يوجد API عام لتغيير الدور** (فقط ترقية المالك). أي تغيير دور مستقبلي يجب أن يستخدم نفس معاملة `authVersion` + revoke؛ الـtrigger يغطي حتى SQL المباشر.
6. **واجهة الصلاحيات**: إذا مُنح المدير اعتمادًا فقط، قد تظهر أزرار الرفض في الواجهة (الـbackend يرفضها 403). تحسين UI دقيق لاحق.
7. **ربط عميل بعقار AVAILABLE من فريق آخر:** بسبب منع المشاركة بين الفرق، قد لا يتمكن مدير الفريق من رؤية/اعتماد هذا الـinterest؛ المالك يستطيع. هذا أثر مباشر لسياسة «لا مشاركة معتمدة بين الفرق» ويُحل عند تفعيل ميزة المشاركة مستقبلًا.
8. `/dev/potential-duplicate-preview` ما زال يدخل build الإنتاج (ملاحظة سابقة، ليست ضمن هذا MVP).
8. إشعارات «عقار متاح» ما زالت تذهب لكل الموظفين (السلوك الحالي)؛ المدير لا يستلمها إلا عبر صلاحياته/فريقه حسب الحدث. قابل للتوسعة لاحقًا.

---

## 6. خطة التفعيل الآمنة على `arkan_crm` (لا تُنفّذ قبل الاعتماد)

### 6.1 قبل التطبيق
1. إيقاف الـbackend (تم).
2. نسخة احتياطية كاملة:
   ```powershell
   pg_dump "<DATABASE_URL>" -Fc -f "backup-arkan_crm-before-hierarchy.dump"
   ```
3. مراجعة الملفات:
   `apps/backend/prisma/migrations/20261108090000_add_owner_role`,
   `.../20261108090100_owner_hierarchy`,
   `.../20261108090200_auth_revocation_triggers`.

### 6.2 تطبيق المخطط (بعد اعتماد منفصل)
```powershell
cd D:\Projects\arkan-crm\apps\backend
# لا تعدّل .env؛ مرّر DATABASE_URL للعملية فقط بعد التأكد أنه arkan_crm
$env:DATABASE_URL = "<production/dev real DATABASE_URL>"
npx prisma migrate deploy
```
> لا تستخدم `prisma migrate dev` أو `reset` أو `seed` على قاعدة حقيقية.

### 6.3 ترقية المدير الحالي (dry-run أولًا)
```powershell
cd D:\Projects\arkan-crm
node --env-file=apps/backend/.env apps/backend/prisma/promote-owner.cjs
```
- إذا ظهرت رسالة Ambiguous: أعد التشغيل بـ`--email <owner-email>` بعد التأكد من الحساب.
- إذا كان هناك OWNER بالفعل: يتوقف.
- لا كتابة في هذه الخطوة.

### 6.4 التطبيق الفعلي (بعد تأكيد الحساب)
```powershell
node --env-file=apps/backend/.env apps/backend/prisma/promote-owner.cjs --email <owner-email> --apply --confirm
```
- يرقّي حسابًا واحدًا فقط، يحافظ على ID/credentials/history.
- يبطل كل جلساته القديمة؛ يلزم login جديد.

### 6.5 تعيين الفريق ومنح الصلاحيات
- من واجهة المالك `/manager/employees` → «إدارة الفرق والصلاحيات»:
  - عيّن كل موظف حالي إلى مديره (أو اتركه بدون مدير → المالك فقط).
  - امنح `اعتماد العقارات` / `رفض العقارات` لكل مدير حسب الحاجة (الافتراضي false).
- أو عبر API:
  ```http
  PATCH /employees/:id/manager   { "managerUserId": "<manager-user-id>" | null }
  PATCH /managers/:id/permissions { "canApprove": true, "canReject": false }
  ```

### 6.6 إعادة التشغيل والتحقق
```powershell
cd D:\Projects\arkan-crm
npm run backend:start
```
ثم:
- سجّل دخولًا جديدًا بحساب OWNER: `/auth/me` يجب أن يعيد `role=OWNER` و`capabilities={true,true}`.
- تأكد أن الجلسات القديمة 401.
- تحقق من:
  - OWNER يرى كل الفرق والبيانات.
  - MANAGER يرى فريقه فقط، ولا يرى فريقًا آخر.
  - الموظف غير المعيّن لا يظهر لأي مدير.
  - المدير بلا صلاحية: approve/reject/request-changes → 403.
  - منح الصلاحية يعمل فورًا، وخارج الفريق 404.
  - الموظفون يحتفظون ببياناتهم بعد النقل/التعطيل/إعادة التفعيل.
  - Cookie/CSRF يعملان.

### 6.7 التراجع
- استعادة النسخة الاحتياطية + إعادة الكود السابق.
- إسقاط الكائنات الجديدة (triggers/functions/table/columns) إن أردت rollback كاملًا؛ قيمة `OWNER` يمكن تركها غير مستخدمة.
- لا rollback لتغييرات business rows لأن الترقية لا تغيّر إلا `role`/`authVersion`/`refreshTokens`/audit.

---

## 7. الملفات الرئيسية

**Schema/Migrations:**
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261108090000_add_owner_role/`
- `apps/backend/prisma/migrations/20261108090100_owner_hierarchy/`
- `apps/backend/prisma/migrations/20261108090200_auth_revocation_triggers/`
- `apps/backend/prisma/promote-owner.cjs`

**Backend:**
- `apps/backend/src/common/access/access-policy.ts` (مركز النطاقات والصلاحيات)
- `apps/backend/src/auth/*` (authVersion/av/revocation)
- `apps/backend/src/employees/*` (إدارة الحسابات/الفريق/الصلاحيات/الترقية)
- `apps/backend/src/properties/*` (الرؤية/الاعتماد/Trash/الإنشاء)
- `apps/backend/src/clients/*`, `contacts/*`, `followups/*`, `dashboard/*`, `notifications/*`, `push/*`, `users/*`

**Frontend:**
- `apps/frontend/app/manager/layout.tsx`
- `apps/frontend/features/auth/*`
- `apps/frontend/features/manager-employees/*`
- `apps/frontend/features/manager-properties/components/manager-properties.tsx`
- `apps/frontend/features/notifications/notification-target.ts`
- `apps/frontend/lib/api/employee-types.ts`, `employees-api.ts`

**Tests:**
- `apps/backend/test/owner-manager-employee-hierarchy.spec.ts`
- `apps/backend/test/role-change-session-revocation.spec.ts`
- تحديثات الحزم القائمة (fixtures للفريق/المالك/الصلاحيات).

---

## 8. الحالة النهائية

- **MVP منفّذ ومختبر على `arkan_crm_api_test` فقط.**
- **لم يُلمس `arkan_crm` الحقيقي**، ولا `.env`، ولا Git history.
- **لا commits/pushes.**
- **الـbackend والـfrontend التطويريان متوقفان** بانتظار تطبيق migrations/الترقية؛ لا تعيد تشغيلهما قبل تفعيل المخطط.
- **التوقف هنا للمراجعة والموافقة قبل تنفيذ أي خطوة من قسم 6 على قاعدة البيانات الحقيقية.**
