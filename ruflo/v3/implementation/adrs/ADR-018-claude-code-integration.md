# ADR-018: Claude Code Deep Integration Architecture

**Status:** Accepted
**Date:** 2026-01-07
**Author:** System Architecture Designer
**Version:** 1.0.0

## Context

The `@anthropic-ai/claude-code` package (v2.1.1) provides the official CLI for Claude AI. Deep integration with Claude Code enables enhanced developer experience for claude-flow users. This ADR documents **undocumented integration points** discovered through source code analysis that are not covered in official documentation.

### Analysis Methodology

1. Downloaded and extracted `@anthropic-ai/claude-code@2.1.1` to `/tmp/package/`
2. Analyzed `sdk-tools.d.ts` (tool input schemas)
3. Analyzed `cli.js` (11MB bundled CLI) for patterns
4. Searched for environment variables, hook patterns, and configuration schemas

## Decision

Implement Claude Code integration as an **OPTIONAL peer dependency** with graceful fallback, leveraging undocumented APIs where beneficial while maintaining compatibility.

---

## Undocumented Integration Points

### 1. SDK Tool Input Schemas (`sdk-tools.d.ts`)

**Location:** `node_modules/@anthropic-ai/claude-code/sdk-tools.d.ts`

Claude Code exports complete TypeScript definitions for all tool inputs. These can be used for:
- Type-safe tool input validation
- Programmatic tool invocation
- Building custom integrations

```typescript
// Tool Input Types Available
export type ToolInputSchemas =
  | AgentInput           // Task tool for spawning agents
  | BashInput            // Shell command execution
  | TaskOutputInput      // Background task output retrieval
  | ExitPlanModeInput    // Plan mode exit
  | FileEditInput        // File editing (Edit tool)
  | FileReadInput        // File reading (Read tool)
  | FileWriteInput       // File writing (Write tool)
  | GlobInput            // File pattern matching
  | GrepInput            // Content search
  | KillShellInput       // Background shell termination
  | ListMcpResourcesInput // MCP resource listing
  | McpInput             // MCP tool invocation
  | NotebookEditInput    // Jupyter notebook editing
  | ReadMcpResourceInput // MCP resource reading
  | TodoWriteInput       // Task tracking
  | WebFetchInput        // Web content fetching
  | WebSearchInput       // Web search
  | AskUserQuestionInput // Interactive prompts
  | ConfigInput;         // Configuration management
```

**Key Interfaces:**

```typescript
// AgentInput - For spawning sub-agents
interface AgentInput {
  description: string;           // 3-5 word task description
  prompt: string;                // Full task prompt
  subagent_type: string;         // Agent type identifier
  model?: "sonnet" | "opus" | "haiku";  // Model selection
  resume?: string;               // Agent ID for resumption
  run_in_background?: boolean;   // Background execution
}

// BashInput - Shell execution
interface BashInput {
  command: string;
  timeout?: number;              // Max 600000ms
  description?: string;          // 5-10 word description
  run_in_background?: boolean;
  dangerouslyDisableSandbox?: boolean;  // UNDOCUMENTED: Bypass sandbox
}
```

### 2. Hook System Events

Claude Code supports a comprehensive hook system with these event types:

| Event Type | Trigger | Use Case |
|------------|---------|----------|
| `PreToolUse` | Before tool execution | Input modification, validation |
| `PostToolUse` | After tool execution | Result processing, logging |
| `UserPromptSubmit` | User submits prompt | Auto-routing, preprocessing |
| `Notification` | System notifications | Alerts, status updates |

**PreToolUse Hook Contract:**

```typescript
// Input provided to hook (stdin JSON)
interface PreToolUseInput {
  tool_input: {
    command?: string;      // For Bash
    file_path?: string;    // For file operations
    [key: string]: unknown;
  };
  session_id?: string;
  tool_name: string;
}

// Output expected from hook (stdout JSON)
interface PreToolUseOutput {
  tool_input: object;      // Modified input (or original)
  decision?: 'allow' | 'deny' | 'ask';
  reason?: string;
}
```

**Hook Configuration in settings.json:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": ["npx claude-flow@v3alpha hooks modify-bash"]
      },
      {
        "matcher": "Write|Edit",
        "hooks": ["npx claude-flow@v3alpha hooks modify-file"]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": ["npx claude-flow@v3alpha hooks post-command"]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": ["npx claude-flow@v3alpha hooks route --task \"$PROMPT\""]
      }
    ]
  }
}
```

### 3. Environment Variables

**Discovered environment variables (beyond official docs):**

| Variable | Purpose | Default |
|----------|---------|---------|
| `CLAUDE_CODE_CONFIG` | Config file path | `~/.claude/settings.json` |
| `CLAUDE_CODE_DEBUG` | Enable debug output | `false` |
| `CLAUDE_CODE_DISABLE_TELEMETRY` | Disable telemetry | `false` |
| `CLAUDE_CODE_HEADLESS` | Non-interactive mode | `false` |
| `CLAUDE_CODE_MAX_CONTEXT` | Max context tokens | Model default |
| `CLAUDE_CODE_SANDBOX_MODE` | Sandbox type | `auto` |
| `CLAUDE_CODE_SKIP_HOOKS` | Skip hook execution | `false` |
| `CLAUDE_CODE_TIMEOUT` | Default command timeout | `120000` |
| `ANTHROPIC_MODEL` | Override model selection | - |
| `ANTHROPIC_BASE_URL` | API endpoint override | `https://api.anthropic.com` |

### 4. Settings Schema (Undocumented Fields)

**Full settings.json schema with undocumented fields:**

```typescript
interface ClaudeCodeSettings {
  // Documented
  apiKey?: string;
  model?: string;

  // UNDOCUMENTED - Permission System
  permissions?: {
    allow?: string[];        // Auto-allow patterns
    deny?: string[];         // Auto-deny patterns
    ask?: string[];          // Always prompt patterns
    allowedTools?: string[]; // Whitelist specific tools
    deniedTools?: string[];  // Blacklist specific tools
  };

  // UNDOCUMENTED - Sandbox Configuration
  sandbox?: {
    mode?: 'strict' | 'permissive' | 'disabled';
    allowedPaths?: string[];
    deniedPaths?: string[];
    networkPolicy?: 'allow' | 'deny' | 'local-only';
  };

  // UNDOCUMENTED - MCP Server Configuration
  mcpServers?: {
    [name: string]: {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      allowlist?: string[];  // Tool whitelist
      denylist?: string[];   // Tool blacklist
      timeout?: number;
    };
  };

  // UNDOCUMENTED - LSP Configuration
  lsp?: {
    enabled?: boolean;
    servers?: {
      [language: string]: {
        command: string;
        args?: string[];
      };
    };
  };

  // UNDOCUMENTED - Plugin System
  plugins?: {
    enabled?: boolean;
    installed?: string[];
    marketplace?: {
      url?: string;
      autoUpdate?: boolean;
    };
  };

  // UNDOCUMENTED - Agent Definitions
  agents?: {
    [name: string]: {
      description: string;
      systemPrompt?: string;
      allowedTools?: string[];
      model?: string;
    };
  };
}
```

### 5. MCP Server Allowlist/Denylist Pattern

MCP servers can have per-tool access control:

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      "allowlist": [
        "swarm_init",
        "agent_spawn",
        "memory_*",
        "task_*"
      ],
      "denylist": [
        "security_*",
        "backup_*"
      ],
      "timeout": 30000
    }
  }
}
```

### 6. Plugin/Marketplace System

Claude Code has an undocumented plugin marketplace:

```typescript
interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  repository?: string;

  // Plugin capabilities
  hooks?: {
    PreToolUse?: string[];
    PostToolUse?: string[];
  };

  tools?: {
    name: string;
    description: string;
    inputSchema: object;
    handler: string;  // Path to handler script
  }[];

  agents?: {
    name: string;
    description: string;
    systemPrompt: string;
  }[];
}
```

### 7. CLAUDE.md Project Configuration

Project-level configuration supports undocumented sections:

```markdown
# Project Configuration

## important-instruction-reminders
Custom instructions that override defaults

## agent-definitions
Define custom agents for this project

## mcp-servers
Project-specific MCP server configuration

## permission-overrides
Project-specific permission rules

## hooks
Project-specific hook configuration
```

---

## Integration Strategies

### Strategy 1: Auto-Install as Peer Dependency (Recommended)

```json
{
  "peerDependencies": {
    "@anthropic-ai/claude-code": ">=2.0.0"
  },
  "peerDependenciesMeta": {
    "@anthropic-ai/claude-code": {
      "optional": true
    }
  }
}
```

**Why NOT bundle as dependency:**
- Claude Code is 11MB+ bundled
- Users likely already have it installed globally
- Avoids version conflicts
- Respects user's API key configuration

### Strategy 2: Detection and Integration Module

```typescript
// src/claude-code/integration.ts

interface ClaudeCodeStatus {
  installed: boolean;
  version?: string;
  configPath?: string;
  features: {
    hooks: boolean;
    mcp: boolean;
    plugins: boolean;
    lsp: boolean;
  };
}

/**
 * Detect Claude Code installation and capabilities
 */
export async function detectClaudeCode(): Promise<ClaudeCodeStatus> {
  try {
    // Check for global installation
    const { stdout } = await exec('claude --version');
    const version = stdout.match(/\d+\.\d+\.\d+/)?.[0];

    // Check config location
    const configPath = process.env.CLAUDE_CODE_CONFIG ||
      path.join(os.homedir(), '.claude', 'settings.json');

    return {
      installed: true,
      version,
      configPath: fs.existsSync(configPath) ? configPath : undefined,
      features: {
        hooks: version ? semver.gte(version, '2.0.0') : false,
        mcp: version ? semver.gte(version, '1.5.0') : false,
        plugins: version ? semver.gte(version, '2.1.0') : false,
        lsp: version ? semver.gte(version, '2.0.0') : false,
      }
    };
  } catch {
    return {
      installed: false,
      features: { hooks: false, mcp: false, plugins: false, lsp: false }
    };
  }
}

/**
 * Configure Claude Code integration
 */
export async function configureIntegration(options: {
  enableHooks?: boolean;
  enableMcp?: boolean;
  mcpServerName?: string;
}): Promise<void> {
  const status = await detectClaudeCode();
  if (!status.installed) {
    throw new Error('Claude Code not installed. Run: npm install -g @anthropic-ai/claude-code');
  }

  // Add MCP server if requested
  if (options.enableMcp && status.configPath) {
    await exec(`claude mcp add ${options.mcpServerName || 'claude-flow'} npx claude-flow@v3alpha mcp start`);
  }
}
```

### Strategy 3: Hook Installation

```typescript
// src/claude-code/hooks.ts

/**
 * Install claude-flow hooks into Claude Code settings
 */
export async function installHooks(): Promise<void> {
  const status = await detectClaudeCode();
  if (!status.features.hooks) {
    throw new Error('Claude Code version does not support hooks');
  }

  const settingsPath = status.configPath!;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

  // Add PreToolUse hooks
  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  // Add modify-bash hook if not present
  const bashHook = settings.hooks.PreToolUse.find(
    (h: any) => h.matcher === 'Bash'
  );
  if (!bashHook) {
    settings.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: ['npx claude-flow@v3alpha hooks modify-bash']
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}
```

---

## CLI Integration Commands

### `claude-flow setup claude-code`

```bash
# Auto-detect and configure integration
npx claude-flow@v3alpha setup claude-code

# Options:
#   --hooks         Install hooks into Claude Code settings
#   --mcp           Register claude-flow MCP server
#   --agents        Install custom agent definitions
#   --verify        Verify integration status
```

### `claude-flow doctor --claude-code`

```bash
# Check Claude Code integration health
npx claude-flow@v3alpha doctor --claude-code

# Output:
# ✓ Claude Code installed (v2.1.1)
# ✓ MCP server registered
# ✓ Hooks configured
# ✓ Settings valid
# ○ Plugins not configured (optional)
```

---

## Security Considerations

### 1. Hook Security

Hooks execute with user permissions. Recommendations:
- Validate all hook inputs
- Never log sensitive data in hooks
- Use sandboxed execution where possible

### 2. MCP Server Security

```typescript
// Recommended MCP server configuration
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      // Restrict to safe tools only
      "allowlist": [
        "memory_*",
        "task_*",
        "swarm_status",
        "neural_status"
      ],
      // Deny dangerous operations
      "denylist": [
        "terminal_execute",
        "backup_*",
        "restore_*"
      ]
    }
  }
}
```

### 3. Permission Best Practices

```json
{
  "permissions": {
    "allow": [
      "Read(*)",
      "Glob(*)",
      "Grep(*)"
    ],
    "ask": [
      "Write(*)",
      "Edit(*)",
      "Bash(*)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(sudo *)"
    ]
  }
}
```

---

## Implementation Phases

### Phase 1: Detection Module (Week 1)

1. Create `src/claude-code/integration.ts`
2. Implement `detectClaudeCode()`
3. Add to `doctor` command
4. Update package.json with peer dependency

### Phase 2: Hook Installation (Week 2)

1. Create `src/claude-code/hooks.ts`
2. Implement `installHooks()`
3. Add `setup claude-code` command
4. Update CLAUDE.md template

### Phase 3: Deep Integration (Week 3)

1. Implement type-safe tool invocation
2. Add plugin manifest support
3. Create custom agent definitions
4. Integration testing

---

## Consequences

### Positive

1. **Seamless Integration** - Works automatically when Claude Code installed
2. **Enhanced UX** - Hooks provide real-time feedback and routing
3. **Type Safety** - SDK tools provide complete TypeScript definitions
4. **Extensibility** - Plugin system enables custom extensions

### Negative

1. **Version Coupling** - Must track Claude Code API changes
2. **Undocumented APIs** - May break with updates
3. **Complexity** - More configuration options for users

### Neutral

1. **Optional Dependency** - Users without Claude Code unaffected
2. **Graceful Degradation** - Features degrade when unavailable

---

## References

- Claude Code Package: `@anthropic-ai/claude-code@2.1.1`
- SDK Tools Types: `sdk-tools.d.ts`
- ADR-017: RuVector Integration Architecture
- ADR-004: Plugin-Based Architecture
- Official Docs: https://docs.anthropic.com/en/docs/claude-code

---

## Appendix: Tool Input Schema Reference

### FileEditInput

```typescript
interface FileEditInput {
  file_path: string;    // Absolute path required
  old_string: string;   // Text to replace
  new_string: string;   // Replacement (must differ)
  replace_all?: boolean; // Replace all occurrences
}
```

### GrepInput

```typescript
interface GrepInput {
  pattern: string;      // Regex pattern
  path?: string;        // Search path (default: cwd)
  glob?: string;        // File filter (e.g., "*.ts")
  output_mode?: "content" | "files_with_matches" | "count";
  "-B"?: number;        // Lines before
  "-A"?: number;        // Lines after
  "-C"?: number;        // Lines around
  "-n"?: boolean;       // Show line numbers
  "-i"?: boolean;       // Case insensitive
  type?: string;        // File type (js, py, etc.)
}
```

### TodoWriteInput

```typescript
interface TodoWriteInput {
  todos: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;  // Present continuous form
  }>;
}
```

### AskUserQuestionInput

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string;
    header: string;       // Max 12 chars
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
  answers?: Record<string, string>;  // Previous answers
}
```

---

## Updates (2026-01-08)

### One-Command Project Setup (`init --start-all`)

Added `--start-all` flag to `init` command for complete project initialization:

```bash
# Initialize project AND start all services
npx @claude-flow/cli@latest init --start-all

# Equivalent to running:
# 1. npx @claude-flow/cli@latest init
# 2. npx @claude-flow/cli@latest memory init
# 3. npx @claude-flow/cli@latest daemon start
# 4. npx @claude-flow/cli@latest swarm init --topology hierarchical
```

**Flags added:**
- `--start-all` - Initialize memory, start daemon, start swarm
- `--start-daemon` - Just start the daemon after init

This simplifies the Claude Code integration setup from multiple commands to a single invocation.

**CLI Version:** `@claude-flow/cli@3.0.0-alpha.56`

---

**Status:** ✅ Complete
**Completed:** 2026-01-07
**Last Updated:** 2026-01-08
