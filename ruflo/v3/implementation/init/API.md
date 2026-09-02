# API Reference

Programmatic API for the V3 init system.

## Installation

```typescript
import {
  executeInit,
  detectPlatform,
  DEFAULT_INIT_OPTIONS,
  MINIMAL_INIT_OPTIONS,
  FULL_INIT_OPTIONS,
  type InitOptions,
  type InitResult,
  type PlatformInfo,
} from '@claude-flow/cli/init';
```

## Core Functions

### executeInit

Main initialization function.

```typescript
async function executeInit(options: InitOptions): Promise<InitResult>
```

**Parameters:**
- `options: InitOptions` - Configuration options

**Returns:**
- `Promise<InitResult>` - Result with created files and errors

**Example:**
```typescript
import { executeInit, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

const result = await executeInit({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: '/path/to/project',
  sourceBaseDir: '/path/to/claude-flow',
  force: true,
});

if (result.success) {
  console.log(`Created ${result.created.files.length} files`);
  console.log(`Platform: ${result.platform.os}`);
}
```

### detectPlatform

Detect current operating system and environment.

```typescript
function detectPlatform(): PlatformInfo
```

**Returns:**
- `PlatformInfo` - Platform detection results

**Example:**
```typescript
import { detectPlatform } from '@claude-flow/cli/init';

const platform = detectPlatform();
console.log(`OS: ${platform.os}`);
console.log(`Shell: ${platform.shell}`);
console.log(`Config dir: ${platform.configDir}`);
```

## Types

### InitOptions

```typescript
interface InitOptions {
  targetDir: string;
  sourceBaseDir?: string;
  force: boolean;
  interactive: boolean;
  components: InitComponents;
  hooks: HooksConfig;
  skills: SkillsConfig;
  commands: CommandsConfig;
  agents: AgentsConfig;
  statusline: StatuslineConfig;
  mcp: MCPConfig;
  runtime: RuntimeConfig;
}
```

### InitResult

```typescript
interface InitResult {
  success: boolean;
  platform: PlatformInfo;
  created: {
    directories: string[];
    files: string[];
  };
  skipped: string[];
  errors: string[];
  summary: {
    skillsCount: number;
    commandsCount: number;
    agentsCount: number;
    hooksEnabled: number;
  };
}
```

### PlatformInfo

```typescript
interface PlatformInfo {
  os: 'windows' | 'darwin' | 'linux';
  arch: 'x64' | 'arm64' | 'arm' | 'ia32';
  nodeVersion: string;
  shell: 'powershell' | 'cmd' | 'bash' | 'zsh' | 'sh';
  homeDir: string;
  configDir: string;
}
```

### InitComponents

```typescript
interface InitComponents {
  settings: boolean;
  skills: boolean;
  commands: boolean;
  agents: boolean;
  helpers: boolean;
  statusline: boolean;
  mcp: boolean;
  runtime: boolean;
}
```

## Generator Functions

### Settings Generator

```typescript
import { generateSettings, generateSettingsJson } from '@claude-flow/cli/init';

// Generate settings object
const settings = generateSettings(options);

// Generate JSON string
const json = generateSettingsJson(options);
```

### MCP Generator

```typescript
import { generateMCPConfig, generateMCPJson, generateMCPCommands } from '@claude-flow/cli/init';

// Generate MCP config object
const config = generateMCPConfig(options);

// Generate .mcp.json content
const json = generateMCPJson(options);

// Generate manual add commands
const commands = generateMCPCommands(options);
// ['claude mcp add claude-flow -- npx @claude-flow/cli mcp start', ...]
```

### Helpers Generator

```typescript
import {
  generatePreCommitHook,
  generatePostCommitHook,
  generateSessionManager,
  generateAgentRouter,
  generateMemoryHelper,
  generateWindowsDaemonManager,
  generateWindowsBatchWrapper,
  generateCrossPlatformSessionManager,
  generateHelpers,
} from '@claude-flow/cli/init';

// Generate individual scripts
const preCommit = generatePreCommitHook();
const sessionMgr = generateCrossPlatformSessionManager();
const windowsDaemon = generateWindowsDaemonManager();

// Generate all helpers based on options
const helpers = generateHelpers(options);
// { 'pre-commit': '...', 'session.js': '...', ... }
```

### Statusline Generator

```typescript
import { generateStatuslineScript, generateStatuslineHook } from '@claude-flow/cli/init';

// Generate statusline.js content
const script = generateStatuslineScript(options);

// Generate shell hook content
const hook = generateStatuslineHook(options);
```

## Preset Configurations

### DEFAULT_INIT_OPTIONS

Recommended settings for most projects:
- All components enabled (except statusline as optional)
- Core, AgentDB, GitHub, V3 skills
- All command groups
- Core, GitHub, SPARC, Swarm agents
- All 7 hook types
- Hierarchical-mesh topology
- 15 max agents
- Hybrid memory backend

### MINIMAL_INIT_OPTIONS

Lightweight configuration:
- Settings, skills, MCP, runtime only
- Core skills only
- Core agents only
- Essential hooks (PreToolUse, PostToolUse, PermissionRequest)
- Mesh topology
- 5 max agents
- In-memory backend

### FULL_INIT_OPTIONS

Everything enabled:
- All components
- All skill sets including Flow Nexus
- All command groups
- All agent categories
- All hook types
- All MCP servers

## Usage Examples

### Basic Initialization

```typescript
import { executeInit, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

const result = await executeInit({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: process.cwd(),
});
```

### Custom Configuration

```typescript
import { executeInit, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

const result = await executeInit({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: '/my/project',
  sourceBaseDir: '/path/to/claude-flow', // Source for skills/commands/agents
  force: true,
  components: {
    ...DEFAULT_INIT_OPTIONS.components,
    statusline: true,
  },
  skills: {
    core: true,
    agentdb: true,
    github: false, // Skip GitHub skills
    flowNexus: false,
    v3: true,
    all: false,
  },
  runtime: {
    topology: 'adaptive',
    maxAgents: 20,
    memoryBackend: 'agentdb',
    enableHNSW: true,
    enableNeural: true,
  },
});
```

### Platform-Aware Initialization

```typescript
import { executeInit, detectPlatform, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

const platform = detectPlatform();

const result = await executeInit({
  ...DEFAULT_INIT_OPTIONS,
  targetDir: process.cwd(),
  // Platform-specific adjustments
  components: {
    ...DEFAULT_INIT_OPTIONS.components,
    // Enable statusline on Unix-like systems
    statusline: platform.os !== 'windows',
  },
});

console.log(`Initialized for ${platform.os} (${platform.shell})`);
```

### Selective Component Installation

```typescript
import { executeInit, MINIMAL_INIT_OPTIONS } from '@claude-flow/cli/init';

// Install only skills
const skillsOnly = await executeInit({
  ...MINIMAL_INIT_OPTIONS,
  targetDir: process.cwd(),
  components: {
    settings: false,
    skills: true,
    commands: false,
    agents: false,
    helpers: false,
    statusline: false,
    mcp: false,
    runtime: false,
  },
  skills: {
    core: true,
    agentdb: true,
    github: true,
    flowNexus: false,
    v3: true,
    all: false,
  },
});
```

## Error Handling

```typescript
import { executeInit, DEFAULT_INIT_OPTIONS } from '@claude-flow/cli/init';

try {
  const result = await executeInit({
    ...DEFAULT_INIT_OPTIONS,
    targetDir: '/path/to/project',
  });

  if (!result.success) {
    console.error('Initialization failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Log skipped files
  if (result.skipped.length > 0) {
    console.log('Skipped (already exist):');
    for (const file of result.skipped) {
      console.log(`  - ${file}`);
    }
  }

  console.log(`Success! Created ${result.created.files.length} files`);
} catch (error) {
  console.error('Unexpected error:', error);
  process.exit(1);
}
```
