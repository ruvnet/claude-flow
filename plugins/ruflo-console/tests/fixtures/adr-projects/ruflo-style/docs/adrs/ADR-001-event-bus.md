# ADR-001: Event bus between services

**Status**: Accepted — Implemented in 1.2.0
**Date**: 2025-01-10
**Scope**: `services/bus/`, `libs/events/index.ts`
**Related**: ADR-002 (retries), issue #41

## Context

Services call each other directly.

## Decision

Introduce an event bus.

## Consequences

Eventual consistency.
