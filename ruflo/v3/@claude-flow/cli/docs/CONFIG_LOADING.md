# CLI Configuration Loading

## Overview

The CLI module now supports loading configuration from multiple sources with proper validation and type conversion.

## Implementation

### Files Added/Modified

1. **`src/config-adapter.ts`** (NEW)
   - Converts between `SystemConfig` (from `@claude-flow/shared`) and `V3Config` (CLI-specific format)
   - Provides bidirectional conversion functions:
     - `systemConfigToV3Config()` - Convert SystemConfig to V3Config
     - `v3ConfigToSystemConfig()` - Convert V3Config to SystemConfig

2. **`src/index.ts`** (MODIFIED)
   - Implemented `loadConfig()` method (previously TODO)
   - Loads configuration from file or default search paths
   - Handles errors gracefully (config loading is optional)
   - Displays warnings when config validation fails

3. **`__tests__/config-adapter.test.ts`** (NEW)
   - Unit tests for config conversion functions
   - Tests minimal configs, missing fields, and round-trip conversion
   - Verifies different coordination strategies

4. **`__tests__/config-loading.test.ts`** (NEW)
   - Integration tests for config loading
   - Tests file loading, missing files, and invalid JSON

## Configuration Sources

The CLI loads configuration in the following priority order:

1. **Explicit file path** - When `--config` flag is provided
2. **Auto-discovery** - Searches for config files in:
   - Current working directory
   - Parent directory
   - `~/.claude-flow/`

### Supported Config Files

- `claude-flow.config.json`
- `claude-flow.config.js`
- `claude-flow.json`
- `.claude-flow.json`

## Environment Variables

Configuration can also be overridden via environment variables:

- `CLAUDE_FLOW_MAX_AGENTS` - Maximum concurrent agents
- `CLAUDE_FLOW_DATA_DIR` - Data directory path
- `CLAUDE_FLOW_MEMORY_TYPE` - Memory backend type
- `CLAUDE_FLOW_MCP_TRANSPORT` - MCP transport type
- `CLAUDE_FLOW_MCP_PORT` - MCP server port
- `CLAUDE_FLOW_SWARM_TOPOLOGY` - Swarm topology type

## Configuration Schema

### V3Config (CLI Format)

```typescript
interface V3Config {
  version: string;
  projectRoot: string;

  agents: {
    defaultType: string;
    autoSpawn: boolean;
    maxConcurrent: number;
    timeout: number;
    providers: ProviderConfig[];
  };

  swarm: {
    topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid';
    maxAgents: number;
    autoScale: boolean;
    coordinationStrategy: 'consensus' | 'leader' | 'distributed';
    healthCheckInterval: number;
  };

  memory: {
    backend: 'agentdb' | 'sqlite' | 'memory' | 'hybrid';
    persistPath: string;
    cacheSize: number;
    enableHNSW: boolean;
    vectorDimension: number;
  };

  mcp: {
    serverHost: string;
    serverPort: number;
    autoStart: boolean;
    transportType: 'stdio' | 'http' | 'websocket';
    tools: string[];
  };

  cli: {
    colorOutput: boolean;
    interactive: boolean;
    verbosity: 'quiet' | 'normal' | 'verbose' | 'debug';
    outputFormat: 'text' | 'json' | 'table';
    progressStyle: 'bar' | 'spinner' | 'dots' | 'none';
  };

  hooks: {
    enabled: boolean;
    autoExecute: boolean;
    hooks: HookDefinition[];
  };
}
```

## Usage Examples

### Command Line

```bash
# Use default config search paths
claude-flow agent spawn -t coder

# Use specific config file
claude-flow agent spawn -t coder --config ./custom-config.json

# Override with environment variables
CLAUDE_FLOW_MAX_AGENTS=20 claude-flow swarm init
```

### Example Config File

```json
{
  "orchestrator": {
    "lifecycle": {
      "autoStart": true,
      "maxConcurrentAgents": 15,
      "shutdownTimeoutMs": 30000,
      "cleanupOrphanedAgents": true
    },
    "session": {
      "dataDir": "./data",
      "persistState": true,
      "stateFile": "session.json"
    },
    "monitoring": {
      "enabled": true,
      "metricsIntervalMs": 5000,
      "healthCheckIntervalMs": 10000
    }
  },
  "swarm": {
    "topology": "hierarchical-mesh",
    "maxAgents": 15
  },
  "memory": {
    "type": "hybrid",
    "agentdb": {
      "dimensions": 1536,
      "indexType": "hnsw"
    }
  },
  "mcp": {
    "enabled": true,
    "transport": {
      "type": "stdio",
      "host": "localhost",
      "port": 3000
    },
    "enabledTools": ["agent/*", "swarm/*", "memory/*"]
  },
  "logging": {
    "level": "info",
    "pretty": true,
    "destination": "console",
    "format": "text"
  },
  "hooks": {
    "enabled": true,
    "autoExecute": false,
    "definitions": []
  }
}
```

## Error Handling

The config loading implementation handles errors gracefully:

1. **File not found** - Falls back to default configuration
2. **Invalid JSON** - Logs warning and uses defaults
3. **Validation errors** - Displays warnings for invalid fields
4. **Missing required fields** - Merges with default values

Debug mode (`DEBUG=1`) provides additional error details.

## Testing

All tests pass successfully:

```bash
# Run config adapter unit tests
npx vitest run __tests__/config-adapter.test.ts

# Run config loading integration tests
npx vitest run __tests__/config-loading.test.ts
```

### Test Coverage

- ✅ SystemConfig to V3Config conversion
- ✅ V3Config to SystemConfig conversion
- ✅ Round-trip conversion preserves values
- ✅ Handles missing optional fields
- ✅ Different coordination strategies
- ✅ File loading
- ✅ Missing file handling
- ✅ Invalid JSON handling

## Architecture Decisions

1. **Adapter Pattern** - Separates SystemConfig (shared) from V3Config (CLI-specific)
2. **Optional Loading** - Config files are optional, failures don't crash CLI
3. **Validation** - Uses existing Zod schemas from `@claude-flow/shared`
4. **Merge Strategy** - Merges loaded config with defaults
5. **Environment Priority** - Environment variables override file config

## Future Enhancements

- [ ] TypeScript config support (`.ts` files)
- [ ] Config validation command (`claude-flow config validate`)
- [ ] Config migration tool (v2 → v3)
- [ ] Interactive config setup wizard
- [ ] Schema documentation generation
