# Known Issues with Claude Flow Benchmark System

## Issue 1: Non-Interactive Mode Not Working in Claude Flow

### Problem
The `--non-interactive` flag is not being properly handled by claude-flow commands, particularly:
- `hive-mind spawn --non-interactive` still prompts for interactive input
- `swarm --non-interactive` may also have similar issues

### Current Status
The benchmark system correctly passes the `--non-interactive` flag in the proper command format:
```bash
./claude-flow hive-mind spawn "Task description" --count 2 --coordination majority --non-interactive
```

However, the claude-flow implementation needs to be updated to:
1. Check for the `--non-interactive` flag before calling wizard functions
2. Use default values or passed parameters instead of prompting

### Workaround
Currently, SPARC commands work correctly without requiring interactive input:
```bash
swarm-benchmark real sparc tdd "Create a function"
```

### Fix Required in Claude Flow
The following files need updates:
- `/src/cli/simple-commands/hive-mind.js` - Check for non-interactive flag in spawn function
- `/src/cli/simple-commands/swarm.js` - Similar check needed

Example fix needed:
```javascript
async function spawnSwarm(args, flags) {
  // Check for non-interactive mode FIRST
  if (flags['non-interactive'] || flags.nonInteractive) {
    // Use defaults or passed parameters without prompting
    const objective = args.join(' ').trim();
    if (!objective) {
      console.error('Objective required in non-interactive mode');
      return;
    }
    // Proceed with defaults...
  } else if (flags.wizard || subArgs.length === 0) {
    await spawnSwarmWizard();
  }
  // ...
}
```

## Issue 2: Command Timeout Handling

### Problem
Long-running benchmarks need proper timeout configuration. 

### Solution
Timeouts have been increased to:
- Swarm: Uses configured timeout (default 6 hours)
- Hive-mind: 6 hours
- SPARC: 2 hours

These can be adjusted in the benchmark configuration.

## Issue 3: Claude CLI Dependency

### Problem
Swarm and hive-mind commands require Claude CLI even with `--executor` flag.

### Current Behavior
Commands will execute but may fail if Claude CLI is not properly configured.

### Workaround
Use SPARC commands for benchmarking without Claude CLI dependency.