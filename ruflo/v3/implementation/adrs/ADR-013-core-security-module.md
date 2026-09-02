# ADR-013: Core Security Module

## Status
**Implemented** ✅

## Date
2026-01-05

## Context

The v2 codebase had critical security vulnerabilities identified in the security audit:

| Issue | Severity | Description |
|-------|----------|-------------|
| CVE-2 | Critical | SHA-256 password hashing with hardcoded salt |
| CVE-3 | Critical | Hardcoded default admin/service credentials |
| HIGH-1 | High | Command injection via shell:true in spawn() |
| HIGH-2 | High | Path traversal via unvalidated file paths |

These vulnerabilities required a complete security module rewrite for v3.

## Decision

Create `@claude-flow/security` package with defense-in-depth approach:

### 1. Password Hashing (CVE-2 Fix)

**Implementation**: `password-hasher.ts`

```typescript
// Before (vulnerable)
createHash('sha256').update(password + 'salt').digest('hex');

// After (secure)
await bcrypt.hash(password, 12); // Adaptive, per-user salt
```

- bcrypt with configurable rounds (default: 12)
- Automatic salt generation per password
- Timing-safe comparison
- Password strength validation

### 2. Credential Generation (CVE-3 Fix)

**Implementation**: `credential-generator.ts`

```typescript
// Before (vulnerable)
passwordHash: createHash('sha256').update('admin123' + 'salt');

// After (secure)
crypto.randomBytes(32).toString('base64url');
```

- Cryptographically secure random generation
- Configurable entropy (32-64 bytes)
- API key generation with checksums
- Rotation support

### 3. Safe Command Execution (HIGH-1 Fix)

**Implementation**: `safe-executor.ts`

```typescript
// Before (vulnerable)
spawn('npx', args, { shell: true });

// After (secure)
execFile(command, args); // No shell interpretation
```

- No shell interpretation (shell: false)
- Command allowlist validation
- Argument sanitization
- Timeout enforcement
- Working directory restrictions

### 4. Path Validation (HIGH-2 Fix)

**Implementation**: `path-validator.ts`

```typescript
// Before (vulnerable)
fs.readFile(userPath); // No validation

// After (secure)
const safe = await pathValidator.validate(userPath);
if (!safe.valid) throw new Error('Path traversal detected');
fs.readFile(safe.resolvedPath);
```

- Path canonicalization (resolve symlinks)
- Prefix validation (jail to allowed directories)
- Traversal pattern detection (../, %2e, null bytes)
- Hidden file handling

### 5. Input Validation

**Implementation**: `input-validator.ts`

- Zod-based schema validation
- Pre-built schemas for common types
- XSS sanitization
- Length/pattern limits

### 6. Token Generation

**Implementation**: `token-generator.ts`

- HMAC-SHA256 signed tokens
- Configurable expiration
- Verification codes
- API key format standards

## Validation Results

**Test Date**: 2026-01-05

| Component | Tests | Status |
|-----------|-------|--------|
| password-hasher | 52 | ✅ Pass |
| credential-generator | 55 | ✅ Pass |
| safe-executor | 77 | ✅ Pass |
| path-validator | 70 | ✅ Pass |
| input-validator | 58 | ✅ Pass |
| token-generator | 78 | ✅ Pass |
| integration | 20 | ✅ Pass |
| acceptance | 34 | ✅ Pass |

**Total: 444/444 tests passing**

## Consequences

### Positive
- All critical CVEs remediated
- Defense-in-depth architecture
- >95% test coverage
- Comprehensive documentation
- Reusable across all v3 modules

### Negative
- bcrypt adds ~100ms latency for password operations
- Stricter validation may break some edge cases

### Dependencies
- bcrypt (password hashing)
- zod (schema validation)
- No external dependencies for crypto (Node.js built-in)

## Usage

```typescript
import { createSecurityModule } from '@claude-flow/security';

const security = createSecurityModule({
  projectRoot: process.cwd(),
  hmacSecret: process.env.HMAC_SECRET!,
  bcryptRounds: 12,
  allowedCommands: ['git', 'npm', 'npx', 'node'],
});

// Password hashing
const hash = await security.passwordHasher.hash('password');
const valid = await security.passwordHasher.verify('password', hash);

// Safe command execution
const result = await security.safeExecutor.execute('git', ['status']);

// Path validation
const pathResult = await security.pathValidator.validate(userPath);
if (!pathResult.valid) throw new Error(pathResult.error);

// Token generation
const token = security.tokenGenerator.generateAccessToken('user-123', 3600);
```

## References

- Security Audit Report: `v3/implementation/security/SECURITY_AUDIT_REPORT.md`
- CVE Tracking: `v3/@claude-flow/security/src/CVE-REMEDIATION.ts`
- OWASP Guidelines: https://owasp.org/www-project-top-ten/
- bcrypt Best Practices: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
