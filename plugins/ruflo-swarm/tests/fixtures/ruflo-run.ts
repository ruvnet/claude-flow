/**
 * The files ruflo 3.49.0 wrote in a real run (swarm init, three agent spawns, two tasks, a claim, an assignment,
 * hive-mind init and a consensus proposal), captured from disk. The hive token is replaced by a sentinel the tests
 * assert never reaches a drawing, a command's text or a log.
 */
export const HIVE_TOKEN = 'HIVE-TOKEN-SENTINEL-must-never-render'

export const RUFLO_RUN: Record<string, string> = {
  ".claude-flow/swarm/swarm-state.json": JSON.stringify({
    "swarms": {
      "swarm-1790888806724-u3ktj4": {
        "swarmId": "swarm-1790888806724-u3ktj4",
        "topology": "hierarchical",
        "maxAgents": 8,
        "status": "running",
        "agents": [
          "agent-1790888815793-6ju96w",
          "agent-1790888816288-z5xsn6",
          "agent-1790888816793-b2xzp7"
        ],
        "tasks": [],
        "config": {
          "topology": "hierarchical",
          "maxAgents": 8,
          "strategy": "specialized",
          "communicationProtocol": "message-bus",
          "autoScaling": true,
          "consensusMechanism": "majority"
        },
        "createdAt": "2026-10-01T21:06:46.724Z",
        "updatedAt": "2026-10-01T21:06:46.724Z"
      }
    },
    "version": "3.0.0"
  }),
  ".swarm/state.json": JSON.stringify({
    "id": "swarm-1790888806724-u3ktj4",
    "topology": "hierarchical",
    "maxAgents": 8,
    "strategy": "specialized",
    "v3Mode": false,
    "permissions": null,
    "initializedAt": "2026-10-01T21:06:46.724Z",
    "status": "ready"
  }),
  ".claude-flow/agents/store.json": JSON.stringify({
    "agents": {
      "agent-1790888815793-6ju96w": {
        "agentId": "agent-1790888815793-6ju96w",
        "agentType": "coder",
        "status": "busy",
        "health": 1,
        "taskCount": 0,
        "config": {
          "provider": "anthropic",
          "timeout": 300,
          "autoTools": true
        },
        "createdAt": "2026-10-01T21:06:55.793Z",
        "model": "sonnet",
        "modelRoutedBy": "default",
        "currentTask": "task-1790888817265-vatniv"
      },
      "agent-1790888816288-z5xsn6": {
        "agentId": "agent-1790888816288-z5xsn6",
        "agentType": "tester",
        "status": "idle",
        "health": 1,
        "taskCount": 0,
        "config": {
          "provider": "anthropic",
          "timeout": 300,
          "autoTools": true
        },
        "createdAt": "2026-10-01T21:06:56.288Z",
        "model": "sonnet",
        "modelRoutedBy": "default"
      },
      "agent-1790888816793-b2xzp7": {
        "agentId": "agent-1790888816793-b2xzp7",
        "agentType": "reviewer",
        "status": "idle",
        "health": 1,
        "taskCount": 0,
        "config": {
          "provider": "anthropic",
          "timeout": 300,
          "autoTools": true
        },
        "createdAt": "2026-10-01T21:06:56.793Z",
        "model": "sonnet",
        "modelRoutedBy": "default"
      }
    },
    "version": "3.0.0"
  }),
  ".claude-flow/tasks/store.json": JSON.stringify({
    "tasks": {
      "task-1790888817265-vatniv": {
        "taskId": "task-1790888817265-vatniv",
        "type": "implementation",
        "description": "Build login form",
        "priority": "normal",
        "status": "in_progress",
        "progress": 0,
        "assignedTo": [
          "agent-1790888815793-6ju96w"
        ],
        "tags": [],
        "createdAt": "2026-10-01T21:06:57.265Z",
        "startedAt": "2026-10-01T21:07:39.789Z",
        "completedAt": null
      },
      "task-1790888817757-h3rps7": {
        "taskId": "task-1790888817757-h3rps7",
        "type": "testing",
        "description": "Write login tests",
        "priority": "normal",
        "status": "pending",
        "progress": 0,
        "assignedTo": [],
        "tags": [],
        "createdAt": "2026-10-01T21:06:57.757Z",
        "startedAt": null,
        "completedAt": null
      }
    },
    "version": "3.0.0"
  }),
  ".claude-flow/claims/claims.json": JSON.stringify({
    "claims": {
      "task-1790888817265-vatniv": {
        "issueId": "task-1790888817265-vatniv",
        "claimant": {
          "type": "agent",
          "agentId": "agent-1790888815793-6ju96w",
          "agentType": "coder"
        },
        "claimedAt": "2026-10-01T21:07:39.332Z",
        "status": "active",
        "statusChangedAt": "2026-10-01T21:07:39.332Z",
        "progress": 0
      }
    },
    "stealable": {},
    "contests": {}
  }),
  ".claude-flow/hive-mind/state.json": JSON.stringify({
    "initialized": true,
    "topology": "hierarchical",
    "workers": [],
    "consensus": {
      "pending": [
        {
          "proposalId": "proposal-1790888860262-55jkcl",
          "type": "design",
          "value": "use-jwt",
          "proposedBy": "system",
          "proposedAt": "2026-10-01T21:07:40.262Z",
          "votes": {},
          "status": "pending",
          "strategy": "raft",
          "term": 1,
          "timeoutAt": "2026-10-01T21:08:10.262Z"
        }
      ],
      "history": []
    },
    "sharedMemory": {},
    "createdAt": "2026-10-01T21:06:58.222Z",
    "updatedAt": "2026-10-01T21:07:40.262Z",
    "consensusStrategy": "byzantine",
    "queen": {
      "agentId": "queen-1790888818222",
      "electedAt": "2026-10-01T21:06:58.222Z",
      "term": 1
    },
    "hiveToken": "HIVE-TOKEN-SENTINEL-must-never-render"
  }),
}
