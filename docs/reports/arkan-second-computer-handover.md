# تسليم Arkan CRM إلى جهاز كمبيوتر ثانٍ

**التاريخ:** 2026-11-22

**الفرع:** `main`

**آخر commit قبل إضافة هذا التقرير:** `cbbcbc52a73b37ae2dc89cdfcc95f6c6037288f5`

**الـ commit النهائي:** هو الـ commit الذي يضيف هذا التقرير، وهو آخر commit على `main`. تحقّق محليًا بالأمر:

```powershell
git rev-parse HEAD
```

**عدد الترحيلات المتعقبة حاليًا:** 27 ترحيلًا.

**رابط الاستنساخ:**

```text
https://github.com/omar9kk1/arkan-crm.git
```

---

## 1. المتطلبات الفعلية للجهاز الجديد

| المكوّن | المطلوب |
|---|---|
| نظام التشغيل | Windows 10/11 مع PowerShell |
| Git | أي إصدار حديث |
| Node.js | `>=22` حسب `package.json`؛ تم التحقق محليًا بـ `24.16.0` |
| npm | تم التحقق محليًا بـ `11.13.0` |
| Docker Desktop | مع Docker Compose |
| PostgreSQL | `postgres:16` عبر `docker-compose.yml` |
| Redis | `redis:7-alpine` عبر `docker-compose.yml` |
| Next.js | `16.4.5` |
| React | `19.2.x` |
| NestJS | `11.2.x` |
| Prisma | `6.19.x` |
| TypeScript | `5.9.x` |

**المنافذ الفعلية في المشروع الحالي:**

- الواجهة: `http://localhost:3001`
- الخادم: `http://localhost:4001`
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6379`

> ملف `README.md` القديم يذكر 3000/4000 في بعض الأمثلة. المرجع الأدق للوضع الحالي هو `AGENTS.md` وسكربتات `package.json`.

---

## 2. خطوات التثبيت على جهاز Windows جديد

```powershell
git clone https://github.com/omar9kk1/arkan-crm.git
Set-Location arkan-crm

Copy-Item apps/backend/.env.example apps/backend/.env
Copy-Item apps/frontend/.env.local.example apps/frontend/.env.local
```

حرّر `apps/backend/.env` و`apps/frontend/.env.local` بالقيم المناسبة. لا تضع أي سر داخل Git.

```powershell
npm ci
npm run db:generate
npm run build -w @arkan/shared
docker compose up -d postgres redis
docker compose ps
```

انتظر حتى يصبح PostgreSQL جاهزًا وRedis يرد بـ `PONG`، ثم:

```powershell
npm run db:deploy -w @arkan/backend
npm run db:seed -w @arkan/backend
npm run dev
```

`db:deploy` و`db:seed` مخصصان لقاعدة جديدة/فارغة. لا تشغّلهما على نسخة مستعادة من قاعدة الشركة قبل فحص `prisma migrate status` والتأكد من الحالة.

**روابط التحقق:**

- تسجيل الدخول: `http://localhost:3001/login`
- صحة الخادم: `http://localhost:4001/health`
- جاهزية قاعدة البيانات والطابور: `http://localhost:4001/health/ready`

---

## 3. أسماء متغيرات البيئة المطلوبة (بدون أي قيم)

### الخادم — `apps/backend/.env`

- `NODE_ENV`
- `PORT`
- `FRONTEND_ORIGIN`
- `DATABASE_URL`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD` (اختياري)
- `JWT_ACCESS_SECRET` (إلزامي، 32 حرفًا على الأقل، يُولَّد محليًا)
- `JWT_ACCESS_TTL_SECONDS` (اختياري)
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `AUTH_COOKIE_MODE`
- `COOKIE_SECURE`
- `STORAGE_ROOT` (اختياري)
- `PUSH_VAPID_PUBLIC_KEY` / `PUSH_VAPID_PRIVATE_KEY` / `PUSH_VAPID_SUBJECT` (اختيارية حسب Web Push)
- متغيرات Rate Limiting الاختيارية: `RATE_LIMIT_*`
- `TRUST_PROXY` (اختياري)

### الواجهة — `apps/frontend/.env.local`

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_AUTH_MODE`
- `CSP_MODE`

> لا تُضاف أي أسرار إلى متغيرات `NEXT_PUBLIC_*`.

---

## 4. ما لا يمكن نقله عبر GitHub

- بيانات PostgreSQL الحقيقية لقاعدة `arkan_crm`.
- صور العقارات والملفات المرفوعة داخل `STORAGE_ROOT`.
- ملفات `.env` و`.env.local` وأي مفاتيح/JWT/VAPID.
- النسخ الاحتياطية وقواعد البيانات المحلية.
- سجلات `.dev/logs` وملفات التشخيص المحلية.
- أي ملفات داخل `node_modules`, `.next`, `dist`, `backups`.

هذه الملفات مستثناة في `.gitignore` ولا ينبغي إضافتها يدويًا.

---

## 5. نقل البيانات المحلية بأمان

### قاعدة البيانات

على الجهاز القديم، مع إيقاف الكتابة أو أخذ نسخة متسقة:

```powershell
pg_dump -Fc -f arkan_crm.dump $env:DATABASE_URL
```

انقل `arkan_crm.dump` عبر وسيط مشفّر، ثم على الجهاز الجديد:

```powershell
pg_restore --clean --if-exists -d $env:DATABASE_URL arkan_crm.dump
```

لا تضع ملف `.dump` في Git. تحقق من اسم قاعدة الهدف قبل الاستعادة، واحتفظ بنسخة احتياطية منفصلة.

### صور العقارات والملفات

انسخ محتويات `STORAGE_ROOT` (الافتراضي عادة `%USERPROFILE%\.arkan-crm\storage`) إلى نفس المسار أو إلى مسار جديد تحدده في `.env`، عبر قرص مشفّر أو قناة نقل آمنة.

### ملفات البيئة

انقل قيم `.env` و`.env.local` عبر مدير كلمات مرور أو قناة مشفّرة. لا ترسلها عبر Git أو الدردشة أو البريد غير المشفّر.

---

## 6. أعمال غير مكتملة أو تحتاج متابعة

1. **ترحيل Finance FX غير مطبّق على قاعدة `arkan_crm` الحقيقية.**
   - الترحيل موجود في المصدر: `20261122120000_finance_fx_reporting`.
   - لا تطبّقه على قاعدة الشركة دون موافقة صريحة ونسخة احتياطية متحققة.
   - حتى تطبيقه، مسارات المالية على القاعدة الحقيقية تفشل مغلقة برسالة «الترحيل غير مطبّق».
   - إنشاء الصفقات يظل يعمل ويسجّل الحركات القديمة.

2. **الحركة القديمة بالجنيه المصري لم تُحوَّل بعد.**
   - المعاينة للقراءة فقط أظهرت حركة EGP واحدة بقيمة `500.000` بتاريخ `2026-11-13`.
   - سعر Frankfurter لذلك التاريخ `0.0057918`، والمعادل المتوقع `2.896` د.ك.
   - لم تُحفظ هذه القيمة ولم تُعدّل الحركة.
   - أمر المعاينة:

```powershell
node --env-file-if-exists=apps/backend/.env apps/backend/dist/scripts/finance-fx-backfill.js --preview --limit=20
```

   - التطبيق الحالي محصور برمجيًا بقاعدة `arkan_crm_api_test`. أي Backfill حقيقي يتطلب موافقة منفصلة وتعديل الحارس بعد التحقق من النسخة الاحتياطية.

3. **اختبارات قاعدة البيانات تحتاج `TEST_DATABASE_URL` مضبوطًا على `arkan_crm_api_test` فقط.**
   - لا توجّه الاختبارات إلى `arkan_crm`.
   - أداة `resetDatabase` في اختبارات الخادم لا تزال بلا حارس اسم قاعدة مستقل، لذا يجب التحقق يدويًا قبل تشغيل اختبارات التكامل.

4. **اختلاف توثيقي بسيط:** `README.md` يذكر منافذ 3000/4000 في بعض الأمثلة، بينما الوضع الحالي 3001/4001. اعتمد `AGENTS.md`.

5. **Rate Limiting وPrisma وCSP enforcement** ليست ضمن هذه المزامنة، ولا ينبغي بدؤها دون طلب صريح.

---

## 7. التحقق بعد الاستنساخ

```powershell
git log -1 --format="%H %s"
git status --short
npm ci
npm run typecheck
npm run lint
npm run build
docker compose up -d postgres redis
npm run db:generate
```

ثم تحقق من قاعدة البيانات:

```powershell
npm run db:validate -w @arkan/backend
npx prisma migrate status --schema apps/backend/prisma/schema.prisma
```

وللاختبارات المركزة، بعد ضبط `TEST_DATABASE_URL` على `arkan_crm_api_test` فقط:

```powershell
npm run test -w @arkan/backend -- employees-deal-metrics.spec.ts employees.spec.ts deals.spec.ts finance.spec.ts fx-rate.spec.ts finance-fx-backfill.spec.ts finance-fx-backfill-guard.spec.ts frontend-employee-metrics.spec.ts frontend-finance-model.spec.ts
```

**النتيجة المتوقعة:** 10 suites و58 اختبارًا ناجحًا، مع بناء إنتاجي ناجح و27 ترحيلًا متعقبًا.
