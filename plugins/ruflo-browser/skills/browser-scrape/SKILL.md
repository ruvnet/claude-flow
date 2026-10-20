---
name: browser-scrape
description: DEPRECATED in v0.2.0 -- use browser-extract instead; this is a thin shim for backward compatibility, kept as a shim and slated for removal in the next minor release
argument-hint: "<url>"
allowed-tools: Bash Read
---

# Browser Scrape (deprecated)

> **Deprecated since plugin v0.2.0.** Kept as a shim; slated for removal in the next minor release.
>
> Use [`browser-extract`](../browser-extract/SKILL.md) instead. It provides the same scraping capability plus:
>
> - RVF cognitive container per session (replayable, federatable)
> - Mandatory AIDefence PII + prompt-injection gates
> - Persistent `browser-templates` namespace for reusable recipes
> - Automatic `browser-selectors` namespace updates so DOM drift is recoverable

## Migration

| v0.1 invocation | v0.2 equivalent |
|-----------------|-----------------|
| `/browser-scrape <url>` | `/browser-extract <url>` |
| `/browser-scrape <url>` (with template intent) | `/browser-extract <url> --template <name>` |
| Manual selector storage in `browser-patterns` namespace | Automatic — `browser-extract` writes to `browser-templates` and `browser-selectors` |

## Behavior of this shim

This skill delegates to `browser-extract`. Calling it emits a deprecation notice and proceeds.

```bash
# This skill is intentionally minimal — it just points the agent at the new skill.
echo "browser-scrape is deprecated; running browser-extract instead." >&2
```

The deprecation notice is captured in the agent's transcript so callers see the remediation. There is no behavior preserved here beyond the redirect — if you depended on a specific extraction shape, port to `browser-extract` and use `--template` to encode it.
