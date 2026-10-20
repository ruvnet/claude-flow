# RuFlo AI Team annotation review

All hints are explicit booleans. The server tests compare the live tool list with this classification.

| Tools | readOnly | destructive | idempotent | openWorld | Justification |
|---|---:|---:|---:|---:|---|
| `team_templates_list`, `team_list`, `team_get`, `task_list`, `memory_search`, `evidence_export` | true | false | true | false | Reads tenant-local or first-party state and makes no change. Repeating returns the same logical view. No external entity is contacted. |
| `team_create`, `run_create`, `task_create` | false | false | false | false | Creates a new tenant-local record on every successful call. It does not delete data or contact an external system. |
| `team_update`, `task_update`, `memory_remember` | false | false | true | false | Upserts bounded tenant-local state to the requested value. Repeating the same arguments has the same logical result. No external entity is contacted. |

No v0.1 tool is destructive or open-world. External effects, public sharing, deletion, arbitrary execution, and credentials are deliberately absent until their approval and policy contracts are implemented.
