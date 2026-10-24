export interface ComplianceRule {
  _id: string;
  jurisdiction: string;
  name: string;
  type: 'break' | 'overtime' | 'predictive_scheduling' | 'minor' | 'split_shift';
  parameters: Record<string, number | string | boolean>;
  description: string;
  isActive: boolean;
}

export interface ComplianceViolation {
  _id: string;
  ruleId: string;
  scheduleId: string;
  employeeId: string;
  shiftId: string;
  severity: 'warning' | 'violation' | 'critical';
  description: string;
  detectedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}
