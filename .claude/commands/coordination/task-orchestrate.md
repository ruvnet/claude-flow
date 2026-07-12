# task-orchestrate

> **Renamed in v3.25:** the `task orchestrate` subcommand no longer exists.
> Task orchestration is now driven by `swarm start`. The `task` command
> covers lifecycle only (`create`, `list`, `status`, `cancel`, `assign`,
> `retry`). Use the commands below.

Orchestrate complex objectives across the swarm.

## Usage
```bash
npx claude-flow swarm start [options]
```

## Options
- `--objective <description>` - What the swarm should accomplish
- `--strategy <type>` - Orchestration strategy (e.g. `parallel`)
- `--parallel` - Run agents concurrently
- `--monitor` - Stream progress while the swarm runs

## Examples
```bash
# Orchestrate a development objective
npx claude-flow swarm start --objective "Implement user authentication"

# Parallel strategy with live monitoring
npx claude-flow swarm start --objective "Refactor codebase" --strategy parallel --monitor
```

> Initialize the swarm topology first with `swarm init` (see
> [swarm-init](./swarm-init.md)).
