import type { IconName } from '../../ui/icon';
export interface ManagerNavItem {
  id: string;
  label: string;
  icon: IconName;
  href?: string;
}
export const primaryNavigation: ManagerNavItem[] = [
  { id: 'home', label: 'الرئيسية', icon: 'home', href: '/manager' },
  {
    id: 'properties',
    label: 'العقارات',
    icon: 'building',
    href: '/manager/properties',
  },
  { id: 'deals', label: 'الصفقات', icon: 'deals', href: '/manager/deals' },
  { id: 'clients', label: 'العملاء', icon: 'users', href: '/manager/clients' },
];
export const moreNavigation: ManagerNavItem[] = [
  { id: 'finance', label: 'المالية', icon: 'wallet', href: '/manager/finance' },
  {
    id: 'employees',
    label: 'الموظفون',
    icon: 'users',
    href: '/manager/employees',
  },
  {
    id: 'attendance',
    label: 'الحضور والانصراف',
    icon: 'clock',
    href: '/manager/attendance',
  },
  {
    id: 'notifications',
    label: 'الإشعارات',
    icon: 'bell',
    href: '/manager/notifications',
  },
  { id: 'reports', label: 'التقارير', icon: 'chart', href: '/manager/reports' },
  {
    id: 'marketing',
    label: 'التسويق',
    icon: 'megaphone',
    href: '/manager/marketing',
  },
  {
    id: 'settings',
    label: 'الإعدادات',
    icon: 'settings',
    href: '/manager/settings',
  },
];
