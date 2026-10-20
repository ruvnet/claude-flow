# ADR-0004: Metered unit budget

Status: Proposed

## Decision

The free plan begins with one active team, three roles, one concurrent run, 100 tasks per month, and a maximum declared run budget of 100 units. Version 0.1 records budgets but does not dispatch billable providers. Before billable models, ruOS desktops, or external connectors are enabled, the service must atomically reserve estimated units, commit actual use, release unused reservations, and stop new chargeable work when the ledger is unavailable.

This separation prevents a descriptive budget field from being mistaken for enforcement.
