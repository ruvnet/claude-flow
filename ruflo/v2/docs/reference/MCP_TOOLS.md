# Claude Flow MCP Tools Reference

This document provides a comprehensive reference for all 112 MCP (Model Context Protocol) tools available in the Claude Flow ecosystem.

## Overview

Claude Flow integrates with two MCP tool providers:
- **claude-flow tools**: 87 tools for core functionality
- **ruv-swarm tools**: 25 tools for advanced swarm intelligence

All tools follow the naming convention: `mcp__provider__tool_name`

---

## Claude Flow Tools (87 tools)

The claude-flow tools are organized into 8 categories providing comprehensive development, coordination, and system management capabilities.

### Swarm Coordination (12 tools)

These tools manage swarm initialization, agent spawning, and coordination tasks.

#### `mcp__claude-flow__swarm_init`
**Function**: Initialize a new swarm with specified topology and configuration
**Parameters**:
- `topology` (string): Swarm topology type - "hierarchical", "mesh", "distributed", "centralized"
- `maxAgents` (number): Maximum number of agents in the swarm (default: 8)
- `strategy` (string): Coordination strategy - "auto", "manual", "adaptive"
- `swarmId` (string, optional): Custom swarm identifier

**Usage Example**:
```json
{
  "topology": "hierarchical",
  "maxAgents": 12,
  "strategy": "auto",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__agent_spawn`
**Function**: Create and spawn new agents with specific roles and capabilities
**Parameters**:
- `type` (string): Agent type - "coder", "researcher", "tester", "coordinator", "architect"
- `name` (string, optional): Custom agent name
- `swarmId` (string): Target swarm identifier
- `capabilities` (array, optional): Specific capabilities to enable

**Usage Example**:
```json
{
  "type": "coder",
  "name": "BackendSpecialist",
  "swarmId": "project-alpha",
  "capabilities": ["nodejs", "database", "api-design"]
}
```

#### `mcp__claude-flow__task_orchestrate`
**Function**: Coordinate task distribution and execution across agents
**Parameters**:
- `task` (string): Task description
- `strategy` (string): Execution strategy - "parallel", "sequential", "adaptive"
- `priority` (number): Task priority (1-10)
- `swarmId` (string): Target swarm identifier

**Usage Example**:
```json
{
  "task": "Implement user authentication system",
  "strategy": "parallel",
  "priority": 8,
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__swarm_status`
**Function**: Get comprehensive status of all swarms and their components
**Parameters**:
- `swarmId` (string, optional): Specific swarm to query
- `includeMetrics` (boolean): Include performance metrics

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "includeMetrics": true
}
```

#### `mcp__claude-flow__agent_list`
**Function**: List all agents with their current status and assignments
**Parameters**:
- `status` (string, optional): Filter by status - "active", "idle", "offline"
- `type` (string, optional): Filter by agent type
- `swarmId` (string, optional): Filter by swarm

**Usage Example**:
```json
{
  "status": "active",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__agent_metrics`
**Function**: Retrieve detailed performance metrics for agents
**Parameters**:
- `agentId` (string, optional): Specific agent ID
- `timeframe` (string): Time period - "1h", "24h", "7d", "30d"
- `metrics` (array): Specific metrics to include

**Usage Example**:
```json
{
  "timeframe": "24h",
  "metrics": ["tasks_completed", "success_rate", "avg_response_time"]
}
```

#### `mcp__claude-flow__swarm_monitor`
**Function**: Real-time monitoring of swarm activities and performance
**Parameters**:
- `interval` (number): Update interval in milliseconds
- `swarmId` (string, optional): Specific swarm to monitor
- `alerts` (boolean): Enable alert notifications

**Usage Example**:
```json
{
  "interval": 5000,
  "swarmId": "project-alpha",
  "alerts": true
}
```

#### `mcp__claude-flow__topology_optimize`
**Function**: Optimize swarm topology based on current workload and performance
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `criteria` (string): Optimization criteria - "performance", "cost", "reliability"
- `autoApply` (boolean): Automatically apply optimizations

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "criteria": "performance",
  "autoApply": false
}
```

#### `mcp__claude-flow__load_balance`
**Function**: Distribute workload evenly across available agents
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `strategy` (string): Balancing strategy - "round_robin", "least_loaded", "capability_based"
- `tasks` (array): Tasks to distribute

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "strategy": "capability_based",
  "tasks": ["task-1", "task-2", "task-3"]
}
```

#### `mcp__claude-flow__coordination_sync`
**Function**: Synchronize coordination state across all agents in a swarm
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `force` (boolean): Force synchronization even if agents are busy

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "force": false
}
```

#### `mcp__claude-flow__swarm_scale`
**Function**: Dynamically scale swarm size based on workload demands
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `direction` (string): Scaling direction - "up", "down", "auto"
- `targetSize` (number, optional): Desired number of agents

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "direction": "up",
  "targetSize": 15
}
```

#### `mcp__claude-flow__swarm_destroy`
**Function**: Safely terminate a swarm and clean up all associated resources
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `preserveData` (boolean): Keep swarm data for analysis
- `graceful` (boolean): Allow agents to complete current tasks

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "preserveData": true,
  "graceful": true
}
```

### Neural Networks & AI (15 tools)

Advanced AI and machine learning capabilities for pattern recognition and adaptive behavior.

#### `mcp__claude-flow__neural_status`
**Function**: Get status of neural network models and training processes
**Parameters**:
- `modelId` (string, optional): Specific model identifier
- `includeWeights` (boolean): Include model weights in response

**Usage Example**:
```json
{
  "includeWeights": false
}
```

#### `mcp__claude-flow__neural_train`
**Function**: Train neural networks on coordination patterns and task outcomes
**Parameters**:
- `pattern_type` (string): Pattern type - "coordination", "optimization", "prediction"
- `epochs` (number): Number of training epochs
- `data_source` (string): Training data source
- `swarmId` (string, optional): Associated swarm for context

**Usage Example**:
```json
{
  "pattern_type": "coordination",
  "epochs": 100,
  "data_source": "swarm_interactions",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__neural_patterns`
**Function**: Analyze and extract patterns from swarm behavior and outcomes
**Parameters**:
- `analysis_type` (string): Analysis type - "behavior", "performance", "communication"
- `timeframe` (string): Time period to analyze
- `swarmId` (string, optional): Target swarm

**Usage Example**:
```json
{
  "analysis_type": "behavior",
  "timeframe": "7d",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__neural_predict`
**Function**: Make predictions about task outcomes and optimal strategies
**Parameters**:
- `input_data` (object): Input data for prediction
- `modelId` (string): Model to use for prediction
- `confidence_threshold` (number): Minimum confidence level

**Usage Example**:
```json
{
  "input_data": {"task_complexity": 7, "agent_count": 5},
  "modelId": "coordination_predictor",
  "confidence_threshold": 0.8
}
```

#### `mcp__claude-flow__model_load`
**Function**: Load a pre-trained neural network model
**Parameters**:
- `modelId` (string): Model identifier
- `version` (string, optional): Specific model version
- `cache` (boolean): Cache model in memory

**Usage Example**:
```json
{
  "modelId": "task_optimizer_v2",
  "version": "1.2.0",
  "cache": true
}
```

#### `mcp__claude-flow__model_save`
**Function**: Save current neural network model state
**Parameters**:
- `modelId` (string): Model identifier
- `version` (string): Version tag
- `metadata` (object): Additional model metadata

**Usage Example**:
```json
{
  "modelId": "task_optimizer_v2",
  "version": "1.3.0",
  "metadata": {"training_date": "2024-01-15", "accuracy": 0.92}
}
```

#### `mcp__claude-flow__wasm_optimize`
**Function**: Optimize neural network execution using WebAssembly
**Parameters**:
- `modelId` (string): Model to optimize
- `optimization_level` (string): Optimization level - "basic", "aggressive", "max"
- `target_platform` (string): Target platform - "browser", "node", "edge"

**Usage Example**:
```json
{
  "modelId": "coordination_predictor",
  "optimization_level": "aggressive",
  "target_platform": "node"
}
```

#### `mcp__claude-flow__inference_run`
**Function**: Run inference on loaded neural network models
**Parameters**:
- `modelId` (string): Model identifier
- `input_data` (object): Input data
- `batch_size` (number, optional): Batch processing size

**Usage Example**:
```json
{
  "modelId": "task_classifier",
  "input_data": {"description": "Implement API endpoint", "complexity": "medium"},
  "batch_size": 1
}
```

#### `mcp__claude-flow__pattern_recognize`
**Function**: Recognize patterns in agent behavior and task execution
**Parameters**:
- `data_type` (string): Type of data to analyze - "logs", "metrics", "communications"
- `pattern_types` (array): Pattern types to look for
- `swarmId` (string, optional): Target swarm

**Usage Example**:
```json
{
  "data_type": "communications",
  "pattern_types": ["bottlenecks", "inefficiencies", "optimal_flows"],
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__cognitive_analyze`
**Function**: Perform cognitive analysis of decision-making processes
**Parameters**:
- `decision_context` (object): Context of the decision
- `analysis_depth` (string): Analysis depth - "surface", "deep", "comprehensive"
- `include_alternatives` (boolean): Include alternative decision paths

**Usage Example**:
```json
{
  "decision_context": {"task": "architecture_choice", "constraints": ["time", "budget"]},
  "analysis_depth": "deep",
  "include_alternatives": true
}
```

#### `mcp__claude-flow__learning_adapt`
**Function**: Adapt behavior based on learning from past experiences
**Parameters**:
- `experience_data` (object): Experience data to learn from
- `adaptation_type` (string): Type of adaptation - "strategy", "communication", "resource_allocation"
- `swarmId` (string): Target swarm

**Usage Example**:
```json
{
  "experience_data": {"task_type": "api_development", "outcome": "success", "duration": 240},
  "adaptation_type": "strategy",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__neural_compress`
**Function**: Compress neural network models for efficient deployment
**Parameters**:
- `modelId` (string): Model to compress
- `compression_ratio` (number): Target compression ratio (0.1 to 0.9)
- `quality_threshold` (number): Minimum quality to maintain

**Usage Example**:
```json
{
  "modelId": "large_coordination_model",
  "compression_ratio": 0.3,
  "quality_threshold": 0.85
}
```

#### `mcp__claude-flow__ensemble_create`
**Function**: Create ensemble models from multiple neural networks
**Parameters**:
- `modelIds` (array): Models to include in ensemble
- `voting_strategy` (string): Voting strategy - "majority", "weighted", "soft"
- `ensembleId` (string): New ensemble identifier

**Usage Example**:
```json
{
  "modelIds": ["predictor_1", "predictor_2", "predictor_3"],
  "voting_strategy": "weighted",
  "ensembleId": "task_prediction_ensemble"
}
```

#### `mcp__claude-flow__transfer_learn`
**Function**: Apply transfer learning from one domain to another
**Parameters**:
- `source_model` (string): Source model identifier
- `target_domain` (string): Target domain
- `freeze_layers` (array): Layers to freeze during transfer

**Usage Example**:
```json
{
  "source_model": "general_coordinator",
  "target_domain": "mobile_development",
  "freeze_layers": ["layer1", "layer2"]
}
```

#### `mcp__claude-flow__neural_explain`
**Function**: Provide explanations for neural network decisions and predictions
**Parameters**:
- `modelId` (string): Model to explain
- `input_data` (object): Input data used for prediction
- `explanation_type` (string): Explanation type - "feature_importance", "decision_path", "counterfactual"

**Usage Example**:
```json
{
  "modelId": "task_prioritizer",
  "input_data": {"urgency": 8, "complexity": 6, "resources": 3},
  "explanation_type": "feature_importance"
}
```

### Memory & Persistence (12 tools)

Tools for managing persistent memory, state, and data across swarm sessions.

#### `mcp__claude-flow__memory_usage`
**Function**: Store and retrieve data in persistent memory with namespace support
**Parameters**:
- `action` (string): Action type - "store", "retrieve", "delete"
- `key` (string): Memory key
- `value` (any, for store): Data to store
- `namespace` (string, optional): Memory namespace
- `type` (string, optional): Data type - "knowledge", "config", "metrics", "state"

**Usage Example**:
```json
{
  "action": "store",
  "key": "project_requirements",
  "value": {"features": ["auth", "dashboard"], "deadline": "2024-02-01"},
  "namespace": "project-alpha",
  "type": "knowledge"
}
```

#### `mcp__claude-flow__memory_search`
**Function**: Search memory using patterns and filters
**Parameters**:
- `pattern` (string): Search pattern or query
- `namespace` (string, optional): Namespace to search in
- `type_filter` (string, optional): Filter by data type
- `limit` (number, optional): Maximum results to return

**Usage Example**:
```json
{
  "pattern": "authentication",
  "namespace": "project-alpha",
  "type_filter": "knowledge",
  "limit": 10
}
```

#### `mcp__claude-flow__memory_persist`
**Function**: Persist memory data to permanent storage
**Parameters**:
- `namespace` (string, optional): Specific namespace to persist
- `compression` (boolean): Enable compression
- `backup_existing` (boolean): Create backup before persisting

**Usage Example**:
```json
{
  "namespace": "project-alpha",
  "compression": true,
  "backup_existing": true
}
```

#### `mcp__claude-flow__memory_namespace`
**Function**: Manage memory namespaces (create, delete, list)
**Parameters**:
- `action` (string): Action type - "create", "delete", "list", "info"
- `namespace` (string): Namespace name
- `maxSize` (number, optional): Maximum namespace size in MB

**Usage Example**:
```json
{
  "action": "create",
  "namespace": "experiment-beta",
  "maxSize": 500
}
```

#### `mcp__claude-flow__memory_backup`
**Function**: Create backups of memory data
**Parameters**:
- `namespace` (string, optional): Specific namespace to backup
- `backup_name` (string): Backup identifier
- `incremental` (boolean): Create incremental backup

**Usage Example**:
```json
{
  "namespace": "project-alpha",
  "backup_name": "milestone_1_complete",
  "incremental": false
}
```

#### `mcp__claude-flow__memory_restore`
**Function**: Restore memory data from backups
**Parameters**:
- `backup_name` (string): Backup identifier to restore
- `namespace` (string, optional): Target namespace
- `merge_strategy` (string): Merge strategy - "overwrite", "merge", "skip_conflicts"

**Usage Example**:
```json
{
  "backup_name": "milestone_1_complete",
  "namespace": "project-alpha",
  "merge_strategy": "merge"
}
```

#### `mcp__claude-flow__memory_compress`
**Function**: Compress memory data to save storage space
**Parameters**:
- `namespace` (string, optional): Specific namespace to compress
- `compression_level` (number): Compression level (1-9)
- `preserve_access_patterns` (boolean): Optimize for access patterns

**Usage Example**:
```json
{
  "namespace": "archived_projects",
  "compression_level": 7,
  "preserve_access_patterns": false
}
```

#### `mcp__claude-flow__memory_sync`
**Function**: Synchronize memory across multiple swarm instances
**Parameters**:
- `source_namespace` (string): Source namespace
- `target_namespaces` (array): Target namespaces
- `sync_strategy` (string): Synchronization strategy - "full", "incremental", "selective"

**Usage Example**:
```json
{
  "source_namespace": "master_project",
  "target_namespaces": ["dev_branch", "test_branch"],
  "sync_strategy": "incremental"
}
```

#### `mcp__claude-flow__cache_manage`
**Function**: Manage cache for frequently accessed memory data
**Parameters**:
- `action` (string): Action type - "clear", "optimize", "stats", "configure"
- `cache_size` (number, optional): Cache size in MB
- `eviction_policy` (string, optional): Eviction policy - "lru", "lfu", "ttl"

**Usage Example**:
```json
{
  "action": "configure",
  "cache_size": 128,
  "eviction_policy": "lru"
}
```

#### `mcp__claude-flow__state_snapshot`
**Function**: Create snapshots of current swarm state
**Parameters**:
- `swarmId` (string): Target swarm identifier
- `snapshot_name` (string): Snapshot identifier
- `include_memory` (boolean): Include memory data
- `include_agent_state` (boolean): Include agent states

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "snapshot_name": "pre_deployment",
  "include_memory": true,
  "include_agent_state": true
}
```

#### `mcp__claude-flow__context_restore`
**Function**: Restore swarm context from snapshots
**Parameters**:
- `snapshot_name` (string): Snapshot to restore
- `swarmId` (string): Target swarm identifier
- `selective_restore` (array, optional): Specific components to restore

**Usage Example**:
```json
{
  "snapshot_name": "pre_deployment",
  "swarmId": "project-alpha",
  "selective_restore": ["agent_states", "task_queue"]
}
```

#### `mcp__claude-flow__memory_analytics`
**Function**: Analyze memory usage patterns and optimization opportunities
**Parameters**:
- `namespace` (string, optional): Specific namespace to analyze
- `analysis_type` (string): Analysis type - "usage", "patterns", "optimization"
- `timeframe` (string): Time period to analyze

**Usage Example**:
```json
{
  "namespace": "project-alpha",
  "analysis_type": "optimization",
  "timeframe": "30d"
}
```

### Analysis & Monitoring (13 tools)

Comprehensive monitoring, analysis, and reporting tools for system performance.

#### `mcp__claude-flow__performance_report`
**Function**: Generate detailed performance reports
**Parameters**:
- `timeframe` (string): Time period - "1h", "24h", "7d", "30d"
- `format` (string): Report format - "summary", "detailed", "csv", "json"
- `include_predictions` (boolean): Include performance predictions
- `swarmId` (string, optional): Specific swarm to report on

**Usage Example**:
```json
{
  "timeframe": "24h",
  "format": "detailed",
  "include_predictions": true,
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__bottleneck_analyze`
**Function**: Identify and analyze performance bottlenecks
**Parameters**:
- `component` (string): Component to analyze - "agents", "tasks", "communication", "memory"
- `analysis_depth` (string): Analysis depth - "quick", "thorough", "comprehensive"
- `swarmId` (string, optional): Target swarm

**Usage Example**:
```json
{
  "component": "communication",
  "analysis_depth": "thorough",
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__token_usage`
**Function**: Track and analyze token consumption across operations
**Parameters**:
- `operation` (string, optional): Specific operation to analyze
- `breakdown_by` (string): Breakdown criteria - "agent", "task", "time", "operation"
- `optimize_suggestions` (boolean): Include optimization suggestions

**Usage Example**:
```json
{
  "operation": "code_generation",
  "breakdown_by": "agent",
  "optimize_suggestions": true
}
```

#### `mcp__claude-flow__task_status`
**Function**: Get comprehensive status of tasks across swarms
**Parameters**:
- `taskId` (string, optional): Specific task identifier
- `swarmId` (string, optional): Filter by swarm
- `status_filter` (string, optional): Filter by status - "pending", "in_progress", "completed", "failed"

**Usage Example**:
```json
{
  "swarmId": "project-alpha",
  "status_filter": "in_progress"
}
```

#### `mcp__claude-flow__task_results`
**Function**: Retrieve detailed results and outputs from completed tasks
**Parameters**:
- `taskId` (string): Task identifier
- `include_logs` (boolean): Include execution logs
- `include_artifacts` (boolean): Include generated artifacts

**Usage Example**:
```json
{
  "taskId": "task_api_impl_001",
  "include_logs": true,
  "include_artifacts": true
}
```

#### `mcp__claude-flow__benchmark_run`
**Function**: Run performance benchmarks on swarm operations
**Parameters**:
- `benchmark_type` (string): Benchmark type - "throughput", "latency", "resource_usage", "accuracy"
- `test_duration` (number): Test duration in seconds
- `concurrent_operations` (number): Number of concurrent operations

**Usage Example**:
```json
{
  "benchmark_type": "throughput",
  "test_duration": 300,
  "concurrent_operations": 10
}
```

#### `mcp__claude-flow__metrics_collect`
**Function**: Collect and aggregate metrics from all system components
**Parameters**:
- `metrics` (array): Specific metrics to collect
- `granularity` (string): Data granularity - "minute", "hour", "day"
- `retention_period` (number): How long to keep metrics (days)

**Usage Example**:
```json
{
  "metrics": ["cpu_usage", "memory_usage", "task_completion_rate"],
  "granularity": "minute",
  "retention_period": 30
}
```

#### `mcp__claude-flow__trend_analysis`
**Function**: Analyze trends in performance and behavior over time
**Parameters**:
- `metric` (string): Metric to analyze
- `timeframe` (string): Analysis period
- `prediction_horizon` (string): Future prediction period
- `alert_thresholds` (object, optional): Set alert thresholds

**Usage Example**:
```json
{
  "metric": "task_completion_rate",
  "timeframe": "7d",
  "prediction_horizon": "3d",
  "alert_thresholds": {"warning": 0.8, "critical": 0.6}
}
```

#### `mcp__claude-flow__cost_analysis`
**Function**: Analyze costs associated with swarm operations
**Parameters**:
- `cost_type` (string): Cost type - "tokens", "compute", "storage", "total"
- `breakdown_by` (string): Cost breakdown - "swarm", "agent", "task", "operation"
- `budget_tracking` (boolean): Track against budget limits

**Usage Example**:
```json
{
  "cost_type": "total",
  "breakdown_by": "swarm",
  "budget_tracking": true
}
```

#### `mcp__claude-flow__quality_assess`
**Function**: Assess quality of outputs and processes
**Parameters**:
- `assessment_type` (string): Assessment type - "code_quality", "task_completion", "communication"
- `quality_metrics` (array): Specific quality metrics to evaluate
- `swarmId` (string, optional): Target swarm

**Usage Example**:
```json
{
  "assessment_type": "code_quality",
  "quality_metrics": ["complexity", "maintainability", "test_coverage"],
  "swarmId": "project-alpha"
}
```

#### `mcp__claude-flow__error_analysis`
**Function**: Analyze errors and failures to identify improvement opportunities
**Parameters**:
- `error_category` (string, optional): Error category to focus on
- `timeframe` (string): Analysis period
- `include_resolution` (boolean): Include resolution suggestions
- `severity_filter` (string, optional): Filter by severity

**Usage Example**:
```json
{
  "error_category": "communication_failures",
  "timeframe": "7d",
  "include_resolution": true,
  "severity_filter": "high"
}
```

#### `mcp__claude-flow__usage_stats`
**Function**: Generate usage statistics and insights
**Parameters**:
- `stat_type` (string): Statistics type - "agent_utilization", "feature_usage", "resource_consumption"
- `aggregation` (string): Aggregation level - "hourly", "daily", "weekly"
- `comparative_analysis` (boolean): Include comparative analysis

**Usage Example**:
```json
{
  "stat_type": "agent_utilization",
  "aggregation": "daily",
  "comparative_analysis": true
}
```

#### `mcp__claude-flow__health_check`
**Function**: Perform comprehensive health checks on system components
**Parameters**:
- `component` (string, optional): Specific component to check
- `check_depth` (string): Check depth - "basic", "standard", "comprehensive"
- `auto_remediate` (boolean): Automatically fix detected issues

**Usage Example**:
```json
{
  "component": "memory_system",
  "check_depth": "comprehensive",
  "auto_remediate": false
}
```

### Workflow & Automation (11 tools)

Tools for creating and managing automated workflows and processes.

#### `mcp__claude-flow__workflow_create`
**Function**: Create new automated workflows
**Parameters**:
- `workflow_name` (string): Workflow identifier
- `steps` (array): Workflow steps definition
- `triggers` (array): Workflow triggers
- `schedule` (string, optional): Cron schedule for automated execution

**Usage Example**:
```json
{
  "workflow_name": "daily_health_check",
  "steps": [
    {"action": "health_check", "params": {}},
    {"action": "generate_report", "params": {"format": "summary"}}
  ],
  "triggers": ["schedule", "system_alert"],
  "schedule": "0 9 * * *"
}
```

#### `mcp__claude-flow__sparc_mode`
**Function**: Execute SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) workflows
**Parameters**:
- `mode` (string): SPARC mode - "specification", "pseudocode", "architecture", "refinement", "completion"
- `project_context` (object): Project context and requirements
- `previous_artifacts` (array, optional): Artifacts from previous SPARC phases

**Usage Example**:
```json
{
  "mode": "architecture",
  "project_context": {
    "description": "E-commerce API",
    "requirements": ["authentication", "product_catalog", "order_processing"]
  },
  "previous_artifacts": ["specification_doc", "pseudocode_outline"]
}
```

#### `mcp__claude-flow__workflow_execute`
**Function**: Execute defined workflows
**Parameters**:
- `workflow_id` (string): Workflow identifier to execute
- `execution_params` (object, optional): Runtime parameters
- `async_execution` (boolean): Execute asynchronously

**Usage Example**:
```json
{
  "workflow_id": "daily_health_check",
  "execution_params": {"verbose": true},
  "async_execution": false
}
```

#### `mcp__claude-flow__workflow_export`
**Function**: Export workflow definitions for sharing or backup
**Parameters**:
- `workflow_ids` (array): Workflows to export
- `format` (string): Export format - "json", "yaml", "xml"
- `include_history` (boolean): Include execution history

**Usage Example**:
```json
{
  "workflow_ids": ["daily_health_check", "deployment_pipeline"],
  "format": "yaml",
  "include_history": false
}
```

#### `mcp__claude-flow__automation_setup`
**Function**: Set up automation rules and triggers
**Parameters**:
- `rule_name` (string): Automation rule name
- `conditions` (array): Trigger conditions
- `actions` (array): Actions to perform
- `enabled` (boolean): Enable rule immediately

**Usage Example**:
```json
{
  "rule_name": "auto_scale_on_load",
  "conditions": [{"metric": "cpu_usage", "threshold": 80, "duration": "5m"}],
  "actions": [{"type": "scale_swarm", "direction": "up", "amount": 2}],
  "enabled": true
}
```

#### `mcp__claude-flow__pipeline_create`
**Function**: Create CI/CD-style pipelines
**Parameters**:
- `pipeline_name` (string): Pipeline identifier
- `stages` (array): Pipeline stages
- `parallel_execution` (boolean): Allow parallel stage execution
- `failure_strategy` (string): Failure handling - "abort", "continue", "retry"

**Usage Example**:
```json
{
  "pipeline_name": "code_quality_pipeline",
  "stages": [
    {"name": "lint", "commands": ["npm run lint"]},
    {"name": "test", "commands": ["npm test"]},
    {"name": "build", "commands": ["npm run build"]}
  ],
  "parallel_execution": false,
  "failure_strategy": "abort"
}
```

#### `mcp__claude-flow__scheduler_manage`
**Function**: Manage task scheduling and cron jobs
**Parameters**:
- `action` (string): Action type - "create", "update", "delete", "list", "status"
- `schedule_id` (string, optional): Schedule identifier
- `cron_expression` (string, optional): Cron schedule expression
- `task_definition` (object, optional): Task to schedule

**Usage Example**:
```json
{
  "action": "create",
  "schedule_id": "weekly_optimization",
  "cron_expression": "0 2 * * 0",
  "task_definition": {"type": "topology_optimize", "swarmId": "production"}
}
```

#### `mcp__claude-flow__trigger_setup`
**Function**: Configure event-driven triggers
**Parameters**:
- `trigger_name` (string): Trigger identifier
- `event_type` (string): Event type to listen for
- `conditions` (object): Trigger conditions
- `webhook_url` (string, optional): Webhook endpoint for notifications

**Usage Example**:
```json
{
  "trigger_name": "deployment_complete",
  "event_type": "task_completed",
  "conditions": {"task_type": "deployment", "status": "success"},
  "webhook_url": "https://api.example.com/deploy-webhook"
}
```

#### `mcp__claude-flow__workflow_template`
**Function**: Manage workflow templates for reusability
**Parameters**:
- `action` (string): Action type - "create", "update", "delete", "list", "instantiate"
- `template_name` (string): Template identifier
- `template_definition` (object, optional): Template definition
- `parameters` (object, optional): Template parameters for instantiation

**Usage Example**:
```json
{
  "action": "instantiate",
  "template_name": "api_development_template",
  "parameters": {
    "project_name": "user-service",
    "database_type": "postgresql"
  }
}
```

#### `mcp__claude-flow__batch_process`
**Function**: Execute batch processing operations
**Parameters**:
- `batch_name` (string): Batch operation identifier
- `operations` (array): Operations to execute in batch
- `concurrency_limit` (number): Maximum concurrent operations
- `retry_failed` (boolean): Retry failed operations

**Usage Example**:
```json
{
  "batch_name": "migrate_projects",
  "operations": [
    {"type": "update_project", "project_id": "proj1"},
    {"type": "update_project", "project_id": "proj2"}
  ],
  "concurrency_limit": 5,
  "retry_failed": true
}
```

#### `mcp__claude-flow__parallel_execute`
**Function**: Execute multiple operations in parallel
**Parameters**:
- `operations` (array): Operations to execute
- `max_concurrency` (number): Maximum concurrent operations
- `timeout` (number): Timeout per operation in seconds
- `collect_results` (boolean): Collect and return all results

**Usage Example**:
```json
{
  "operations": [
    {"tool": "health_check", "params": {"component": "agents"}},
    {"tool": "health_check", "params": {"component": "memory"}},
    {"tool": "health_check", "params": {"component": "neural"}}
  ],
  "max_concurrency": 3,
  "timeout": 30,
  "collect_results": true
}
```

### GitHub Integration (8 tools)

Comprehensive GitHub integration for repository management and collaboration.

#### `mcp__claude-flow__github_repo_analyze`
**Function**: Analyze GitHub repositories for structure, patterns, and insights
**Parameters**:
- `repo_url` (string): GitHub repository URL
- `analysis_type` (string): Analysis type - "structure", "activity", "contributors", "issues", "code_quality"
- `depth` (string): Analysis depth - "shallow", "moderate", "deep"
- `include_history` (boolean): Include commit history analysis

**Usage Example**:
```json
{
  "repo_url": "https://github.com/example/project",
  "analysis_type": "code_quality",
  "depth": "moderate",
  "include_history": true
}
```

#### `mcp__claude-flow__github_pr_manage`
**Function**: Manage GitHub pull requests (create, review, merge)
**Parameters**:
- `action` (string): Action type - "create", "review", "merge", "close", "list"
- `repo` (string): Repository identifier
- `pr_number` (number, optional): Pull request number
- `title` (string, optional): PR title for creation
- `description` (string, optional): PR description
- `base_branch` (string, optional): Base branch for PR

**Usage Example**:
```json
{
  "action": "create",
  "repo": "example/project",
  "title": "Add user authentication feature",
  "description": "Implements JWT-based authentication system",
  "base_branch": "main"
}
```

#### `mcp__claude-flow__github_issue_track`
**Function**: Track and manage GitHub issues
**Parameters**:
- `action` (string): Action type - "create", "update", "close", "list", "assign"
- `repo` (string): Repository identifier
- `issue_number` (number, optional): Issue number
- `title` (string, optional): Issue title
- `labels` (array, optional): Issue labels
- `assignee` (string, optional): Issue assignee

**Usage Example**:
```json
{
  "action": "create",
  "repo": "example/project",
  "title": "Bug: Login form validation",
  "labels": ["bug", "frontend"],
  "assignee": "dev-team"
}
```

#### `mcp__claude-flow__github_release_coord`
**Function**: Coordinate GitHub releases and versioning
**Parameters**:
- `action` (string): Action type - "create", "update", "delete", "list"
- `repo` (string): Repository identifier
- `tag_name` (string, optional): Release tag
- `release_name` (string, optional): Release title
- `description` (string, optional): Release description
- `draft` (boolean, optional): Create as draft

**Usage Example**:
```json
{
  "action": "create",
  "repo": "example/project",
  "tag_name": "v2.1.0",
  "release_name": "Version 2.1.0 - Feature Release",
  "description": "Added new dashboard and improved performance",
  "draft": false
}
```

#### `mcp__claude-flow__github_workflow_auto`
**Function**: Automate GitHub Actions workflows
**Parameters**:
- `repo` (string): Repository identifier
- `workflow_action` (string): Action type - "trigger", "status", "list", "create"
- `workflow_name` (string, optional): Workflow name
- `inputs` (object, optional): Workflow inputs
- `branch` (string, optional): Target branch

**Usage Example**:
```json
{
  "repo": "example/project",
  "workflow_action": "trigger",
  "workflow_name": "deploy-to-production",
  "inputs": {"environment": "production"},
  "branch": "main"
}
```

#### `mcp__claude-flow__github_code_review`
**Function**: Perform automated code reviews using AI
**Parameters**:
- `repo` (string): Repository identifier
- `pr_number` (number, optional): Pull request to review
- `review_type` (string): Review type - "security", "performance", "style", "comprehensive"
- `auto_comment` (boolean): Automatically comment on findings
- `review_criteria` (array, optional): Specific criteria to check

**Usage Example**:
```json
{
  "repo": "example/project",
  "pr_number": 42,
  "review_type": "comprehensive",
  "auto_comment": true,
  "review_criteria": ["security_vulnerabilities", "performance_issues", "code_style"]
}
```

#### `mcp__claude-flow__github_sync_coord`
**Function**: Coordinate synchronization between GitHub and local development
**Parameters**:
- `repos` (array): Repositories to synchronize
- `sync_direction` (string): Sync direction - "push", "pull", "bidirectional"
- `conflict_resolution` (string): Conflict resolution strategy
- `sync_branches` (array, optional): Specific branches to sync

**Usage Example**:
```json
{
  "repos": ["example/project", "example/shared-lib"],
  "sync_direction": "bidirectional",
  "conflict_resolution": "manual_review",
  "sync_branches": ["main", "develop"]
}
```

#### `mcp__claude-flow__github_metrics`
**Function**: Collect and analyze GitHub repository metrics
**Parameters**:
- `repo` (string): Repository identifier
- `metrics` (array): Metrics to collect - "commits", "contributors", "issues", "prs", "releases"
- `timeframe` (string): Analysis period
- `export_format` (string, optional): Export format for metrics

**Usage Example**:
```json
{
  "repo": "example/project",
  "metrics": ["commits", "issues", "prs"],
  "timeframe": "30d",
  "export_format": "csv"
}
```

### DAA (Dynamic Agent Architecture) (8 tools)

Advanced dynamic agent management and architecture tools.

#### `mcp__claude-flow__daa_agent_create`
**Function**: Create dynamic agents with adaptive capabilities
**Parameters**:
- `agent_type` (string): Agent type or capability profile
- `adaptation_rules` (array): Rules for dynamic adaptation
- `resource_constraints` (object): Resource allocation constraints
- `lifecycle_policy` (string): Agent lifecycle management policy

**Usage Example**:
```json
{
  "agent_type": "adaptive_coder",
  "adaptation_rules": [
    {"condition": "high_complexity", "action": "request_specialist"},
    {"condition": "low_workload", "action": "hibernate"}
  ],
  "resource_constraints": {"max_memory": "512MB", "max_cpu": "2_cores"},
  "lifecycle_policy": "auto_scale"
}
```

#### `mcp__claude-flow__daa_capability_match`
**Function**: Match agent capabilities to task requirements
**Parameters**:
- `task_requirements` (object): Required capabilities for task
- `available_agents` (array, optional): Agents to consider
- `match_criteria` (string): Matching criteria - "exact", "partial", "adaptive"
- `optimization_goal` (string): Optimization goal - "speed", "quality", "cost"

**Usage Example**:
```json
{
  "task_requirements": {
    "skills": ["python", "machine_learning", "data_analysis"],
    "experience_level": "senior",
    "availability": "immediate"
  },
  "match_criteria": "adaptive",
  "optimization_goal": "quality"
}
```

#### `mcp__claude-flow__daa_resource_alloc`
**Function**: Dynamically allocate resources to agents based on demand
**Parameters**:
- `allocation_strategy` (string): Strategy - "fair", "priority_based", "demand_based", "predictive"
- `resource_pool` (object): Available resources
- `constraints` (object): Allocation constraints
- `monitoring_interval` (number): Resource monitoring interval in seconds

**Usage Example**:
```json
{
  "allocation_strategy": "demand_based",
  "resource_pool": {"cpu_cores": 16, "memory_gb": 64, "storage_gb": 1000},
  "constraints": {"min_cpu_per_agent": 1, "max_memory_per_agent": "8GB"},
  "monitoring_interval": 30
}
```

#### `mcp__claude-flow__daa_lifecycle_manage`
**Function**: Manage dynamic agent lifecycles (creation, scaling, termination)
**Parameters**:
- `lifecycle_action` (string): Action - "spawn", "scale", "hibernate", "terminate", "migrate"
- `agent_ids` (array, optional): Specific agents to manage
- `scaling_policy` (object): Scaling policies and triggers
- `migration_target` (string, optional): Target for agent migration

**Usage Example**:
```json
{
  "lifecycle_action": "scale",
  "scaling_policy": {
    "scale_up_threshold": 80,
    "scale_down_threshold": 20,
    "cooldown_period": 300
  }
}
```

#### `mcp__claude-flow__daa_communication`
**Function**: Manage dynamic communication patterns between agents
**Parameters**:
- `communication_pattern` (string): Pattern - "broadcast", "peer_to_peer", "hierarchical", "mesh"
- `message_routing` (object): Message routing configuration
- `protocol_adaptation` (boolean): Enable protocol adaptation
- `bandwidth_management` (object): Bandwidth allocation rules

**Usage Example**:
```json
{
  "communication_pattern": "mesh",
  "message_routing": {"priority_queues": true, "load_balancing": true},
  "protocol_adaptation": true,
  "bandwidth_management": {"max_per_agent": "10Mbps", "priority_levels": 3}
}
```

#### `mcp__claude-flow__daa_consensus`
**Function**: Implement consensus mechanisms for distributed decision making
**Parameters**:
- `consensus_algorithm` (string): Algorithm - "raft", "byzantine", "proof_of_stake", "democratic"
- `decision_topic` (string): Topic requiring consensus
- `voting_power` (object, optional): Voting power distribution
- `timeout_seconds` (number): Consensus timeout

**Usage Example**:
```json
{
  "consensus_algorithm": "democratic",
  "decision_topic": "architecture_choice",
  "voting_power": {"senior_agents": 2, "junior_agents": 1},
  "timeout_seconds": 120
}
```

#### `mcp__claude-flow__daa_fault_tolerance`
**Function**: Implement fault tolerance and recovery mechanisms
**Parameters**:
- `fault_detection` (object): Fault detection configuration
- `recovery_strategy` (string): Recovery strategy - "restart", "migrate", "replicate", "degrade"
- `health_monitoring` (object): Health monitoring settings
- `backup_agents` (number): Number of backup agents to maintain

**Usage Example**:
```json
{
  "fault_detection": {"heartbeat_interval": 10, "failure_threshold": 3},
  "recovery_strategy": "migrate",
  "health_monitoring": {"check_interval": 30, "metrics": ["cpu", "memory", "response_time"]},
  "backup_agents": 2
}
```

#### `mcp__claude-flow__daa_optimization`
**Function**: Optimize dynamic agent architecture for performance and efficiency
**Parameters**:
- `optimization_target` (string): Target - "performance", "cost", "reliability", "energy"
- `constraints` (object): Optimization constraints
- `optimization_algorithm` (string): Algorithm to use
- `continuous_optimization` (boolean): Enable continuous optimization

**Usage Example**:
```json
{
  "optimization_target": "performance",
  "constraints": {"max_cost": 1000, "min_reliability": 0.99},
  "optimization_algorithm": "genetic",
  "continuous_optimization": true
}
```

### System & Utilities (8 tools)

Core system management and utility functions.

#### `mcp__claude-flow__terminal_execute`
**Function**: Execute terminal commands with safety controls
**Parameters**:
- `command` (string): Command to execute
- `working_directory` (string, optional): Working directory
- `timeout` (number, optional): Execution timeout in seconds
- `capture_output` (boolean): Capture command output
- `environment_vars` (object, optional): Environment variables

**Usage Example**:
```json
{
  "command": "npm test",
  "working_directory": "/path/to/project",
  "timeout": 300,
  "capture_output": true,
  "environment_vars": {"NODE_ENV": "test"}
}
```

#### `mcp__claude-flow__config_manage`
**Function**: Manage system configuration settings
**Parameters**:
- `action` (string): Action - "get", "set", "update", "delete", "list", "backup", "restore"
- `config_key` (string, optional): Configuration key
- `config_value` (any, optional): Configuration value
- `namespace` (string, optional): Configuration namespace

**Usage Example**:
```json
{
  "action": "set",
  "config_key": "swarm.default_topology",
  "config_value": "hierarchical",
  "namespace": "system"
}
```

#### `mcp__claude-flow__features_detect`
**Function**: Detect available features and capabilities
**Parameters**:
- `component` (string, optional): Specific component to check
- `detailed_info` (boolean): Include detailed feature information
- `compatibility_check` (boolean): Check feature compatibility

**Usage Example**:
```json
{
  "component": "neural_networks",
  "detailed_info": true,
  "compatibility_check": true
}
```

#### `mcp__claude-flow__security_scan`
**Function**: Perform security scans on system components
**Parameters**:
- `scan_type` (string): Scan type - "vulnerability", "compliance", "access_control", "data_integrity"
- `scope` (string): Scan scope - "system", "agents", "communications", "storage"
- `severity_threshold` (string): Minimum severity to report
- `remediation_suggestions` (boolean): Include remediation suggestions

**Usage Example**:
```json
{
  "scan_type": "vulnerability",
  "scope": "system",
  "severity_threshold": "medium",
  "remediation_suggestions": true
}
```

#### `mcp__claude-flow__backup_create`
**Function**: Create system backups
**Parameters**:
- `backup_type` (string): Backup type - "full", "incremental", "differential"
- `components` (array): Components to backup
- `compression` (boolean): Enable compression
- `encryption` (boolean): Enable encryption
- `retention_days` (number): Backup retention period

**Usage Example**:
```json
{
  "backup_type": "incremental",
  "components": ["memory", "configs", "agent_states"],
  "compression": true,
  "encryption": true,
  "retention_days": 30
}
```

#### `mcp__claude-flow__restore_system`
**Function**: Restore system from backups
**Parameters**:
- `backup_id` (string): Backup identifier to restore
- `restore_components` (array): Components to restore
- `verification` (boolean): Verify backup integrity before restore
- `rollback_plan` (boolean): Create rollback point before restore

**Usage Example**:
```json
{
  "backup_id": "backup_2024_01_15_001",
  "restore_components": ["memory", "configs"],
  "verification": true,
  "rollback_plan": true
}
```

#### `mcp__claude-flow__log_analysis`
**Function**: Analyze system logs for insights and issues
**Parameters**:
- `log_source` (string): Log source - "system", "agents", "tasks", "communications"
- `analysis_type` (string): Analysis type - "errors", "performance", "patterns", "anomalies"
- `timeframe` (string): Time period to analyze
- `export_results` (boolean): Export analysis results

**Usage Example**:
```json
{
  "log_source": "agents",
  "analysis_type": "errors",
  "timeframe": "24h",
  "export_results": true
}
```

#### `mcp__claude-flow__diagnostic_run`
**Function**: Run comprehensive system diagnostics
**Parameters**:
- `diagnostic_level` (string): Diagnostic level - "quick", "standard", "comprehensive"
- `components` (array, optional): Specific components to diagnose
- `include_recommendations` (boolean): Include improvement recommendations
- `auto_fix` (boolean): Automatically fix detected issues

**Usage Example**:
```json
{
  "diagnostic_level": "comprehensive",
  "components": ["memory", "agents", "neural_networks"],
  "include_recommendations": true,
  "auto_fix": false
}
```

---

## Ruv-Swarm Tools (25 tools)

The ruv-swarm tools provide advanced swarm intelligence, distributed computing, and collaborative AI capabilities. All ruv-swarm tools use the prefix `mcp__ruv-swarm__`.

### Core Swarm Intelligence (8 tools)

#### `mcp__ruv-swarm__memory_usage`
**Function**: Advanced distributed memory management across swarm networks
**Parameters**:
- `action` (string): Action type - "store", "retrieve", "sync", "replicate", "compress"
- `key` (string): Memory key with hierarchical support
- `value` (any, for store): Data to store with automatic serialization
- `namespace` (string, optional): Memory namespace for isolation
- `replication_factor` (number, optional): Number of replicas across nodes
- `consistency_level` (string, optional): Consistency level - "eventual", "strong", "bounded"

**Usage Example**:
```json
{
  "action": "store",
  "key": "distributed/project_state",
  "value": {"phase": "implementation", "completion": 0.75},
  "namespace": "project-alpha",
  "replication_factor": 3,
  "consistency_level": "strong"
}
```

#### `mcp__ruv-swarm__swarm_monitor`
**Function**: Real-time monitoring of distributed swarm operations
**Parameters**:
- `monitoring_mode` (string): Mode - "realtime", "batch", "event_driven"
- `metrics` (array): Metrics to monitor - "performance", "health", "communication", "resource_usage"
- `alert_thresholds` (object): Alert threshold configuration
- `dashboard_update` (boolean): Update monitoring dashboard

**Usage Example**:
```json
{
  "monitoring_mode": "realtime",
  "metrics": ["performance", "health", "communication"],
  "alert_thresholds": {"cpu_usage": 80, "memory_usage": 75},
  "dashboard_update": true
}
```

#### `mcp__ruv-swarm__task_orchestrate`
**Function**: Advanced task orchestration with intelligent agent assignment
**Parameters**:
- `orchestration_strategy` (string): Strategy - "capability_based", "load_balanced", "priority_weighted", "ml_optimized"
- `task_graph` (object): Task dependency graph
- `resource_constraints` (object): Resource allocation constraints
- `optimization_goals` (array): Goals - "speed", "quality", "cost", "energy_efficiency"

**Usage Example**:
```json
{
  "orchestration_strategy": "ml_optimized",
  "task_graph": {
    "nodes": ["research", "design", "implement", "test"],
    "edges": [["research", "design"], ["design", "implement"], ["implement", "test"]]
  },
  "resource_constraints": {"max_parallel_tasks": 5, "memory_limit": "16GB"},
  "optimization_goals": ["speed", "quality"]
}
```

#### `mcp__ruv-swarm__neural_train`
**Function**: Distributed neural network training across swarm nodes
**Parameters**:
- `training_mode` (string): Mode - "federated", "distributed", "ensemble", "transfer"
- `model_architecture` (object): Neural network architecture definition
- `training_data` (string): Training data source or identifier
- `hyperparameters` (object): Training hyperparameters
- `convergence_criteria` (object): Training stop conditions

**Usage Example**:
```json
{
  "training_mode": "federated",
  "model_architecture": {"type": "transformer", "layers": 12, "hidden_size": 768},
  "training_data": "swarm_collaboration_logs",
  "hyperparameters": {"learning_rate": 0.001, "batch_size": 32},
  "convergence_criteria": {"min_accuracy": 0.95, "max_epochs": 100}
}
```

#### `mcp__ruv-swarm__consensus_vote`
**Function**: Implement distributed consensus voting mechanisms
**Parameters**:
- `vote_type` (string): Vote type - "simple_majority", "weighted", "byzantine_tolerant", "proof_of_stake"
- `proposal` (object): Proposal details and options
- `voting_power` (object, optional): Voting weight distribution
- `quorum_threshold` (number): Minimum participation for valid vote
- `timeout_duration` (number): Vote timeout in seconds

**Usage Example**:
```json
{
  "vote_type": "weighted",
  "proposal": {
    "id": "architecture_decision_001",
    "description": "Choose database architecture",
    "options": ["PostgreSQL", "MongoDB", "Hybrid"]
  },
  "voting_power": {"senior_agents": 2.0, "junior_agents": 1.0},
  "quorum_threshold": 0.67,
  "timeout_duration": 300
}
```

#### `mcp__ruv-swarm__agent_spawn`
**Function**: Spawn intelligent agents with adaptive capabilities
**Parameters**:
- `agent_template` (string): Agent template or type
- `specialization` (array): Agent specializations and skills
- `autonomy_level` (string): Autonomy level - "supervised", "semi_autonomous", "fully_autonomous"
- `learning_enabled` (boolean): Enable continuous learning
- `collaboration_preferences` (object): Collaboration settings

**Usage Example**:
```json
{
  "agent_template": "adaptive_researcher",
  "specialization": ["data_analysis", "pattern_recognition", "report_generation"],
  "autonomy_level": "semi_autonomous",
  "learning_enabled": true,
  "collaboration_preferences": {"preferred_team_size": 3, "communication_style": "structured"}
}
```

#### `mcp__ruv-swarm__swarm_status`
**Function**: Comprehensive swarm status with predictive analytics
**Parameters**:
- `status_depth` (string): Status depth - "overview", "detailed", "comprehensive", "predictive"
- `include_predictions` (boolean): Include future state predictions
- `health_assessment` (boolean): Perform health assessment
- `performance_analysis` (boolean): Include performance analysis
- `export_format` (string, optional): Export format - "json", "dashboard", "report"

**Usage Example**:
```json
{
  "status_depth": "comprehensive",
  "include_predictions": true,
  "health_assessment": true,
  "performance_analysis": true,
  "export_format": "dashboard"
}
```

#### `mcp__ruv-swarm__collective_intelligence`
**Function**: Harness collective intelligence for problem solving
**Parameters**:
- `intelligence_mode` (string): Mode - "aggregated", "emergent", "collective_reasoning", "wisdom_of_crowds"
- `problem_context` (object): Problem definition and context
- `participation_criteria` (object): Agent participation requirements
- `synthesis_method` (string): Method for combining insights
- `confidence_weighting` (boolean): Weight contributions by confidence

**Usage Example**:
```json
{
  "intelligence_mode": "collective_reasoning",
  "problem_context": {
    "domain": "software_architecture",
    "complexity": "high",
    "constraints": ["scalability", "maintainability", "cost"]
  },
  "participation_criteria": {"min_experience": "intermediate", "domain_expertise": true},
  "synthesis_method": "weighted_consensus",
  "confidence_weighting": true
}
```

### Advanced Coordination (7 tools)

#### `mcp__ruv-swarm__dynamic_topology`
**Function**: Dynamically adapt swarm topology based on performance
**Parameters**:
- `adaptation_trigger` (string): Trigger - "performance_threshold", "workload_change", "failure_detection", "optimization_cycle"
- `topology_options` (array): Available topology configurations
- `transition_strategy` (string): Transition strategy - "gradual", "immediate", "rolling"
- `performance_metrics` (object): Metrics to optimize for

**Usage Example**:
```json
{
  "adaptation_trigger": "performance_threshold",
  "topology_options": ["hierarchical", "mesh", "star", "hybrid"],
  "transition_strategy": "gradual",
  "performance_metrics": {"latency": 100, "throughput": 1000, "error_rate": 0.01}
}
```

#### `mcp__ruv-swarm__resource_federation`
**Function**: Federate resources across multiple swarm instances
**Parameters**:
- `federation_policy` (string): Policy - "fair_share", "priority_based", "market_based", "need_based"
- `resource_types` (array): Resources to federate - "compute", "memory", "storage", "bandwidth"
- `sharing_constraints` (object): Constraints on resource sharing
- `billing_model` (string, optional): Billing model for resource usage

**Usage Example**:
```json
{
  "federation_policy": "priority_based",
  "resource_types": ["compute", "memory"],
  "sharing_constraints": {"max_share_percentage": 0.7, "reserved_for_local": 0.3},
  "billing_model": "usage_based"
}
```

#### `mcp__ruv-swarm__load_prediction`
**Function**: Predict future load patterns for proactive scaling
**Parameters**:
- `prediction_horizon` (string): Prediction timeframe - "minutes", "hours", "days", "weeks"
- `prediction_model` (string): Model type - "linear", "seasonal", "ml_based", "hybrid"
- `historical_data_period` (string): Historical data to use
- `confidence_intervals` (boolean): Include prediction confidence intervals

**Usage Example**:
```json
{
  "prediction_horizon": "hours",
  "prediction_model": "ml_based",
  "historical_data_period": "30d",
  "confidence_intervals": true
}
```

#### `mcp__ruv-swarm__fault_recovery`
**Function**: Implement advanced fault detection and recovery
**Parameters**:
- `recovery_strategy` (string): Strategy - "restart", "migrate", "replicate", "degrade_gracefully", "self_heal"
- `fault_detection_sensitivity` (string): Sensitivity - "low", "medium", "high", "adaptive"
- `recovery_timeout` (number): Maximum time for recovery attempts
- `cascade_prevention` (boolean): Prevent cascade failures

**Usage Example**:
```json
{
  "recovery_strategy": "self_heal",
  "fault_detection_sensitivity": "adaptive",
  "recovery_timeout": 120,
  "cascade_prevention": true
}
```

#### `mcp__ruv-swarm__communication_optimize`
**Function**: Optimize communication patterns and protocols
**Parameters**:
- `optimization_target` (string): Target - "latency", "bandwidth", "reliability", "energy"
- `communication_patterns` (array): Current communication patterns
- `protocol_adaptation` (boolean): Enable protocol adaptation
- `compression_strategies` (array): Available compression methods

**Usage Example**:
```json
{
  "optimization_target": "latency",
  "communication_patterns": ["broadcast", "peer_to_peer", "hierarchical"],
  "protocol_adaptation": true,
  "compression_strategies": ["gzip", "lz4", "adaptive"]
}
```

#### `mcp__ruv-swarm__knowledge_synthesis`
**Function**: Synthesize knowledge from distributed agents
**Parameters**:
- `synthesis_method` (string): Method - "weighted_average", "expert_consensus", "evidence_based", "emergent_patterns"
- `knowledge_domains` (array): Domains to synthesize knowledge from
- `conflict_resolution` (string): Method for resolving conflicting information
- `quality_filtering` (object): Quality filters for knowledge sources

**Usage Example**:
```json
{
  "synthesis_method": "evidence_based",
  "knowledge_domains": ["technical_specifications", "user_requirements", "best_practices"],
  "conflict_resolution": "weighted_voting",
  "quality_filtering": {"min_confidence": 0.8, "source_credibility": "high"}
}
```

#### `mcp__ruv-swarm__adaptive_learning`
**Function**: Enable adaptive learning across the swarm
**Parameters**:
- `learning_mode` (string): Mode - "continuous", "episodic", "reinforcement", "meta_learning"
- `knowledge_sharing` (boolean): Enable knowledge sharing between agents
- `learning_objectives` (array): Specific learning objectives
- `adaptation_rate` (string): Rate of adaptation - "slow", "medium", "fast", "adaptive"

**Usage Example**:
```json
{
  "learning_mode": "continuous",
  "knowledge_sharing": true,
  "learning_objectives": ["task_efficiency", "collaboration_patterns", "error_reduction"],
  "adaptation_rate": "adaptive"
}
```

### Analytics & Intelligence (5 tools)

#### `mcp__ruv-swarm__behavioral_analysis`
**Function**: Analyze agent and swarm behavioral patterns
**Parameters**:
- `analysis_scope` (string): Scope - "individual_agents", "agent_groups", "entire_swarm", "cross_swarm"
- `behavioral_dimensions` (array): Dimensions to analyze
- `pattern_detection` (boolean): Detect behavioral patterns
- `anomaly_detection` (boolean): Detect anomalous behaviors

**Usage Example**:
```json
{
  "analysis_scope": "entire_swarm",
  "behavioral_dimensions": ["communication_frequency", "task_selection", "collaboration_preferences"],
  "pattern_detection": true,
  "anomaly_detection": true
}
```

#### `mcp__ruv-swarm__performance_prediction`
**Function**: Predict swarm performance under different conditions
**Parameters**:
- `prediction_scenarios` (array): Scenarios to predict performance for
- `performance_metrics` (array): Metrics to predict
- `model_complexity` (string): Prediction model complexity
- `uncertainty_quantification` (boolean): Include uncertainty estimates

**Usage Example**:
```json
{
  "prediction_scenarios": [
    {"agent_count": 10, "task_complexity": "high", "load": "peak"},
    {"agent_count": 15, "task_complexity": "medium", "load": "normal"}
  ],
  "performance_metrics": ["throughput", "latency", "success_rate"],
  "model_complexity": "advanced",
  "uncertainty_quantification": true
}
```

#### `mcp__ruv-swarm__sentiment_analysis`
**Function**: Analyze sentiment and morale within swarm communications
**Parameters**:
- `analysis_timeframe` (string): Timeframe for sentiment analysis
- `communication_channels` (array): Channels to analyze
- `sentiment_dimensions` (array): Dimensions of sentiment to track
- `trend_analysis` (boolean): Include sentiment trend analysis

**Usage Example**:
```json
{
  "analysis_timeframe": "7d",
  "communication_channels": ["task_coordination", "peer_feedback", "status_updates"],
  "sentiment_dimensions": ["confidence", "satisfaction", "stress", "collaboration_quality"],
  "trend_analysis": true
}
```

#### `mcp__ruv-swarm__insight_generation`
**Function**: Generate insights from swarm data and interactions
**Parameters**:
- `insight_categories` (array): Categories of insights to generate
- `data_sources` (array): Data sources to analyze
- `insight_depth` (string): Depth of analysis
- `actionable_recommendations` (boolean): Include actionable recommendations

**Usage Example**:
```json
{
  "insight_categories": ["efficiency_improvements", "collaboration_optimization", "resource_utilization"],
  "data_sources": ["task_logs", "communication_history", "performance_metrics"],
  "insight_depth": "comprehensive",
  "actionable_recommendations": true
}
```

#### `mcp__ruv-swarm__predictive_maintenance`
**Function**: Predict and prevent swarm system issues
**Parameters**:
- `prediction_horizon` (string): How far ahead to predict
- `maintenance_categories` (array): Categories of maintenance to predict
- `alert_thresholds` (object): Thresholds for maintenance alerts
- `automated_actions` (boolean): Enable automated preventive actions

**Usage Example**:
```json
{
  "prediction_horizon": "weeks",
  "maintenance_categories": ["agent_performance_degradation", "resource_exhaustion", "communication_bottlenecks"],
  "alert_thresholds": {"degradation_rate": 0.1, "resource_usage": 0.9},
  "automated_actions": true
}
```

### Specialized Operations (5 tools)

#### `mcp__ruv-swarm__quantum_simulate`
**Function**: Simulate quantum computing algorithms for optimization problems
**Parameters**:
- `algorithm_type` (string): Quantum algorithm - "vqe", "qaoa", "grover", "shor", "custom"
- `problem_encoding` (object): Problem encoding for quantum simulation
- `qubit_count` (number): Number of qubits to simulate
- `noise_model` (string, optional): Quantum noise model to apply

**Usage Example**:
```json
{
  "algorithm_type": "qaoa",
  "problem_encoding": {"type": "max_cut", "graph_nodes": 10},
  "qubit_count": 16,
  "noise_model": "depolarizing"
}
```

#### `mcp__ruv-swarm__blockchain_consensus`
**Function**: Implement blockchain-based consensus for critical decisions
**Parameters**:
- `consensus_mechanism` (string): Mechanism - "proof_of_work", "proof_of_stake", "delegated_pos", "practical_byzantine"
- `block_parameters` (object): Blockchain block parameters
- `validator_selection` (string): How to select validators
- `finality_requirements` (object): Requirements for transaction finality

**Usage Example**:
```json
{
  "consensus_mechanism": "proof_of_stake",
  "block_parameters": {"block_time": 30, "max_transactions": 100},
  "validator_selection": "stake_weighted",
  "finality_requirements": {"confirmations": 6, "time_threshold": 180}
}
```

#### `mcp__ruv-swarm__evolutionary_optimize`
**Function**: Use evolutionary algorithms for swarm optimization
**Parameters**:
- `optimization_target` (string): What to optimize
- `population_size` (number): Size of population for evolution
- `mutation_rate` (number): Mutation rate for genetic algorithm
- `selection_pressure` (string): Selection pressure level
- `termination_criteria` (object): When to stop evolution

**Usage Example**:
```json
{
  "optimization_target": "task_allocation_strategy",
  "population_size": 50,
  "mutation_rate": 0.1,
  "selection_pressure": "moderate",
  "termination_criteria": {"max_generations": 100, "convergence_threshold": 0.01}
}
```

#### `mcp__ruv-swarm__swarm_robotics`
**Function**: Coordinate physical or virtual robotic swarms
**Parameters**:
- `coordination_mode` (string): Mode - "centralized", "distributed", "hybrid", "emergent"
- `robot_capabilities` (array): Capabilities of individual robots
- `formation_control` (object): Formation control parameters
- `path_planning` (string): Path planning algorithm

**Usage Example**:
```json
{
  "coordination_mode": "distributed",
  "robot_capabilities": ["movement", "sensing", "communication", "manipulation"],
  "formation_control": {"formation_type": "line", "spacing": 2.0, "flexibility": 0.5},
  "path_planning": "rrt_star"
}
```

#### `mcp__ruv-swarm__bio_inspired_algorithms`
**Function**: Implement bio-inspired algorithms for swarm behavior
**Parameters**:
- `algorithm_type` (string): Algorithm - "ant_colony", "particle_swarm", "bee_algorithm", "flocking", "stigmergy"
- `bio_parameters` (object): Biological parameters for the algorithm
- `adaptation_rules` (array): Rules for algorithm adaptation
- `emergence_detection` (boolean): Detect emergent behaviors

**Usage Example**:
```json
{
  "algorithm_type": "ant_colony",
  "bio_parameters": {"pheromone_evaporation": 0.1, "alpha": 1.0, "beta": 2.0},
  "adaptation_rules": [
    {"condition": "stagnation", "action": "increase_exploration"},
    {"condition": "convergence", "action": "maintain_exploitation"}
  ],
  "emergence_detection": true
}
```

---

## Usage Patterns and Best Practices

### Batch Operations

Many claude-flow tools support batch operations for efficiency:

```json
{
  "tool": "mcp__claude-flow__parallel_execute",
  "params": {
    "operations": [
      {"tool": "memory_usage", "params": {"action": "retrieve", "key": "project_status"}},
      {"tool": "agent_metrics", "params": {"timeframe": "1h"}},
      {"tool": "performance_report", "params": {"format": "summary"}}
    ],
    "max_concurrency": 3
  }
}
```

### Error Handling

All tools provide structured error responses:

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Swarm with ID 'project-alpha' not found",
    "details": {"swarmId": "project-alpha", "available_swarms": ["project-beta"]}
  }
}
```

### Tool Chaining

Tools can be chained for complex workflows:

```json
[
  {"tool": "mcp__claude-flow__swarm_init", "params": {"topology": "hierarchical"}},
  {"tool": "mcp__claude-flow__agent_spawn", "params": {"type": "coordinator"}},
  {"tool": "mcp__ruv-swarm__neural_train", "params": {"pattern_type": "coordination"}}
]
```

### Performance Optimization

- Use `mcp__claude-flow__parallel_execute` for concurrent operations
- Leverage caching with memory tools for frequently accessed data
- Monitor performance with analytics tools
- Use predictive tools to anticipate resource needs

### Security Considerations

- All tools support namespace isolation for multi-tenant environments
- Sensitive data is automatically encrypted in memory storage
- Access control is enforced at the MCP protocol level
- Audit trails are maintained for all tool executions

---

## Integration Examples

### Full-Stack Development Swarm

```json
{
  "workflow": [
    {
      "tool": "mcp__claude-flow__swarm_init",
      "params": {"topology": "hierarchical", "maxAgents": 8}
    },
    {
      "tool": "mcp__claude-flow__agent_spawn",
      "params": {"type": "architect", "specialization": ["system_design"]}
    },
    {
      "tool": "mcp__claude-flow__agent_spawn",
      "params": {"type": "coder", "specialization": ["backend"]}
    },
    {
      "tool": "mcp__claude-flow__agent_spawn",
      "params": {"type": "coder", "specialization": ["frontend"]}
    },
    {
      "tool": "mcp__claude-flow__task_orchestrate",
      "params": {"task": "Build e-commerce platform", "strategy": "parallel"}
    }
  ]
}
```

### AI Research Collaboration

```json
{
  "workflow": [
    {
      "tool": "mcp__ruv-swarm__collective_intelligence",
      "params": {"intelligence_mode": "collective_reasoning", "problem_context": {"domain": "machine_learning"}}
    },
    {
      "tool": "mcp__ruv-swarm__neural_train",
      "params": {"training_mode": "federated", "model_architecture": {"type": "transformer"}}
    },
    {
      "tool": "mcp__claude-flow__performance_report",
      "params": {"timeframe": "24h", "include_predictions": true}
    }
  ]
}
```

## Getting Started

1. **Install MCP Tools**: Follow the installation guide in the main documentation
2. **Configure Permissions**: Set up appropriate permissions in your Claude configuration
3. **Start with Basic Tools**: Begin with simple tools like `swarm_status` and `memory_usage`
4. **Build Workflows**: Combine tools into automated workflows
5. **Monitor and Optimize**: Use analytics tools to optimize performance

For detailed setup instructions, see the [Integration Guide](integration/README.md).

---

*This documentation is automatically generated and updated. Last updated: 2024-08-13*