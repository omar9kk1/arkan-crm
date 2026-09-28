# استعادة المسودات بعد التحديث

تم إضافة useFormDraft وuseDraftState وuseDraftFields. التخزين الأساسي في localStorage مع بديل sessionStorage عند تعذره، مع فصل المستخدم والدور والمسار والفورم. مهلة الحفظ 500ms، مع تفريغ التغييرات عند pagehide وbeforeunload وvisibilitychange. البيانات تبقى بعد إغلاق المتصفح حتى الحفظ النهائي الناجح، مع فصلها حسب الحساب والصفحة.

## النطاق

إضافة عميل، إضافة عقار، تسجيل صفقة، إضافة موظف، إضافة متابعة، نتيجة المتابعة، متابعة من ملف العميل، مصروف يدوي، حضور يدوي. حالات فتح هذه الفورمات تُستعاد أيضًا. الإلغاء يغلق الفورم ويحتفظ بالبيانات، والحفظ الناجح يمسحها ويغلق الفورم. لا توجد أزرار مسح أو استعادة أو بدء من جديد؛ تظهر رسالة «تم استعادة البيانات غير المحفوظة» مرة واحدة لكل فورم في تحميل الصفحة. لا يتم حفظ password/token/secret/credential fields أو نتيجة كلمة مرور الموظف.

## الجلسة

تم فحص auth/session.ts وAuthProvider وRequireRole دون تعديلها: جلسة صحيحة تكمل بنفس route؛ 401 يحاول refresh؛ 401/403 نهائي يمسح الجلسة؛ خطأ الشبكة يعرض إعادة المحاولة ويحتفظ بالجلسة. لا يوجد تحويل للرئيسية في استعادة الجلسة الصالحة.

## الاختبار اليدوي

1. /employee/clients: افتح إضافة عميل، اكتب الاسم والهاتف واختر الأنواع، انتقل للتحليل ثم اعمل refresh. تحقق من بقاء المسار والفورم والخطوة والبيانات.
2. /employee/properties: اكتب المالك واختر بيع وإيجار، اكتب الرسائل وحللها ثم refresh. تحقق من استعادة كل قسم.
3. /manager/deals: اختر العقار والعميل واعتمد الموظفين، أدخل القيم في الخطوة الثالثة ثم refresh.
4. جرّب الصفحات الداخلية للحسابين دون فورم: المسار لا يتغير عند refresh طالما الجلسة صالحة.
5. كرر التجربة مع المصروف والحضور والمتابعات والموظف. كلمة المرور لا تُستعاد.
6. أغلق الفورم بالإلغاء وافتحه مجددًا؛ يجب أن تعود القيم والخطوة. احفظ بنجاح ثم refresh؛ يجب ألا يفتح الفورم المكتمل مرة أخرى.
7. اكتب ثم أعد التحميل فورًا قبل مرور 500ms؛ الأحداث النهائية تحفظ التغيير.

## الحدود

اختبارات hook والمنطق تمت دون متصفح حقيقي. لا يوجد حفظ حقيقي للسجلات النهائية ولا مزامنة بين الأجهزة. التخزين خاص بالمتصفح وorigin، لذلك localhost وعنوان الشبكة منفصلان. بعد إغلاق المتصفح قد تحتاج تسجيل الدخول مجددًا؛ نظام Auth لم يتغير، وتعود بيانات الفورم عند الدخول بنفس الحساب والصفحة. منع التخزين أو إغلاق نظام التشغيل بالقوة قبل تفريغ التغييرات قد يمنع الاستعادة.

## الملفات المعدلة والمضافة

- [apps/frontend/features/employee-clients/components/request-wizard/add-client-request-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-clients/components/request-wizard/add-client-request-modal.tsx)
- [apps/frontend/features/employee-properties/components/add-property-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-properties/components/add-property-modal.tsx)
- [apps/frontend/features/manager-deals/components/deal-create-wizard.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-deals/components/deal-create-wizard.tsx)
- [apps/frontend/features/manager-employees/components/add-employee-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-employees/components/add-employee-modal.tsx)
- [apps/frontend/features/employee-followups/components/add-followup-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-followups/components/add-followup-modal.tsx)
- [apps/frontend/features/employee-followups/components/followup-result-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-followups/components/followup-result-modal.tsx)
- [apps/frontend/features/manager-finance/components/manual-expense-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-finance/components/manual-expense-modal.tsx)
- [apps/frontend/features/manager-attendance/components/attendance-manual-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-attendance/components/attendance-manual-modal.tsx)
- [apps/frontend/features/employee-clients/components/add-follow-up-modal.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-clients/components/add-follow-up-modal.tsx)
- [apps/frontend/features/employee-clients/components/employee-clients-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-clients/components/employee-clients-page.tsx)
- [apps/frontend/features/manager-clients/components/clients-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-clients/components/clients-page.tsx)
- [apps/frontend/features/employee-properties/components/employee-properties-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-properties/components/employee-properties-page.tsx)
- [apps/frontend/features/manager-properties/components/manager-properties.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-properties/components/manager-properties.tsx)
- [apps/frontend/features/manager-deals/components/deals-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-deals/components/deals-page.tsx)
- [apps/frontend/features/manager-employees/components/employees-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-employees/components/employees-page.tsx)
- [apps/frontend/features/manager-attendance/components/attendance-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-attendance/components/attendance-page.tsx)
- [apps/frontend/features/manager-finance/components/finance-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/manager-finance/components/finance-page.tsx)
- [apps/frontend/features/employee-followups/components/employee-followups-page.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-followups/components/employee-followups-page.tsx)
- [apps/frontend/features/employee-clients/components/employee-client-details-drawer.tsx](E:/arkan_codex_handoff_v1/apps/frontend/features/employee-clients/components/employee-client-details-drawer.tsx)
- [apps/frontend/lib/drafts/use-form-draft.ts](E:/arkan_codex_handoff_v1/apps/frontend/lib/drafts/use-form-draft.ts)
- [apps/frontend/lib/drafts/draft-tools.tsx](E:/arkan_codex_handoff_v1/apps/frontend/lib/drafts/draft-tools.tsx)
- [apps/frontend/lib/drafts/draft-storage.ts](E:/arkan_codex_handoff_v1/apps/frontend/lib/drafts/draft-storage.ts)
- [scripts/test-form-drafts.cjs](E:/arkan_codex_handoff_v1/scripts/test-form-drafts.cjs)

