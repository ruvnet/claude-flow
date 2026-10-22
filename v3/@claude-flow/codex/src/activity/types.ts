export type RecordObject = Record<string, unknown>;

export function object(value: unknown): RecordObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordObject : {};
}

export interface SessionIdentity {
  id: string;
  parent: string | null;
  name: string;
  path: string;
  file: string;
}

export interface ActivityEvent {
  kind: 'message' | 'tool';
  time: string;
  label: string;
  text: string;
  output: string;
  status: string;
}

export interface ActivitySnapshot {
  available: boolean;
  status: string;
  assignment: string;
  events: ActivityEvent[];
  updatedAt: string;
  bytesRead: number;
  fileSize: number;
  partial: boolean;
  limited: boolean;
  attributed: boolean;
  error: string;
}
