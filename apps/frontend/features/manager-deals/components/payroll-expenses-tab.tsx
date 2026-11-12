import { Card } from '../../../components/ui/card';

/**
 * Payroll/expenses remain a deferred Finance surface. The previous preview
 * showed hardcoded salaries and accepted a mock expense; both are removed so
 * the Deals page never presents fake financial totals as real data.
 */
export function PayrollExpensesTab() {
  return (
    <Card>
      <h2>المرتبات والمصاريف</h2>
      <p>
        ستُتاح وحدة المرتبات والمصاريف بعد تفعيل وحدة المالية. لا تُعرض هنا أي
        بيانات تجريبية.
      </p>
    </Card>
  );
}
