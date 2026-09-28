export const Role = { MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE' } as const;
export type Role = (typeof Role)[keyof typeof Role];
