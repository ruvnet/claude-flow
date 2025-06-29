# Claude-Flow Configuration System

## Overview

The Claude-Flow configuration system provides a comprehensive, type-safe configuration management solution with environment-specific configurations, hot reloading, validation, and migration support.

## Features

- **Type-safe configuration** with full TypeScript support
- **Environment-specific configurations** (development, staging, production)
- **Hot configuration reloading** with file watching
- **Configuration validation** with detailed error reporting
- **Migration system** for seamless version upgrades
- **Flexible configuration sources** (JSON, JS, environment variables)
- **Configuration presets** for common scenarios

## Quick Start

### 1. Basic Usage

```typescript
import { initializeConfig, getConfig } from '@/config';

// Initialize configuration
const config = await initializeConfig();

// Access configuration values
const maxAgents = config.performance.maxConcurrentAgents;
const daemonEnabled = config.daemon.enabled;
```

### 2. Using ConfigManager

```typescript
import { configManager } from '@/config';

// Load configuration
await configManager.loadConfig();

// Get specific values
const ipcTimeout = configManager.get<number>('daemon.ipc.timeout');

// Set configuration values
await configManager.set('performance.maxConcurrentAgents', 20);

// Watch for changes
configManager.watchConfig((event) => {
  console.log('Config changed:', event.changedKeys);
});
```

### 3. Environment-Specific Configuration

Configuration is automatically selected based on `NODE_ENV`:

```bash
# Development (default)
NODE_ENV=development ./claude-flow

# Staging
NODE_ENV=staging ./claude-flow

# Production
NODE_ENV=production ./claude-flow
```

## Configuration Structure

### Daemon Configuration
- **enabled**: Enable/disable daemon mode
- **autoStart**: Auto-start daemon on system boot
- **pidFile**: Process ID file location
- **logFile**: Daemon log file location
- **ipc**: Inter-process communication settings
- **healthCheck**: Health monitoring settings

### Registry Configuration
- **backend**: Storage backend (memory, sqlite, file)
- **path**: Database/file path
- **backup**: Backup settings
- **cleanup**: Cleanup policies
- **persistence**: Persistence settings

### Security Configuration
- **authentication**: Auth method (none, token, jwt, oauth)
- **authorization**: Authorization settings
- **encryption**: Data encryption settings
- **audit**: Audit logging settings

### Monitoring Configuration
- **metrics**: Metrics collection settings
- **logging**: Logging configuration
- **tracing**: Distributed tracing settings
- **alerting**: Alert configuration

### Performance Configuration
- **maxConcurrentAgents**: Maximum parallel agents
- **agentTimeoutMs**: Agent execution timeout
- **memoryLimit**: Memory usage limit
- **cpuLimit**: CPU usage percentage limit
- **cache**: Caching configuration
- **pooling**: Connection pooling settings

## Integration Guide

### 1. Module Integration

```typescript
import { ConfigIntegration } from '@/config/loader';

class MyModule {
  private config = ConfigIntegration.getInstance();
  
  async initialize() {
    await this.config.initialize('MyModule');
    
    const daemonConfig = this.config.getDaemonConfig();
    const perfConfig = this.config.getPerformanceConfig();
    
    // Use configuration values
    this.maxWorkers = perfConfig.maxConcurrentAgents;
  }
}
```

### 2. Custom Configuration Files

```typescript
import { loadConfiguration } from '@/config/loader';

const config = await loadConfiguration({
  configPath: './my-custom-config.json',
  environment: 'production',
  enableHotReload: true
});
```

### 3. Configuration Presets

```typescript
import { ConfigPresets, configManager } from '@/config';

// Apply high-performance preset
const highPerfConfig = configManager.mergeConfigs(
  await configManager.loadConfig(),
  ConfigPresets.highPerformance()
);

await configManager.saveConfig(highPerfConfig);
```

## Configuration Files

### Search Order

1. `./claude-flow.config.json`
2. `./claude-flow.config.js`
3. `./.claudeflow/config.json`
4. `~/.claudeflow/config.json`
5. `/etc/claudeflow/config.json`

### Example Configuration

```json
{
  "version": "1.0.0",
  "daemon": {
    "enabled": true,
    "autoStart": false,
    "pidFile": "/var/run/claudeflow.pid",
    "logFile": "/var/log/claudeflow.log",
    "ipc": {
      "transport": "unix",
      "path": "/tmp/claudeflow.sock",
      "timeout": 5000
    }
  },
  "registry": {
    "backend": "sqlite",
    "path": "./claudeflow.db",
    "backup": {
      "enabled": true,
      "interval": 3600000,
      "retention": 7
    }
  }
}
```

## Migration System

### Creating Migrations

```typescript
import { createMigration } from '@/config';

const migration = createMigration(
  '1.0.0',  // from version
  '1.1.0',  // to version
  'Add new feature configuration',
  (config) => {
    config.newFeature = { enabled: true };
    return config;
  }
);
```

### Automatic Migration

Configurations are automatically migrated when loading:

```typescript
// config.json has version "0.9.0"
const config = await configManager.loadConfig();
// Config is automatically migrated to current version
```

## Hot Reloading

### Enable Hot Reloading

```typescript
configManager.watchConfig((event) => {
  console.log('Configuration changed:', event.changedKeys);
  
  // React to specific changes
  if (event.changedKeys.includes('performance.maxConcurrentAgents')) {
    updateWorkerPool(event.current.performance.maxConcurrentAgents);
  }
});
```

### Disable for Production

Hot reloading is automatically disabled in production but can be controlled:

```typescript
const config = await loadConfiguration({
  enableHotReload: false  // Explicitly disable
});
```

## Validation

### Built-in Validation

All configurations are validated on load and save:

```typescript
try {
  await configManager.saveConfig(myConfig);
} catch (error) {
  console.error('Invalid configuration:', error.message);
}
```

### Custom Validation

```typescript
import { validateConfig } from '@/config';

const result = validateConfig(myConfig);
if (!result.valid) {
  console.error('Errors:', result.errors);
  console.warn('Warnings:', result.warnings);
}
```

## Best Practices

1. **Use environment-specific configs** instead of runtime conditionals
2. **Enable hot reloading** in development for faster iteration
3. **Validate configurations** before deployment
4. **Use configuration presets** for common scenarios
5. **Version your configurations** for proper migration support
6. **Backup production configurations** regularly
7. **Use type-safe access** with TypeScript
8. **Monitor configuration changes** in production

## Troubleshooting

### Configuration Not Loading

1. Check file permissions
2. Verify JSON syntax
3. Check environment variable `NODE_ENV`
4. Review validation errors

### Hot Reload Not Working

1. Ensure not in production mode
2. Check file watcher permissions
3. Verify configuration file path

### Migration Failures

1. Check version numbers
2. Review migration logs
3. Backup before migration
4. Test migrations in staging

## Advanced Usage

### Dynamic Configuration

```typescript
// Load different configs based on conditions
const config = await loadConfiguration({
  configPath: process.env.CI ? './ci-config.json' : undefined,
  environment: process.env.DEPLOY_ENV || 'development'
});
```

### Configuration Composition

```typescript
const baseConfig = await configManager.loadConfig();
const overrides = { performance: { maxConcurrentAgents: 50 } };
const finalConfig = configManager.mergeConfigs(baseConfig, overrides);
```

### Secure Configuration

```typescript
// Use environment variables for secrets
const config = {
  security: {
    authentication: {
      method: 'jwt',
      jwtSecret: process.env.JWT_SECRET
    }
  }
};
```