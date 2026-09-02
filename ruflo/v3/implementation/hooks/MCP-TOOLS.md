# V3 Hooks MCP Tools Reference

## Overview

The Hooks MCP Tools provide programmatic access to the V3 hooks system through the Model Context Protocol. All tools follow ADR-005 (MCP-First API Design) conventions.

## Tools

### hooks/pre-edit

Get context, suggestions, and warnings before file edits.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "Absolute path to the file being edited"
    },
    "operation": {
      "type": "string",
      "enum": ["create", "modify", "delete"],
      "default": "modify"
    },
    "includeContext": {
      "type": "boolean",
      "default": true,
      "description": "Include file context and related patterns"
    },
    "includeSuggestions": {
      "type": "boolean",
      "default": true,
      "description": "Include agent suggestions"
    }
  },
  "required": ["filePath"]
}
```

**Response:**
```json
{
  "filePath": "/path/to/file.ts",
  "operation": "modify",
  "context": {
    "fileExists": true,
    "fileType": "ts",
    "relatedFiles": ["file.test.ts", "types.ts"],
    "similarPatterns": [
      {
        "pattern": "TypeScript module implementation",
        "confidence": 0.85,
        "description": "Similar patterns found in codebase"
      }
    ]
  },
  "suggestions": [
    {
      "agent": "coder",
      "suggestion": "Use coder for this modify operation",
      "confidence": 0.87,
      "rationale": "Based on file type and operation pattern"
    }
  ],
  "warnings": []
}
```

---

### hooks/post-edit

Record edit outcomes for learning. Stores trajectories in ReasoningBank.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "filePath": {
      "type": "string",
      "description": "Absolute path to the file that was edited"
    },
    "operation": {
      "type": "string",
      "enum": ["create", "modify", "delete"],
      "default": "modify"
    },
    "success": {
      "type": "boolean",
      "description": "Whether the edit was successful"
    },
    "outcome": {
      "type": "string",
      "description": "Description of the outcome"
    },
    "metadata": {
      "type": "object",
      "description": "Additional metadata"
    }
  },
  "required": ["filePath", "success"]
}
```

**Response:**
```json
{
  "filePath": "/path/to/file.ts",
  "operation": "modify",
  "success": true,
  "recorded": true,
  "recordedAt": "2025-01-05T12:00:00.000Z",
  "patternId": "mem_abc123"
}
```

---

### hooks/pre-command

Risk assessment before command execution.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "Command to be executed"
    },
    "workingDirectory": {
      "type": "string",
      "description": "Working directory for command execution"
    },
    "includeRiskAssessment": {
      "type": "boolean",
      "default": true
    },
    "includeSuggestions": {
      "type": "boolean",
      "default": true
    }
  },
  "required": ["command"]
}
```

**Response:**
```json
{
  "command": "rm -rf ./temp",
  "riskAssessment": {
    "riskLevel": "high",
    "concerns": [
      "Command is potentially destructive",
      "May result in data loss"
    ],
    "recommendations": [
      "Review command carefully",
      "Consider backing up data first",
      "Use --dry-run if available"
    ]
  },
  "suggestions": [
    {
      "type": "safety",
      "suggestion": "Add error handling with try-catch",
      "rationale": "Previous similar commands benefited from error handling"
    }
  ],
  "shouldProceed": false,
  "warnings": ["HIGH RISK: This command may be destructive"]
}
```

---

### hooks/post-command

Record command execution outcomes for learning.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string"
    },
    "exitCode": {
      "type": "number",
      "default": 0
    },
    "success": {
      "type": "boolean"
    },
    "output": {
      "type": "string"
    },
    "error": {
      "type": "string"
    },
    "executionTime": {
      "type": "number",
      "minimum": 0,
      "description": "Execution time in milliseconds"
    },
    "metadata": {
      "type": "object"
    }
  },
  "required": ["command", "success"]
}
```

**Response:**
```json
{
  "command": "npm test",
  "success": true,
  "recorded": true,
  "recordedAt": "2025-01-05T12:00:00.000Z",
  "patternId": "mem_def456",
  "executionTime": 5230
}
```

---

### hooks/route

Route a task to the optimal agent based on learned patterns.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "task": {
      "type": "string",
      "description": "Task description to route"
    },
    "context": {
      "type": "string",
      "description": "Additional context about the task"
    },
    "preferredAgents": {
      "type": "array",
      "items": { "type": "string" },
      "description": "List of preferred agent types"
    },
    "constraints": {
      "type": "object",
      "description": "Routing constraints"
    },
    "includeExplanation": {
      "type": "boolean",
      "default": true
    }
  },
  "required": ["task"]
}
```

**Response:**
```json
{
  "task": "Implement user authentication",
  "recommendedAgent": "security-auditor",
  "confidence": 0.92,
  "alternativeAgents": [
    { "agent": "coder", "confidence": 0.78 },
    { "agent": "backend-dev", "confidence": 0.75 }
  ],
  "explanation": "Based on task analysis and 15 similar historical tasks, 'security-auditor' is recommended with 92% confidence.",
  "reasoning": {
    "factors": [
      { "factor": "Task keywords match", "weight": 0.4, "value": 0.95 },
      { "factor": "Historical performance", "weight": 0.3, "value": 0.90 },
      { "factor": "Agent specialization", "weight": 0.2, "value": 0.95 },
      { "factor": "Current availability", "weight": 0.1, "value": 1.0 }
    ],
    "historicalPerformance": [
      { "agent": "security-auditor", "successRate": 0.94, "avgQuality": 0.91, "tasksSimilar": 12 }
    ]
  }
}
```

---

### hooks/explain

Explain routing decision with transparency.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "task": {
      "type": "string",
      "description": "Task description to explain routing for"
    },
    "context": {
      "type": "string"
    },
    "verbose": {
      "type": "boolean",
      "default": false,
      "description": "Include detailed reasoning"
    }
  },
  "required": ["task"]
}
```

**Response:**
```json
{
  "task": "Fix authentication bug in login flow",
  "recommendedAgent": "debugger",
  "explanation": "Based on task analysis and 8 similar historical tasks, 'debugger' is recommended with 88% confidence.",
  "reasoning": {
    "primaryFactors": [
      "Task keyword analysis",
      "Historical performance data",
      "Agent specialization match"
    ],
    "historicalData": {
      "similarTasksCount": 8,
      "avgSuccessRate": 0.87,
      "topPerformingAgents": [
        { "agent": "debugger", "performance": 0.91 },
        { "agent": "coder", "performance": 0.82 }
      ]
    },
    "patternMatching": {
      "matchedPatterns": 5,
      "relevantPatterns": [
        { "pattern": "Bug fix workflow", "relevance": 0.89 },
        { "pattern": "Authentication handling", "relevance": 0.85 }
      ]
    }
  },
  "alternatives": [
    { "agent": "coder", "whyNotBest": "Lower confidence (78%) and less historical success on similar tasks" }
  ]
}
```

---

### hooks/pretrain

Bootstrap intelligence from repository analysis.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "repositoryPath": {
      "type": "string",
      "description": "Path to repository (defaults to current directory)"
    },
    "includeGitHistory": {
      "type": "boolean",
      "default": true
    },
    "includeDependencies": {
      "type": "boolean",
      "default": true
    },
    "maxPatterns": {
      "type": "number",
      "minimum": 1,
      "maximum": 10000,
      "default": 1000
    },
    "force": {
      "type": "boolean",
      "default": false,
      "description": "Force retraining even if data exists"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "repositoryPath": "/workspaces/claude-flow",
  "statistics": {
    "filesAnalyzed": 247,
    "patternsExtracted": 156,
    "commitsAnalyzed": 1523,
    "dependenciesAnalyzed": 42,
    "executionTime": 3450.5
  },
  "patterns": {
    "byCategory": {
      "code-implementation": 89,
      "testing": 34,
      "documentation": 12,
      "refactoring": 15,
      "bug-fixes": 6
    },
    "byAgent": {
      "coder": 95,
      "tester": 28,
      "reviewer": 18,
      "researcher": 10,
      "planner": 5
    }
  },
  "recommendations": [
    "Strong TypeScript patterns detected - recommend coder agent for TS tasks",
    "High test coverage patterns - tester agent performs well",
    "Consistent code review practices - reviewer agent recommended for quality checks"
  ]
}
```

---

### hooks/metrics

Get learning metrics and statistics.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "enum": ["all", "routing", "edits", "commands", "patterns"],
      "default": "all"
    },
    "timeRange": {
      "type": "string",
      "enum": ["hour", "day", "week", "month", "all"],
      "default": "all"
    },
    "includeDetailedStats": {
      "type": "boolean",
      "default": false
    },
    "format": {
      "type": "string",
      "enum": ["json", "summary"],
      "default": "summary"
    }
  }
}
```

**Response:**
```json
{
  "category": "all",
  "timeRange": "all",
  "summary": {
    "totalOperations": 1547,
    "successRate": 0.89,
    "avgQuality": 0.85,
    "patternsLearned": 156
  },
  "routing": {
    "totalRoutes": 423,
    "avgConfidence": 0.84,
    "topAgents": [
      { "agent": "coder", "count": 189, "successRate": 0.91 },
      { "agent": "tester", "count": 87, "successRate": 0.88 },
      { "agent": "reviewer", "count": 65, "successRate": 0.92 }
    ]
  },
  "edits": {
    "totalEdits": 756,
    "successRate": 0.93,
    "commonPatterns": ["TypeScript modification", "Test file creation"]
  },
  "commands": {
    "totalCommands": 368,
    "successRate": 0.82,
    "avgExecutionTime": 2340,
    "commonCommands": ["npm test", "npm run build", "git status"]
  }
}
```

---

### hooks/list

List registered hooks with filtering.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "enum": ["all", "pre-edit", "post-edit", "pre-command", "post-command", "routing"],
      "default": "all"
    },
    "includeDisabled": {
      "type": "boolean",
      "default": false
    },
    "includeMetadata": {
      "type": "boolean",
      "default": true
    }
  }
}
```

**Response:**
```json
{
  "hooks": [
    {
      "name": "pre-edit-validation",
      "category": "pre-edit",
      "enabled": true,
      "priority": 100,
      "executionCount": 1523,
      "lastExecuted": "2025-01-05T11:55:00.000Z",
      "metadata": {
        "version": "1.0.0",
        "reasoningBankEnabled": true
      }
    },
    {
      "name": "intelligent-routing",
      "category": "routing",
      "enabled": true,
      "priority": 100,
      "executionCount": 423,
      "lastExecuted": "2025-01-05T11:58:00.000Z",
      "metadata": {
        "version": "1.0.0",
        "reasoningBankEnabled": true,
        "agentdbEnabled": true
      }
    }
  ],
  "total": 5,
  "byCategory": {
    "pre-edit": 1,
    "post-edit": 1,
    "pre-command": 1,
    "post-command": 1,
    "routing": 1
  }
}
```

## Tool Categories and Tags

All hooks tools are categorized and tagged for discovery:

| Tool | Category | Tags |
|------|----------|------|
| hooks/pre-edit | hooks | hooks, pre-edit, learning, reasoningbank |
| hooks/post-edit | hooks | hooks, post-edit, learning, reasoningbank |
| hooks/pre-command | hooks | hooks, pre-command, safety, risk-assessment |
| hooks/post-command | hooks | hooks, post-command, learning, reasoningbank |
| hooks/route | hooks | hooks, routing, ai, reasoningbank, learning |
| hooks/explain | hooks | hooks, routing, explanation, transparency |
| hooks/pretrain | hooks | hooks, pretraining, intelligence, reasoningbank |
| hooks/metrics | hooks | hooks, metrics, analytics, performance |
| hooks/list | hooks | hooks, list, registry |

## Caching

Some tools support caching for improved performance:

| Tool | Cacheable | Cache TTL |
|------|-----------|-----------|
| hooks/route | Yes | 5000ms |
| hooks/explain | Yes | 5000ms |
| hooks/metrics | Yes | 10000ms |
| hooks/list | Yes | 5000ms |
