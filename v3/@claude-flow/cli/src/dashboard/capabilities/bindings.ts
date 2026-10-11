/**
 * The binding table: the ONLY things the capability channel can run. A plugin manifest never says what to run; a capability with no entry here is listed
 * as refused. Every entry carries a hand-written argument schema. No entry exists for anything that installs, uses the network, spends money, deletes, or
 * hands free text to a model. Tools named here are the whole allowlist of the capability executor (CAPABILITY_TOOLS).
 */
import type { ArgSpec, Binding } from './types.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const mcp = (b: Omit<Binding, 'action'> & { tool: string; params?: (a: Record<string, string | number | boolean>) => Record<string, unknown> }): Binding => {
  const { tool, params, ...rest } = b;
  return { ...rest, action: { kind: 'mcp', tool, params: params ?? (() => ({})) } };
};
const none: readonly ArgSpec[] = [];

export const BINDINGS: readonly Binding[] = [
  // ---- read: MetaHarness (the tools spawn plugin scripts through ruflo, hence the shadow check at run time) ----
  mcp({ plugin: 'ruflo-metaharness', kind: 'skill', name: 'harness-score', pinFile: 'skills/harness-score/SKILL.md', level: 'read', risk: 'read', args: none, tool: 'metaharness_score', metaharness: true }),
  mcp({ plugin: 'ruflo-metaharness', kind: 'skill', name: 'harness-genome', pinFile: 'skills/harness-genome/SKILL.md', level: 'read', risk: 'read', args: none, tool: 'metaharness_genome', metaharness: true }),
  mcp({ plugin: 'ruflo-metaharness', kind: 'skill', name: 'harness-threat-model', pinFile: 'skills/harness-threat-model/SKILL.md', level: 'read', risk: 'read', args: none, tool: 'metaharness_threat_model', metaharness: true }),
  mcp({ plugin: 'ruflo-metaharness', kind: 'skill', name: 'harness-mcp-scan', pinFile: 'skills/harness-mcp-scan/SKILL.md', level: 'read', risk: 'read', tool: 'metaharness_mcp_scan', metaharness: true,
    args: [{ name: 'failOn', type: 'enum', enum: ['low', 'medium', 'high'] }], params: a => (a.failOn ? { failOn: String(a.failOn) } : {}) }),
  // ---- read: views over tools ruflo already ships ----
  mcp({ plugin: 'ruflo-agentdb', kind: 'view', name: 'health', pinFile: 'commands/agentdb.md', level: 'read', risk: 'read', args: none, tool: 'agentdb_health', timeoutMs: 60_000 }),
  mcp({ plugin: 'ruflo-agentdb', kind: 'view', name: 'controllers', pinFile: 'commands/agentdb.md', level: 'read', risk: 'read', args: none, tool: 'agentdb_controllers', timeoutMs: 60_000 }),
  mcp({ plugin: 'ruflo-workflows', kind: 'view', name: 'workflow-list', pinFile: 'commands/workflow.md', level: 'read', risk: 'read', args: none, tool: 'workflow_list' }),
  mcp({ plugin: 'ruflo-swarm', kind: 'view', name: 'swarm-status', pinFile: 'commands/swarm.md', level: 'read', risk: 'read', args: none, tool: 'swarm_status' }),
  mcp({ plugin: 'ruflo-rag-memory', kind: 'view', name: 'memory-stats', pinFile: 'commands/ruflo-memory.md', level: 'read', risk: 'read', args: none, tool: 'memory_stats' }),
  mcp({ plugin: 'ruflo-rvf', kind: 'view', name: 'sessions', pinFile: 'commands/rvf.md', level: 'read', risk: 'read', args: none, tool: 'session_list' }),
  // ---- write: always behind the local card ----
  mcp({ plugin: 'ruflo-workflows', kind: 'view', name: 'workflow-pause', pinFile: 'commands/workflow.md', level: 'write', risk: 'write', tool: 'workflow_pause', args: [{ name: 'workflowId', type: 'string', required: true, max: 80, pattern: ID }], params: a => ({ workflowId: String(a.workflowId) }) }),
  mcp({ plugin: 'ruflo-workflows', kind: 'view', name: 'workflow-resume', pinFile: 'commands/workflow.md', level: 'write', risk: 'write', tool: 'workflow_resume', args: [{ name: 'workflowId', type: 'string', required: true, max: 80, pattern: ID }], params: a => ({ workflowId: String(a.workflowId) }) }),
  mcp({ plugin: 'ruflo-agentdb', kind: 'view', name: 'consolidate', pinFile: 'commands/agentdb.md', level: 'write', risk: 'write', args: none, tool: 'agentdb_consolidate', timeoutMs: 120_000 }),
  // cli: ruflo's own subcommand, fixed argv
  { plugin: 'ruflo-mods', kind: 'view', name: 'status', pinFile: 'README.md', level: 'read', risk: 'read', args: none, action: { kind: 'cli', argv: () => ['mods', 'status', '--json'] } },
];

/** Skills whose names say they cannot be remote, for the refusal code (never a way to run them). */
export function classifyUnbound(plugin: string, name: string): 'risk-network' | 'risk-install' | 'risk-spend' | 'risk-delete' | 'free-text-to-agent' | 'no-binding' {
  if (plugin === 'ruflo-browser' || /^browser-|scrape|fetch|openrouter/.test(name)) return 'risk-network';
  if (/install|setup|bootstrap|update|upgrade|create-plugin/.test(name)) return 'risk-install';
  if (/gaia-(run|submit)|^gaia$|train|cloud|backtest|benchmark|bench\b|deep-research|trader|spend/.test(name)) return 'risk-spend';
  if (/purge|delete|reset|forget|clean|uninstall|remove|shutdown|terminate/.test(name)) return 'risk-delete';
  if (/^task$|^agent$|prompt|nested|spawn/.test(name)) return 'free-text-to-agent';
  return 'no-binding';
}

export const bindingKey = (plugin: string, kind: string, name: string): string => `${plugin}/${kind}/${name}`;
/** The table the catalog and the executor consult. Tests build their own; production uses DEFAULT_BINDINGS. */
export class BindingTable {
  private byKey: Map<string, Binding>;
  constructor(readonly list: readonly Binding[]) { this.byKey = new Map(list.map(b => [bindingKey(b.plugin, b.kind, b.name), b])); }
  find(plugin: string, kind: string, name: string): Binding | undefined { return this.byKey.get(bindingKey(plugin, kind, name)); }
  /** Exactly the tools the capability executor may call. */
  get tools(): ReadonlySet<string> { return new Set(this.list.flatMap(b => (b.action.kind === 'mcp' ? [b.action.tool] : []))); }
}
export const DEFAULT_BINDINGS = new BindingTable(BINDINGS);
export const CAPABILITY_TOOLS: ReadonlySet<string> = DEFAULT_BINDINGS.tools;
