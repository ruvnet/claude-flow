---
name: ruvllm
description: RuVLLM status -- ruvllm-wasm availability, native backend and graph database state
---

Show RuVLLM status:

1. Call `mcp__plugin_ruflo-core_ruflo__ruvllm_status` to get ruvllm-wasm availability plus the native ruvllm backend and graph database status (it returns `wasm`, `native` and `graph` sections; it does not list providers or adapters)
2. Present: whether WASM loaded, native backend state (coordinator, trajectories, training backend) and graph backend. Say which fields were missing instead of guessing
