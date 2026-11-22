import {
  commissionMoney,
  mapEmployeeListItem,
} from '../../frontend/features/manager-employees/model';
import type { EmployeeListItemDto } from '../../frontend/lib/api/employee-types';

const dto: EmployeeListItemDto = {
  id: 'employee-1',
  name: 'موظف الاختبار',
  email: 'employee@test.local',
  role: 'EMPLOYEE',
  isActive: true,
  phone: null,
  hiredAt: null,
  baseSalary: null,
  managerUserId: null,
  managerName: null,
  capabilities: null,
  propertyCount: 2,
  propertiesByStatus: {
    PENDING: 0,
    AVAILABLE: 2,
    REJECTED: 0,
    SOLD: 0,
    RENTED: 0,
    ARCHIVED: 0,
  },
  clientsCount: 3,
  assignedCount: 1,
  dealsCount: 4,
  commissionTotal: '3.580',
  lateCount: 0,
};

describe('Employee card real metrics mapping', () => {
  it('maps the real deals count and exact commission total', () => {
    const employee = mapEmployeeListItem(dto);
    expect(employee.dealsCount).toBe(4);
    expect(employee.commission).toBe('3.580');
    // Existing card fields remain untouched.
    expect(employee.propertyCount).toBe(2);
    expect(employee.clientsCount).toBe(3);
    expect(employee.assignedCount).toBe(1);
  });

  it('renders zero commission with three decimals and KWD', () => {
    const expected = `${new Intl.NumberFormat('ar-KW', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(0)} د.ك`;
    expect(commissionMoney('0.000')).toBe(expected);
    expect(commissionMoney('0.000')).toContain('د.ك');
  });
});
