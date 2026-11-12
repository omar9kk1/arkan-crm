# تنظيف أمان سكربتات اختبار الحمل قبل الرفع إلى GitHub

**التاريخ:** 2026-11-12
**النطاق:** `scripts/load-test/` فقط — تنظيف وتحقق، بدون commit/push.
**الحالة:** مكتمل. لم تُنفّذ أي كتابة أو Seed أو Reset أو اختبار حمل على أي قاعدة بيانات.

---

## 1. السكربتات الخمسة عشر التي تم فحصها

| # | السكربت | الحالة |
|---|---|---|
| 1 | `analyze-profile.cjs` | **نظيف أصلاً** — لا اتصال DB ولا HTTP ولا أسرار |
| 2 | `check-employee-correctness.cjs` | عُدّل |
| 3 | `generate.cjs` | عُدّل |
| 4 | `keepalive-compare.cjs` | عُدّل |
| 5 | `measure-employees.cjs` | عُدّل |
| 6 | `measure-single-endpoints.cjs` | عُدّل |
| 7 | `measure-supervision.cjs` | عُدّل |
| 8 | `measure-sync.cjs` | عُدّل |
| 9 | `profile-backend.cjs` | عُدّل |
| 10 | `profile-dashboard-queries.cjs` | عُدّل |
| 11 | `profile-deal-aggregation.cjs` | عُدّل |
| 12 | `profile-employee-queries.cjs` | عُدّل |
| 13 | `profile-list-endpoints.cjs` | عُدّل |
| 14 | `retest-concurrency.cjs` | عُدّل |
| 15 | `verify.cjs` | عُدّل |

**الإجمالي:** 15 مفحوصة، **14 عُدّلت**، وواحدة كانت نظيفة بالفعل.

---

## 2. الملفات المضافة/المعدلة

### جديدة (دعم فقط، دون حذف أي سكربت)

| الملف | الغرض |
|---|---|
| `scripts/load-test/config.cjs` | إعداد مشترك fail-closed: تحقق من URL قاعدة البيانات، هدف API، كلمة مرور الحسابات، وفحص `current_database()` |
| `scripts/load-test/.env.example` | أسماء المتغيرات المطلوبة بقيم **placeholder** فقط |
| `scripts/load-test/README.md` | طريقة التشغيل الآمنة والترتيب (توليد ثم تحقق ثم قياس) |

### المعدلة

جميع السكربتات الـ14 المذكورة أعلاه، بتغييرات محدودة على:
- ثوابت الاتصال وكلمة المرور في أعلى الملف.
- بناء عنوان API.
- استدعاء الدخول ليستخدم كلمة المرور من البيئة.

لم تتغير:
- سيناريوهات الاختبار أو أحجام بيانات التوليد أو مراحل A/B/C.
- أوقات الانتظار، عدد التكرارات، الحسابات الإحصائية، صيغ المخرجات.
- أي كود داخل `apps/backend` أو `apps/frontend`.

---

## 3. فئات المخاطر التي أُزيلت (بدون كشف أي قيمة)

| الفئة | ما تم |
|---|---|
| PostgreSQL URLs مكتوبة مباشرة | استُبدلت بـ`LOAD_DATABASE_URL` في جميع سكربتات DB |
| كلمات مرور الحسابات التجريبية | استُبدلت بـ`LOAD_TEST_PASSWORD` (مطلوب، بلا Default) |
| Fallback إلى قاعدة التطوير/الاختبار | أُزيل بالكامل؛ لا توجد قيمة افتراضية لقاعدة البيانات |
| عنوان API ثابت `127.0.0.1:4101` | استُبدل بـ`LOAD_API_URL` صريح في سكربتات HTTP |
| `HOST/PORT` ثابتان | يُشتقان من `LOAD_API_URL` بعد التحقق |
| Fixed cookies/tokens/secrets | لم توجد أي قيم مثبتة؛ الرموز تُبنى من تسجيل الدخول وقت التشغيل |
| مسارات/إعدادات محلية حساسة | لم توجد؛ فقط مسارات temp لحالة الاختبار وPID (غير سرية) |

**لم تُطبع أي قيمة سرية** في المخرجات أو التقرير.

---

## 4. الإعدادات الجديدة

| المتغير | إلزامي | القاعدة |
|---|---|---|
| `LOAD_DATABASE_URL` | نعم | `postgresql://` أو `postgres://`، واسم القاعدة **بالضبط** `arkan_crm_load_test` |
| `LOAD_API_URL` | نعم لسكربتات HTTP | http/https، loopback فقط (`127.0.0.1` / `localhost` / `::1`)، بلا path/query، و**يرفض المنفذ 4001** |
| `LOAD_TEST_PASSWORD` | نعم للتوليد والدخول | كلمة مرور الحسابات المولّدة، بلا قيمة افتراضية |
| `LOAD_STATE_FILE` | لا | اختياري، الافتراضي ملف temp |
| `LOAD_BACKEND_PID_FILE` | لا | اختياري، الافتراضي ملف temp |
| `LOAD_STAGE` | لا | الافتراضي `A` كما كان |

---

## 5. فحوص الأمان المطبقة

### قاعدة البيانات (قبل أي اتصال/كتابة)

1. `LOAD_DATABASE_URL` مطلوب ويجب أن يكون URL صالحاً.
2. البروتوكول يجب أن يكون `postgresql:` أو `postgres:`.
3. اسم القاعدة يُقرأ من `pathname` ويُفكّ ترميزه ويُقارن حرفياً بـ`arkan_crm_load_test`.
4. أي اسم آخر (`arkan_crm`, `arkan_crm_api_test`, قاعدة أخرى) يرمي خطأً فوراً قبل إنشاء `PrismaClient`.
5. كل سكربتات DB تحتفظ بفحص `SELECT current_database()` بعد الاتصال وتتوقف عند عدم التطابق.
6. في `generate.cjs` يوجد فحصان: اسم URL + `current_database()`، قبل أي كتابة/Seed.
7. `assertLoadDatabase()` في `config.cjs` يوفّر نفس الفحص بشكل موحّد وقابل للاختبار (يُستخدم في التحقق الاصطناعي أدناه).

### هدف HTTP

1. `LOAD_API_URL` مطلوب صراحةً — لا يوجد default.
2. يجب أن يكون http/https.
3. يجب أن يكون loopback فقط.
4. يُرفض المنفذ `4001` (الـAPI التطويري الحقيقي).
5. يُرفض أي path أو query أو hash.
6. السكربتات التي تستخدم `http.request` تشتق `HOST/PORT` من نفس الـURL المتحقق منه.

---

## 6. نتائج التحقق (غير تدميرية)

### 6.1 صحة الصياغة

تم تشغيل `node --check` على **جميع** ملفات `scripts/load-test/*.cjs` (15 سكربت + `config.cjs`):

```
SYNTAX_FAIL=0
```

### 6.2 اختبار وحدة الإعدادات (بدون اتصال قاعدة بيانات)

تم استخدام قيم placeholder فقط، ونتائج **12/12 PASS**:

```
PASS missing LOAD_DATABASE_URL rejected
PASS missing LOAD_API_URL rejected
PASS missing LOAD_TEST_PASSWORD rejected
PASS real arkan_crm database rejected
PASS arkan_crm_api_test database rejected
PASS non-postgres scheme rejected
PASS valid load-test database accepted
PASS real dev API port 4001 rejected
PASS non-loopback API target rejected
PASS valid loopback API accepted
PASS mismatched current_database rejected
PASS correct current_database accepted
VALIDATION_PASS=12
```

فحص `current_database` تم عبر Prisma mock (SELECT فقط) دون أي اتصال فعلي.

### 6.3 فشل واضح عند غياب المتغيرات

تشغيل `verify.cjs` و`profile-dashboard-queries.cjs` بعد إزالة متغيرات البيئة:

- كلاهما فشل فوراً بـ**exit code 1** من `config.cjs` قبل أي اتصال أو كتابة.

### 6.4 فحص الأسرار المتبقية

- لا توجد connection strings بكلمات مرور حقيقية.
- لا توجد كلمات مرور أو tokens/cookies مثبتة.
- المطابقات الوحيدة المتبقية هي **placeholders** في `.env.example` و`README.md` (`USER:PASSWORD`, `change-me`).
- لا توجد أرقام منافذ/مضيفين حقيقيين مثبتة في السكربتات خارج قواعد التحقق في `config.cjs` (المنفذ 4001 مذكور فقط لرفضه).

---

## 7. الحفاظ على الوظائف

- عدد السكربتات كما هو: **15**.
- لم تُحذف أي مرحلة أو قياس أو حمل.
- أعداد المستخدمين/العملاء/العقارات في `generate.cjs` لم تتغير.
- أسماء الحاويات (`arkan-crm-postgres-1`) المستخدمة لجمع `docker stats` بقيت كما هي (ليست سراً).
- حالة الاختبار `LOAD_STATE_FILE` ما زالت بالصيغة نفسها؛ لكن يجب إعادة توليدها بنفس `LOAD_TEST_PASSWORD` الجديد.
- لا تغيير على كود التطبيق أو قاعدة البيانات.

---

## 8. القيود والمخاطر المتبقية

1. **إثبات هوية خادم الاختبار:** السكربتات تضمن loopback ومنع 4001، لكنها لا تستطيع إثبات أن ما يعمل على `4101` هو فعلاً خادم اختبار. المستخدم يجب أن يشغّل خادماً اختبارياً على `LOAD_API_URL`.
2. **قاعدة بيانات بنفس الاسم على خادم آخر:** الفحص يعتمد على اسم القاعدة كما هو مطلوب؛ يجب التأكد أن `LOAD_DATABASE_URL` يشير إلى نسخة قابلة للتخلص. الفحص `current_database()` يكمل الحماية.
3. **ملفات الحالة/PID:** مسارات temp محلية افتراضية، غير سرية.
4. **ESLint:** إعدادات المستودع لا تدعم ملفات CJS (أخطاء `no-undef`/`require` سابقة لكل السكربتات)، لذلك الاعتماد هنا على `node --check` + اختبار الإعدادات.
5. **إعادة توليد البيانات:** من لديه حالة قديمة مولّدة بكلمة المرور القديمة يجب أن يعيد تشغيل `generate.cjs` بعد ضبط `LOAD_TEST_PASSWORD`.

---

## 9. الحكم النهائي

**SAFE TO INCLUDE IN GIT**

- 14 سكربتاً نُظّفوا، والخامس عشر لم يكن به أي سر.
- لا أسرار أو credentials حقيقية في الملفات.
- فحوص قاعدة البيانات وHTTP fail-closed ومُختبرة.
- لم يُنفّذ commit/push، ولم تُمس أي بيانات.

> هذا التقرير يُلغي مانع `scripts/load-test/` المذكور في تدقيق ما قبل VPS.
