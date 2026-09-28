import {
  localDate,
  shiftDate,
  money,
  manualMovement,
  type FinanceMovement,
} from './finance-model';
// Independent source snapshots, normalized into one financial movement feed.
// These fixtures do not read or persist data from the other preview pages.
export function createPreviewMovements(today = localDate()): FinanceMovement[] {
  const deal = {
    id: 'D001',
    property: 'المطلاع K027',
    client: 'محمد العتيبي',
    price: 300000000,
    commission: 3000000,
    date: today,
  };
  const commissionSources = [
    { id: 'C001', employee: 'خالد مبارك', amount: 1000000 },
    { id: 'C002', employee: 'أحمد محمد', amount: 2000000 },
  ];
  const salarySources = [
    {
      id: 'P001',
      employee: 'أحمد محمد',
      base: 1200000,
      bonus: 50000,
      deduction: 0,
      date: shiftDate(today, -3),
    },
    {
      id: 'P002',
      employee: 'سارة أحمد',
      base: 1300000,
      bonus: 100000,
      deduction: 0,
      date: shiftDate(today, -8),
    },
  ];
  const income: FinanceMovement = {
    id: 'income-001',
    reference: 'FM-001',
    title: 'عمولة بيع بيت المطلاع',
    type: 'income',
    sourceType: 'صفقة',
    sourceId: deal.id,
    date: deal.date,
    amountFils: deal.commission,
    direction: 'داخل',
    party: 'الشركة',
    property: deal.property,
    clientOrOwner: deal.client,
    status: 'مسجل تجريبيًا',
    calculation: [
      `سعر الصفقة: ${money(deal.price)}`,
      'نسبة العمولة التجريبية: 1%',
      `عمولة الشركة: ${money(deal.commission)}`,
    ],
    notes: 'مصدر الحركة تسجيل الصفقة. توزيع الموظفين ظاهر كحركات مستقلة.',
  };
  return [
    income,
    ...commissionSources.map((source): FinanceMovement => ({
      id: source.id,
      reference: `FM-${source.id}`,
      title: `عمولة ${source.employee} عن صفقة ${deal.id}`,
      type: 'commission',
      sourceType: 'عمولة',
      sourceId: source.id,
      date: today,
      amountFils: source.amount,
      direction: 'خارج',
      party: source.employee,
      employee: source.employee,
      property: deal.property,
      clientOrOwner: deal.client,
      status: 'مسجل تجريبيًا',
      calculation: [
        `الصفقة المرتبطة: ${deal.id}`,
        `نصيب الموظف: ${money(source.amount)}`,
      ],
      notes:
        'عمولة موظف من توزيع عمولات الصفقة، وليست إدخالًا مباشرًا من صفحة المالية.',
    })),
    ...salarySources.map((source): FinanceMovement => ({
      id: source.id,
      reference: `FM-${source.id}`,
      title: `راتب ${source.employee}`,
      type: 'payroll',
      sourceType: 'راتب',
      sourceId: source.id,
      date: source.date,
      amountFils: source.base + source.bonus - source.deduction,
      direction: 'خارج',
      party: source.employee,
      employee: source.employee,
      status: 'مسجل تجريبيًا',
      calculation: [
        `راتب أساسي: ${money(source.base)}`,
        `مكافآت: ${money(source.bonus)}`,
        `خصومات: ${money(source.deduction)}`,
        `الصافي: ${money(source.base + source.bonus - source.deduction)}`,
      ],
      notes: 'مصروف إداري ناتج عن تسجيل راتب تجريبي.',
    })),
    manualMovement(
      {
        expenseType: 'تصوير عقار',
        currency: 'KWD',
        amountFils: 75000,
        date: shiftDate(today, -2),
        property: 'غرناطة K0331',
        description: 'جلسة تصوير وإعداد إعلان للعقار.',
      },
      'EXP001',
    ),
    manualMovement(
      {
        expenseType: 'مصروف إداري',
        currency: 'KWD',
        amountFils: 30000,
        date: shiftDate(today, -40),
        property: '',
        description: 'مستلزمات مكتبية تجريبية.',
      },
      'EXP002',
    ),
  ].sort((a, b) => b.date.localeCompare(a.date));
}
