---
name: pii-detect
description: Detect and flag personally identifiable information (PII) in text, code, and configurations. Use before committing code, writing logs, storing data, or sending model responses that might contain emails, phone numbers, SSNs, API keys, or passwords.
argument-hint: "<input-text>"
allowed-tools: mcp__plugin_ruflo-core_ruflo__aidefence_has_pii mcp__plugin_ruflo-core_ruflo__aidefence_scan mcp__plugin_ruflo-core_ruflo__aidefence_analyze mcp__plugin_ruflo-core_ruflo__transfer_detect-pii Bash
---

# PII Detection

Detect personally identifiable information before it enters logs, commits, or responses.

## When to use

Before committing code, storing data, or sending responses that might contain PII (emails, phone numbers, SSNs, API keys, passwords).

## Steps

1. **Quick PII check** — call `mcp__plugin_ruflo-core_ruflo__aidefence_has_pii` with the text for a boolean result
2. **Detailed scan** — call `mcp__plugin_ruflo-core_ruflo__transfer_detect-pii` for categorized PII findings
3. **Full analysis** — call `mcp__plugin_ruflo-core_ruflo__aidefence_analyze` for context-aware PII detection
4. If PII found, flag the specific locations and suggest redaction

## PII categories detected

- Email addresses, phone numbers
- Social security numbers, tax IDs
- Credit card numbers
- API keys, tokens, passwords
- Physical addresses
- Names linked to sensitive data
