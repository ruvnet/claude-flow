---
status: accepted
date: 2024-06-01
supersedes: ADR-0002
---

# Use Cockroach for storage

## Context and Problem Statement

Postgres did not scale across regions. See PR #77.

## Decision Outcome

Chosen option: "Cockroach", for `src/db/` and `services/orders/`.
