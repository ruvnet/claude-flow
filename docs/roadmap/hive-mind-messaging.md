# Hive-Mind Messaging

## Overview

This document describes the current messaging behavior for hive-mind communication in RuFlo.

It clarifies what is currently supported, what requires MCP tooling, and what remains future roadmap work.

Related issue:
- #1315 — Awake agent: send message to current active hive-mind by session ID or Hive ID

---

## Current Supported Behavior

RuFlo currently supports:

- hive-wide broadcast messaging
- hive status inspection
- MCP-based agent updates
- MCP-based hive broadcast

This allows communication with active hive sessions, but not direct CLI targeting of a specific session by ID.

---

## Supported CLI Commands

### Broadcast to all agents in active hive

```bash
npx ruflo@latest hive-mind broadcast --message "your message"