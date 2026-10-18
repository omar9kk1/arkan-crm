# استعادة توليد Prisma Client والتحقق من الاتصال بقاعدة البيانات

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **النوع:** استعادة بيئة التطوير المحلية (إيقاف/إعادة تشغيل خادم الخلفية فقط) — بدون أي كتابة في قاعدة البيانات، وبدون أي ترحيل جديد.
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات غير مُلتزمة، لم يُنفَّذ commit أو push.
- **مراجع سابقة:** [development-database-migration](./2026-10-15-development-database-migration.md)، [optional-legacy-owner-schema-fix](./2026-10-15-optional-legacy-owner-schema-fix.md)، [property-schema-migration-preparation](./2026-10-15-property-schema-migration-preparation.md)

> **نطاق هذه المهمة:** حلّ خطأ `EPERM` عند توليد Prisma Client على Windows، وإعادة تشغيل خادم **Arkan Backend** بطريقة آمنة ومتحكَّم بها، والتحقق القطعي من هوية قاعدة بيانات التطوير. **لم تُنفَّذ أي كتابة على قاعدة البيانات، ولم يُشغَّل أي ترحيل (`migrate deploy/dev/reset`) ولا `db push` ولا seed، ولم يُثبَّت أو يُرقّى أي اعتماد، ولم تُعدَّل ملفات البيئة، ولم تُبنَ أي API، ولم تُلمَس الواجهة الأمامية أو معالج Astra، ولم يُنفَّذ commit/push.** تم الحفاظ على كل العمل غير المُلتزم.

---

## 1. المشكلة الأصلية

- في المهمة السابقة (تطبيق ترحيل توسيع مخطط العقار) فشل توليد Prisma Client بالخطأ:

  ```
  EPERM: operation not permitted, rename '...\node_modules\.prisma\client\query_engine-windows.dll.node'
  ```

- **السبب:** ملف محرّك الاستعلام `query_engine-windows.dll.node` كان **محجوزًا (locked)** من عملية `node` قيد التشغيل (خادم خلفية Arkan الذي يستورد `@prisma/client`). عند إعادة التوليد يحاول Prisma استبدال الملف عبر `rename` فيفشل على Windows لأن الملف مُقفَل.
- **الأثر:** لم يكن بالإمكان إعادة توليد العميل لتفعيل النماذج الجديدة (`Contact`، `PropertyFloor`، `RequestedProperty`، `PropertyRevision`)، رغم أن الترحيل كان **مُطبَّقًا ومتحقَّقًا منه** على قاعدة التطوير.
- **الفجوة الثانية (للتحقق):** سُجِّل سابقًا أن `localhost:5433` و`127.0.0.1:5433` قد يسلكان مسارات شبكية مختلفة، وأن أول `migrate deploy` بدا ناجحًا عبر `localhost` دون أن تظهر آثاره فورًا في قاعدة Docker المتوقعة. أُدرج التحقق من هذا الغموض (للقراءة فقط) ضمن هذه المهمة.

---

## 2. العمليات الفعلية التي تم تحديدها

تم تحديد العمليات الحالية عبر: مسار التنفيذ، سطر الأوامر، العملية الأب/التابع، والاستماع على المنفذ. **لم يُفترض صلاحية المعرّفات القديمة**؛ فالمعرّفات تغيّرت عن المهمة السابقة.

### 2.1 شجرة خادم الخلفية (Arkan Backend) قبل الإيقاف

| PID | PPID | العملية | ملاحظات |
| --- | --- | --- | --- |
| `7488` | `14140` | `cmd.exe /k` بعنوان `BACKEND_ArkanCRM` | وحدة التحكم الأصلية (original process controller) |
| `17244` | `7488` | `node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch` | مراقب Nest (watcher) |
| `15468` | `17244` | `cmd.exe` | وسيط تشغيل التطبيق المُصرَّف |
| `12188` | `15468` | `node --enable-source-maps D:\Projects\arkan-crm\apps\backend\dist\main` | **التطبيق الذي يخدم المنفذ 4001** |
| `15788` | `17220` | `cmd.exe /k` بعنوان `BACKEND_ArkanCRM` (نسخة مكرّرة) | وحدة تحكم ثانية |
| `4416` | `15788` | `node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch` | **مراقب مكرّر** لا يخدم المنفذ (نسخة زائدة) |

- **مكان التشغيل:** `D:\Projects\arkan-crm\apps\backend` (تُستدل من المسار النسبي `..\..\node_modules`).
- **طريقة التشغيل الأصلية:** `cmd.exe /k` بعنوان `BACKEND_ArkanCRM` ثم `node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch`.
- **اتصال قاعدة البيانات وقت التشغيل:** التطبيق `12188` كان متصلًا بـ`[::1]:5433` (عبر `wslrelay`) — أي إلى نفس حاوية Docker (انظر §5).
- وُجد **مراقبان مكرّران** للخلفية، أحدهما فقط يخدم المنفذ 4001.

### 2.2 الواجهة الأمامية (لا يجوز لمسها)

| PID | PPID | العملية | ملاحظات |
| --- | --- | --- | --- |
| `1444` | `17220` | `cmd.exe /k` بعنوان `FRONTEND_ArkanCRM` | وحدة تحكم الواجهة |
| `17008` | `1444` | `node ..\..\node_modules\next\dist\bin\next dev -p 3001` | Next.js dev |
| `15488` | `17008` | `next ... start-server.js` | **يخدم المنفذ 3001** |

### 2.3 عمليات غير متعلقة (تم استثناؤها)

- `4516` — Adobe Creative Cloud Experience.
- `5140` / `6412` — Windows Net Service Helper.
- Docker Desktop / PostgreSQL 16 / Redis (حاويات) — لم تُلمَس.

**الخلاصة:** عمليات Arkan Backend = `{7488, 17244, 15468, 12188}` و`{15788, 4416}`. الواجهة الأمامية = `{1444, 17008, 15488}`.

---

## 3. العمليات التي أُوقفت وأُعيد تشغيلها

### 3.1 ما تم إيقافه (فقط خادم Arkan Backend)

تم الاستهداف بالمعرّف مع الشجرة الفرعية (`/T`)، **بدون** استهداف كل عمليات `node.exe`:

```
taskkill /T /F /PID 7488    -> terminated 15412, 17244, 7488      (exit 0)
taskkill /T /F /PID 15788   -> terminated 1604, 2804, 7596, 4416, 15788  (exit 0)
```

- أُوقفت **شجرتا** خادم الخلفية (بما فيها المراقب المكرّر) لإفراغ قفل ملف المحرّك.
- **ملاحظة أمانة:** تعذّر الإيقاف "اللطيف" التفاعلي (Ctrl+C) من بيئة غير تفاعلية، لذا استُخدم `taskkill /T /F` على المعرّفات المُتحقَّق منها فقط. لم تُستهدف عمليات غير محدّدة، ولم يُحذف أي ملف مقفل، ولم تُحذف `node_modules`.
- **لم تُلمس** الواجهة الأمامية، ولا Docker/PostgreSQL/Redis، ولا العمليات غير المتعلقة.

### 3.2 التحقق بعد الإيقاف

| الفحص | النتيجة |
| --- | --- |
| منفذ `4001` | ✅ أُفرِغ (لم يعد يستمع) |
| منفذ `3001` | ✅ ما زال يستمع (الواجهة لم تتأثر) |
| عمليات Node المتبقية | الواجهة الأمامية + Adobe + WindowsNetService فقط |
| قفل ملف المحرّك `query_engine-windows.dll.node` | ✅ `DLL_LOCKED=NO` (تحرّر) |

### 3.3 إعادة التشغيل

أُعيد تشغيل **نسخة واحدة فقط** من خادم الخلفية بالأمر التطويري المعتمد، بنفس أسلوب التشغيل الأصلي (نافذة `cmd` منفصلة حتى لا تتأثر بجلسة الأدوات)، من المجلد الصحيح:

```
cwd = D:\Projects\arkan-crm\apps\backend
cmd /k "title BACKEND_ArkanCRM && node ..\..\node_modules\@nestjs\cli\bin\nest.js start --watch"
```

- **العمليات الجديدة:** مراقب `11996` (`nest start --watch`) → التطبيق `16804` (`node --enable-source-maps dist/main`).
- ✅ لم تُشغَّل أي نسخة مكرّرة (النسخة الزائدة السابقة أُزيلت).
- ✅ أصبح المنفذ `4001` يخدمه التطبيق `16804` (بعد ~39 ثانية من التجميع والبدء).

---

## 4. نتيجة توليد Prisma Client

| الخطوة | الأمر | النتيجة |
| --- | --- | --- |
| التحقق من المخطط | `npx prisma validate` | ✅ «The schema at prisma\schema.prisma is valid 🚀» — exit 0 |
| توليد العميل | `npx prisma generate` | ✅ «Generated Prisma Client (v6.19.3) to .\..\..\node_modules\@prisma\client in 508ms» — exit 0 |

**إصدار Prisma:** CLI `6.19.3` و`@prisma/client` `6.19.3` (لم يُثبَّت/يُرقَّى أي شيء).

**تأكيد احتواء العميل المُولَّد على النماذج والحقول الجديدة** (فحص ملف `node_modules/.prisma/client/index.d.ts`):

| العنصر المطلوب | موجود | الدليل |
| --- | --- | --- |
| `Contact` | ✅ | `get contact(): Prisma.ContactDelegate<...>` + `interface ContactDelegate<...>` |
| `PropertyFloor` | ✅ | `get propertyFloor(): Prisma.PropertyFloorDelegate<...>` |
| `RequestedProperty` | ✅ | `get requestedProperty(): Prisma.RequestedPropertyDelegate<...>` |
| `PropertyRevision` | ✅ | `get propertyRevision(): Prisma.PropertyRevisionDelegate<...>` |
| `Property.contactId` | ✅ | `contactId: string \| null` |
| `Property.createdByUserId` | ✅ | `createdByUserId: string \| null` |
| `Property.primaryImageId` | ✅ | `primaryImageId: string \| null` |
| `Property.version` | ✅ | `version: number` |
| `Property.ownerId` اختياري | ✅ | `ownerId: string \| null` |
| `DealType.EXCHANGE` | ✅ | `EXCHANGE: 'EXCHANGE'` |

**النتيجة:** نجح توليد Prisma Client، وأصبح يحتوي فعليًا على النماذج والحقول الجديدة والعدد `EXCHANGE`.

---

## 5. نتائج فحص اتصال قاعدة البيانات

تم الفحص **للقراءة فقط** عبر ثلاث طرق وصول، مع مقارنة بصمة الخادم (server fingerprint) للتحقق من الهوية:

- `localhost:5433`
- `127.0.0.1:5433`
- `[::1]:5433` (IPv6)
- الوصول المباشر داخل الحاوية `arkan-crm-postgres-1` (Unix socket)

استُخدمت استعلامات قراءة فقط: `current_database()`، `current_schema()`، `current_user`، `inet_server_addr()`، `inet_server_port()`، إصدار الخادم، `pg_postmaster_start_time()`، عدد الترحيلات المُطبَّقة، ووجود الجداول الجديدة.

| المسار | القاعدة | Schema | المستخدم | srvaddr | srvport | الإصدار | بدء الخادم | الترحيلات | Contact | PropertyRevision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `localhost:5433` | arkan_crm | public | postgres | 172.19.0.2 | 5432 | 16.15 | 2026-10-14 13:56:35.374396+00 | 3 | ✅ | ✅ |
| `127.0.0.1:5433` | arkan_crm | public | postgres | 172.19.0.2 | 5432 | 16.15 | 2026-10-14 13:56:35.374396+00 | 3 | ✅ | ✅ |
| `[::1]:5433` | arkan_crm | public | postgres | 172.19.0.2 | 5432 | 16.15 | 2026-10-14 13:56:35.374396+00 | 3 | ✅ | ✅ |
| مباشر داخل الحاوية | arkan_crm | public | postgres | unix | — | 16.15 | 2026-10-14 13:56:35.374396+00 | 3 | ✅ | ✅ |

> ملاحظة: أوامر `localhost`/`127.0.0.1`/`[::1]` استخدمت كتلة `DO $$ ... RAISE EXCEPTION` **عن قصد** لطباعة البصمة (سلوك متوقّع، وليس خطأ).

**قراءة النتيجة:** جميع المسارات تشير إلى **نفس الخادم ونفس القاعدة**:
- `srvaddr = 172.19.0.2` هو عنوان **داخل حاوية Docker**، و`srvport = 5432` هو المنفذ الداخلي للحاوية، و`inet_server_addr()` من الـUnix socket يُرجع `unix` لكنه **نفس** خادم الـPostgreSQL (نفس `pg_postmaster_start_time` ونفس الإصدار).

**قاعدة بيانات التشغيل الفعلية للخلفية (NestJS):** عملية التطبيق متصلة بـ`[::1]:5433`، وهي بحسب البصمة أعلاه **نفس الحاوية/نفس قاعدة `arkan_crm`** — لم تُكتشف أي قاعدة بيانات بديلة.

**عن الغموض السابق (`localhost` مقابل `127.0.0.1`):** لم يكن قابلًا لإعادة الإنتاج؛ جميع المسارات الآن تعطي بصمة متطابقة، كما تم استبعاد فرضية "تسريب متغيرات البيئة بين استدعاءات الشل" (الاختبار أعاد `READ=[]` — لا استمرارية للمتغيرات). للحصول على الحياد القطعي نوصي بتثبيت المضيف على `127.0.0.1` في أدوات قاعدة البيانات (انظر §11).

---

## 6. هل `localhost` و`127.0.0.1` يصلا نفس قاعدة البيانات؟

**نعم.** كلٌّ من `localhost:5433` و`127.0.0.1:5433` (وكذلك `[::1]:5433`) يؤدي إلى **نفس نسخة PostgreSQL** (الحاوية `arkan-crm-postgres-1`، عنوانها الداخلي `172.19.0.2`، الإصدار 16.15، ونفس وقت بدء الخادم) ونفس قاعدة `arkan_crm` ونفس الـschema `public` ونفس عدد الترحيلات (3) ونفس وجود جداول `Contact`/`PropertyRevision`.

لذلك **لا توجد "قاعدتان مختلفتان"**، ولا يمكن تفسير السلوك الغامض السابق باختلاف القاعدة. أي اختلاف مستقبلي يجب أن يُفحص ببصمة الخادم هذه قبل أي عملية تغيير. **لم تُنفَّذ أي عملية تغيير على قاعدة البيانات أثناء هذا الفحص.**

---

## 7. التحقق من الترحيل المُطبَّق

تحقق **للقراءة فقط** على قاعدة التطوير `arkan_crm`:

| البند | النتيجة |
| --- | --- |
| عدد الترحيلات في `_prisma_migrations` | ✅ **3** ومكتملة (`finished = t`) |
| `20260907000000_initial` | ✅ مُطبَّق |
| `20260907100000_mvp_schema_refinements` | ✅ مُطبَّق |
| `20261015100000_property_schema_expansion` | ✅ **مُطبَّق** |
| جدول `Contact` | ✅ موجود (`public."Contact"`) |
| جدول `PropertyFloor` | ✅ موجود |
| جدول `RequestedProperty` | ✅ موجود |
| جدول `PropertyRevision` | ✅ موجود |
| `Property.ownerId` اختياري | ✅ `is_nullable = YES` |
| بيانات المستخدم/المصادقة سليمة | ✅ `User = 2` (`manager@arkan.test` MANAGER، `employee@arkan.test` EMPLOYEE)، `EmployeeProfile = 1`، `RefreshToken = 34` |
| الفهرس الفريد الجزئي للإصدار المعلّق | ✅ `PropertyRevision_one_pending_per_property` موجود |
| قيد ميزانية العقار المطلوب | ✅ `RequestedProperty_budget_range_check` موجود |

**لم يُنفَّذ** أي من: `prisma migrate deploy` / `migrate dev` / `migrate reset` / `db push` / seed. قراءة حالة الترحيل (`npx prisma migrate status`) أعادت: «3 migrations found» + «Database schema is up to date!».

---

## 8. نتيجة الحفاظ على النسخة الاحتياطية

- **النسخة الأصلية (مؤقتة):** `C:\Users\omar9\AppData\Local\Temp\opencode\arkan-db-backups\arkan_crm_dev_20261015_161201.dump` — **موجودة** (65,869 بايت).
- **النسخة الدائمة (خارج المستودع وخارج مجلدات التنظيف):** `C:\Users\omar9\Documents\arkan-crm-db-backups\arkan_crm_dev_20261015_161201.dump`.

| البند | القيمة |
| --- | --- |
| طريقة النقل | **نسخ** (`Copy-Item`) — لم يُنقَل ولم يُحذَف الأصل |
| تجاوز ملف موجود | لا — لو وُجد ملف بالاسم نفسه لما جرى الكتابة فوقه (المجلد كان جديدًا) |
| الحجم | 65,869 بايت (مطابق) |
| SHA-256 للأصل | `186381F0A0BE275C46F50CB48EA79FE7EC8C7D1AF1F308AAD4537576E4C0136B` |
| SHA-256 للنسخة | `186381F0A0BE275C46F50CB48EA79FE7EC8C7D1AF1F308AAD4537576E4C0136B` |
| تطابق البصمة | ✅ `True` |

- **لم تُنفَّذ أي عملية استعادة (restore)**، ولم تُرفَع النسخة، ولم تُلتزم في Git، ولم تُطبَع أي بيانات اعتماد. النسخة تحتوي (مبدئيًا) على بيانات المستخدمين المُجزَّأة، لذا يجب إبقاؤها **خاصة**.

---

## 9. التحقق من تشغيل الخلفية

| الفحص | الأمر/الهدف | النتيجة |
| --- | --- | --- |
| المنفذ 4001 | `netstat` | ✅ يخدمه التطبيق `16804` |
| المنفذ 3001 | `netstat` + طلب HTTP | ✅ الواجهة `15488` تعمل، `HTTP 200` (لم تتأثر) |
| `GET /health` | `http://localhost:4001/health` | ✅ `200` — `{"data":{"status":"ok","service":"arkan-api"}}` |
| `GET /health/ready` | (قاعدة + Redis) | ✅ `200` — `{"status":"ok","database":"up","redis":"up"}` |
| `GET /auth/me` بدون رمز | | ✅ `401` |
| بدء الخلفية دون أخطاء Prisma | سجل التشغيل | ✅ «Found 0 errors» ثم «Nest application successfully started» |
| الوصول لقاعدة التطوير | سجل + `/health/ready` + اتصال `[::1]:5433` | ✅ `database: up` |
| أخطاء مخطط/ترحيل غير متوقعة | فحص السجل | ✅ لا شيء (لا `EPERM`، لا `PrismaClientInitializationError`، لا استثناءات) |

- **لم يُنفَّذ تسجيل دخول (login)** ولا أي كتابة بيانات أعمال (لتجنّب الكتابات غير الضرورية)، لذا بقي عدد `RefreshToken = 34` دون تغيير.
- جرت إعادة التشغيل بنجاح **بعد** أن صار ملف المحرّك غير مقفول.

---

## 10. نتائج Typecheck وJest

| الفحص | الأمر | النتيجة |
| --- | --- | --- |
| Prisma validate | `npx prisma validate` | ✅ valid (exit 0) |
| Prisma generate | `npx prisma generate` | ✅ نجح (exit 0) |
| Typecheck | `npm run typecheck -w @arkan/backend` | ✅ `tsc --noEmit` — exit 0 |
| اختبارات Jest | `npm run test -w @arkan/backend` | ✅ **3 suites / 12 tests passed** — exit 0 |
| حالة الترحيل (قراءة فقط) | `npx prisma migrate status` | ✅ 3 ترحيلات، up to date |
| فحوص صحة الخلفية | `/health`، `/health/ready`، `/auth/me` | ✅ 200 / 200 / 401 |
| `git diff --check` | | ✅ exit 0 (تحذيرات CRLF فقط من Git على Windows، لا أخطاء مسافات) |

---

## 11. المخاطر والعوائق المتبقية

1. **قفل ملف محرّك Prisma أثناء التشغيل:** إعادة توليد `prisma generate` تتعارض مع خادم خلفية قيد التشغيل. عند الحاجة لإعادة التوليد مستقبلًا: أوقف خادم الخلفية (شجرته) → ولّد → ثم أعد التشغيل.
2. **الفهرس الفريد الجزئي `PropertyRevision_one_pending_per_property`:** مُنشأ بـSQL خام وغير منمذج في Prisma؛ يجب مراجعة أي `migrate dev` مستقبلي لضمان ألّا يولّد `DROP INDEX` له.
3. **الترحيل `20260907100000_mvp_schema_refinements`:** يفشل عن قصد إن لم تكن جداول المال فارغة؛ يجب أن يكون مُطبَّقًا أولًا في أي بيئة جديدة.
4. **الخصوصية ما زالت أمامية فقط:** لا يوجد تفويض خلفي (backend authorization) لبيانات المالك/جهة التواصل بعد — يجب تنفيذه في الـAPIs.
5. **حياد الاتصال:** نوصي بتثبيت المضيف على `127.0.0.1` (IPv4) في أدوات قاعدة البيانات لتجنّب غموض `localhost`→`::1`، لكن **تغيير أي إعداد بيئة دائم يتطلب موافقة صريحة** (لم يُغيَّر أي ملف `.env`).
6. **النسخة الاحتياطية حساسة:** تحتوي بيانات مصادقة مُجزَّأة؛ حافظ عليها خاصة، خارج Git.
7. **نسخ المراقبين المكرّرة:** أُزيلت النسخة الزائدة؛ يجب الإبقاء على مراقب واحد لخادم الخلفية.

---

## 12. حالة الجاهزية الدقيقة لتنفيذ Properties وContacts APIs

| البند | الحالة |
| --- | --- |
| توليد Prisma Client (نموذج `Contact`) | `Completed` |
| توليد Prisma Client (`PropertyFloor`, `RequestedProperty`, `PropertyRevision` وحقول العقار الجديدة و`EXCHANGE`) | `Completed` |
| ترحيل توسيع المخطط مُطبَّق على قاعدة التطوير | `Completed` |
| هوية قاعدة البيانات مؤكدة قطعيًا (مسار واحد) | `Completed` |
| خادم الخلفية يعمل ويصل القاعدة الصحيحة | `Completed` |
| Typecheck + اختبارات Jest | `Completed` |
| **الجاهزية التقنية لبدء تنفيذ Properties/Contacts APIs** | ✅ **`Completed`** — المخطط والعميل والأساس (مصادقة/حراسة JWT) جاهزة |
| **تنفيذ Properties/Contacts APIs فعليًا** | ❌ **`Not Implemented`** — **بانتظار موافقة جديدة صريحة** (خارج نطاق هذه المهمة) |
| تفويض الصفوف (row-level authorization) خلفيًا | `Not Implemented` (متطلّب للمرحلة التالية) |
| تنقيح/إخفاء بيانات جهات التواصل في DTOs | `Not Implemented` (متطلّب للمرحلة التالية) |

**الخلاصة:** البيئة المحلية **جاهزة تقنيًا** لتنفيذ Properties/Contacts: العميل مُولَّد بالكامل، والترحيل مُطبَّق ومتحقَّق منه، وقاعدة البيانات هوية واحدة مؤكدة، والخادم يعمل ويصلها. **لكن التنفيذ نفسه لم يبدأ ولم يُصرَّح به**؛ يتطلّب موافقة المالك على المرحلة التالية.

---

## 13. تأكيدات الامتثال

- ✅ **لا كتابة على قاعدة البيانات** ولا أي ترحيل/prisma db push/reset/seed.
- ✅ لم يُغيَّر أي ملف `.env`، ولم تُطبَع أي بيانات اعتماد أو سلسلة اتصال كاملة.
- ✅ لم تُثبَّت/تُرقَّى أي اعتماديات (Prisma بقي `6.19.3`).
- ✅ لم تُحذَف `node_modules`، ولم يُحذَف أي ملف مقفل، ولم تُلمَس الواجهة الأمامية/معالج Astra.
- ✅ أُوقفت **فقط** عمليات Arkan Backend المُتحقَّق منها، ثم أُعيد تشغيل نسخة واحدة سليمة.
- ✅ الحفاظ على كل العمل غير المُلتزم؛ لم يُنفَّذ `git reset` ولا commit ولا push (`HEAD = ff71379`).
- ✅ نسخة احتياطية دائمة محفوظة خارج المستودع ببصمة مطابقة، دون استعادة.

**الحالة النهائية:** `Completed` — استُعيد توليد Prisma Client، وأُكِّدت هوية قاعدة بيانات التطوير وأصبحت قطعية، وأُعيد تشغيل خادم الخلفية بنجاح. **ونتوقّف بانتظار موافقة صريحة قبل تنفيذ Properties/Contacts APIs.**
