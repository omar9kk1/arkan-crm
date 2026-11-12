# تنظيف آمن للكود الميت

**التاريخ:** 2026-11-09  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** ملفات frontend غير المستخدمة فقط، دون تغيير السلوك أو الصلاحيات.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا تغييرات على قاعدة البيانات أو migrations أو `.env` أو الصور أو النسخ الاحتياطية.  
> لا commits أو pushes.

---

## 1. الملفات المحذوفة (مؤكدة غير مستخدمة)

تم البحث عن كل اسم ملف وكل export في `apps/frontend` (بما فيها imports الديناميكية والمسارات) قبل الحذف.

| الملف | الدليل |
|---|---|
| `apps/frontend/components/layout/workspace-shell.tsx` | لا مراجع إلى `WorkspaceShell` أو مسار الملف. |
| `apps/frontend/components/ui/placeholder-panel.tsx` | لا مراجع إلى `PlaceholderPanel` أو مسار الملف. |
| `apps/frontend/features/manager-properties/components/approval-property-card.tsx` | لا مراجع إلى `ApprovalPropertyCard`؛ كان يستورد `property-status-badge` فقط. |
| `apps/frontend/features/manager-properties/components/property-status-badge.tsx` | لا مراجع بعد حذف `approval-property-card`. |
| `apps/frontend/features/manager-clients/components/contact-card.tsx` | لا مراجع إلى `ContactCard`. |
| `apps/frontend/features/manager-clients/components/owner-employee-follow-up-tabs.tsx` | لا مراجع إلى `OwnerEmployeeFollowUpTabs`. |
| `apps/frontend/lib/property-privacy.ts` | لا مراجع إلى `canViewPropertyContact` أو `contactRoleLabel` أو `contactTypeLabel` أو `PropertyContactFields`. |

بعد الحذف: `git grep` لا يجد أي مرجع لهذه الملفات أو رموزها داخل كود التطبيق (تظهر فقط في تقارير تاريخية).

---

## 2. Exports غير مستخدمة أُزيلت دون حذف الملفات الأم

| الملف | ما أُزيل | ما بقي |
|---|---|---|
| `apps/frontend/lib/contact-registry.ts` | `useContactList` | `useContacts`, `useVisibleContacts`, `useRegistryContacts`, الأنواع. |
| `apps/frontend/features/employee-properties/components/employee-property-card.tsx` | `PropertyStatusBadge` | `EmployeePropertyCard` (مستخدم في صفحة عقارات الموظف). |
| `apps/frontend/features/employee-dashboard/components/dashboard-cards.tsx` | `FollowUpCard`, `EmployeePropertyCard` (نسخة الداشبورد), `ClientMiniCard` | `EmployeeStatCard` (مستخدم في `employee-dashboard-page`). |

تم تنظيف imports غير المستخدمة في `dashboard-cards.tsx` فقط. لم تُحذف ملفات CSS أو مكوّنات مشتركة.

---

## 3. ملفات تطوير محلية

| الملف | الإجراء | السبب |
|---|---|---|
| `apps/frontend/app/dev/potential-duplicate-preview/page.tsx` | **حُذف** | fixture بصري تطويري، لا مراجع runtime، ويعتمد فقط على مكونات موجودة. حذفه يمنع دخول المسار في build الإنتاج. |
| `apps/frontend/public/__drawer-header-probe.html` | **حُذف** | صفحة تشخيص ثابتة غير مستخدمة، وكانت تنسخ إلى `public` في أي build محلي. |

### التحقق من سلامة الإنتاج
- مجلد `apps/frontend/app/dev` لم يعد موجودًا.
- `next typegen` أُعيد تشغيله بعد الحذف؛ لم يعد `.next/types/validator.ts` يذكر `dev/potential-duplicate-preview`.
- لا توجد أي مراجع للمسار أو للـprobe داخل `apps/frontend`.
- بقيت سطور `.gitignore` و`.prettierignore` الخاصة بهما كسياسة وقاية مستقبلية؛ لا تضر.

---

## 4. مرشحون أُبقوا مع السبب

- `apps/frontend/features/manager-clients/components/follow-up-timeline.tsx` — ما زال مستخدمًا في `client-details-drawer.tsx`.
- `apps/frontend/features/manager-properties/preview-data.ts` — ما زال مستخدمًا عبر `property-adapter.ts` (`PreviewProperty`). واجهة `ApprovalProperty` داخله أصبحت بلا مرجع لكن الملف نفسه مطلوب.
- `apps/frontend/features/employee-properties/components/employee-property-card.tsx` — ما زال مستخدمًا في صفحة عقارات الموظف؛ أُزيل export واحد فقط.
- `apps/frontend/features/employee-dashboard/components/dashboard-cards.tsx` — ما زال مستخدمًا عبر `EmployeeStatCard`.
- ComingSoon، Deals، Finance، Attendance، NFC، Redis/BullMQ، Web Push، CSP scripts، Prisma migrations وتقارير سابقة: **لم تُلمس**.

---

## 5. التحقق

```powershell
npm run typecheck -w @arkan/frontend
# 0

npx eslint `
  apps/frontend/features/employee-dashboard/components/dashboard-cards.tsx `
  apps/frontend/features/employee-properties/components/employee-property-card.tsx `
  apps/frontend/lib/contact-registry.ts
# 0

npx next typegen
# Types generated successfully

npm run csp:test -w @arkan/frontend
# 8/8 passed
```

- لم تُشغّل اختبارات backend لعدم وجود تغييرات backend.
- لم توجد اختبارات UI مخصصة للمكونات المحذوفة؛ typecheck وESLint و`next typegen` هي التحقق المتاح.
- التصميم العربي RTL والسلوك الحالي لم يتغيرا.

---

## 6. القيود والمخاطر المتبقية

- لم يُجرَ smoke بصري في المتصفح بعد حذف المكونات غير المستخدمة؛ لا توجد مراجع runtime لها.
- `ApprovalProperty` داخل `preview-data.ts` أصبحت بلا مرجع، لكن لم تُحذف لأن الملف نفسه مستخدم.
- أُعيد توليد أنواع Next عبر `next typegen` بعد حذف مسار التطوير؛ لم يعد هناك types قديم يشير إليه.
- لا تغييرات على Git أو قاعدة البيانات.

**متوقف للمراجعة اليدوية.**
