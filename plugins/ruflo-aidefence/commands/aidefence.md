---
name: aidefence
description: AIDefence status, detection stats, and threat analysis dashboard
allowed-tools: mcp__plugin_ruflo-core_ruflo__aidefence_stats
---

Show the AIDefence dashboard:

1. Call `mcp__plugin_ruflo-core_ruflo__aidefence_stats` to get detection rates, scan counts, and learned patterns
2. Present a summary with: total scans, threats detected, false positive rate, PII detections
3. Show learned threat categories and their detection confidence
