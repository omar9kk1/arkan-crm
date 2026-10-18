# M6 — Step 3: تنظيف ويزارد طلبات العملاء القديم (مجلد request-wizard)

**التاريخ:** 2026-10-18
**النطاق:** `apps/frontend/features/employee-clients/components/request-wizard/`
**آخر checkpoint معلوم (HEAD):** `0d71c25` (لم يُنشأ أي commit في هذه الخطوة)

---

## 1. ما تم إنجازه

- فحص مجلد `request-wizard/` بالكامل (16 ملفًا).
- بناء **رسم استيراد برمجي** (Node) يغطي: الاستيراد الساكن، إعادة التصدير، `import(...)` الديناميكي، و`import type`، وCSS modules.
- حساب الوصول انطلاقًا من **نقاط دخول App Router** (`apps/frontend/app/**`).
- تحديد الملفات غير القابلة للوصول والمتحقَّق من كونها تشكّل رسمًا فرعيًا ميتًا مغلقًا.
- حذف **7 ملفات** ميتة فقط، مع إبقاء كل ما له مستهلك حيّ.
- التحقق من عدم وجود أي مرجع متبقٍّ للملفات المحذوفة.
- تشغيل typecheck وlint وproduction build واختبارات وحدة موجودة.

لم يُغيَّر أي كود تطبيقي أو منطق أعمال أو CSS فعّال.

---

## 2. الملفات المحذوفة (7 ملفات — 479 سطرًا)

| # | الملف (داخل `apps/frontend/features/employee-clients/components/request-wizard/`) | الأسطر |
| - | -------------------------------------------------------------------------------- | -----: |
| 1 | `client-request-form-step.tsx` | 58 |
| 2 | `client-review-step.tsx` | 45 |
| 3 | `modal-stepper.tsx` | 20 |
| 4 | `model.ts` | 36 |
| 5 | `request-wizard.module.css` | 196 |
| 6 | `smart-paste-panel.tsx` | 100 |
| 7 | `usage-help-panel.tsx` | 24 |
|   | **الإجمالي** | **479** |

**المجموع الكلي للأسطر المحذوفة في هذه الخطوة:** 479 سطرًا.

---

## 3. الملفات المُبقاة (9 — مطابقة تمامًا لـ `HEAD`)

- `add-client-request-modal.tsx` (المودال الحيّ لمسار «إضافة عميل»)
- `client-identity-step.tsx`
- `client-request-bundle.ts`
- `client-request-model.ts`
- `client-type-review.tsx`
- `floor-details.tsx`
- `request-details-editor.tsx`
- `request-interest-step.tsx`
- `unified-request.module.css`

لم تُعدَّل أي من هذه الملفات (لا يظهر أي `M` لها في `git status`).

---

## 4. الدليل على أن الملفات المحذوفة كانت غير مستخدمة

### 4.1 رسم الاستيراد والوصول (تحليل برمجي)
- إجمالي وحدات الواجهة قبل الحذف: **254**، القابلة للوصول من App Router: **239**.
- الملفات السبعة المحذوفة كانت **غير قابلة للوصول**.
- بعد الحذف: إجمالي الوحدات **247**، والقابلة للوصول بقيت **239** → لم تُخلَق أي وحدات يتيمة جديدة، ولم ينكسر أي مسار.
- الوحدات غير القابلة للوصول المتبقية (خارج نطاق هذه الخطوة، لم تُمسّ): `components/layout/workspace-shell.tsx`, `components/ui/placeholder-panel.tsx`, `features/employee-properties/components/property-request.module.css`, `features/manager-properties/components/approval-property-card.tsx`, `features/manager-properties/components/property-status-badge.tsx`, `lib/property-privacy.ts`, `next-env.d.ts`, `next.config.ts`.

### 4.2 الرسم الفرعي الميت مغلق
- `model.ts` (داخل request-wizard) يستورده فقط: `client-request-form-step.tsx`, `client-review-step.tsx`, `smart-paste-panel.tsx` — وكلها ضمن المحذوف.
- `request-wizard.module.css` يستورده فقط: `client-request-form-step.tsx`, `modal-stepper.tsx`, `smart-paste-panel.tsx`, `usage-help-panel.tsx` — وكلها ضمن المحذوف.

### 4.3 الوارد الوحيد من الكود الحيّ إلى المجلد
- `employee-clients/components/add-client-modal.tsx` → يعيد تصدير `AddClientRequestModal` من `./request-wizard/add-client-request-modal`.
- `manager-clients/components/add-client-modal.tsx` → يستورد `AddClientRequestModal` من `.../request-wizard/add-client-request-modal`.
- `employee-clients/client-model.ts` → استيراد نوعي لـ`client-request-bundle` و`client-request-model`.
- `manager-clients/mock-data.ts` → استيراد نوعي لـ`client-request-bundle`.
- `employee-properties/components/property-request-model.ts` → يستورد من `client-request-model`.

كل هذه الأنواع/الوحدات **مُبقاة**، ولا شيء منها يشير إلى الملفات السبعة المحذوفة.

### 4.4 استيرادات المودال الحيّ
`add-client-request-modal.tsx` يستورد: `client-request-model`, `client-request-bundle`, `client-identity-step`, `client-type-review`, `request-interest-step`, `unified-request.module.css` (+ عناصر UI/ليبراريات). **لا شيء من السبعة المحذوفة.**

### 4.5 فحص نصّي شامل (المستودع كله)
- لا يوجد أي مرجع لأي من الأسماء الخمسة المضغوطة (`client-request-form-step`, `client-review-step`, `modal-stepper`, `smart-paste-panel`, `usage-help-panel`) خارج مجلد `request-wizard`: **0 نتيجة** (بما في ذلك اختبارات الـbackend).
- كل مواصفات الاستيراد التي تشير إلى داخل المجلد من خارج تحصر نفسها في: `add-client-request-modal`, `client-request-bundle`, `client-request-model`.

---

## 5. نتائج الفحص والبناء

| الفحص | النتيجة |
| ----- | ------- |
| frontend `typecheck` (`npm run typecheck -w @arkan/frontend` / `tsc --noEmit`) | **نجح — exit 0** |
| `lint` (`npx eslint apps/frontend`) | **نجح — exit 0** |
| production `build` (`npm run build -w @arkan/frontend`) | **نجح — exit 0**، وبنى كل المسارات بما فيها `/manager/clients` و`/employee/clients` |
| اختبارات وحدة موجودة تلمس وحدات الواجهة (بلا قاعدة بيانات): `frontend-property-adapter.spec.ts` + `employee-property-filters.spec.ts` | **51/51 نجحت، 2/2 ملف، exit 0** |

---

## 6. التحذيرات والمشكلات والعناصر غير المحسومة

1. **خطأ في المحاولة الأولى (تم تصحيحه بالكامل):**
   استخدمت في البداية مطابقة أسماء **مع الامتداد** أثناء البحث النصّي، وهي معيبة لأن استيرادات TypeScript بلا امتداد (`./request-wizard/add-client-request-modal` لا `.tsx`)، فبدت بعض الملفات الحيّة «ميتة» وحُذفت خطأً.
   - **المعالجة:** أُعيد المجلد بالكامل إلى حالة `HEAD` عبر `git checkout -- apps/frontend/features/employee-clients/components/request-wizard` (كان هذا المجلد نظيفًا بلا أي تغييرات غير مُلتزَمة قبله)، ثم أُعيد التحليل عبر الرسم البياني الدقيق.
   - الحالة النهائية: الملفات التسعة المُبقاة مطابقة بايت-ببايت لـ`HEAD` (لا `M` لها في `git status`).
2. **`property-request.module.css`** في `employee-properties` أصبح غير قابل للوصول كنتيجة لـ**M6 Step 2** (حيث حُذفت المكوّنات الخمسة التي كانت تستورده). خارج نطاق هذه الخطوة — **لم يُمسّ**.
3. مرشّحات كود ميت أخرى خارج نطاق هذه الخطوة، **لم تُمسّ**: `approval-property-card.tsx`, `property-status-badge.tsx`, `lib/property-privacy.ts`, `components/layout/workspace-shell.tsx`, `components/ui/placeholder-panel.tsx`.
4. لم يُشغَّل أي اختبار يتطلب قاعدة البيانات في هذه الخطوة (لا حاجة — تغييرات واجهة فقط)، ولم تُشغَّل أو تُعدّل أي migrations.

---

## 7. حالة شجرة Git (بما فيها تغييرات M5/M6 الأقدم غير المُلتزَمة)

`git status --short` بعد الخطوة:

```
 M apps/backend/test/support/test-app.ts
 M apps/frontend/features/employee-clients/components/employee-clients-page.tsx
 D apps/frontend/features/employee-clients/components/request-wizard/client-request-form-step.tsx
 D apps/frontend/features/employee-clients/components/request-wizard/client-review-step.tsx
 D apps/frontend/features/employee-clients/components/request-wizard/modal-stepper.tsx
 D apps/frontend/features/employee-clients/components/request-wizard/model.ts
 D apps/frontend/features/employee-clients/components/request-wizard/request-wizard.module.css
 D apps/frontend/features/employee-clients/components/request-wizard/smart-paste-panel.tsx
 D apps/frontend/features/employee-clients/components/request-wizard/usage-help-panel.tsx
 D apps/frontend/features/employee-properties/components/property-data-editor.tsx
 D apps/frontend/features/employee-properties/components/property-form-steps.tsx
 D apps/frontend/features/employee-properties/components/property-offer-steps.tsx
 D apps/frontend/features/employee-properties/components/property-owner-step.tsx
 D apps/frontend/features/employee-properties/components/property-paste-step.tsx
 M apps/frontend/features/manager-clients/components/clients-page.tsx
 M apps/frontend/features/manager-clients/mock-data.ts
 M apps/frontend/features/manager-employees/components/employees-page.tsx
?? apps/frontend/lib/search.ts
```

**تفسير الحالة:**
- **M6 Step 3 (هذه الخطوة):** الـ7 ملفات `D` داخل `request-wizard/`.
- **M6 Step 2:** الـ5 ملفات `D` داخل `employee-properties/components/` (property-*-steps/data-editor).
- **M6 Step 1:** تعديل 3 ملفات مستهلكين (`employee-clients-page.tsx`, `clients-page.tsx`, `employees-page.tsx`) + اقتطاع `mock-data.ts` (12 سطرًا) + الملف الجديد `?? apps/frontend/lib/search.ts`.
- **M5:** تعديل `apps/backend/test/support/test-app.ts`.
- `git diff --stat` الكلي: **38 insertions, 1204 deletions**، تشمل آثار الخطوات الثلاث السابقة.

جميع تغييرات M5/M6-1/M6-2 **محفوظة كما هي** ولم تُمسّ.

**لم يُنفَّذ:** commit / push / reset / clean / stash.

---

## 8. تأكيد الحفاظ على الوظائف الحيّة وتصميم Astra

- **الويزارد الحالي لإنشاء/تعديل العقارات:** لم يُمسّ (سلسلة `new-property-modal-v2` و`add-property-modal` و`parse-property-message` سليمة).
- **صفحات العملاء الحيّة (موظف/مدير) ومسار «إضافة عميل»:** سليمة؛ المودال الحيّ `add-client-request-modal` واعتماداته **مُبقاة** ولم تُعدَّل.
- **وظيفة العملاء/الطلبات العاملة:** سليمة.
- **الـbackend وقاعدة البيانات والـmigrations وواجهات API ونماذج البيانات:** لم تُمسّ.
- **تصميم Astra وCSS والتخطيطات سريعة الاستجابة:** لم تُمسّ (لا تعديل CSS فعّال؛ حُذف فقط ملف CSS ميت غير مستورَد).
- **التحقق التطبيقي:** typecheck وlint وproduction build كلها نجحت (exit 0)، و51/51 اختبار وحدة نجحت — أي لا كسر في أي استيراد حيّ.
