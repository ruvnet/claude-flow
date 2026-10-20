---
name: manage-team-lifecycle
description: Pauses, resumes, or completes an AI team, or marks a run complete, while keeping its evidence. Use when the user asks to pause, stop, resume, wrap up, or close a team or run. Changes coordination state only and deletes nothing.
allowed-tools: Read
---

# Manage Team Lifecycle

Uses the RuFlo AI Team connector (server name ruflo-ai-team): the tools team_get, team_update, run_complete and evidence_export.

Read the current state before changing it. A team status is active, paused, or complete. A run can be completed only when it has at least one task and every task is complete; if the service answers tasks_incomplete, list what is still open rather than forcing it. Explain that pausing or completing changes coordination state only, offer the evidence bundle before closing, and never describe completion as deletion. This service has no deletion, public-sharing, or external-action capability.
