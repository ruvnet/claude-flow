# Non-Interactive Claude Flow Commands

## Working Commands (alpha.83)

These commands work correctly with `--non-interactive` flag in claude-flow alpha.83:

### 1. Swarm Command
```bash
# Basic swarm with non-interactive mode
npx claude-flow@v2.0.0-alpha.83 swarm "Your task description" --non-interactive

# With additional options
npx claude-flow@v2.0.0-alpha.83 swarm "Build a REST API" \
  --strategy development \
  --mode distributed \
  --max-agents 8 \
  --non-interactive

# With executor (for built-in execution without Claude CLI)
npx claude-flow@v2.0.0-alpha.83 swarm "Analyze code patterns" \
  --executor \
  --non-interactive
```

### 2. Hive-Mind Command
```bash
# Basic hive-mind spawn
npx claude-flow@v2.0.0-alpha.83 hive-mind spawn "Design architecture" \
  --count 4 \
  --coordination majority \
  --non-interactive

# With different coordination modes
npx claude-flow@v2.0.0-alpha.83 hive-mind spawn "Solve complex problem" \
  --count 8 \
  --coordination weighted \
  --non-interactive

# Byzantine fault tolerant mode
npx claude-flow@v2.0.0-alpha.83 hive-mind spawn "Critical system design" \
  --count 10 \
  --coordination byzantine \
  --non-interactive
```

### 3. SPARC Commands
```bash
# SPARC modes (these work without --non-interactive as they're already non-interactive)
npx claude-flow@v2.0.0-alpha.83 sparc spec "Define API requirements"
npx claude-flow@v2.0.0-alpha.83 sparc architect "Design microservices system"
npx claude-flow@v2.0.0-alpha.83 sparc tdd "Create authentication module"
npx claude-flow@v2.0.0-alpha.83 sparc integration "Integrate payment gateway"
npx claude-flow@v2.0.0-alpha.83 sparc refactor "Optimize database queries"

# With output format
npx claude-flow@v2.0.0-alpha.83 sparc tdd "Build calculator" --format markdown
npx claude-flow@v2.0.0-alpha.83 sparc architect "Design system" --format json

# With file output
npx claude-flow@v2.0.0-alpha.83 sparc tdd "Create parser" --file ./output/parser.md
```

## Benchmark Usage

### Using Real Execution with Benchmark Tool
```bash
# Swarm benchmark
./benchmark/bin/swarm-benchmark real swarm "Your task" --strategy auto --mode centralized

# Hive-mind benchmark  
./benchmark/bin/swarm-benchmark real hive-mind "Your task" --max-workers 8 --consensus majority

# SPARC benchmark
./benchmark/bin/swarm-benchmark real sparc tdd "Your task"
```

## Important Notes

1. **Version Requirement**: Use `claude-flow@v2.0.0-alpha.83` for working non-interactive mode
2. **Current Issue**: Versions after alpha.83 (including alpha.87) have a regression where --non-interactive flag is not properly handled
3. **SPARC Commands**: Work without Claude CLI and don't require --non-interactive flag
4. **Swarm/Hive-mind**: Require Claude CLI unless using --executor flag

## Troubleshooting

### If Non-Interactive Mode Fails
1. Check claude-flow version: `npx claude-flow --version`
2. Use alpha.83: `npx claude-flow@v2.0.0-alpha.83`
3. For SPARC modes, omit --non-interactive flag as they're already non-interactive
4. Use --executor flag for swarm/hive-mind to avoid Claude CLI dependency

### Exit Codes
- 0: Success
- -9: Timeout (SIGKILL)
- 1: General error
- 127: Command not found (usually Claude CLI missing)

## Examples for Testing

```bash
# Test swarm non-interactive
npx claude-flow@v2.0.0-alpha.83 swarm "Hello world test" --non-interactive

# Test hive-mind non-interactive
npx claude-flow@v2.0.0-alpha.83 hive-mind spawn "Simple task" --count 2 --non-interactive

# Test SPARC (already non-interactive)
npx claude-flow@v2.0.0-alpha.83 sparc tdd "Simple function"
```