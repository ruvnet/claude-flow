---
name: launch-ai-team
description: Plans and creates an AI team for a goal, with roles, a run that carries a unit budget, and bounded tasks. Use when the user asks to start, set up or staff a team, or to split a larger goal across roles. Records coordination state only; nothing is executed.
allowed-tools: Read
---

# Launch AI Team

Uses the RuFlo AI Team connector (server name ruflo-ai-team): the tools team_templates_list, team_create, run_create and task_create. If the connector is not connected or the user has not signed in, say so and ask them to connect it; do not pretend a team was created.

1. Clarify the outcome, acceptance criteria, constraints, deadline, and the maximum units for the run (a whole number from 1 to 100, default 25). Units are a recorded budget, not a billed or enforced limit.
2. List the templates (research-brief, release-readiness, security-review) and propose no more than three roles; a team may hold up to eight.
3. Show the team, tasks, budget, risks, and what this service cannot do: it does not run agents, send, publish, deploy, purchase, or execute commands.
4. Create the team only after the user accepts the plan.
5. Create a run, then small tasks that each have one deliverable and one owner role. Recording a task does not execute it; say who or what will do the work.
6. Never put credentials or secrets in a team, run, or task.
