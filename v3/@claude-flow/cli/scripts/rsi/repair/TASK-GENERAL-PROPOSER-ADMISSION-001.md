# TASK-GENERAL-PROPOSER-ADMISSION-001: generic operator availability

Status: accepted engineering improvement; inherited improvement unmeasured.  
Source commit: `ce26636e0a7fe240c82b74f76c6c8e8fbf793414`  
Source tree: `f0ee0350f1c4d4865e8820f8493b758ad4968c47`  
Date: 2026-09-14 UTC

## Blocker removed

The retained FRESH-IMPROVER-ADMISSION-001 negative proved that the only existing
materializer was bound to the exposed p-limit calibration and offered zero proposal
families to `avoid-ai-writing-291`. That result is preserved unchanged.

This increment adds a source-independent registry for the
`js-regex-line-boundary` task family. Its inspection mechanism consumes only the
frozen public pre-outcome task prompt and proposer-visible source archive. It
derives named-symbol, physical-line, horizontal-whitespace, cross-line,
broad-whitespace-token and multiline-regex signals. It does not read evaluator or
test-plan bytes.

For the frozen source at `fabd62d9c8785dd0edda35201359bcc635b7d3de`, the
inspection located `TITLE_CASE_HEADER` in `detector/patterns.js` line 1454 and
admitted four generic operator families:

- `NARROW_REGEX_WHITESPACE_CLASS`;
- `EXCLUDE_CRLF_FROM_WHITESPACE`;
- `PRESERVE_MULTILINE_ANCHORS_WITH_LINE_LOCAL_TOKENS`;
- `POST_MATCH_REJECT_LINEBREAK`.

Each of inherited, frozen, static, shuffled and previous receives the same four
available families and the same two bounded admission slots. The previous p-limit
materializer remains at zero. The entire availability delta is therefore marked
`codexWrittenProposerEffect: true`; inherited state has zero influence on admission
or selection. This does not test the inherited-state hypothesis.

## Bounds and measured cost

No candidate descriptor, patch byte, fresh outcome or empirical hypothesis was
created. Candidate evaluation, proposer/evaluator workload starts, isolated starts,
repair wall time, native/model calls, epochs, provider spend and pi requests stayed
zero. The proposer-visible staging command copied 296812 decoded source bytes from
an 88498-byte archive and retained evaluator separation.

Local validation used three test commands: 49/49 test cases, five test-file workers,
four bounded CLI helper starts and 657.852763 ms summed reported suite duration.
One semantic project-memory search took 13206 ms; one source-stage command and one
read-only admission inspection also ran. Outer Codex acquisition/model costs and
total engineering dollars are unknown, blocking confirmation.

The lifetime ledger remains at 209784 native calls, seven epochs and head
`5a0e219e871fcf616209807c828c5793c29752f8d190fc38a0bc95e4db88422e`.
The repair envelope remains unapproved.

## Guidance and next acceptance

Prior guidance required a reviewed task-general proposer after the zero-family
negative, but did not mechanically separate newly written operator availability
from inherited-state selection. The new guidance requires both fields in every
admission receipt and prohibits attributing this availability delta to inheritance.
Expected benefit is unmeasured: it should prevent proposer engineering from
masquerading as recursive improvement. Cost scope is one bounded prompt/source
inspection per frozen task. Roll back only if independent review finds the generic
signal derivation unsound; retain both this artifact and the original zero-family
negative, then replace the registry with a stricter reviewed version.

Next, a child-owned materializer must turn these admitted operators into bounded
successors without evaluator access or researcher coaching, first against synthetic
fixtures. Actual fresh-task candidate execution still requires reviewed source, a
durable HYPOTHESIS/reservation, compatible isolation and explicit approval of the
separate repair envelope. The useful implementation queue remains active, so no
cadence change is warranted.

## Acceptance

```bash
node --test v3/@claude-flow/cli/scripts/rsi/repair/task-general-proposer-admission.test.mjs
```

Expected: twelve passes, four available families, two equal slots per arm, zero
inherited-state influence, zero candidate bytes, and execution/RSI gates closed.

GitHub Actions run 34803373414 passed 313 focused research-loop tests and 18
experiment/proof tests (331 total). It replayed all seven epochs from their
original source identities, retained 209784 lifetime native calls, and reported
`boundedRsiEvidenceAccepted: false`.
