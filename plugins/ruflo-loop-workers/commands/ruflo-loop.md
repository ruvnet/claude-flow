---
name: ruflo-loop
description: Start a Ruflo background worker (audit, optimize, testgaps, etc.) on a recurring schedule
---
$ARGUMENTS
Start a cache-aware /loop worker. Parse the worker name from $ARGUMENTS.

Available workers (12 total):
- **audit** (critical) -- security scanning
- **optimize** (high) -- performance optimization
- **ultralearn** (normal) -- deep knowledge acquisition
- **predict** (normal) -- predictive preloading
- **map** (normal) -- codebase mapping
- **deepdive** (normal) -- deep code analysis
- **document** (normal) -- auto-documentation
- **refactor** (normal) -- refactoring suggestions
- **benchmark** (normal) -- performance benchmarking
- **testgaps** (normal) -- test coverage analysis
- **consolidate** (low) -- memory consolidation
- **preload** (low) -- resource preloading

Run the worker via `npx @claude-flow/cli@latest hooks worker dispatch --trigger WORKER_NAME`, then use `ScheduleWakeup` (`delaySeconds` 270 on the 5-minute cache TTL, 1200-1800 on the 1-hour TTL; `reason`; and `prompt` set to this same /loop input) to schedule the next iteration.
