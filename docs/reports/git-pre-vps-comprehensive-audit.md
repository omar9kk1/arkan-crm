# تدقيق شامل قبل المزامنة مع GitHub ونشر VPS

**التاريخ:** 2026-11-12
**النوع:** تدقيق للقراءة فقط (READ-ONLY) — لم يُنفّذ أي staging/commit/push.
**الفرع:** `main` — **HEAD = origin/main = `20900a7`**.

---

## 1. حالة Git والريموت

| العنصر | القيمة |
|---|---|
| الفرع الحالي | `main` |
| HEAD | `20900a781d8a04243410673f407d920b87ef08f7` — `docs: record git sync verification` — 2026-11-09 |
| الريموت | `origin` → `https://github.com/omar9kk1/arkan-crm.git` |
| Upstream | `origin/main` |
| `git fetch --all --prune` | نُفّذ بنجاح |
| الفرق مع الريموت | `0` commits محلية غير مرفوعة، `0` commits بعيدة غير موجودة محلياً |
| staged | **0 ملفات** |
| تعارضات/merge markers | **لا يوجد** |

**الخلاصة:** لا توجد commits محلية تنتظر الرفع. كل العمل الجديد موجود كتغييرات غير مُودَعة في working tree.

---

## 2. جرد الملفات المنتظرة للمزامنة

باستخدام `git status -uall` (يفكّ المجلدات غير المتتبعة إلى ملفات):

| الفئة | العدد |
|---|---|
| Modified tracked | **73** |
| Deleted tracked | **10** |
| Untracked | **97** |
| **الإجمالي قبل هذا التقرير** | **180** |
| تقرير التدقيق هذا (جديد) | +1 → **181** |

### 2.1 توزيع الـ Untracked (97)

| الفئة | العدد |
|---|---|
| تقارير `docs/reports/` | 40 |
| ملفات ترحيل (3 مجلدات × migration+rollback) | 6 |
| سكربتات `scripts/load-test/` | 15 |
| Backend source جديد | 12 |
| Backend tests جديدة | 13 |
| Frontend source جديد | 11 |

**Migrations الجديدة (3):**
- `apps/backend/prisma/migrations/20261110120000_deal_kwd_precision_and_notes/` (`migration.sql`, `rollback.sql`)
- `apps/backend/prisma/migrations/20261110130000_finance_ledger_precision_payouts/` (`migration.sql`, `rollback.sql`)
- `apps/backend/prisma/migrations/20261111120000_client_review_assigned_reviewer/` (`migration.sql`, `rollback.sql`)

**Backend source جديد (12):**
- `apps/backend/src/clients/client-review-schema.ts`
- `apps/backend/src/deals/deals.controller.ts`
- `apps/backend/src/deals/deals.service.ts`
- `apps/backend/src/deals/dto/create-deal.dto.ts`
- `apps/backend/src/deals/dto/list-deal-clients.query.ts`
- `apps/backend/src/deals/dto/list-deals.query.ts`
- `apps/backend/src/finance/dto/finance.dto.ts`
- `apps/backend/src/finance/finance-schema.ts`
- `apps/backend/src/finance/finance.controller.ts`
- `apps/backend/src/finance/finance.service.ts`
- `apps/backend/src/notifications/system-log.dto.ts`
- `apps/backend/src/notifications/system-log.service.ts`

**Backend tests جديدة (13):**
`client-review-queue-scope.spec.ts`, `deals.spec.ts`, `employee-transfer-review-ownership.spec.ts`, `finance.spec.ts`, `followup-history-authorization.spec.ts`, `followups-fingerprint-optimization.spec.ts`, `followups-supervision-employees.spec.ts`, `followups-sync-optimization.spec.ts`, `frontend-deal-model.spec.ts`, `frontend-finance-model.spec.ts`, `frontend-manager-navigation.spec.ts`, `property-company-wide-visibility.spec.ts`, `review-routing-system-log.spec.ts` — جميعها تحت `apps/backend/test/`.

**Frontend source جديد (11):**
- `apps/frontend/components/layout/manager/navigation-permissions.ts`
- `apps/frontend/features/manager-deals/deal-model.ts`
- `apps/frontend/features/manager-deals/use-deals.ts`
- `apps/frontend/features/manager-notifications/components/system-log-details-drawer.tsx`
- `apps/frontend/features/manager-notifications/components/system-log-panel.tsx`
- `apps/frontend/lib/api/deal-types.ts`
- `apps/frontend/lib/api/deals-api.ts`
- `apps/frontend/lib/api/finance-api.ts`
- `apps/frontend/lib/api/finance-types.ts`
- `apps/frontend/lib/api/system-log-api.ts`
- `apps/frontend/lib/api/system-log-types.ts`

**التقارير (40):** جميعها تحت `docs/reports/`، ومنها: `deals-backend-integration.md`, `deals-employee-permissions-and-client-selector.md`, `deals-owner-only-client-employee-selection.md`, `deals-manager-automatic-employee-confirmation.md`, `deals-commission-payout-buttons.md`, `deals-commission-cards-deduplication.md`, `sold-property-drawer-deal-link.md`, `finance-backend-integration.md`, `finance-real-database-migration-verification.md`, `owner-notifications-and-system-log.md`, `system-log-readonly-review-drawer.md`, `review-ownership-real-database-migration-verification.md`, `company-wide-approved-property-visibility.md`, `company-wide-sold-property-visibility.md`، إضافة إلى تقارير الأداء والتدقيق السابقة.

**Deleted tracked (10) — حذف مقصود بعد إزالة mock/dead code:**
- `apps/frontend/components/layout/workspace-shell.tsx`
- `apps/frontend/components/ui/placeholder-panel.tsx`
- `apps/frontend/features/manager-clients/components/contact-card.tsx`
- `apps/frontend/features/manager-clients/components/owner-employee-follow-up-tabs.tsx`
- `apps/frontend/features/manager-deals/mock-data.ts`
- `apps/frontend/features/manager-deals/use-mock-deals.ts`
- `apps/frontend/features/manager-finance/mock-sources.ts`
- `apps/frontend/features/manager-properties/components/approval-property-card.tsx`
- `apps/frontend/features/manager-properties/components/property-status-badge.tsx`
- `apps/frontend/lib/property-privacy.ts`

لا توجد commits محلية تنتظر push. لا توجد ملفات staged.

### 2.2 الملفات المعدّلة (73)

**Backend (21):**
`apps/backend/prisma/schema.prisma`, `src/auth/guards/jwt-auth.guard.ts`, `src/clients/client-reviews.controller.ts`, `src/clients/client-reviews.service.ts`, `src/common/access/access-policy.ts`, `src/dashboard/dashboard.dto.ts`, `src/dashboard/dashboard.service.ts`, `src/deals/deals.module.ts`, `src/employees/employees.service.ts`, `src/finance/finance.module.ts`, `src/followups/dto/list-follow-ups.query.ts`, `src/followups/followups.controller.ts`, `src/followups/followups.service.ts`, `src/notifications/notification-events.ts`, `src/notifications/notifications.controller.ts`, `src/notifications/notifications.module.ts`, `src/notifications/notifications.service.ts`, `src/properties/properties.service.ts`, `src/properties/property-serializer.ts`, `src/properties/property-visibility.ts`, `src/properties/property.dto.ts`.

**Backend tests (15):**
`auth.spec.ts`, `client-edit-notifications.spec.ts`, `contacts.spec.ts`, `employee-decision-notifications.spec.ts`, `employee-pending-property-edit.spec.ts`, `employee-property-filters.spec.ts`, `employee-property-restoration-notification.spec.ts`, `employee-record-notifications.spec.ts`, `followups-manager.spec.ts`, `followups-pagination.spec.ts`, `frontend-property-reveal.spec.ts`, `manager-review-change-notifications.spec.ts`, `notifications.spec.ts`, `owner-manager-employee-hierarchy.spec.ts`, `support/test-app.ts`.

**Frontend (37):** تشمل `components/layout/manager/navigation.ts`, `components/ui/glass-combobox.tsx`, `features/client-reviews/.../client-review-details-drawer.tsx`, `features/employee-dashboard/.../dashboard-cards.tsx`, `features/employee-notifications/.../employee-notifications-page.tsx`, `features/employee-properties/...` (بطاقة/نموذج/CSS), `features/manager-deals/components/*` (المعالج، درج التفاصيل، البطاقات، العمولات، الاختيار، CSS), `features/manager-finance/*`, `features/manager-followups/*`, `features/manager-notifications/*`, `features/manager-properties/*` (بما فيها درج التفاصيل، البطاقة، المحذوفات، CSS), و`lib/api/*`, `lib/contact-registry.ts`, `lib/property-adapter.ts`, `lib/property-reveal.ts`.

> القائمة الكاملة متاحة بأمر `git diff --diff-filter=M --name-only`، وتم التحقق منها ملفاً بملف.

---

## 3. حالة كل ميزة مقابل GitHub

الريموت يحتوي فقط على الأساس القديم عند `20900a7`؛ لا توجد أي commits محلية، لذلك كل ما يلي **محلي غير مرفوع**.

| # | الميزة | حالة GitHub | أدلة/ملفات مفتاحية |
|---|---|---|---|
| 1 | صلاحيات OWNER/MANAGER/EMPLOYEE | **محلي فقط** — نسخة أساسية أقدم على GitHub | `access-policy.ts`, `jwt-auth.guard.ts`, `navigation.ts`, `navigation-permissions.ts`, اختبارات الهيكل |
| 2 | تحسينات الأمان والأداء | **محلي فقط** | auth guard، dashboard، employees، followups، تقارير الأداء |
| 3 | Deals backend + دقة KWD | **غير موجود على GitHub** (الريموت فيه `deals.module.ts` فقط) | `deals.service/controller/dto` جديدة، migration `deal_kwd_precision_and_notes`، schema، `deals.spec.ts` |
| 4 | Finance ledger + صرف العمولات | **غير موجود على GitHub** (الريموت فيه `finance.module.ts` فقط) | `finance.service/controller/dto/schema` جديدة، migration `finance_ledger_precision_payouts`، `finance.spec.ts` |
| 5 | System Log + إشعارات المراجعة المباشرة | **غير موجود على GitHub** | `system-log.service/dto`, `system-log-panel/drawer`, notifications service/controller |
| 6 | درج مراجعة للقراءة فقط | **محلي فقط** | `client-review-details-drawer.tsx`, `system-log-details-drawer.tsx`, تقرير `system-log-readonly-review-drawer.md` |
| 7 | ملكية طابور المراجعة ونقل الموظف | **محلي فقط** | client-reviews service/controller، migration `client_review_assigned_reviewer`، `client-review-queue-scope.spec.ts`, `employee-transfer-review-ownership.spec.ts` |
| 8 | ظهور العقارات المعتمدة على مستوى الشركة | **محلي فقط** | access-policy/property-visibility/serializer، `property-company-wide-visibility.spec.ts`, تقرير |
| 9 | ظهور «تم البيع» وشارته | **محلي فقط** | access-policy، بطاقات manager/employee، `property-reveal.ts`, `employee-properties/model.ts`, اختبار sold، تقرير |
| 10 | قيود موظفي معالج الصفقات + بحث العملاء | **محلي فقط** | `deal-create-wizard.tsx`, `employee-selection.tsx`, `glass-combobox.tsx`, `deals.service.ts` (`client-options`), اختبارات |
| 11 | تأكيد الموظف التلقائي للمدير | **محلي فقط** | wizard + `deal-model.ts` + `frontend-deal-model.spec.ts`, تقرير |
| 12 | أزرار صرف العمولات وإزالة التكرار | **محلي فقط** | `deal-details-drawer.tsx`, `commission-breakdown.tsx`, `deal-card.tsx`, finance payout، تقارير |
| 13 | درج العقار المباع + تفاصيل الصفقة المرتبطة | **محلي فقط** | `property-details-drawer.tsx`, `manager-properties.tsx`, `deal-details-drawer.tsx`, تقرير `sold-property-drawer-deal-link.md` |
| 14 | الاختبارات والترحيلات والتقارير | **محلي فقط** | 13 اختباراً جديداً، 10 اختبارات معدّلة، 3 ترحيلات (6 ملفات)، 40 تقريراً |

**الترحيلات:** الريموت 23 ترحيلاً، محلياً **26** (الفرق 3 ترحيلات جديدة غير مرفوعة).

---

## 4. نتائج فحص سلامة الشجرة

- `npm run typecheck` (shared + backend + frontend + shared typecheck) → **نجح (0)**.
- لا توجد merge markers (`<<<<<<<`, `=======`, `>>>>>>>`).
- `TODO/FIXME` في الملفات غير المتتبعة: مرة واحدة فقط داخل `docs/reports/arkan-prelaunch-readiness-audit.md` (توثيقي، ليس كوداً ناقصاً).
- الملفات المحذوفة لا يشار إليها أي import (typecheck يثبت ذلك).
- تحذيرات Git متكررة عن `LF will be replaced by CRLF` عند الإضافة — طبيعية على Windows ولا تعني تلفاً، لكنها ستظهر في أول staging.
- لم تُشغَّل الاختبارات الكاملة في هذا التدقيق. آخر نتائج موثقة: Deals/Finance/Visibility suites ناجحة (105/105 و68/68 و22/22 في الجولات السابقة)، ويجب إعادة تشغيل `npm test` قبل الرفع.

---

## 5. المخاطر الأمنية والخصوصية

### 5.1 ملفات مستثناة بـ `.gitignore` (يجب أن تبقى خارج Git)

| المسار | التصنيف |
|---|---|
| `apps/backend/.env` | أسرار اتصال/JWT — **مستثنى** |
| `apps/backend/.env.auth-backup-20261107-022627` | نسخة احتياطية لأسرار — **مستثنى** |
| `apps/frontend/.env.local` | إعدادات محلية/أسرار — **مستثنى** |
| `apps/frontend/.env.local.auth-backup-*` | نسخة احتياطية — **مستثنى** |
| `apps/frontend/.env.local.csp-backup-*` | نسخة احتياطية — **مستثنى** |
| `backups/` | 5 ملفات SQL/dump + مجلد صور عقارات (~14 MB) — **مستثنى** |
| `.dev/backups/arkan_crm_20261028_035155.dump` | نسخة قاعدة بيانات (~283 MB) — **مستثنى** |
| `.dev/logs/backend.log*` | سجلات تشغيل (~6.4 MB) — **مستثنى** |
| `node_modules/`, `apps/*/node_modules/` | generated — مستثنى |
| `.next/`, `dist/`, `*.tsbuildinfo` | generated — مستثنى |

- لا توجد ملفات `.env` أو مفاتيح/شهادات متتبعة. المتتبع فقط:
  `apps/backend/.env.example`, `apps/frontend/.env.example`, `apps/frontend/.env.local.example` (قوالب بلا أسرار).
- الصور المتتبعة (12) هي أصول واجهة/تقارير فقط، وليست صور عقارات خاصة.
- `backups/` و`.dev/` غير متتبعة ولا تظهر في `git status` العادي، لكنها موجودة على القرص.

### 5.2 خطر في ملفات غير متتبعة

- **`scripts/load-test/` (15 ملفاً) تحتوي على connection strings محلية مكتوبة مباشرة** إلى `arkan_crm_load_test` وبعض بيانات دخول اختبارية. لم تُطبع القيم.
  - التوصية: **عدم إضافتها كما هي**. إما استثناؤها من الرفع، أو تنظيفها لاستخدام `process.env` قبل أي commit.
- لا توجد أسرار أو connection strings في ملفات المصدر/الاختبارات/التقارير غير المتتبعة الأخرى (تم فحص الأنماط: `postgresql://`, `password=`, `JWT_SECRET`, مفاتيح خاصة).

---

## 6. خطة الرفع الآمنة المقترحة (لا تُنفَّذ الآن)

### 6.1 ما يجب إضافته

1. **Backend + schema + migrations:**
   `apps/backend/prisma/schema.prisma` + مجلدات الترحيل الثلاثة، ثم:
   `apps/backend/src/{deals,finance,clients,notifications,properties,followups,dashboard,employees,auth,common}`
2. **Backend tests:** كل `apps/backend/test/*.spec.ts` المعدّلة والجديدة.
3. **Frontend:** `apps/frontend/app` (إن تغيّر)، `apps/frontend/components`, `apps/frontend/features`, `apps/frontend/lib` مع تسجيل الحذف المقصود للملفات العشرة.
4. **التقارير:** `docs/reports/` (40 ملفاً) — لا تحتوي أسراراً.
5. **هذا التقرير:** `docs/reports/git-pre-vps-comprehensive-audit.md`.

### 6.2 ما يجب استثناؤه

- `scripts/load-test/` حتى تُنظّف أو يُقرر استثناؤها نهائياً.
- `apps/backend/.env*` (ما عدا `.env.example`)، `apps/frontend/.env.local*` (ما عدا الأمثلة).
- `backups/`, `.dev/`, `node_modules/`, `.next/`, `dist/`, `*.tsbuildinfo`.

### 6.3 تسلسل مقترح (بعد موافقة صريحة)

```powershell
# 1) Backend + PRISMA + migrations
git add apps/backend/prisma/schema.prisma `
        apps/backend/prisma/migrations/20261110120000_deal_kwd_precision_and_notes `
        apps/backend/prisma/migrations/20261110130000_finance_ledger_precision_payouts `
        apps/backend/prisma/migrations/20261111120000_client_review_assigned_reviewer `
        apps/backend/src apps/backend/test
git diff --cached --check
git commit -m "feat: deals, finance ledger, review ownership and system log"

# 2) Frontend
git add apps/frontend
git diff --cached --check
git commit -m "feat(ui): deals, finance, notifications and property visibility updates"

# 3) Docs
git add docs/reports
git commit -m "docs: add development, migration and audit reports"

# 4) تحقق نهائي (بدون add .)
git status
git log --oneline origin/main..HEAD
```

**قبل الرفع:** تشغيل `TEST_DATABASE_URL` على `arkan_crm_api_test` ثم `npm test` و`npm run check` و`npm run build`، ومراجعة أن الترحيلات الثلاثة فقط هي الجديدة. بعد النجاح: `git push origin main` (بعد موافقة منفصلة).

### 6.4 ملاحظات نشر VPS

- الترحيلات الثلاثة يجب تطبيقها بـ`prisma migrate deploy` ضمن خطة نشر مضبوطة، وليس تلقائياً من هذا التدقيق.
- لا تتضمن الشجرة أسرار إنتاج؛ يجب توفير `.env` على الخادم يدوياً.
- الملفات المحذوفة هي تنظيف mock/dead code، وليست حذف ميزات.

---

## 7. المخاطر/الملاحظات المتبقية

1. `scripts/load-test/` تحمل بيانات اتصال محلية مكتوبة مباشرة — أكبر خطر إن استُخدم `git add .`.
2. لم يُجرَ تشغيل كامل للاختبارات في هذه الجولة (فقط typecheck)؛ يجب تشغيلها قبل الرفع.
3. تحذيرات CRLF/LF ستظهر؛ يمكن قبولها أو توحيدها بوعي قبل commit أول.
4. حجم `backups/` و`.dev/` كبير؛ تبقى مستثناة ولا علاقة لها بالنشر.

---

## 8. الحكم النهائي

**SAFE TO PUSH AFTER REVIEW**

- لا divergences مع GitHub، ولا commits معلّقة، ولا تعارضات.
- الشجرة متسقة وtypecheck ناجح.
- لا أسرار متتبعة.
- **شرط أساسي:** استبعاد/تنظيف `scripts/load-test/` وعدم استخدام `git add .`، وتشغيل الاختبارات الكاملة قبل الرفع.

**لم يُنفّذ أي commit أو push أو staging.** في انتظار موافقة صريحة.
