export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
export type UserStatus = 'ACTIVE' | 'INACTIVE';

export const USER_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MEMBER'] as const;
export const USER_STATUSES: readonly UserStatus[] = ['ACTIVE', 'INACTIVE'] as const;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === 'string' && (USER_STATUSES as readonly string[]).includes(value);
}
