---
name: security-audit
description: >
  Comprehensive security scanning and vulnerability detection. Includes input validation, path traversal prevention, CVE detection, and secure coding pattern enforcement.
  Use when: authentication implementation, authorization logic, payment processing, user data handling, API endpoint creation, file upload handling, database queries, external API integration.
  Skip when: read-only operations on public data, internal development tooling, static documentation, styling changes.
---

# Security Audit Skill

## Purpose
Comprehensive security scanning and vulnerability detection. Includes input validation, path traversal prevention, CVE detection, and secure coding pattern enforcement.

## When to Trigger
- authentication implementation
- authorization logic
- payment processing
- user data handling
- API endpoint creation
- file upload handling
- database queries
- external API integration

## When to Skip
- read-only operations on public data
- internal development tooling
- static documentation
- styling changes

## Commands

### Full Security Scan
Run comprehensive security analysis on the codebase

```bash
npx @claude-flow/cli security scan --depth deep
```

**Example:**
```bash
npx @claude-flow/cli security scan --depth deep --output security-report.json
```

### Input Validation Check
Check for input validation issues

```bash
npx @claude-flow/cli security scan --check input-validation
```

**Example:**
```bash
npx @claude-flow/cli security scan --check input-validation --path ./src/api
```

### Path Traversal Check
Check for path traversal vulnerabilities

```bash
npx @claude-flow/cli security scan --check path-traversal
```

### SQL Injection Check
Check for SQL injection vulnerabilities

```bash
npx @claude-flow/cli security scan --check sql-injection
```

### XSS Check
Check for cross-site scripting vulnerabilities

```bash
npx @claude-flow/cli security scan --check xss
```

### CVE Scan
Scan dependencies for known CVEs

```bash
npx @claude-flow/cli security cve --scan
```

**Example:**
```bash
npx @claude-flow/cli security cve --scan --severity high
```

### Security Audit Report
Generate full security audit report

```bash
npx @claude-flow/cli security audit --report
```

**Example:**
```bash
npx @claude-flow/cli security audit --report --format markdown --output SECURITY.md
```

### Threat Modeling
Run threat modeling analysis

```bash
npx @claude-flow/cli security threats --analyze
```

### Validate Secrets
Check for hardcoded secrets

```bash
npx @claude-flow/cli security validate --check secrets
```


## Scripts

| Script | Path | Description |
|--------|------|-------------|
| `security-scan` | `.agents/scripts/security-scan.sh` | Run full security scan pipeline |
| `cve-remediate` | `.agents/scripts/cve-remediate.sh` | Auto-remediate known CVEs |


## References

| Document | Path | Description |
|----------|------|-------------|
| `Security Checklist` | `docs/security-checklist.md` | Security review checklist |
| `OWASP Guide` | `docs/owasp-top10.md` | OWASP Top 10 mitigation guide |

## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
