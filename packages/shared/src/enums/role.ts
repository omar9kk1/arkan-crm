export const Role = {
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
