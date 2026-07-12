---
name: security-audit
description: >
  Security scanning and vulnerability detection.
  Use when: authentication, authorization, payment processing, user data.
  Skip when: read-only operations, internal tooling.
---

# Security Audit Skill

## Purpose
Security scanning and vulnerability detection.

## When to Trigger
- authentication
- authorization
- payment processing
- user data

## When to Skip
- read-only operations
- internal tooling

## Commands

### Full Security Scan
Run comprehensive security analysis

```bash
npx @claude-flow/cli security scan --depth deep
```

### Input Validation Check
Check for input validation issues

```bash
npx @claude-flow/cli security scan --check input-validation
```



## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
