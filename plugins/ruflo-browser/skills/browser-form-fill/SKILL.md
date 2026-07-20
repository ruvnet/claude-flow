---
name: browser-form-fill
description: Fill a web form by mapping field-name → value, with optional template lookup from browser-templates for known forms
argument-hint: "<url> <field-map.json> [--template <name>] [--submit]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_fill mcp__plugin_ruflo-core_ruflo__browser_type mcp__plugin_ruflo-core_ruflo__browser_select mcp__plugin_ruflo-core_ruflo__browser_check mcp__plugin_ruflo-core_ruflo__browser_uncheck mcp__plugin_ruflo-core_ruflo__browser_click mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__aidefence_has_pii Bash Read Write
---

# Browser Form Fill

Fill a form using a structured field map (`{"first_name": "Ada", "company": "..."}`). When a `browser-templates` entry exists for the host, use it to resolve field names → CSS selectors automatically; otherwise resolve via the page accessibility snapshot.

## When to use

- Submitting a known form (signup, contact, checkout) where field names are stable.
- Re-using a stored template for a recurring submission.
- Authoring a new template for a site by recording the resolved selectors.

## Steps

1. **Open a recorded session** via `browser-record`.
2. **Resolve selectors**:
   - **Template path** (`--template <name>`): pull `{field_name → selector}` from `browser-templates`.
   - **Snapshot path**: call `browser_snapshot`, walk the accessibility tree, match each input's accessible name / label to the field map keys.
3. **AIDefence PII gate**: every value in the field map passes `aidefence_has_pii` before any keystroke; record `pii_in_form: true` in the session manifest. **Do not** record the values themselves in the trajectory; record only the field names + a redacted placeholder.
4. **Fill** with `browser_fill` / `browser_type` / `browser_select` / `browser_check` per input type.
5. **Submit** if `--submit`: locate the submit button via the snapshot, `browser_click`, then `browser_wait` for navigation.
6. **Persist the template** if a new mapping was discovered:
   ```bash
   npx -y @claude-flow/cli@latest memory store --namespace browser-templates \
     --key "<host>:<form-name>" \
     --value "{field_map:{...}, submit_selector:..., post_submit_url_pattern:...}"
   ```
7. **Verify** post-submit state if a verification snippet was provided in the field map's `_assert` key.

## Caveats

- Trajectory steps for fills MUST redact values. The PII gate is the contract.
- For inputs that require typing simulation (e.g., autocomplete reactions), use `browser_type` (simulates keystrokes) rather than `browser_fill` (sets value programmatically). Record which one was used in the trajectory step.
- Multi-step forms are a sequence of `browser-form-fill` invocations; chain them via the same session id.
- If the form has a CAPTCHA, surface the request to the user — do not attempt to bypass.
