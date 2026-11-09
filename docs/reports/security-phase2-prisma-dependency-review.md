# المرحلة الأمنية الثانية — المهمة 6: تقييم أمن تبعيات Prisma

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** مراجعة تبعيات Prisma وخطة الترقية فقط — بدون أي تغيير في التبعيات أو المخطط أو قاعدة البيانات.  
**الحالة:** مكتمل — بانتظار المراجعة.  
**القرار:** **ترقية رئيسية مخططة إلى Prisma 7.10.1**، مع **قبول مخاطر مؤقت موثق** حتى تنفيذها. لا يوجد patch/minor مدعوم في خط 6.x.

> لم يتم ترقية Prisma.  
> لم يتم تعديل `schema.prisma` أو migrations.  
> لم تُنفّذ migrations/resets/seeds.  
> لم تُلمس بيانات الأعمال أو `.env`.  
> لا commits أو pushes.  
> Cookie/CSRF وCSP وRate Limiting محفوظة.

---

## 1. النسخ المثبتة

| الحزمة | النسخة |
|---|---|
| `prisma` (CLI) | **6.19.3** (devDependency) |
| `@prisma/client` | **6.19.3** |
| `@prisma/config` | **6.19.3** (عبر CLI) |
| `deepmerge-ts` | **7.1.5** |
| Node | 24.x (المشروع يشترط >=22) |
| TypeScript | 5.9.x |

أحدث إصدارات متاحة:

- Prisma 6: **6.19.3** (لا يوجد إصلاح في 6.x)
- Prisma 7: **7.10.1**
- `@prisma/config` 7.10.1 → `deepmerge-ts` **8.0.2**
- Prisma 8: `8.0.0-rc.33` (غير مستقر — ليس هدفًا)

---

## 2. الثغرة المتبقية

| العنصر | القيمة |
|---|---|
| Advisory | **GHSA-ggr8-5vv4-36mx / CVE-2026-40345** |
| الحزمة | `deepmerge-ts < 8.0.0` |
| الشدة | **High — CVSS 8.2** |
| النوع | CWE-674 Stack Exhaustion |
| الإصلاح | `deepmerge-ts 8.0.0+` |
| المسار | `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5` |

الاستغلال يتطلب تمرير **رسوم كائنات متكررة/دائرية** إلى `deepmerge` في Prisma Config، مما يسبب `RangeError` وإسقاط العملية.

`npm audit --omit=dev` يعرض **3 high** فقط، وكلها نفس السلسلة:

- `prisma`
- `@prisma/config`
- `deepmerge-ts`

`npm audit` الكامل يعرض 31 مشكلة (5 low / 23 moderate / 3 high)، لكن باقي المشاكل في أدوات تطوير (Jest/ESLint/Nest CLI) وخارج نطاق هذه المهمة.

`npm audit fix --dry-run` لم يقترح أي تغيير آمن؛ الإصلاح المتاح هو Prisma **7.10.1** بترقية Major.

---

## 3. هل تصل الثغرة إلى runtime؟

### ما تم إثباته

- `@prisma/client` المستخدم في `PrismaService` لا يحمّل `@prisma/config` ولا `deepmerge-ts` وقت التشغيل:
  ```text
  require('@prisma/client') → require.cache @prisma/config/deepmerge-ts = []
  ```
- `@prisma/config` يُستخدم فقط عند تحميل **Prisma CLI** لملف `prisma.config.*` / دمج إعدادات CLI.
- لا يوجد endpoint أو service يمرر مدخلات مستخدم إلى Prisma CLI أو إلى `deepmerge`.
- `deepmerge-ts` غير مستورد مباشرة في كود التطبيق.

### لكن

- `prisma` موجود في **devDependencies**، لكنه يظهر أيضًا كـ optional peer لـ `@prisma/client`؛ لذلك:
  - `npm ls --omit=dev` يُظهر السلسلة.
  - `npm audit --omit=dev` يصنفها production.
- `docker/backend.Dockerfile` الحالي ينفّذ `npm ci` ويضمّن devDependencies في صورة التشغيل (لا توجد مرحلة runtime منفصلة/prune).
- العملية الفعلية `node dist/main.js` لا تستدعي CLI، لكن الصورة تحتوي على الحزمة القابلة للاستغلال وآلية CLI متاحة لأي عملية/طرف لديه تنفيذ داخل الحاوية.

**الخلاصة:** التعرض **ليس عبر طلبات HTTP العادية** ولا يمس استعلامات ORM. التعرض العملي محصور في:
- build/CI وتشغيل Prisma CLI على إعدادات غير موثوقة، أو
- وصول مهاجم إلى بيئة تشغيل CLI/الحاوية.

وثيقة القبول المؤقت يجب أن تذكر أن `npm audit --omit=dev` يظل أحمر حتى الترقية، حتى لو كان runtime التطبيق لا يحمّل الحزمة.

---

## 4. هل يوجد patch أو minor آمن؟

**لا.**

- لا يوجد Prisma 6.x أحدث من 6.19.3.
- `@prisma/config@6.19.3` يثبّت `deepmerge-ts` **بالضبط** على `7.1.5` (`"deepmerge-ts": "7.1.5"`).
- `deepmerge-ts` 8.0.0 هو أول إصدار مُصلح، لكنه **Major** وبه تغييرات:
  - دمج Map قيميًّا بشكل مختلف.
  - إعادة تسمية `DeepMergeMetaMetaData` و`DeepMergeIntoFunctionUtils`.
  - تغيير سلوك `deepmergeInto` (عدم تعديل المدخلات).
  - إضافة معالجة circular references.
- فرض `overrides: { "deepmerge-ts": "8.0.2" }` قد يعمل تقنيًا لأن `@prisma/config` يستخدم `deepmerge` فقط، لكنه:
  - غير مدعوم من Prisma،
  - يتجاوز pin صريحًا،
  - يحتاج اختبار Prisma CLI/config كاملًا.
- لم يتم تطبيق override في هذه المهمة.

**النتيجة:** لا يوجد patch/minor مدعوم. الطريق المدعوم الوحيد هو Prisma 7.10.1.

---

## 5. أثر Prisma 7 (خطة ترقية)

الهدف: **Prisma 7.10.1** (وليس 8 RC).

### 5.1 ESM — أكبر عائق

- Prisma 7 يوجّه إلى ESM ويطلب `"type": "module"` وإعدادات TypeScript `module: ESNext` / `moduleResolution: bundler` (أو NodeNext).
- المشروع الحالي:
  - `apps/backend/tsconfig.json`: `"module": "commonjs"`.
  - `apps/backend/package.json`: لا يوجد `"type": "module"`.
- يلزم قرار معماري: تحويل NestJS backend إلى ESM أو إثبات توافق CJS مع generated client. هذا يحتاج branch/اختبار مستقل، وليس ترقية مباشرة.

### 5.2 المولد والاستيرادات

- `generator client { provider = "prisma-client-js" }` يجب أن ينتقل إلى `prisma-client` مع `output` إلزامي (مثل `generated/prisma`).
- جميع استيرادات `@prisma/client` (أكثر من 40 موضعًا في `apps/backend/src`) تحتاج تحديثًا إلى المسار المولّد أو re-export مركزي.
- `PrismaService` يحتاج:
  - استيراد `PrismaClient` من العميل المولّد.
  - driver adapter (`@prisma/adapter-pg` + `pg`) لأن Prisma 7 يتطلب adapter لـPostgreSQL.
  - `new PrismaClient({ adapter })` بدل الاعتماد على engine/datasource.
- `@prisma/adapter-pg@7.10.1` يعتمد `pg` و`@types/pg`؛ لا بنية تحتية جديدة، لكنه يغيّر pool/SSL/timeout defaults.

### 5.3 Prisma Config

- إنشاء `prisma.config.ts` (غالبًا في `apps/backend` بجانب `package.json`):
  - `dotenv/config` مطلوب لتحميل `.env`.
  - `schema` و`migrations.path` و`migrations.seed`.
  - `datasource.url` من `DATABASE_URL`.
- Prisma 7 لا يحمّل env تلقائيًا، و`prisma generate` قد يفشل إذا استخدم `env()` بدون وجود المتغير.
- `datasource.url` في `schema.prisma` أصبح deprecated لصالح Config.
- `prisma migrate dev` لم يعد يشغّل generate/seed تلقائيًا؛ يجب تحديث سكربتات `db:migrate`/`db:seed`/`db:generate`.
- `directUrl` و`adapter`/`engine`/`studio` options تغيّرت/أُزيلت من Config.

### 5.4 قاعدة البيانات والـmigrations

- **لا تغيير مطلوب في schema البيانات أو الـ19 migrations الحالية** لترقية client/CLI.
- يجب اختبار `prisma validate` و`prisma migrate status` ضد قاعدة اختبار فقط.
- لا تنفيذ `migrate dev/reset` على `arkan_crm` أثناء الترقية.
- `migrate deploy` يحتاج Config/URL الجديد.
- لا migrations جديدة في مهمة الترقية ما لم يثبت وجود فرق schema.

### 5.5 Raw SQL وNestJS

- يوجد استخدامات حرجة لـ:
  - `$queryRaw` / `$executeRaw`
  - `Prisma.sql`
  - `pg_advisory_xact_lock` في auth/properties/followups
  - `$transaction`
- يجب إعادة اختبار:
  - أقفال advisory، منع التكرار، P/A counters
  - followups/health/notifications
  - الأنواع (`bigint`, Decimal, enums) بعد driver adapter
- Prisma Client middleware (`$use`) غير مستخدم؛ لا يوجد أثر مباشر.
- Prisma 7 driver adapter يغيّر connection pool/SSL defaults؛ يجب ضبط `PrismaPg` بما يطابق سلوك v6.

### 5.6 Docker / النشر

- Node 22/24 مدعوم (Prisma 7 engines: `^20.19 || ^22.12 || >=24`).
- يجب:
  - generate أثناء build،
  - نسخ العميل المولّد/الـadapter إلى runtime،
  - إبقاء Prisma CLI خارج صورة runtime أو prune dev dependencies (يفيد أيضًا في تقليل سطح الثغرة الحالية).
- Dockerfile الحالي لا يفصل build/runtime ولا يعمل prune؛ هذا يحتاج تحسينًا منفصلًا.

### 5.7 خطة التنفيذ المقترحة

1. Branch/worktree معزول + backup lockfile/package/config.
2. تثبيت `prisma@7.10.1` و`@prisma/client@7.10.1` و`@prisma/adapter-pg` و`pg` و`dotenv` في بيئة اختبار.
3. حل قرار ESM/CJS في build وNest runtime.
4. إنشاء `prisma.config.ts` ونقل datasource/seed/migrations.
5. تحويل generator إلى `prisma-client` مع output، وإضافة re-export مركزي.
6. تحديث PrismaService إلى driver adapter.
7. تحديث استيرادات `@prisma/client` في كل الملفات.
8. تشغيل `prisma validate/generate`، ثم full tests + raw SQL + browser smoke (cookies/CSRF/upload/push/CSP) على `arkan_crm_api_test`.
9. قياس/مراجعة pool وSSL، ثم Docker build/run.
10. لا نشر قبل اعتماد منفصل.

### 5.8 Rollback

- استعادة `package.json` و`package-lock.json` و`schema.prisma` و`prisma.config.ts` والملفات المستوردة من العميل المولّد.
- `npm ci` من lock السابق.
- إعادة بناء backend.
- لا rollback قاعدة بيانات مطلوب إذا لم تُنفّذ migrations جديدة.
- إعادة تشغيل الاختبارات الأساسية وCookie auth.

---

## 6. التوصية

**ترقية رئيسية مخططة إلى Prisma 7.10.1**، وليس patch/minor.

حتى تنفيذها:

- **قبول مخاطر مؤقت موثق** لهذه السلسلة، بناءً على:
  - عدم تحميل `@prisma/config`/`deepmerge-ts` في runtime التطبيق،
  - عدم وجود مسار مستخدم يصل إلى Prisma CLI/config،
  - الثغرة تتطلب recursive object graph في CLI config.
- تقليل التعرض فورًا دون ترقية Prisma:
  1. عدم تمرير إعدادات/ملفات Prisma CLI غير موثوقة.
  2. فصل build عن runtime في Docker وprune dev dependencies/CLI.
  3. تقييد CI ومن له حق تعديل `prisma.config.*`/environment.
  4. إبقاء `npm audit` مراقبًا وموثقًا؛ لا اعتبار السلسلة "مغلقة".
- **لا** نوصي بـ override غير مدعوم لـ`deepmerge-ts@8.0.2` كحل نهائي؛ يمكن تجربته فقط في branch مؤقت إذا طلب المالك حلًا فوريًا.

---

## 7. التحقق المنفذ (بدون تغييرات)

| الفحص | النتيجة |
|---|---|
| `npm ls` Prisma chain | 6.19.3 → 6.19.3 → 7.1.5 |
| `npm audit --omit=dev` | 3 high: prisma/@prisma/config/deepmerge-ts |
| `npm audit` full | 31 (5 low/23 moderate/3 high)، الباقي أدوات تطوير |
| runtime require cache | لا تحميل لـ@prisma/config أو deepmerge-ts |
| `npm audit fix --dry-run` | لا تغييرات؛ الحل Major 7.10.1 |
| Prisma 7 docs | ESM، generator/output، driver adapter، prisma.config |
| Prisma 7.10.1 config | deepmerge-ts 8.0.2 (مُصلح) |

لم تُجرَ أي ترقية أو migrations أو اختبارات قاعدة بيانات في هذه المهمة؛ لا تغييرات في كود المنتج.

---

## 8. الملفات والحالة

**تمت إضافة هذا التقرير فقط:**

- `docs/reports/security-phase2-prisma-dependency-review.md`

لم يتم تغيير:

- `apps/backend/package.json` أو lock.
- `schema.prisma` أو migrations.
- `.env` أو `.env.local`.
- أي كود أو واجهة.

**الخلاصة:** القرار الآمن هو **خطة ترقية Prisma 7.10.1**، مع قبول مؤقت موثق وعدم ترقية فورية. لا تفعيل أو ترقية قبل اعتماد المالك.

**التوقف هنا للمراجعة.**
