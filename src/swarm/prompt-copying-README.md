# Robust Prompt Copying System

A comprehensive, enterprise-grade prompt copying mechanism designed for Claude-Flow projects. This system provides efficient, reliable, and safe copying of prompt files with advanced features like parallel processing, conflict resolution, verification, and rollback capabilities.

## Features

### Core Functionality
- ✅ **Parallel Processing**: Multi-threaded copying for faster performance
- ✅ **Conflict Resolution**: Smart handling of file conflicts (skip, overwrite, backup, merge)
- ✅ **File Verification**: Hash-based integrity checking
- ✅ **Incremental Updates**: Only copy changed files
- ✅ **Automatic Backups**: Create backups before overwriting
- ✅ **Rollback Mechanism**: Restore from backups on failure
- ✅ **Progress Reporting**: Real-time progress updates
- ✅ **Dry Run Mode**: Preview operations without making changes

### Advanced Features
- 🔍 **Pattern Matching**: Flexible include/exclude patterns
- 📁 **Directory Discovery**: Automatic detection of prompt directories  
- ✅ **File Validation**: Validate prompt files for common issues
- 🔧 **Configuration Profiles**: Pre-configured settings for different use cases
- 📊 **Comprehensive Reporting**: Detailed operation reports and statistics
- 🔄 **Bidirectional Sync**: Two-way synchronization support
- ⚡ **Worker Threads**: Enhanced performance with worker thread pools

## Quick Start

### Basic Usage

```typescript
import { copyPrompts } from './prompt-copier';

const result = await copyPrompts({
  source: './.roo',
  destination: './project-prompts'
});

console.log(`Copied ${result.copiedFiles} files successfully`);
```

### Enhanced Parallel Copying

```typescript
import { copyPromptsEnhanced } from './prompt-copier-enhanced';

const result = await copyPromptsEnhanced({
  source: './.roo', 
  destination: './project-prompts',
  parallel: true,
  maxWorkers: 8,
  verify: true
});
```

### Using the Manager

```typescript
import { PromptManager } from './prompt-manager';

const manager = new PromptManager({
  defaultProfile: 'sparc',
  autoDiscovery: true
});

await manager.initialize();
const result = await manager.copyPrompts();
```

## CLI Usage

### Installation
```bash
npm install -g @claude-flow/prompt-copier
```

### Basic Commands

```bash
# Copy prompts with default settings
npx prompt-copier copy --source .roo --destination ./prompts

# Use a configuration profile
npx prompt-copier copy --profile sparc

# Enhanced copying with workers
npx prompt-copier copy --enhanced --workers 8

# Dry run to preview changes
npx prompt-copier copy --dry-run

# Discover prompt directories
npx prompt-copier discover

# Validate prompt files
npx prompt-copier validate ./prompts --recursive

# Initialize configuration
npx prompt-copier config --init

# Show current configuration  
npx prompt-copier config --show

# Rollback from backup
npx prompt-copier rollback ./prompts/.prompt-backups/manifest-123456.json
```

## Configuration

### Configuration File (.prompt-config.json)

```json
{
  "sourceDirectories": [
    ".roo",
    ".claude/commands", 
    "src/templates"
  ],
  "destinationDirectory": "./project-prompts",
  "defaultOptions": {
    "backup": true,
    "verify": true,
    "parallel": true,
    "maxWorkers": 4,
    "conflictResolution": "backup",
    "includePatterns": ["*.md", "*.txt", "*.prompt"],
    "excludePatterns": ["**/node_modules/**", "**/.git/**"]
  },
  "profiles": {
    "sparc": {
      "includePatterns": ["*.md", "rules.md", "sparc-*.md"],
      "excludePatterns": ["**/README.md"]
    },
    "safe": {
      "backup": true,
      "verify": true,
      "conflictResolution": "skip",
      "parallel": false
    },
    "fast": {
      "backup": false,
      "verify": false,
      "parallel": true,
      "maxWorkers": 8,
      "conflictResolution": "overwrite"
    }
  }
}
```

### Built-in Profiles

#### `sparc` Profile
Optimized for SPARC methodology prompts:
- Includes: `*.md`, `rules.md`, `sparc-*.md`
- Excludes: README and changelog files
- Backup enabled, merge conflicts

#### `templates` Profile  
For template files:
- Includes: `*.template`, `*.tmpl`, `*.hbs`, `*.mustache`
- Merge conflict resolution
- Template variable preservation

#### `safe` Profile
Conservative copying:
- Backup enabled
- Verification enabled
- Skip conflicts (no overwrites)
- Sequential processing

#### `fast` Profile
Performance optimized:
- No backups
- No verification
- Overwrite conflicts
- Maximum parallelization

## API Reference

### PromptCopier

The main copying class with comprehensive options:

```typescript
interface CopyOptions {
  source: string;                    // Source directory
  destination: string;               // Destination directory
  backup?: boolean;                  // Create backups (default: true)
  overwrite?: boolean;               // Overwrite existing files
  verify?: boolean;                  // Verify copied files (default: true)
  preservePermissions?: boolean;     // Preserve file permissions
  excludePatterns?: string[];        // Exclude patterns
  includePatterns?: string[];        // Include patterns  
  parallel?: boolean;                // Enable parallel processing
  maxWorkers?: number;               // Worker thread count
  dryRun?: boolean;                  // Preview mode
  conflictResolution?: 'skip' | 'overwrite' | 'backup' | 'merge';
  progressCallback?: (progress: CopyProgress) => void;
}
```

### Enhanced Copying

For large-scale operations with worker threads:

```typescript
import { EnhancedPromptCopier } from './prompt-copier-enhanced';

const copier = new EnhancedPromptCopier({
  source: './source',
  destination: './dest',
  parallel: true,
  maxWorkers: 8
});

const result = await copier.copy();
```

### Validation

Validate prompt files for common issues:

```typescript
import { PromptValidator } from './prompt-utils';

const result = await PromptValidator.validatePromptFile('./prompt.md');

if (!result.valid) {
  console.log('Issues found:', result.issues);
}

if (result.metadata) {
  console.log('Metadata:', result.metadata);
}
```

### Configuration Management

```typescript
import { PromptConfigManager } from './prompt-utils';

const manager = new PromptConfigManager('./my-config.json');
await manager.loadConfig();

// Get profile settings
const sparcSettings = manager.getProfile('sparc');

// Update configuration
await manager.saveConfig({
  destinationDirectory: './new-destination'
});
```

## Integration Examples

### With SPARC Workflow

```typescript
// Copy SPARC prompts before starting development
const manager = new PromptManager({ defaultProfile: 'sparc' });
await manager.initialize();

const result = await manager.copyPrompts({
  verify: true,
  backup: true
});

if (result.success) {
  console.log('SPARC prompts ready for development');
}
```

### With Build Process

```typescript
// package.json
{
  "scripts": {
    "setup": "prompt-copier copy --profile sparc",
    "build": "npm run setup && npm run compile",
    "deploy": "prompt-copier sync --bidirectional"
  }
}
```

### With Git Hooks

```bash
#!/bin/sh
# pre-commit hook
npx prompt-copier validate ./prompts --recursive
if [ $? -ne 0 ]; then
  echo "Prompt validation failed"
  exit 1
fi
```

## Advanced Usage

### Custom Worker Processing

```typescript
import { Worker } from 'worker_threads';

const copier = new EnhancedPromptCopier({
  source: './source',
  destination: './dest',
  parallel: true,
  maxWorkers: 16 // Scale based on CPU cores
});

// Monitor progress
copier.on('progress', (progress) => {
  console.log(`Progress: ${progress.percentage}%`);
});

copier.on('copyComplete', (result) => {
  console.log('Copy completed:', result);
});
```

### Selective Copying

```typescript
// Copy only specific prompt types
await copyPrompts({
  source: './.roo',
  destination: './prompts',
  includePatterns: ['**/rules-*.md', '**/sparc-*.md'],
  excludePatterns: ['**/debug/**', '**/temp/**']
});
```

### Merge Strategies

```typescript
// Custom merge function
const result = await copyPrompts({
  source: './source',
  destination: './dest',
  conflictResolution: 'merge',
  // Files are merged with separator comments
});
```

### Backup and Recovery

```typescript
// Create timestamped backups
const result = await copyPrompts({
  source: './source',
  destination: './dest',
  backup: true,
  conflictResolution: 'backup'
});

// Restore from backup if needed
if (!result.success && result.backupLocation) {
  const copier = new PromptCopier({ source: '', destination: '' });
  await copier.restoreFromBackup(result.backupLocation);
}
```

## Performance Considerations

### Parallel Processing
- Default workers: 4 (good for most systems)
- High-end systems: 8-16 workers
- Network storage: Reduce workers to 2-4
- SSD storage: Can handle more workers

### Memory Usage
- Large files: Enable streaming mode
- Many files: Use chunked processing
- Worker threads: Monitor memory per worker

### Network Considerations
- Remote sources: Reduce parallelization
- Slow connections: Disable verification temporarily
- Bandwidth limits: Use sequential processing

## Error Handling

### Common Errors and Solutions

**Permission Denied**
```typescript
// Solution: Check file permissions
try {
  await copyPrompts(options);
} catch (error) {
  if (error.code === 'EACCES') {
    console.log('Check file permissions');
  }
}
```

**Disk Space**
```typescript
// Solution: Check available space
import { promises as fs } from 'fs';

const stats = await fs.statfs(destinationPath);
if (stats.bavail * stats.bsize < requiredSpace) {
  throw new Error('Insufficient disk space');
}
```

**Network Timeouts**
```typescript
// Solution: Reduce parallelization
const options = {
  ...defaultOptions,
  parallel: false, // or reduce maxWorkers
  timeout: 30000   // increase timeout
};
```

## Testing

### Unit Tests

```bash
npm test -- --testPathPattern=prompt-copier
```

### Integration Tests

```bash
npm run test:integration
```

### Performance Tests

```bash
npm run test:performance
```

## Troubleshooting

### Debug Mode
```bash
DEBUG=prompt-copier* npx prompt-copier copy --source ./source --destination ./dest
```

### Verbose Logging
```typescript
import { logger } from '../logger';
logger.level = 'debug';

const result = await copyPrompts(options);
```

### Common Issues

1. **Files not copying**: Check include/exclude patterns
2. **Slow performance**: Increase worker count or disable verification
3. **Permission errors**: Check file/directory permissions  
4. **Memory issues**: Reduce worker count or enable streaming
5. **Verification failures**: Check disk space and file integrity

## Contributing

### Development Setup

```bash
git clone <repository>
cd prompt-copying-system
npm install
npm run build
npm test
```

### Running Examples

```bash
npm run example:basic
npm run example:enhanced  
npm run example:manager
```

### Adding New Features

1. Add feature to appropriate module
2. Add comprehensive tests
3. Update documentation
4. Add CLI support if applicable
5. Update examples

## License

MIT License - see LICENSE file for details.

## Changelog

### v1.0.0
- Initial release with core copying functionality
- Parallel processing with worker threads
- Configuration profiles and CLI interface
- Comprehensive testing and documentation