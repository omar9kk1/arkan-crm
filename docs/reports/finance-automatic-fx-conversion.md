# تحويل العملات التلقائي في المالية (EGP → KWD)

التاريخ: 2026-11-22

الحالة: منفّذ ومختبر على قاعدة الاختبار المعزولة فقط. لم يُطبّق أي ترحيل أو Backfill على قاعدة `arkan_crm`، ولم يتم commit أو push.

## ما تم تنفيذه

- تحويل تلقائي للمصروفات المسجلة بالجنيه المصري إلى الدينار الكويتي عند الحفظ، دون حقل سعر يدوي أو زر إضافي.
- حفظ المبلغ الأصلي والعملة الأصلية، والمبلغ المعادل بالدينار، وسعر التحويل، وتاريخ السعر الفعلي، والمزوّد، وحالة التحويل على `FinanceMovement`.
- جلب السعر من مزوّد واحد مسموح فقط: `https://api.frankfurter.dev/v2/rate/EGP/KWD?date=YYYY-MM-DD` مع تثبيت المضيف، HTTPS فقط، رفض إعادة التوجيه، ومهلة 8 ثوانٍ.
- استخدام تاريخ الحركة كما هو (تقويم الكويت UTC+3)، ورفض تاريخ مستقبلي، وعدم قبول سعر أحدث من تاريخ الحركة، وقبول أحدث سعر سابق ضمن 7 أيام كحد أقصى للعطلات.
- تقريب مبلغ الدينار إلى 3 منازل عشرية بـ `ROUND_HALF_UP` باستخدام `Prisma.Decimal` فقط، دون حسابات عائمة.
- الفشل المغلق: إذا تعذّر المزوّد لا يُحفظ المصروف ولا أي حركة، ويُعاد خطأ عربي واضح (503).
- الحفاظ على Idempotency: إعادة الطلب بنفس `requestId` تعيد نفس الحركة دون استدعاء المزوّد مرة أخرى، مع حماية التزامن عبر القيد الفريد و`P2002`.
- عدم إعادة حساب أي حركة محوّلة لاحقًا: السعر والتاريخ المحفوظان ثابتان.
- الملخصات المالية أصبحت بالدينار فقط وتعتمد حصرًا على `reportingAmount` المحفوظ. الحركات القديمة غير المحوّلة تُستبعد من الإجماليات وتُعدّ في `unresolvedCount` وتظهر تحذيرًا في الواجهة، ولا تُحسب صفرًا.
- بطاقة الحركة تعرض المبلغ الأصلي فقط. المعادل بالدينار وسعر الصرف وتاريخ السعر والمزوّد تظهر في التفاصيل فقط. الحركة غير المحوّلة تظهر في التفاصيل كـ «قيد التحويل — لم تُحتسب في الإجماليات».
- حركات KWD لا تستدعي المزوّد إطلاقًا وتُحفظ بحالة `NOT_REQUIRED`.

## الملفات المعدّلة أو المضافة

### الخادم

- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261122120000_finance_fx_reporting/migration.sql`
- `apps/backend/prisma/migrations/20261122120000_finance_fx_reporting/rollback.sql`
- `apps/backend/src/finance/fx-rate.service.ts` (جديد)
- `apps/backend/src/finance/finance-fx.ts` (جديد)
- `apps/backend/src/finance/finance-fx-backfill.ts` (جديد)
- `apps/backend/src/scripts/finance-fx-backfill.ts` (جديد)
- `apps/backend/src/finance/finance.service.ts`
- `apps/backend/src/finance/finance-schema.ts`
- `apps/backend/src/finance/finance.module.ts`
- `apps/backend/src/deals/deals.service.ts`
- `apps/backend/package.json`

### الواجهة

- `apps/frontend/lib/api/finance-types.ts`
- `apps/frontend/features/manager-finance/finance-model.ts`
- `apps/frontend/features/manager-finance/components/finance-page.tsx`
- `apps/frontend/features/manager-finance/components/finance.module.css`

لم تُعدّل بطاقة الحركة أو درج التفاصيل في هذه المهمة؛ يعرضان الحقول الجديدة تلقائيًا عبر `movementDetailRows` بعد تحديث نموذج البيانات.

### الاختبارات

- `apps/backend/test/finance.spec.ts`
- `apps/backend/test/frontend-finance-model.spec.ts`
- `apps/backend/test/fx-rate.spec.ts` (جديد)
- `apps/backend/test/finance-fx-backfill.spec.ts` (جديد)
- `apps/backend/test/finance-fx-backfill-guard.spec.ts` (جديد)

## الترحيل وقاعدة البيانات

- أُنشئ ترحيل واحد فقط: `20261122120000_finance_fx_reporting`.
- تحقّقت أولًا أن قاعدة الاختبار اسمها بالضبط `arkan_crm_api_test`، ثم طُبّق الترحيل عليها وحدها:
  - `27 migrations found`
  - الترحيل الجديد فقط كان معلّقًا، ثم طُبّق بنجاح.
- قاعدة `arkan_crm` الحقيقية لم تُرحّل ولم تُكتب فيها أي بيانات. المعاينة للقراءة فقط أظهرت:
  - `database: arkan_crm`
  - `schemaReady: false`
  - `applyAllowed: false`
  - `total: 1`
  - حركة EGP واحدة بقيمة `500.000` بتاريخ `2026-11-13`.
- سعر Frankfurter لذلك التاريخ: `0.0057918`، أي أن المعادل المتوقع لو تم التفعيل لاحقًا هو `2.896` د.ك. لم يُحفظ هذا التحويل ولم تُعدّل الحركة.
- بسبب فصل فحص الجاهزية، إنشاء الصفقات على قاعدة حقيقية غير مرحّلة يظل يعمل ويسجّل الحركات القديمة، بينما مسارات المالية الجديدة تفشل مغلقة حتى يُعتمد الترحيل.

## أوامر التحقق والنتائج

- `npm run typecheck` — ناجح.
- `npm run lint` — ناجح.
- `npm run build` — ناجح (Next.js 26 route، وكُتب CSP manifest).
- الاختبارات المركزة:
  - `finance.spec.ts deals.spec.ts fx-rate.spec.ts finance-fx-backfill.spec.ts finance-fx-backfill-guard.spec.ts frontend-finance-model.spec.ts`
  - النتيجة: `6 suites passed, 40 tests passed`.
- اختبارات الـ Backfill على قاعدة الاختبار غطّت:
  - معاينة للقراءة فقط دون كتابة.
  - تحويل صف EGP بسعر تاريخه الفعلي.
  - إصلاح صف KWD قديم.
  - إعادة التشغيل Idempotent دون استدعاء المزوّد مرة أخرى.
  - بقاء الصف فاشلًا عند تعطّل المزوّد ثم استكماله في تشغيل لاحق.
  - تخطي عملة غير مدعومة (USD) وإبقائها `UNRESOLVED`.
  - رفض `--apply` خارج قاعدة `arkan_crm_api_test`.

## معاينة الـ Backfill

الأمر الافتراضي للقراءة فقط:

```powershell
node --env-file-if-exists=apps/backend/.env apps/backend/dist/scripts/finance-fx-backfill.js --preview --limit=20
```

التطبيق محصور بقاعدة الاختبار فقط (مع تعيين `DATABASE_URL` إلى `arkan_crm_api_test` قبل الأمر):

```powershell
node --env-file-if-exists=apps/backend/.env apps/backend/dist/scripts/finance-fx-backfill.js --apply --database=arkan_crm_api_test --limit=50
```

## المخاطر المتبقية

- التفعيل الحقيقي معلّق: ترحيل `arkan_crm` وBackfill الحقيقي يحتاجان موافقة صريحة ونسخة احتياطية متحققة. حتى ذلك الحين مسارات المالية على القاعدة الحقيقية تفشل مغلقة برسالة «الترحيل غير مطبّق».
- لا يوجد Cache لأسعار الصرف؛ كل مصروف EGP يستدعي المزوّد مرة واحدة. هذا مقصود حاليًا لتجنب سعر قديم، والحجم المتوقع منخفض.
- المزوّد الوحيد المدعوم هو Frankfurter وأسعاره مرجعية وليست أسعار سوق لحظية.
- العملات غير EGP/KWD تبقى `UNRESOLVED` ولا تُحوّل تلقائيًا.
- لم يُنفّذ أي Backfill حقيقي، ولم تُلمس أي بيانات أعمال حقيقية.
- لم يتم تحقق بصري متكامل على قاعدة `arkan_crm` لأن ترحيل FX لم يُفعّل بعد؛ التحقق الحالي هو اختبارات تكامل وواجهة + بناء إنتاجي ناجح.
- الأعمال السابقة غير المرفوعة (بطاقات الموظفين وتنظيف النصوص) ما زالت غير مُودَعة في Git، ولم يتم commit أو push في هذه المهمة.
