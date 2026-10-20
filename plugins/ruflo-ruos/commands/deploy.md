---
name: deploy
description: Read-only deploy hand-off after a swarm finishes on a ruOS desktop — report what would ship, never push
---
$ARGUMENTS

After a remote swarm run, report the state of a repo on the desktop so the user can
decide on a deploy:

`node "${CLAUDE_PLUGIN_ROOT}/scripts/cli.mjs" deploy-info --desktop "<ref>" --repo <path-relative-to-$HOME>`

It returns branch, HEAD, dirty file count and commits ahead of upstream. The hand-off is:

- a branch or PR;
- this summary, for a human to review, merge and deploy.

The swarm is read-only for deploys. It never pushes, merges, deploys or publishes, and ruOS has no deploy tool to call. Present the summary and stop.
