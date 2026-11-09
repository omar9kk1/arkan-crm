# تحسين سير عمل OpenCode — تقرير مختصر

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تعليمات وسير عمل الوكيل فقط — لا تغيير في وظائف المنتج.  
**الحالة:** مكتمل — بانتظار المراجعة.

---

## 1. الملفات المعدّلة

| الملف | التغيير |
|---|---|
| `AGENTS.md` | **جديد** — دليل الوكيل الجذري المختصر |
| `package.json` | إضافة `test:auth`, `test:csp`, `check` |
| `docs/reports/opencode-workflow-optimization.md` | هذا التقرير |

لم يتم تعديل:

- أي كود منتج أو واجهة أو API.
- `.env` أو `.env.local`.
- قاعدة البيانات أو migrations/seeds.
- ملفات CSP أو المصادقة أو Push أو Multer.
- `apps/frontend/AGENTS.md` (موجود مسبقًا من Next).

---

## 2. محتوى `AGENTS.md`

الدليل يغطي فقط ما يحتاجه الوكيل فعليًا:

- الهيكل: `apps/frontend`, `apps/backend`, `packages/shared`, `docs/reports`.
- المنافذ الفعلية: **3001** للواجهة و**4001** للخلفية.
- قاعدة التطوير `arkan_crm` وقاعدة الاختبار المعزولة `arkan_crm_api_test` فقط.
- أوامر التشغيل والصيانة الفعلية.
- مسارات وحدود Manager/Employee، حماية بيانات الملاك والوسطاء والصور.
- دورة حياة العقار: P-code للطلب، A-code عند الاعتماد، منع التكرار، دورة المالك، Trash للمدير.
- Cookie/CSRF الحالية: HttpOnly، `credentials: include`، `X-CSRF-Token`، و`403` ليس انتهاء جلسة.
- CSP المحلي Report-Only، وخط hashes، ومنع تفعيل Enforce دون موافقة.
- الحفاظ على واجهة Astra-glass العربية RTL.
- قواعد السلامة: لا DB/env/Git history بدون تفويض.
- مستويات العمل: صغير، متوسط، أمني/كبير.

يُحيل إلى `apps/frontend/AGENTS.md` لقواعد Next.js 16 بدل تكرارها.

---

## 3. الأوامر المضافة

```json
"check": "npm run typecheck && npm run lint",
"test:auth": "npm run test -w @arkan/backend -- auth.spec.ts auth-cookie-mode.spec.ts frontend-auth-mode.spec.ts frontend-authorized.spec.ts",
"test:csp": "npm run test -w @arkan/backend -- csp-policy.spec.ts && npm run csp:test -w @arkan/frontend"
```

- لا تغيّر runtime ولا build.
- `test:auth` يحتاج `TEST_DATABASE_URL` لقاعدة `arkan_crm_api_test`.
- الأوامر القديمة `dev`, `backend:*`, `build`, `typecheck`, `lint`, `test`, `csp:*` موثقة كما هي.

---

## 4. التحقق الفعلي

| الأمر | النتيجة | ملاحظة |
|---|---|---|
| `npm run test:auth` | **4 suites / 38 tests** ✅ | ~36s مع قاعدة الاختبار المعزولة |
| `npm run test:csp` | **14 backend + 8 frontend** ✅ | ~8s warm / ~19s أول تشغيل |
| `npm run check` | typecheck + lint ✅ | ~32s |
| `npm run csp:test` ضمن `test:csp` | **8/8** ✅ | fail-safe pipeline |

- لم تُشغّل الحزمة الكاملة أو build كاملًا لأن التغيير ليس في كود المنتج.
- لم تُستخدم قاعدة التطوير في الاختبارات.
- لم يتم طباعة أي أسرار.

---

## 5. قبل/بعد

### قبل

- التعليمات موزعة بين `README`, تقارير `docs/reports`, وسكربتات `package.json`.
- README يحتوي قيم setup تاريخية (3000/4000)، بينما التطبيق المحلي الفعلي 3001/4001.
- أوامر الاختبار المركزة كانت تُكتب يدويًا في كل مهمة.
- ميل لتشغيل full suite/build أو إعادة تنظيف/تثبيت بلا ضرورة.

### بعد

- دليل جذري واحد يحدد المسارات والمنافذ والأوامر والحدود الأمنية.
- ثلاثة أوامر مركزة للتحقق السريع.
- سير عمل متدرج: صغير = اختبارات قريبة فقط؛ متوسط = `check` + build للمتأثر؛ أمني/كبير = full suite + browser + builds.
- تقليل إعادة اكتشاف المعلومات وتكرار الحزم الكاملة.
- **لم يتم قياس تحسين سرعة إنتاجية مُدّعَى**؛ الأرقام أعلاه هي زمن الأوامر الفعلية فقط.

---

## 6. القيود

- README لم يُعدّل (خارج نطاق سير العمل)؛ قد يظل يذكر 3000/4000 في إعداد clean-machine. `AGENTS.md` هو المرجع للبيئة المحلية الحالية.
- `test:auth` يعتمد على Windows/PowerShell backend manager وعلى `TEST_DATABASE_URL` الصحيح.
- الأوامر المركزة لا تغني عن full suite للتحقق الأمني الواسع أو الإصدارات.
- إذا تغيّرت المنافذ أو السكربتات، يجب تحديث `AGENTS.md`.
- `apps/frontend/AGENTS.md` يُعاد إنشاؤه تلقائيًا بواسطة `next dev`.

---

## 7. السلامة والحالة النهائية

- لم يتم تغيير كود المنتج أو سلوك runtime.
- Cookie/CSRF وCSP hash pipeline وSSRF/Multer محفوظة.
- لا تغييرات على قاعدة البيانات أو `.env`.
- لا commits أو pushes.
- `HEAD=d43cae5`.
- الواجهة `:3001` والخلفية `:4001` ما زالتا تعملان.

**التوقف هنا للمراجعة.**
