# ADR-027: agent-browser Integration for Web Automation

## Status

Proposed

Priority: High  
Complexity: Medium

---

# Context

Claude Flow V3 currently lacks native browser automation capabilities. Users must manually orchestrate web interactions, scraping, and testing workflows.

The `agent-browser` package from Vercel Labs provides a production-ready, AI-optimized browser automation CLI that could significantly enhance Claude Flow's capabilities.

---

# Current Gaps

- No built-in web automation agents
- No browser interaction skills
- Manual coordination for web scraping and testing tasks
- High token usage when agents describe DOM interactions

---

# Opportunity

- `agent-browser` reduces context usage by approximately 93% using snapshot references
- Native Rust CLI enables fast command parsing
- More than 50 browser automation commands available
- Session isolation supports multi-agent browser coordination

---

# Decision Drivers

## AI-First Design

`agent-browser` uses accessibility tree snapshots with compact element references such as `@e1` and `@e2` instead of full DOM output, significantly reducing token usage.

## Universal Compatibility

Compatible with:
- Claude Code
- Cursor
- Codex
- Copilot
- Gemini

## Production Ready

- Apache-2.0 licensed
- Backed by Vercel Labs
- Active development lifecycle

## Minimal Dependencies

Requires only:
- `playwright-core`
- `ws`
- `zod`

## Session Isolation

Each browser session maintains independent state, supporting swarm coordination workflows.

---

# Considered Options

## Option 1 — Full Integration (Recommended)

- New `@claude-flow/browser` package
- Dedicated `browser-agent`
- `/browser` skill with browser commands
- MCP browser tools
- Memory integration for session persistence

## Option 2 — Skill-Only Integration

- Browser skill wrapping CLI commands
- No dedicated browser agent type
- Faster implementation

## Option 3 — External Dependency Only

- Recommend `agent-browser` externally
- No native integration
- Manual orchestration by users

---

# Decision Outcome

## Chosen Option

**Option 1 — Full Integration**

### Rationale

The AI-first snapshot architecture and large token reduction strongly align with Claude Flow's design goals.

This integration enables:
- Swarm-based web scraping
- Automated browser testing workflows
- Persistent browser sessions
- Screenshot-driven debugging

---

# Domain-Driven Design (DDD)

## Browser Automation Context

### Aggregates

- Session Aggregate
- Page Aggregate
- Network Aggregate

### Value Objects

- ElementRef (`@e1`, `@e2`)
- Snapshot
- Selector
- Viewport
- Cookie
- StorageItem

### Domain Events

- `PageNavigated`
- `ElementClicked`
- `SnapshotTaken`
- `FormFilled`
- `SessionCreated`
- `NetworkIntercepted`

---

# Technical Architecture

## Package Structure

```text
v3/@claude-flow/browser/
├── src/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   └── index.ts
├── package.json
└── README.md