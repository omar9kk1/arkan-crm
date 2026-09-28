# Arkan Real Estate CRM

هيكل تأسيسي ينفذ المهمة في [docs/05_CODEX_FIRST_TASK.md](docs/05_CODEX_FIRST_TASK.md).
الواجهة منفصلة عن الخادم، والبروتوتايب مرجع UI محفوظ دون تعديل.

## النطاق الحالي

- Next.js / React / TypeScript: صفحات عربية RTL بسيطة في `/login` و`/manager` و`/employee`.
- NestJS: إعدادات بيئة، تحقق DTO، تنسيق موحد للاستجابات والأخطاء، Prisma، وBullMQ.
- JWT guard افتراضي لكل API غير معلّم بـ `@Public()`، و`@Roles(Role.MANAGER)` أو `@Roles(Role.EMPLOYEE)`.
- وحدات المجالات فارغة عمدًا. تضاف controllers/services/DTOs عند تنفيذ كل مجال.
- PostgreSQL وRedis وتهيئة migrations عبر Docker Compose.
- S3: حقول إعدادات ونموذج FileAsset فقط؛ لا رفع ملفات أو اتصالات خارجية في هذه المرحلة.

**المصادقة:** Login وRefresh وLogout منفذة في Backend. كلمات المرور تستخدم scrypt مع salt عشوائي.
Access token هو JWT متحقق من توقيعه وانتهائه وissuer وaudience والدور والجلسة النشطة.
Refresh token عشوائي بطول 48 بايت، محفوظ كـSHA-256 hash فقط، بعمر سبعة أيام ومتجدد عند الاستخدام.
تُسجّل أحداث الدخول والتجديد والخروج في AuditLog ضمن معاملة قاعدة البيانات نفسها.
صفحة /login متصلة بالـBackend، وقالبا المدير والموظف محميان بتوجيه حسب الدور بعد التحقق من /auth/me.
الجلسة محفوظة مؤقتًا في sessionStorage للتطوير فقط؛ حماية بيانات API الفعلية تبقى في Backend guards.

## المتطلبات

- Node.js 22 أو أحدث وnpm.
- Docker Desktop مع Linux containers وDocker Compose v2.
- المنافذ المحلية 3000 و4000 و5432 و6379 متاحة.

## تهيئة البيئة

نفّذ من جذر المشروع في PowerShell:

```powershell
Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/frontend/.env.example apps/frontend/.env.local
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

ضع القيمة العشوائية الناتجة في `JWT_ACCESS_SECRET` داخل `apps/backend/.env`.
التطبيق يرفض القيمة النموذجية. لا ترسل السر إلى Git.
في macOS/Linux استخدم `cp` بدلًا من `Copy-Item`.

## تشغيل كل الخدمات في Docker

```powershell
docker compose up --build -d
docker compose ps
docker compose logs -f backend
```

خدمة `migrate` تطبق migrations أولًا ثم تخرج بنجاح، وبعدها يبدأ الخادم والواجهة.
البيانات تحفظ في volumes. بيانات PostgreSQL المرفقة محلية فقط، والمنافذ مربوطة بـ127.0.0.1.

- الواجهة: http://localhost:3000/login
- API liveness: http://localhost:4000/health
- API readiness: http://localhost:4000/health/ready

```powershell
docker compose down
```

هذا يوقف الخدمات ويحافظ على البيانات. لا تضف `-v` إلا إذا أردت مسح البيانات المحلية.

## التطوير المحلي مع PostgreSQL وRedis داخل Docker

```powershell
npm ci
npm run db:generate
npm run build -w @arkan/shared
docker compose up -d postgres redis
npm run db:deploy
npm run dev
```

`npm run dev` يشغّل التطبيقين معًا؛ يمكن أيضًا استخدام `npm run dev:backend` و`npm run dev:frontend` في نافذتين.
أعد بناء shared بعد تعديله. Prisma CLI يقرأ `apps/backend/.env` لأن أوامره تعمل داخل workspace الخادم.
عند تغيير مخطط البيانات:

```powershell
npm run db:migrate -w @arkan/backend -- --name describe_change
npm run db:generate
```

يوجد seed اختياري للمستخدمين التجريبيين كما هو موضح أدناه. `JWT_REFRESH_SECRET` غير مستخدم لأن refresh tokens عشوائية وليست JWT؛ إعدادات S3 مؤجلة.
عنوان API في المتصفح يحدد بواسطة `NEXT_PUBLIC_API_URL`، ويثبت وقت build؛ عند تشغيل Docker عدله في build args داخل compose.
داخل Docker يستخدم الخادم أسماء الخدمات postgres وredis، وفي التطوير المحلي يستخدم localhost.

## الجودة والتحقق

```powershell
npm run db:generate
npm run db:validate -w @arkan/backend
npm run typecheck
npm run lint
npm test
npm run build
npm run format:check
```

الاختبارات تفحص حدود JWT، الصلاحيات لكلا الدورين، validation، الدخول والتجديد والخروج وتخزين hashes،
وفحص الجاهزية عند نجاح أو فشل التبعيات. تستخدم بدائل اختبار لقاعدة البيانات وRedis؛
لا تغني عن تشغيل Compose للتحقق من الاتصال الحقيقي.

## شكل API

نجاح:

```json
{ "data": { "status": "ok", "service": "arkan-api" } }
```

خطأ:

```json
{ "error": { "statusCode": 401, "message": "Bearer token required", "path": "/auth/me" } }
```

| Endpoint | الوصول | السلوك |
| --- | --- | --- |
| GET /health | عام | حياة الخادم |
| GET /health/ready | عام | PostgreSQL + Redis، و503 عند عدم الجاهزية |
| POST /auth/login | بريد وكلمة مرور | إصدار access/refresh tokens، أو 401 |
| POST /auth/refresh | refreshToken في JSON | إبطال القديم وإصدار زوج جديد، أو 401 |
| POST /auth/logout | refreshToken في JSON | إبطال الجلسة، ويرجع 200 حتى عند تكرار الطلب |
| GET /auth/me | Bearer JWT | هوية الحساب النشط بعد التحقق من الجلسة |

قواعد المجال مثل تسجيل المدير للصفقة
وتغيير حالة العقار وإنشاء الحركات المالية وسجل التدقيق ستنفذ في services بمعاملة واحدة في مرحلة لاحقة.

## الهيكل

```text
apps/frontend/
  app/                 routes وlayouts
  components/layout/   ManagerLayout وEmployeeLayout وWorkspaceShell
  components/ui/       مكونات عرض صغيرة
  features/auth/       نموذج الدخول وAuth API وإدارة الجلسة وحماية الدور
  lib/                 API client
  styles/              RTL responsive styles
apps/backend/
  src/auth/            DTOs وguards وdecorators
  src/common/          validation وresponse/error formatting
  src/config/          environment validation
  src/prisma/          Prisma lifecycle
  src/health/          liveness/readiness
  src/jobs/            BullMQ system queue؛ لا workers أو jobs دورية بعد
  src/<domain>/        وحدات فارغة لكل مجال
  prisma/              schema وmigration أولي
  test/                اختبارات HTTP وحدود الصلاحيات والجاهزية
packages/shared/src/   enums وtypes وDTO contracts مشتركة فقط
docker/                Dockerfiles
docs/                  وثائق المشروع الأصلية
prototype/             مرجع UI الأصلي
```

Prisma مصدر علاقات قاعدة البيانات؛ shared يحتوي عقود API فقط ولا يصدّر Prisma للواجهة.
إصدارات التبعيات المحلولة مثبتة في package-lock.json. يستخدم المشروع Prisma 6.19
مع PostgreSQL datasource داخل schema؛ ترقية Prisma الكبرى خطوة منفصلة.

## حدود المسودة

- مبالغ المال Decimal مع حقل عملة صريح؛ لا استخدام float.
- لا تُحذف العقارات عند إغلاق صفقة؛ الحالات SOLD وRENTED موجودة.
- العلاقات المالية والمرجعية المهمة تمنع الحذف المتسلسل.
- FollowUp يستهدف كيانًا واحدًا: عميلًا أو مالكًا أو عقارًا.
- قيود CHECK الخاصة بهدف المتابعة ومطابقة مصدر الحركة المالية محفوظة في migration SQL؛ يجب الحفاظ عليها عند تعديل المخطط.
- sourceType وsourceId إلزاميان للحركة المالية؛ المصدر اليدوي يحمل معرف العملية المحلية.
- لا توجد قواعد حساب عمولات أو رواتب، ولا تشغيل إشعارات دورية أو AI Parser.
- Payroll period وAttendance date قيم تاريخية؛ تثبيت منطقة زمنية للشركة وتفاصيل الفترات من أعمال المجال القادمة.
- سجل التدقيق موجود كهيكل؛ إنفاذ الكتابة لكل حدث مهم يأتي مع تنفيذ الحدث.

قرارات التنفيذ الأصلية: [Stack](docs/01_STACK_DECISION.md)، [MVP](docs/02_MVP_SCOPE.md)،
[Structure](docs/03_PROJECT_STRUCTURE.md)، [Clean code](docs/04_CLEAN_CODE_RULES.md)،
[Domain](docs/06_DOMAIN_MODEL_DRAFT.md)، [UI](docs/07_UI_IMPLEMENTATION_NOTES.md).

## Auth + Seed Users

بعد تهيئة ملفات البيئة والسر كما سبق، نفذ من جذر المشروع:

```powershell
npm ci
npm run db:generate
npm run build -w @arkan/shared
docker compose up -d postgres redis
npm run db:deploy
npm run db:seed -w @arkan/backend
npm run dev:backend
```

أمر seed يبني الخادم ويقرأ apps/backend/.env. ينشئ المستخدمين وEmployeeProfile داخل معاملة واحدة.
يمكن تكراره دون تغيير كلمة مرور أو بيانات حساب موجود؛ يتوقف إذا كان بريد تجريبي موجودًا بدور مختلف.
يرفض العمل عندما NODE_ENV=production. استخدمه في قاعدة تطوير فقط.

| البريد | كلمة المرور التجريبية | الدور |
| --- | --- | --- |
| manager@arkan.test | ChangeMe123! | MANAGER |
| employee@arkan.test | ChangeMe123! | EMPLOYEE + EmployeeProfile |

اختبار التسلسل في PowerShell بعد تشغيل الخادم:

```powershell
$apiBase = 'http://localhost:4000'
$loginBody = @{ email = 'manager@arkan.test'; password = 'ChangeMe123!' } | ConvertTo-Json
$session = (Invoke-RestMethod -Method Post -Uri "$apiBase/auth/login" -ContentType 'application/json' -Body $loginBody).data

Invoke-RestMethod -Uri "$apiBase/auth/me" -Headers @{ Authorization = "Bearer $($session.accessToken)" }

$refreshBody = @{ refreshToken = $session.refreshToken } | ConvertTo-Json
$session = (Invoke-RestMethod -Method Post -Uri "$apiBase/auth/refresh" -ContentType 'application/json' -Body $refreshBody).data

$logoutBody = @{ refreshToken = $session.refreshToken } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$apiBase/auth/logout" -ContentType 'application/json' -Body $logoutBody
```

Login وRefresh يعيدان data.accessToken وdata.refreshToken وdata.expiresIn (ثوانٍ).
Logout يعيد data.loggedOut=true. لا تطبع tokens في سجلات مشتركة.
بعد التجديد استخدم الزوج الجديد؛ القديم مرفوض. بعد الخروج ترجع محاولات استخدام access/refresh الخاصين بتلك الجلسة 401.
يمكن اختبار الموظف بتغيير البريد فقط.

```powershell
npm test
npm run typecheck
npm run lint
npm run build -w @arkan/backend
```

حدود هذه المرحلة:
- فحوص HTTP تستخدم Prisma test double؛ لا تثبت معاملات PostgreSQL الحقيقية أو سلوكها تحت الحمل.
- كل طلب محمي يقرأ الجلسة والحساب من قاعدة البيانات؛ logout وتعطيل الحساب يوقفان الطلبات اللاحقة فورًا.
- Logout يوقف الجلسة المحددة بالـrefresh token المرسل فقط؛ لا يوجد logout لجميع الأجهزة.
- إعادة استخدام refresh قديم تُرفض؛ لا يوجد تتبع لعائلة tokens لإبطال الجلسات المتفرعة عند الاشتباه بالسرقة.
- مدة refresh سبعة أيام من الإصدار/التجديد، دون حد مطلق لعمر الجلسة أو تنظيف دوري للسجلات القديمة بعد.
- لا توجد rate limiting أو استعادة كلمة مرور أو MFA أو إدارة حسابات بعد. تخزين جلسة الواجهة مؤقت للتطوير، ولا توجد HttpOnly cookies بعد؛ استخدم HTTPS عند النشر.
- seed مكتوب وقابل للتشغيل، لكن تنفيذ الحسابات فعليًا يتطلب PostgreSQL متاحًا وmigrations مطبقة.

## Frontend Login

المتطلبات: إعداد Backend والـJWT secret، وتشغيل PostgreSQL وRedis وتطبيق migrations والـseed كما سبق.

```powershell
Copy-Item apps/frontend/.env.local.example apps/frontend/.env.local
npm run build -w @arkan/shared
npm run dev
```

يشغّل الأمر الأخير Backend على 4000 وFrontend على 3000. أو افتح نافذتين:

```powershell
npm run dev:backend
npm run dev:frontend
```

افتح http://localhost:3000/login. يجب أن تكون NEXT_PUBLIC_API_URL=http://localhost:4000،
وFRONTEND_ORIGIN=http://localhost:3000 في إعدادات الخادم. أعد تشغيل Next.js بعد تعديل متغيرات البيئة.
إذا تغير منفذ الواجهة، عدل FRONTEND_ORIGIN وأعد تشغيل الخادم.

اختبار يدوي:
1. دون جلسة، افتح /manager أو /employee: يتم تحويلك إلى /login دون عرض محتوى القالب.
2. ادخل بـmanager@arkan.test وكلمة ChangeMe123!: يتم تحويلك إلى /manager.
3. افتح /employee بنفس الجلسة: يعود التوجيه إلى /manager.
4. استخدم تسجيل الخروج، ثم ادخل بـemployee@arkan.test وكلمة ChangeMe123!: يتم تحويلك إلى /employee.
5. افتح /manager كموظف: يتم توجيهك إلى /employee.
6. حدّث الصفحة للتحقق من استعادة الجلسة. كلمة مرور خاطئة أو توقف الخادم يعرضان رسالة عربية.
7. لتجربة التجديد سريعًا، اضبط JWT_ACCESS_TTL_SECONDS=60 في Backend وأعد تشغيله، ثم سجل الدخول وانتظر انتهاء access token وحدّث صفحة محمية.

العميل يوفر login() وgetMe() وrefresh() وlogout() في features/auth/api/auth-api.ts.
لا تُخزن كلمة المرور؛ يُخزن زوج الرموز والمستخدم في sessionStorage، ويُعاد التحقق من المستخدم عبر API عند تحميل/تغيير المسار.
يُجرّب refresh مرة واحدة بعد 401 من /auth/me. لا يحدث تجديد دوري أثناء الخمول.
تُمسح الجلسة محليًا عند الخروج حتى إذا تعذر الاتصال بالخادم؛ عندها قد تبقى الجلسة البعيدة صالحة حتى تنتهي.

حدود الحماية:
- sessionStorage قابل للقراءة بواسطة JavaScript، وقد ينسخه المتصفح عند نسخ تبويب؛ ليس تخزينًا مناسبًا للإنتاج. استخدم جلسة بـHttpOnly/Secure cookies مع تصميم حماية CSRF لاحقًا.
- الحماية الحالية في المتصفح؛ لا تستخدمها لإخفاء بيانات سرية ضمن Server Components. قوالب /manager و/employee ما زالت خالية من بيانات النظام، والـBackend يحمي API فعليًا.
- إغلاق التبويب يمسح التخزين عادة لكنه لا يرسل logout إلى الخادم.
- لم تُضف صفحات نظام أو CRUD، ولم يتغير البروتوتايب أو Backend.

## Manager UI Shell

مسار /manager يعرض الآن هيكل المدير وDashboard أوليًا: Sidebar على اليمين، Topbar،
أربع بطاقات إحصائية، مساحة رسم للصفقات والعمولات، وثلاث فئات لأفضل الموظفين.
كل القيم placeholders معلّمة بوضوح. البحث والفترة والأقسام غير المنفذة معطلة وتظهر كميزات قادمة.

للاختبار بعد تشغيل التطبيقين والـseed:

1. افتح /login وسجّل الدخول بـmanager@arkan.test وكلمة ChangeMe123!.
2. على شاشة أعرض من 980px راجع Sidebar وTopbar وترتيب البطاقات.
3. عند 980px أو أقل يختفي Sidebar ويظهر شريط بخمسة عناصر: الرئيسية، العقارات، الصفقات، العملاء، المزيد.
4. افتح «المزيد»؛ راجع الأقسام الإضافية، ثم أغلق بالزر أو Escape أو النقر خارج النافذة.
5. اختبر عرض 320px و390px و768px، والتمرير لنهاية المحتوى دون أن يغطيه الشريط السفلي.
6. جرّب التنقل بـTab ورابط «تخطي إلى المحتوى»، والخروج، وحماية /manager من حساب الموظف.

مكونات الهيكل في components/layout/manager، والبطاقات الأولية في features/manager-dashboard.
Card وButton وStatCard وSearchBar مشتركة، والقيم البصرية في styles/tokens.css.
لا توجد بيانات Dashboard حقيقية أو APIs جديدة أو صفحات للأقسام القادمة.
