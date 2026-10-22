---
name: agntcy-status
description: Show AGNTCY/SLIM/CASA integration status — whether the optional SLIM runtime package is installed, whether a SLIM endpoint is configured, which transport is the default, and what the agntcy mod has seen this session. Use when the user asks "is AGNTCY configured?", "show SLIM/CASA status", or "is AGNTCY/IOC integration active?". Read-only; makes no network call.
allowed-tools: Read Bash
argument-hint: ""
---

Report what can be measured on this machine, and say "unknown" for anything that cannot. Never invent a healthy status.

## Steps

1. **Endpoint** — run `test -n "$RUFLO_AGNTCY_SLIM_ENDPOINT" && echo set || echo unset`. Report only set or unset; do not print the value (an endpoint can carry credentials).
2. **Runtime package** — run `npm ls @agntcy/slim-bindings 2>&1 | tail -3` from the project root. `(empty)` or `ERR! missing` means not installed (the supported default: the package is an `optionalDependency`). Do not `import()` it from the shell; resolving a package runs its code.
3. **Active transport** — local in-process transport is the default. There is no read-only transport status command: `ruflo transport` with no arguments only prints help, and `ruflo transport use slim` is a switch that contacts the configured endpoint, so do not run it just to check status. Report "local (default)" unless the user says they switched.
4. **Mod counters** — `Read` `.claude-flow/agntcy-mod/status.json` if it exists (`calls`, `blocked`, `guard`, `updatedMs`). Missing file means the mod has not run in this project yet.
5. **CASA, IOC events, identity attributes** — the CASA policy compiler ships in this plugin (`src/casa`), but runtime enforcement is not wired into the ruflo CLI (no CASA reference in `v3/@claude-flow/*/src`), and Layer 9 events and OTel attributes are design items in ADR-380 §§4-5. Report these as "compiler present, enforcement not wired in the CLI" and "not implemented"; do not report them as enabled.

## Output

One short table: endpoint (set/unset), package (installed version or absent), transport (local/slim), mod counters, CASA/IOC/identity (state from step 5). If the endpoint is set but the package is absent, say the transport falls back to local and point to ADR-380 §1 for setup.
