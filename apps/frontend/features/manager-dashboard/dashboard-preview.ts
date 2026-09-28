// Illustrative month snapshot only; never used as domain or financial records.
export const dashboardPreview = {
  stats: [
    {
      title: 'إجمالي العقارات',
      value: '32',
      hint: '18 متاح · 8 بانتظار الموافقة',
      icon: 'building',
    },
    {
      title: 'إجمالي العملاء',
      value: '43',
      hint: '9 عملاء جدد هذا الشهر',
      icon: 'users',
    },
    {
      title: 'إجمالي الملاك',
      value: '16',
      hint: '3 ملاك جدد هذا الشهر',
      icon: 'home',
    },
    {
      title: 'إجمالي الموظفين',
      value: '4',
      hint: '3 متواجدين الآن',
      icon: 'users',
    },
  ],
  leaders: [
    { label: 'أكثر موظف جاب عملاء', name: 'أحمد محمد', value: '12 عميل' },
    { label: 'أكثر موظف جاب عقارات', name: 'خالد مبارك', value: '7 عقارات' },
    { label: 'أكثر موظف قفل صفقات', name: 'سارة أحمد', value: '5 صفقات' },
  ],
  properties: [
    { label: 'متاح', value: 18 },
    { label: 'تم البيع', value: 4 },
    { label: 'تم التأجير', value: 2 },
    { label: 'بانتظار الموافقة', value: 8 },
  ],
  people: [
    { label: 'عملاء جدد', value: 9 },
    { label: 'ملاك جدد', value: 3 },
    { label: 'متابعات متأخرة', value: 7, warning: true },
    { label: 'متابعة تمت', value: 54 },
  ],
  alerts: [
    {
      title: 'متابعة مالك متأخرة',
      detail: 'أبو فهد · عقار المطلاع K029',
      warning: true,
    },
    { title: 'عقارات تحتاج اعتماد', detail: '8 عقارات مرسلة من الموظفين' },
    { title: 'صفقة مشتركة', detail: 'راجع توزيع العمولة بين موظفين' },
  ],
  activity: [
    { title: 'تم تسجيل صفقة بيع', detail: 'بيت المطلاع K027 · بواسطة المدير' },
    { title: 'تم إضافة عميل جديد', detail: 'محمد العتيبي · مهتم بالمطلاع' },
    { title: 'تم تخصيص عقار', detail: 'غرناطة K0331 · تسويق فقط لأحمد محمد' },
  ],
} as const;
