# التحقق النهائي من المزامنة مع GitHub قبل نشر VPS

**التاريخ:** 2026-11-12
**الفرع:** `main`
**الحالة:** تجهيز نهائي — يُستكمل بعد الرفع بمعرّفات الـcommits.

---

## 1. جرد Git النهائي

| العنصر | القيمة |
|---|---|
| HEAD قبل الرفع | `20900a781d8a04243410673f407d920b87ef08f7` |
| origin/main قبل الرفع | نفس الـHEAD — لا divergence |
| Modified tracked | **77** |
| Deleted tracked | **10** |
| Untracked (قبل هذا التقرير) | **102** |
| هذا التقرير | +1 |
| **إجمالي التغييرات** | **190** (77 معدّل + 10 محذوف + 103 غير متتبع) |
| Staged قبل البدء | 0 |

- `git fetch --all --prune` نُفّذ؛ لا commits محلية أو بعيدة متباعدة.
- لا توجد ملفات build/`dist`/`.next`/`tsbuildinfo` ضمن التغييرات.
- لا تعارضات merge، و`git diff --check` ناجح.
- تحذيرات `LF → CRLF` طبيعية على Windows.

### Migrations

- محلياً **26** مجلد ترحيل، منها 3 جديدة:
  - `20261110120000_deal_kwd_precision_and_notes`
  - `20261110130000_finance_ledger_precision_payouts`
  - `20261111120000_client_review_assigned_reviewer`
- جميعها ستُضاف دون تشغيلها.

### Load-test

- 15 سكربتاً موجوداً، إضافة إلى:
  - `scripts/load-test/config.cjs`
  - `scripts/load-test/.env.example` (placeholders فقط)
  - `scripts/load-test/README.md`

---

## 2. الاختبارات والتحقق

| الفحص | النتيجة |
|---|---|
| `npm run check` (typecheck + lint) | **نجح** |
| `npm test` (95 suite) | **886/886 نجحت** في التشغيل النهائي |
| `npm run build` (shared + backend + frontend + CSP) | **نجح** |
| `node --check` لكل سكربتات load-test | **نجح (0 أخطاء)** |
| اختبار إعدادات load-test (11 حالة) | **11/11 نجحت** |
| `git diff --check` | **نجح** |

ملاحظة شفافية: في تشغيل كامل وسيط فشل اختبار واحد عابر في
`owner-manager-employee-hierarchy.spec.ts` (login 500)، ثم نجح منفرداً
(12/12) ونجحت الحزمة الكاملة في إعادة التشغيل (95/95 suite).

### قاعدة الاختبار

- تم التحقق من `SELECT current_database()` عبر Prisma override صريح:
  **`arkan_crm_api_test`** فقط.
- لم تُستخدم قاعدة `arkan_crm` ولا `arkan_crm_load_test` لاختبارات التطبيق.
- لم تُنفّذ أي Stress/Seed/Reset يدوي أو Migration.

### إصلاحات اختبارية مطلوبة أثناء التحقق

1. `properties-assets.spec.ts`: تحديث قائمة الترحيلات المتوقعة (4 ترحيلات جديدة).
2. `wizard-edit-payload.spec.ts`: إضافة `lastFollowUp` المطلوب في نوع `EmployeeClient`.
3. `property-codes.spec.ts`: استخدام OWNER لعمليات trash/restore بعد تقييد حذف المدير.
4. `push.spec.ts`: عزل مراجعات العملاء بين الاختبارات، وتوجيه مراجعة الموظف إلى OWNER pool عند تعطيل مديره، وتصحيح توقع عدم تسريب endpoint مشترك إلى حساب آخر.
5. `test-app.ts`: استبدال مثال URL يحمل بيانات دخول محلية بـplaceholders.

لم تُعدّل أي منطق تطبيق أو صلاحيات أو حسابات مالية.

---

## 3. مراجعة الأمان

- لا توجد ملفات `.env` حقيقية بين المرشحين للـstaging.
- لا توجد connection strings تحمل كلمات مرور حقيقية.
- لا توجد JWT secrets أو API tokens أو private keys أو cookies ثابتة.
- لا توجد ملفات SQL dumps/backups أو صور عقارات أو سجلات تشغيل بين المرشحين.
- لا توجد ملفات أكبر من 1MB بين المرشحين.
- السكربتات النظيفة تحتوي فقط على متغيرات بيئة وقيم placeholder.
- المستثنى (لن يُضاف): `backups/`, `.dev/`, `apps/backend/.env*` (عدا الأمثلة),
  `apps/frontend/.env.local*` (عدا الأمثلة), `node_modules/`, `dist/`, `.next/`,
  `*.tsbuildinfo`.

---

## 4. نطاق الـCommits المقصود

1. **Backend + Prisma + tests**
   - `apps/backend/prisma/schema.prisma`
   - مجلدات الترحيل الثلاثة
   - `apps/backend/src`
   - `apps/backend/test`
2. **Frontend**
   - `apps/frontend` بالكامل، بما فيها الحذف المقصود لـ10 ملفات mock/dead code.
3. **Load-test + Documentation**
   - `scripts/load-test`
   - `docs/reports` (بما فيها هذا التقرير)

سيتم staging بمسارات صريحة، ومراجعة `--cached --stat` و`--check` قبل كل commit.
لن يُستخدم `git add .` أو `-A`، ولن يُستخدم force-push.

---

## 5. الحكم

**SAFE TO COMMIT AND PUSH** — بعد مراجعة staged paths والتأكد من عدم وجود أسرار.

معرّفات الـcommits وتأكيد `HEAD == origin/main` ستُعاد في الرد النهائي بعد الرفع.
