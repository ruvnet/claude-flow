# ADR 439: Console research start and confirm

Status: Accepted (shipped in ruflo-console 0.28.0 and its companion plugins, PR #3667)

Date: 2026 10 04

Scope: `plugins/ruflo-console` (Missions page: question, depth, cap, screen, confirm; palette; Help)

Source: ADR-438 (research integration contract). Companion: 440 (the guard).

## 1. Decision

The Missions page can start a capped deep-research run. The console only **prepares** a slash command and never fetches; the run happens in the main Claude Code conversation, as every ruflo-goals skill does today.

- **Inputs.** A question, a depth (`quick`, `standard`, `deep`; default `standard`) and a USD cap (default `$2`). The cap is validated like `budgetAmount` in the cost code: decimal dollars only (no flags, exponents or currency marks), from 0.10 to 50 inclusive. A question must be non-empty and may not start with `-`.
- **Screen first.** The question is always screened with the existing `screenText` (AIDefence `aidefence_is_safe` and `aidefence_has_pii`, local). Unsafe or PII-bearing questions are refused: no confirm is shown and nothing is prepared. The screen cannot be switched off for research, because the text reaches web search. An unavailable detector warns in the confirm text and does not block, as for goals.
- **Confirm, in words.** The runner's ask row states: it starts a billed Claude Code turn; it allows web search and fetch up to the cap (and the depth); web content is untrusted; nothing is stored until you accept the report. The ask is never "remembered" (the spec has a `run`, so `rememberKey` returns null). The existing denylist and ask-first rules are unchanged.
- **The prepared command**, idle: `runSlash`; mid-turn: only placed in the prompt box.

  `/ruflo-goals:deep-research --depth <d> --cap-usd <usd> <question>`

  **Contract with the plugin side:** `ruflo-goals` (updated concurrently) accepts exactly the flags `--depth <quick|standard|deep>` and `--cap-usd <usd>` before the question text, in that order, and treats everything after them as the question. If the plugin and console disagree, this ADR and ADR-438 are the reference.
- **Palette and Help.** Palette entry `mission-research` (runs the start on the question typed in Missions); Help topic `research`.

## 2. Notes

- The inputs live in a console-side draft (`researchOf`, `setResearch`) and the start is `missionWired(state).research()`. A verdict for a question that changed while AIDefence was looking is dropped.
- Typed headless use (`/ruflo run mission-research <question>`) needs `mission-research` added to the palette's text keywords; until then the entry runs on the draft.

## 3. Not decided here

- The Missions form widgets (they live in `views/missions.ts`) and the Research section list (ADR-438).
- Whether research spend appears in the Cost ledger (UNVERIFIED, see ADR-438 §4).
