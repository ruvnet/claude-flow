---
name: generate-console-theme
description: Generate a data-only animated theme preset for Ruflo Console Theme Studio. Use when the user requests a new console color palette, cyberpunk theme, or variation of Orbital globe, stars, and swarm animation in Claude or Codex.
allowed-tools: Read
---

# Generate a Ruflo console theme

Create one preset from the user's visual direction. Use the current assistant, Claude or Codex, to generate the data; no API key, subprocess, or second model is required.

1. Read [the preset contract and example](references/preset.md).
2. Choose a short theme name and six readable colors. Translate the requested mood into the palette, animation speed, and optional stars, globe, and topology. Reuse the existing Orbital renderer; do not promise new animation geometry from a preset.
3. Keep text and status colors legible against the background. Aim for at least 4.5:1 contrast for every foreground role. Keep failures visually distinct from successes and warnings; preserve the host's status labels. Prefer calm motion and avoid flashing. Honor a request for less visual activity by disabling decorative layers and lowering speed; the host's zero-FPS setting remains authoritative.
4. Check the exact keys, types, bounds, six-digit hex colors, and name length against the contract. Never include scripts, CSS, URLs, escape sequences, extra keys, or invented telemetry. Theme settings must not change boot checks, agent states, or reported failures.
5. Return exactly one JSON object with no Markdown fences or surrounding explanation. Theme Studio accepts the object in its import field; the user can review and save/select the preset there. Do not claim it has been installed or activated merely because JSON was generated.

Use the user's stated preferences directly. When details are absent, choose a dark background, warm readable status colors, all three decorative layers enabled, and speed 1. Do not ask for credentials or make external calls to produce a preset.
