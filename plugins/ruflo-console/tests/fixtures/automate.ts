/**
 * What @claude-flow/cli 3.51.1 printed for the Automation and Learning Lab entries, captured in a scratch project
 * (`git init` under /tmp). The workflow, session and secret config rows are made up in the same shapes; every secret
 * here is fake and exists to prove it is never drawn.
 */
const mcp = (tool: string, result: unknown) => `[INFO] Executing tool: ${tool}\n\n[OK] Tool executed in 6.64ms\n\nResult:\n${JSON.stringify(result, null, 2)}\n`

export const WF_ID = 'workflow-1790990000000-abc123'
export const SESSION_ID = 'session-1790990000000-q1w2e3'
export const FAKE_SECRET = 'sk-not-a-real-key-console-test'

export const AUTO_OUT: Record<string, string> = {
  'workflow-list': mcp('workflow_list', { workflows: [{ workflowId: WF_ID, name: 'ship the console', status: 'pending', stepCount: 1, createdAt: '2026-10-02T10:00:00.000Z' }], total: 1, filters: {} }),
  'workflow-empty': mcp('workflow_list', { workflows: [], total: 0, filters: {} }),
  'template-list': mcp('workflow_template', { action: 'list', templates: [{ templateId: 'template-1790990000001-zz9', name: 'ship Template', stepCount: 1, createdAt: '2026-10-02T10:00:00.000Z' }], total: 1 }),
  'session-list': mcp('session_list', { sessions: [{ sessionId: SESSION_ID, name: 'before-refactor', savedAt: '2026-10-02T09:00:00.000Z', stats: null }], total: 1, limit: 20 }),
  'config-list': mcp('config_list', {
    configs: [
      { key: 'logging.level', value: 'info', source: 'stored' },
      { key: 'providers.anthropic.apiKey', value: FAKE_SECRET, source: 'stored' },
      { key: 'swarm.maxAgents', value: 8, source: 'stored' },
      { key: 'webhook.url', value: FAKE_SECRET, source: 'stored' },
    ],
    total: 4,
    scope: 'default',
  }),
  'config-get-secret': mcp('config_get', { key: 'providers.anthropic.apiKey', value: FAKE_SECRET, scope: 'default', exists: true, source: 'stored' }),
  'autopilot-status': '{\n  "enabled": false,\n  "sessionId": "6d2c7525-679a-4503-8842-8cdb44defdf1",\n  "iterations": 0,\n  "maxIterations": 50,\n  "timeoutMinutes": 240,\n  "elapsedMs": 0,\n  "tasks": {\n    "completed": 0,\n    "total": 0,\n    "percent": 100\n  },\n  "taskSources": [\n    "team-tasks",\n    "swarm-tasks",\n    "file-checklist"\n  ]\n}\n',
  'neural-train': [
    '',
    'Neural Pattern Training (RuVector WASM)',
    '───────────────────────────────────────────────────────',
    '✅ Using native better-sqlite3',
    'Training complete: 5 epochs in 0.4s',
    '',
    '+--------------------+----------------------------------+',
    '| Metric             | Value                            |',
    '+--------------------+----------------------------------+',
    '| Pattern Type       | coordination                     |',
    '| Epochs             | 5                                |',
    '| Batch Size         | 32                               |',
    '| Total Time         | 0.4s                             |',
    '| Backend            | native (@ruvector/ruvllm Trai... |',
    '| Final Loss         | 4.289e-3                         |',
    '| Checkpoint         | /tmp/automate-probe/.claude-f... |',
    '+--------------------+----------------------------------+',
    '',
    '✓ 5 patterns saved to /tmp/automate-probe/.claude-flow/neural/patterns.json',
  ].join('\n'),
  'neural-train-js': '| Pattern Type       | testing |\n| Epochs             | 10 |\n| Total Time         | 1.2s |\n| Avg Loss           | 0.0213 |\n',
  'hooks-route': [
    '[hooks] Semantic router initialized: native VectorDb (HNSW, 16k+ routes/s), embedder=hash',
    JSON.stringify(
      {
        task: 'fix the login bug',
        routing: { method: 'semantic-native', backend: 'native VectorDb (HNSW)', latencyMs: 0.105 },
        matchedPattern: 'testing-task',
        matched: true,
        primaryAgent: { type: 'tester', confidence: 0.49, reason: 'Semantic similarity to "testing-task" pattern (49%)' },
        alternativeAgents: [{ type: 'reviewer', confidence: 0.39, reason: 'Alternative agent for reviewer capabilities' }],
      },
      null,
      2,
    ),
  ].join('\n'),
}

/** Answers the Automation and Learning Lab argv from AUTO_OUT; null for anything else (the caller falls back). */
export function autoAnswer(argv: readonly string[]): { exitCode: number; stdout: string; stderr: string } | null {
  const line = argv.join(' ')
  const out = (name: string) => ({ exitCode: 0, stdout: AUTO_OUT[name] ?? '', stderr: '' })

  if (line.includes('workflow_list')) return out('workflow-list')
  if (line.includes('workflow_template')) return out('template-list')
  if (line.includes('session_list')) return out('session-list')
  if (line.includes('config_list')) return out('config-list')
  if (line.includes('config_get')) return out('config-get-secret')
  if (line.includes('autopilot status')) return out('autopilot-status')
  if (line.includes('neural train')) return out('neural-train')
  if (line.includes('hooks route')) return out('hooks-route')

  return null
}
