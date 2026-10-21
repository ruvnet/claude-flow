# e2e host matrix: Claude Code, Codex, OpenRouter

One command shows whether ruflo works end to end with each host. Design, safety rules and the first results: [ADR-490](../v3/docs/adr/ADR-490-three-host-e2e-integration-loop.md).

```bash
npm run e2e                                  # keyless: no model call, $0 (this is what CI runs)
RUFLO_E2E_LIVE=1 npm run e2e:live            # also real sessions, capped at 6 USD (--cap N)
node scripts/e2e/host-matrix.mjs --legs codex --cli-path "$PWD/v3/@claude-flow/cli/bin/cli.js" --json out.json
```

Flags: `--legs claude,codex,openrouter,tui` (the `tui` leg runs the standalone `ruflo tui` bundle in process, so build it first: `node plugins/ruflo-console/scripts/build-tui.mjs`; keyless it covers the six pages, the not-a-terminal exit and the AI page against a stub fetch; live it asks OpenRouter and the pinned Codex one trivial question each after a card), `--cli-version latest|X.Y.Z` (default: the published `ruflo`), `--cli-path <cli.js>` (test a workspace
build; build `shared security mcp swarm cli` first), `--json <file>`, `--cap <usd>`. Exit code 1 only when a row is `fail`.

## What you need for the live mode

- **Claude Code** logged in (`~/.claude/.credentials.json`); only the access token is copied into a throwaway config.
- **Codex 0.162.0** under `~/.codex/packages/standalone/releases/` (or `RUFLO_E2E_CODEX_BIN`). Never 0.162.1: it crashes with a #GP.
  Codex authenticates through OpenRouter, so your ChatGPT login is never copied or refreshed.
- **An OpenRouter key**: `OPENROUTER_API_KEY`, or Secret Manager (`ruv-dev`, then `cognitum-20260110`) when `gcloud` is `ruv@ruv.net`.
  It is held in memory, passed by environment, and redacted from every report. Without one the OpenRouter and Codex live rows are `blocked`.

## Reading the table

`pass`, `fail`, `blocked` (a credential or the pinned binary is missing), `skipped` (live mode off, or the host cannot do it
non-interactively), `flaky` (the trigger did not occur this run; rerun), `advisory` (a posture question for a person, not a defect).
Evidence is redacted and capped at 600 characters per row. A defect found live needs a failing unit test and a fix, not a harness change.

## Files

`scripts/e2e/host-matrix.mjs` (orchestrator), `leg-claude.mjs`, `leg-codex.mjs`, `leg-openrouter.mjs`, `lib.mjs` (recorder, redaction, sandbox,
MCP stdio client, OpenAI-compatible stub). Workflow: `.github/workflows/e2e-host-matrix.yml` (keyless; PRs touching the seam, weekly, on demand).
