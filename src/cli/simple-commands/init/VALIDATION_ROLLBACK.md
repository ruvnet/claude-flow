# Validation and Rollback Systems

This document describes the comprehensive validation and rollback mechanisms implemented for SPARC initialization to ensure safe and reliable setup.

## Overview

The validation and rollback systems provide multiple layers of safety and reliability:

1. **Pre-initialization validation** - Checks system readiness before any changes
2. **Automatic backup creation** - Creates restore points before initialization
3. **Atomic operations** - Ensures all-or-nothing initialization
4. **Post-initialization verification** - Validates successful completion
5. **Rollback mechanisms** - Allows reverting to previous states
6. **Auto-recovery procedures** - Handles common failure scenarios
7. **Health monitoring** - Continuous system health assessment

## Components

### ValidationSystem

The `ValidationSystem` orchestrates all validation checks:

- **PreInitValidator**: Checks permissions, disk space, conflicts, dependencies
- **PostInitValidator**: Verifies file integrity, completeness, structure
- **ConfigValidator**: Validates configuration files and syntax
- **ModeValidator**: Tests SPARC mode functionality
- **HealthChecker**: Monitors system health and resources

### RollbackSystem

The `RollbackSystem` provides comprehensive rollback capabilities:

- **BackupManager**: Creates and manages backups
- **RollbackExecutor**: Executes rollback operations
- **StateTracker**: Tracks initialization state and checkpoints
- **RecoveryManager**: Handles automated recovery procedures

## Usage

### Enhanced Initialization

Use the enhanced initialization for maximum safety:

```bash
# Safest initialization with full validation and rollback
claude-flow init --enhanced --sparc

# Enhanced with specific options
claude-flow init --safe --sparc --force

# Validation only (no initialization)
claude-flow init --validate-only

# Skip specific validations if needed
claude-flow init --enhanced --skip-pre-validation --skip-backup
```

### Validation Commands

Run validation checks independently:

```bash
# Full validation suite
claude-flow init --validate

# Skip specific validation phases
claude-flow init --validate --skip-pre-init --skip-config --skip-mode-test

# Pre-initialization check only
claude-flow init --validate --pre-init-only
```

### Rollback Commands

Rollback previous initialization:

```bash
# Full system rollback
claude-flow init --rollback --full

# Partial rollback for specific phase
claude-flow init --rollback --partial --phase sparc-init

# Interactive rollback (shows available points)
claude-flow init --rollback

# List available backups and checkpoints
claude-flow init --list-backups
```

## Validation Phases

### Phase 1: Pre-initialization Validation

**Purpose**: Ensure system is ready for initialization

**Checks**:
- File system permissions (read/write access)
- Available disk space (minimum 100MB required)
- Existing file conflicts (with --force handling)
- Required dependencies (node, npm, npx, git)
- Environment variables and configuration

**Result**: Block initialization if critical issues found

### Phase 2: Backup Creation

**Purpose**: Create restore point before any changes

**Actions**:
- Backup existing critical files
- Backup directory structures
- Create backup manifest with metadata
- Store backup with timestamp and ID

**Result**: Rollback point available for recovery

### Phase 3: Atomic Initialization

**Purpose**: Perform initialization with checkpoint tracking

**Process**:
1. Begin atomic operation
2. Create checkpoints before each phase
3. Execute initialization steps
4. Track all file/directory operations
5. Commit or rollback based on success

**Phases**:
- File creation (CLAUDE.md, memory-bank.md, coordination.md)
- Directory structure creation
- Memory system setup
- Coordination system setup
- Executable creation
- SPARC initialization (if enabled)
- Claude command creation

### Phase 4: Post-initialization Validation

**Purpose**: Verify initialization completed successfully

**Checks**:
- File integrity (existence, size, readability)
- Completeness (all required files and directories)
- Structure validation (correct organization)
- Permission verification (executable files)

**Result**: Automatic rollback if validation fails

### Phase 5: Configuration Validation

**Purpose**: Validate configuration files and syntax

**Checks**:
- .roomodes JSON syntax and structure
- CLAUDE.md content and sections
- Memory configuration validity
- Coordination configuration completeness

**Result**: Warnings for configuration issues

### Phase 6: Health Checks

**Purpose**: Assess overall system health

**Checks**:
- SPARC mode availability
- Template integrity
- Configuration consistency
- System resource adequacy

**Result**: Health report with recommendations

## Rollback Mechanisms

### Full Rollback

Completely reverts system to pre-initialization state:

1. Remove all initialization artifacts
2. Restore files from backup
3. Verify rollback completion
4. Update state tracking

### Partial Rollback

Reverts specific components or phases:

- **sparc-init**: Remove SPARC-specific files and configurations
- **claude-commands**: Remove Claude Code slash commands
- **memory-setup**: Reset memory system
- **coordination-setup**: Remove coordination files
- **executable-creation**: Remove local executable

### Atomic Rollback

Automatic rollback during failed initialization:

1. Track all operations in atomic operation
2. Reverse operations in case of failure
3. Restore system to checkpoint state
4. Clean up partial changes

## Auto-Recovery

The system includes automated recovery for common failures:

### Permission Denied
- Attempt to fix directory permissions
- Verify write access restoration
- Provide manual resolution steps

### Disk Space Issues
- Clean temporary files
- Remove old backups
- Check available space after cleanup

### Missing Dependencies
- Attempt dependency installation/configuration
- Verify dependency availability
- Provide installation guidance

### Corrupted Configuration
- Regenerate configuration files
- Restore from backup if available
- Create minimal working configuration

### Partial Initialization
- Identify completed vs missing components
- Complete missing initialization steps
- Verify final system state

### SPARC Failures
- Recover .roomodes configuration
- Restore .roo directory structure
- Recreate SPARC commands

## State Tracking

The system maintains detailed state information:

### Rollback Points
- Backup ID and location
- Timestamp and type
- System state snapshot

### Checkpoints
- Phase name and timestamp
- Operation details
- Status tracking

### File Operations
- Operation type (create/modify/delete)
- File paths and metadata
- Reversible operation data

### Phase History
- Initialization progress
- Phase transitions
- Timing information

## Error Handling

### Validation Failures
- Clear error messages with context
- Suggested resolution steps
- Prevention of unsafe operations

### Initialization Failures
- Automatic rollback triggers
- Error categorization
- Recovery procedure selection

### Rollback Failures
- Emergency procedures
- Manual recovery steps
- System state analysis

## Best Practices

### For Users

1. **Use Enhanced Mode**: Always use `--enhanced` for production setups
2. **Validate First**: Run `--validate-only` before initialization
3. **Keep Backups**: Don't skip backup creation unless absolutely necessary
4. **Monitor Health**: Regular health checks with `--validate`
5. **Clean Rollbacks**: Use specific rollback phases when possible

### For Developers

1. **Atomic Operations**: Wrap complex operations in atomic blocks
2. **Checkpoint Frequently**: Create checkpoints before major operations
3. **Validate Early**: Check prerequisites before making changes
4. **Handle Errors**: Provide clear error messages and recovery steps
5. **Test Recovery**: Regularly test rollback and recovery procedures

## Testing

The system includes comprehensive test coverage:

```bash
# Run validation and rollback tests
import { runValidationTests } from './validation/test-runner.js';
const results = await runValidationTests('/path/to/project');
```

Test categories:
- Pre-initialization validation
- Post-initialization validation
- Configuration validation
- Mode functionality testing
- Health checks
- Backup system
- Rollback operations
- State tracking
- Recovery procedures
- Atomic operations

## Configuration

### Environment Variables

- `CLAUDE_FLOW_DEBUG`: Enable debug logging
- `CLAUDE_FLOW_BACKUP_DIR`: Custom backup directory
- `CLAUDE_FLOW_STATE_FILE`: Custom state file location

### System Requirements

- **Disk Space**: Minimum 100MB free space
- **Permissions**: Read/write access to project directory
- **Dependencies**: Node.js, npm, npx (git recommended)
- **Memory**: At least 100MB available RAM

### Backup Management

- **Retention**: Keeps last 5 backups by default
- **Cleanup**: Automatic cleanup of old backups
- **Storage**: Backups stored in `.claude-flow-backups/`
- **Compression**: Future enhancement for large projects

## Troubleshooting

### Common Issues

1. **Permission Denied**
   ```bash
   # Fix permissions
   chmod -R 755 .
   claude-flow init --enhanced --sparc
   ```

2. **Disk Space Low**
   ```bash
   # Clean and retry
   claude-flow init --rollback --full
   df -h  # Check space
   claude-flow init --enhanced --sparc
   ```

3. **Validation Failures**
   ```bash
   # Check what's failing
   claude-flow init --validate
   # Fix issues and retry
   claude-flow init --enhanced --sparc
   ```

4. **Partial Initialization**
   ```bash
   # Complete missing components
   claude-flow init --enhanced --sparc --force
   # Or start fresh
   claude-flow init --rollback --full
   ```

### Emergency Recovery

If all automated recovery fails:

1. **Manual Backup Restore**
   ```bash
   # Find backup
   ls .claude-flow-backups/
   # Manual restore from backup directory
   ```

2. **Clean State Reset**
   ```bash
   # Remove all artifacts manually
   rm -rf .claude .roo CLAUDE.md memory-bank.md coordination.md
   rm -rf memory/ coordination/ claude-flow
   ```

3. **Fresh Installation**
   ```bash
   # Start completely fresh
   npx claude-flow@latest init --sparc --force
   ```

## Future Enhancements

Planned improvements to the validation and rollback systems:

1. **Interactive Recovery**: GUI-based recovery interface
2. **Remote Backups**: Cloud backup storage options
3. **Incremental Backups**: Space-efficient backup strategy
4. **Parallel Validation**: Faster validation through parallelization
5. **Smart Recovery**: AI-assisted failure diagnosis and recovery
6. **Integration Testing**: Automated end-to-end testing
7. **Performance Monitoring**: Real-time performance metrics
8. **Custom Validators**: User-defined validation rules

## API Reference

### ValidationSystem

```javascript
const validator = new ValidationSystem(workingDir);

// Run validation phases
await validator.validatePreInit(options);
await validator.validatePostInit();
await validator.validateConfiguration();
await validator.testModeFunctionality();
await validator.runHealthChecks();

// Generate reports
const report = validator.generateReport(results);
```

### RollbackSystem

```javascript
const rollback = new RollbackSystem(workingDir);

// Create backups and rollback points
await rollback.createPreInitBackup();
await rollback.createCheckpoint(phase, data);

// Perform rollbacks
await rollback.performFullRollback(backupId);
await rollback.performPartialRollback(phase);

// Auto-recovery
await rollback.performAutoRecovery(failureType, context);
```

### AtomicOperation

```javascript
const atomicOp = createAtomicOperation(rollbackSystem, 'operation-name');

await atomicOp.begin();
try {
  // Perform operations
  await atomicOp.commit();
} catch (error) {
  await atomicOp.rollback();
}
```

This validation and rollback system ensures that SPARC initialization is safe, reliable, and recoverable, providing confidence for users and maintaining system integrity even in failure scenarios.