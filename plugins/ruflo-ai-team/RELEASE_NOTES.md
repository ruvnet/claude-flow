# 0.1.6 — Explicit CORS allowlist, documented public discovery (#3556)

- Replaced `access-control-allow-origin: *` with an explicit allowlist: `https://chatgpt.com`, `https://chat.openai.com` and `https://claude.ai` by default, or `ALLOWED_ORIGINS` to replace it. Only an allowlisted request origin is echoed, with `Vary: Origin`; any other origin gets no ACAO header, including on `401` responses.
- Kept MCP discovery (`initialize`, `ping`, `tools/list`, `prompts/list`, `resources/list`) anonymous on purpose, and documented exactly which methods are public and why in the README. `tools/call` and non-UI `resources/read` still require OAuth.
- Added tests: allowlisted and disallowed origins, preflight, server-to-server calls without `Origin`, the env override, protected calls from an allowlisted origin, and anonymous `resources/list` never carrying tenant data.

# 0.1.4 — Larger, clickable workspace rail

- Increased the outside gutter around the single ChatGPT workspace and enlarged the sidebar hit targets with hover/focus states.
- Added an Evidence section to the same board with a tenant-scoped run summary and a clear path to the full `evidence_export` bundle.
- Versioned the UI resource to `ui://ruflo-ai-team/board-v4.html`; older ChatGPT cards remain immutable and require a fresh chat.

# 0.1.3 — One navigable workspace

- Made the single ChatGPT MCP Apps board a navigable hub for teams, runs, and tasks, with in-card refresh and run selection through the MCP Apps bridge.
- Added tenant-scoped run summaries to the board response. Other MCP tools remain data-only and do not create separate UI surfaces.
- Versioned the UI resource as `ui://ruflo-ai-team/board-v3.html` so a refreshed ChatGPT installation fetches the new component.

# 0.1.2 — Desktop-style team workspace

- Reworked the ChatGPT board into a compact ruOS-inspired desktop with window chrome, workspace rail, status indicators, run metrics, task rows, and responsive narrow-width layout.
- Versioned the MCP Apps resource URI to `ui://ruflo-ai-team/board-v2.html` so hosts refresh the cached UI.
- Kept all content read-only and rendered with text nodes; no external scripts, frames, or network requests were added.

# 0.1.1 — ChatGPT team board and run completion

- Added a read-only ChatGPT team board with ruOS-inspired styling through an MCP Apps HTML resource. Tenant data is returned only by the OAuth-scoped `team_board` tool.
- Added `run_complete`, guarded by `team:run` and completion of all tasks, so evidence exports can show a completed run.
- Kept the RuVector fallback explicit while the pinned native binding fails its dimension self-test; native search is not claimed as verified.

# 0.1.0 — Initial review candidate

- New multi-tenant RuFlo AI Team MCP service, separate from RuFlo Federation.
- Twelve focused tools for templates, teams, runs, tasks, tenant-local memory, and evidence.
- OAuth 2.1 resource-server discovery with strict issuer, audience, scope, and tenant binding.
- Firestore canonical storage plus bounded per-tenant/team RuVector derived indexes.
- Six workflow skills, four specialized agents, four commands, two MCP prompts, and one template resource.
- Complete explicit tool annotations, secret-free schemas, cross-tenant denial tests, untrusted-content fencing, legal pages, Docker packaging, and Cloud Run manifest.

Known boundary: v0.1 coordinates and verifies work but does not dispatch paid models, provision desktops, execute arbitrary commands, send messages, deploy, purchase, publicly share, or delete tenant data.
