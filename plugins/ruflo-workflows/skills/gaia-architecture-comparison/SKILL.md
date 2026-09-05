---
name: gaia-architecture-comparison
description: Side-by-side comparison of ruflo vs HAL vs other GAIA harnesses — capability gaps, design decisions, and improvement roadmap
argument-hint: "[--focus=tools|routing|memory|cost]"
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_store
---

# GAIA Architecture Comparison Skill

Compare ruflo's GAIA benchmark harness against the Princeton HAL reference
implementation and other open-source harnesses to understand capability gaps
and prioritize improvements.

## When to use

- Planning the next iteration of GAIA work
- Evaluating which architectural change has the highest pass-rate ROI
- Onboarding a new contributor to the benchmark codebase

## Architecture overview

### ruflo harness (current)

```
gaia-bench run
  └─ gaia-loader.ts      — HF dataset download + cache
  └─ gaia-agent.ts       — multi-turn Anthropic Messages loop
       └─ gaia-tools/    — web_search, file_read, web_browse,
                           image_describe, python_exec
  └─ gaia-voting.ts      — Track A self-consistency (N attempts → majority vote)
  └─ gaia-hardness/      — Track Q difficulty predictor (ADR-136)
  └─ gaia-judge.ts       — two-stage LLM-as-judge scorer
```

### HAL reference (Princeton)

HAL uses a similar loop but with:
- OpenAI function calling as the tool interface
- BrowserBase / Playwright for real browser automation
- Code interpreter sandbox (Jupyter kernel)
- Larger token budget per turn (4096+)
- Full 300-question evaluation set

### Key differences

| Dimension | ruflo | HAL reference | Gap |
|-----------|-------|--------------|-----|
| Question count | 53 (partial L1) | 300 (full L1) | Use `--limit 165` for full L1 |
| Web search | DuckDuckGo / Google CSE | BrowserBase live | Add Playwright or Browserless |
| Code execution | python_exec stub | Real Jupyter kernel | Implement real sandbox |
| Image OCR | image_describe (Gemini) | GPT-4V / Gemini | Functionally equivalent |
| File handling | file_read | Full PDF/XLSX/ZIP parser | Expand file_read |
| Self-consistency | voting.ts (Track A) | Not in reference | ruflo advantage |
| Hardness routing | predictor.ts (Track Q) | Not in reference | ruflo advantage |
| Memory | AgentDB HNSW | None | ruflo advantage |
| Pass-rate L1 | ~20.8% (iter 23) | 74.6% (HAL Sonnet 4.5) | ~54 pp gap |

## Gap analysis

### Primary gaps (high impact)

1. **Real code execution** — many L2/L3 questions require running Python to
   compute a numerical answer. The current `python_exec` tool is a stub.
   Implementing a real sandbox (E2B, Pyodide, or subprocess) is the single
   highest-ROI change.

2. **Full question set** — running 53/300 L1 questions underestimates true
   pass-rate because the first 53 skew easier. Run `--limit 165` (full L1)
   for a comparable HAL score.

3. **Real browser** — `web_browse` currently fetches raw HTML. Replacing it
   with Playwright/Browserless for JavaScript-rendered pages would unlock
   many web navigation questions.

### Secondary gaps (medium impact)

4. **Structured file parsing** — PDF, XLSX, and ZIP attachments require
   dedicated parsers. `file_read` currently handles plain text and images only.

5. **Turn budget** — 12 turns may be insufficient for complex multi-step
   questions. HAL uses up to 20 turns for L3.

6. **System prompt tuning** — HAL's system prompt is more elaborate and
   explicitly instructs the model to use tools before answering.

### ruflo advantages

7. **Self-consistency voting** (Track A) — running N attempts per question and
   taking the majority answer reduces variance on borderline questions.
   HAL does not implement this.

8. **Hardness routing** (Track Q) — routing each question to an appropriate
   model and turn budget based on predicted difficulty. This reduces cost on
   easy questions while providing more resources for hard ones.

9. **AgentDB memory** — storing patterns across runs enables the agent to
   recall successful strategies for similar question types.

## Improvement roadmap

| Priority | Change | Expected Lift | Effort |
|----------|--------|--------------|--------|
| P0 | Real python_exec sandbox (E2B) | +15-25 pp | High |
| P0 | Full 165-Q L1 evaluation | Accurate baseline | Low |
| P1 | Playwright-based web_browse | +5-10 pp | Medium |
| P1 | PDF/XLSX file parser | +3-8 pp | Medium |
| P2 | Increase max-turns to 20 for L2/L3 | +2-5 pp | Low |
| P2 | System prompt tuning (iter 30 research) | +2-5 pp | Low |
| P3 | Google Grounding via Gemini (iter 32) | +3-7 pp | Medium |
| P3 | Multi-provider routing (Gemini Flash for cheap Q's) | Cost reduction | Medium |

## Loading context from past research

```bash
npx @claude-flow/cli@latest memory search \
  --namespace gaia-patterns \
  --query "architecture comparison HAL benchmark"
```

## Storing comparison findings

```bash
npx @claude-flow/cli@latest memory store \
  --namespace gaia-patterns \
  --key "architecture-comparison-$(date +%Y%m%d)" \
  --value "HAL gap: 54pp. Primary: python_exec stub. Secondary: browser, file parsing."
```
