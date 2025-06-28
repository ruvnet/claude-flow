/**
 * TypeScript interfaces for SQLite row results
 * These interfaces match the actual database column names (snake_case)
 * to ensure proper type safety when querying the database
 */

// Agent-related row types
export interface AgentRow {
  id: string;
  type: string;
  name: string;
  status: string;
  capabilities: string; // JSON string
  system_prompt?: string;
  max_concurrent_tasks: number;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface AgentMetricsRow {
  agent_id: string;
  tasks_completed: number;
  tasks_failed: number;
  total_duration_ms: number;
  last_activity: string;
}

export interface AgentWithMetricsRow extends AgentRow {
  tasks_completed: number;
  tasks_failed: number;
  total_duration_ms: number;
  last_activity: string;
}

// Task-related row types
export interface TaskRow {
  id: string;
  type: string;
  description?: string;
  status: string;
  priority: number;
  dependencies: string; // JSON string
  metadata: string; // JSON string
  assigned_agent?: string;
  progress: number;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  retry_count: number;
  max_retries: number;
  timeout_ms: number;
}

// Memory-related row types
export interface SwarmMemoryEntryRow {
  id: string;
  agent_id: string;
  type: string;
  content: string; // JSON string or text
  timestamp: string;
  task_id?: string;
  objective_id?: string;
  tags: string; // JSON string
  priority: number;
  share_level: string;
}

// Message-related row types
export interface MessageRow {
  id: string;
  type: string;
  sender_id: string;
  receivers: string; // JSON string
  content: string;
  priority: number;
  reliability: string;
  created_at: string;
  expires_at?: string;
}

export interface MessageAcknowledgmentRow {
  message_id: string;
  agent_id: string;
  acknowledged_at: string;
}

// Objective-related row types
export interface ObjectiveRow {
  id: string;
  description: string;
  status: string;
  priority: number;
  metadata: string; // JSON string
  created_at: string;
  completed_at?: string;
}

export interface ObjectiveTaskRow {
  objective_id: string;
  task_id: string;
}

// Complex query result types
export interface AgentWorkloadRow {
  agent_id: string;
  agent_name: string;
  agent_type: string;
  active_task_count: number;
  pending_task_count: number;
  completed_today: number;
  average_completion_time: number | null;
  current_load: number | null;
}

export interface TaskDependencyRow {
  task_id: string;
  task_type: string;
  status: string;
  dependencies: string; // JSON string
  dependents: string; // JSON string
}

export interface MemoryUsagePatternRow {
  date: string;
  hour: number;
  entry_count: number;
  unique_agents: number;
  avg_priority: number;
  top_types: string; // JSON string
}

export interface ObjectiveProgressRow {
  objective_id: string;
  description: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  progress_percentage: number;
  blocked_tasks: string; // JSON string
}

export interface CommunicationPatternRow {
  sender_id: string;
  receiver_id: string;
  message_types: string; // JSON string
  total_messages: number;
}

export interface AgentNodeRow {
  id: string;
  label: string;
  type: string;
  message_count: number;
}

export interface PerformanceAnomalyAgentRow {
  id: string;
  name: string;
  type: string;
  tasks_completed: number;
  tasks_failed: number;
  failure_rate: number;
  avg_task_duration: number;
}

export interface StuckTaskRow {
  id: string;
  type: string;
  assigned_agent?: string;
  status: string;
  started_at: string;
  seconds_in_progress: number;
}

export interface MemoryGrowthRow {
  entry_count: number;
  total_size: number;
}

export interface DeliveryIssueRow {
  id: string;
  type: string;
  sender_id: string;
  total_receivers: number;
  acknowledged_count: number;
  created_at: string;
}

export interface DatabaseSizeRow {
  size: number;
}

export interface CountRow {
  count: number;
}

export interface CacheSizeRow {
  cache_size: number;
}

export interface StatusCountRow {
  status: string;
  count: number;
}

export interface PerformanceMetricsRow {
  avg_completion_time: number | null;
  success_rate: number | null;
  avg_retries: number | null;
}

export interface AgentPerformanceStatsRow {
  total_agents: number;
  active_agents: number;
  total_tasks_completed: number;
  total_tasks_failed: number;
  average_task_duration: number;
}