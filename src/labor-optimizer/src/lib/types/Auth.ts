export type AppUserRole = 'corporate_admin' | 'regional_manager' | 'general_manager'
                        | 'assistant_manager' | 'shift_lead';

export type Permission =
  | 'schedule:read' | 'schedule:write' | 'schedule:publish'
  | 'employee:read' | 'employee:write'
  | 'labor_cost:read' | 'labor_cost:export'
  | 'forecast:read' | 'forecast:generate'
  | 'compliance:read' | 'compliance:override'
  | 'settings:read' | 'settings:write'
  | 'reports:read' | 'reports:export'
  | 'integration:configure';

export interface AppUser {
  _id: string;
  email: string;
  name: string;
  role: AppUserRole;
  locationIds: string[];
  permissions: Permission[];
  isActive: boolean;
  createdAt: string;
}

export const ROLE_PERMISSIONS: Record<AppUserRole, Permission[]> = {
  corporate_admin: [
    'schedule:read', 'schedule:write', 'schedule:publish',
    'employee:read', 'employee:write',
    'labor_cost:read', 'labor_cost:export',
    'forecast:read', 'forecast:generate',
    'compliance:read', 'compliance:override',
    'settings:read', 'settings:write',
    'reports:read', 'reports:export',
    'integration:configure',
  ],
  regional_manager: [
    'schedule:read', 'schedule:write', 'schedule:publish',
    'employee:read', 'employee:write',
    'labor_cost:read', 'labor_cost:export',
    'forecast:read', 'forecast:generate',
    'compliance:read',
    'settings:read',
    'reports:read', 'reports:export',
  ],
  general_manager: [
    'schedule:read', 'schedule:write', 'schedule:publish',
    'employee:read', 'employee:write',
    'labor_cost:read',
    'forecast:read', 'forecast:generate',
    'compliance:read',
    'reports:read',
  ],
  assistant_manager: [
    'schedule:read', 'schedule:write',
    'employee:read',
    'labor_cost:read',
    'forecast:read',
    'compliance:read',
  ],
  shift_lead: [
    'schedule:read',
    'employee:read',
    'compliance:read',
  ],
};
