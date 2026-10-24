/**
 * Role-Based Access Control (RBAC) for HELIXO KPI Dashboard.
 *
 * NEW MODEL: Groups define tab-level permissions (what you see).
 *            User location assignments define where you see it.
 *
 * Legacy hierarchy kept for backwards compat: super_admin > director > admin > manager > viewer
 */

export type UserRole = 'super_admin' | 'director' | 'admin' | 'manager' | 'viewer';

export interface RolePermissions {
  reporting: boolean;
  planning: boolean;
  admin: boolean;
  scheduleApprove: boolean;
  forecastUnlock: boolean;
}

/** Tab-level permissions from user_groups.tab_permissions JSONB. */
export interface TabPermissions {
  reporting: string[];
  planning: string[];
  admin: string[];
}

/** All available tabs per category. */
export const ALL_REPORTING_TABS = [
  'executive_summary', 'dashboard', 'labor_detail', 'insights',
  'location_comparison', 'monthly_report', 'guest_analytics', 'events', 'snapshot',
] as const;

export const ALL_PLANNING_TABS = [
  'forecast', 'staffing', 'schedule_builder', 'schedule_approval', 'approval_workflow',
] as const;

export const ALL_ADMIN_TABS = [
  'user_management', 'employees', 'forecast_accuracy', 'engine_audit',
  'competitive_set', 'settings', 'labor_questionnaire', 'guiding_principles',
  'data_sources',
] as const;

/** Map from nav route path to tab permission key. */
export const NAV_TO_TAB_KEY: Record<string, { category: keyof TabPermissions; key: string }> = {
  '/dashboard/executive':                { category: 'reporting', key: 'executive_summary' },
  '/dashboard':                          { category: 'reporting', key: 'dashboard' },
  '/dashboard/labor-detail':             { category: 'reporting', key: 'labor_detail' },
  '/dashboard/insights':                 { category: 'reporting', key: 'insights' },
  '/dashboard/location-comparison':      { category: 'reporting', key: 'location_comparison' },
  '/dashboard/monthly-report':           { category: 'reporting', key: 'monthly_report' },
  '/dashboard/guest-analytics':          { category: 'reporting', key: 'guest_analytics' },
  '/dashboard/events':                   { category: 'reporting', key: 'events' },
  '/dashboard/snapshot':                 { category: 'reporting', key: 'snapshot' },
  '/dashboard/forecast':                 { category: 'planning', key: 'forecast' },
  '/dashboard/staffing':                 { category: 'planning', key: 'staffing' },
  '/dashboard/schedule-builder':         { category: 'planning', key: 'schedule_builder' },
  '/dashboard/schedule-approval':        { category: 'planning', key: 'schedule_approval' },
  '/dashboard/approval-workflow':        { category: 'planning', key: 'approval_workflow' },
  '/dashboard/admin/user-management':    { category: 'admin', key: 'user_management' },
  '/dashboard/admin/employees':          { category: 'admin', key: 'employees' },
  '/dashboard/admin/forecast-accuracy':  { category: 'admin', key: 'forecast_accuracy' },
  '/dashboard/admin/engine-audit':       { category: 'admin', key: 'engine_audit' },
  '/dashboard/admin/competitive':        { category: 'admin', key: 'competitive_set' },
  '/dashboard/settings':                 { category: 'admin', key: 'settings' },
  '/dashboard/settings/questionnaire':   { category: 'admin', key: 'labor_questionnaire' },
  '/dashboard/admin/principles':         { category: 'admin', key: 'guiding_principles' },
  '/dashboard/admin/data-source-map':    { category: 'admin', key: 'data_sources' },
};

/** Check if a tab permission key exists in the user's tab permissions. */
export function canAccessTab(permissions: TabPermissions, tabKey: string): boolean {
  const all = [...permissions.reporting, ...permissions.planning, ...permissions.admin];
  return all.includes(tabKey);
}

/** Check if a nav route path is permitted by the user's tab permissions. */
export function canAccessRoute(permissions: TabPermissions, path: string): boolean {
  const mapping = NAV_TO_TAB_KEY[path];
  if (!mapping) return false;
  return permissions[mapping.category]?.includes(mapping.key) ?? false;
}

/** Empty permissions (no access). */
export const EMPTY_TAB_PERMISSIONS: TabPermissions = {
  reporting: [],
  planning: [],
  admin: [],
};

/** Default tab permissions for built-in groups. */
export const DEFAULT_GROUP_PERMISSIONS: Record<string, TabPermissions> = {
  'Super Admin': {
    reporting: [...ALL_REPORTING_TABS],
    planning: [...ALL_PLANNING_TABS],
    admin: [...ALL_ADMIN_TABS],
  },
  'Executive': {
    reporting: [...ALL_REPORTING_TABS],
    planning: ['forecast'],
    admin: [],
  },
  'Director': {
    reporting: [...ALL_REPORTING_TABS],
    planning: [...ALL_PLANNING_TABS],
    admin: [],
  },
  'Approver': {
    reporting: ['dashboard'],
    planning: ['approval_workflow'],
    admin: [],
  },
  'Manager': {
    reporting: ['dashboard', 'labor_detail', 'insights', 'guest_analytics', 'events'],
    planning: ['forecast', 'schedule_approval'],
    admin: [],
  },
  'Staff': {
    reporting: ['dashboard'],
    planning: [],
    admin: [],
  },
};

// ---- Legacy types / functions kept for backwards compat ----

export type NavKey =
  | 'executive'
  | 'dashboard'
  | 'labor-detail'
  | 'insights'
  | 'location-comparison'
  | 'monthly-report'
  | 'forecast'
  | 'staffing'
  | 'schedule'
  | 'admin';

const DIRECTOR_AND_ABOVE: UserRole[] = ['super_admin', 'director'];
const MANAGER_AND_ABOVE: UserRole[] = ['super_admin', 'director', 'manager'];
const ALL_ROLES: UserRole[] = ['super_admin', 'director', 'manager', 'viewer'];

export const NAV_VISIBILITY: Record<NavKey, UserRole[]> = {
  executive:           DIRECTOR_AND_ABOVE,
  dashboard:           ALL_ROLES,
  'labor-detail':      ALL_ROLES,
  insights:            MANAGER_AND_ABOVE,
  'location-comparison': DIRECTOR_AND_ABOVE,
  'monthly-report':    MANAGER_AND_ABOVE,
  forecast:            MANAGER_AND_ABOVE,
  staffing:            MANAGER_AND_ABOVE,
  schedule:            MANAGER_AND_ABOVE,
  admin:               ['super_admin'],
};

/** Check if a role can see a specific nav item (legacy). */
export function canSeeNav(role: UserRole, nav: NavKey): boolean {
  return NAV_VISIBILITY[nav]?.includes(role) ?? false;
}

export const ROLE_HIERARCHY: UserRole[] = [
  'super_admin', 'director', 'admin', 'manager', 'viewer',
];

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  super_admin: { reporting: true, planning: true, admin: true, scheduleApprove: true, forecastUnlock: true },
  director:    { reporting: true, planning: true, admin: false, scheduleApprove: true, forecastUnlock: false },
  admin:       { reporting: true, planning: true, admin: true, scheduleApprove: false, forecastUnlock: false },
  manager:     { reporting: true, planning: true, admin: false, scheduleApprove: false, forecastUnlock: false },
  viewer:      { reporting: true, planning: false, admin: false, scheduleApprove: false, forecastUnlock: false },
};

export function canAccess(role: UserRole, section: keyof RolePermissions): boolean {
  return ROLE_PERMISSIONS[role]?.[section] ?? false;
}
export function canApproveSchedule(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.scheduleApprove ?? false;
}
export function canUnlockForecast(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.forecastUnlock ?? false;
}
export function hasAdminAccess(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role]?.admin ?? false;
}
export function isValidRole(role: string): role is UserRole {
  return ROLE_HIERARCHY.includes(role as UserRole);
}
export function getHighestRole(roles: UserRole[]): UserRole {
  if (roles.length === 0) return 'viewer';
  for (const r of ROLE_HIERARCHY) {
    if (roles.includes(r)) return r;
  }
  return 'viewer';
}
