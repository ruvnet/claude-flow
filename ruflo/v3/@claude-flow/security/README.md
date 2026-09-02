# @claude-flow/security

[![npm version](https://img.shields.io/npm/v/@claude-flow/security.svg)](https://www.npmjs.com/package/@claude-flow/security)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/security.svg)](https://www.npmjs.com/package/@claude-flow/security)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Security Audit](https://img.shields.io/badge/Security-Audited-green.svg)](https://github.com/ruvnet/claude-flow)

> Comprehensive security module for Claude Flow V3 - CVE fixes, input validation, path security, and secure credential management.

## Features

- **CVE Remediation** - Fixes for CVE-2 (Weak Password Hashing), CVE-3 (Hardcoded Credentials), HIGH-1 (Command Injection), HIGH-2 (Path Traversal)
- **Password Hashing** - Secure bcrypt-based password hashing with configurable rounds (12+ recommended)
- **Credential Generation** - Cryptographically secure credential and API key generation
- **Safe Command Execution** - Allowlist-based command execution preventing injection attacks
- **Path Validation** - Protection against path traversal and symlink attacks
- **Input Validation** - Zod-based schema validation for all input types
- **Token Generation** - Secure token creation with HMAC signing

## Installation

```bash
npm install @claude-flow/security
```

## Quick Start

```typescript
import { createSecurityModule } from '@claude-flow/security';

// Create a complete security module
const security = createSecurityModule({
  projectRoot: '/workspaces/project',
  hmacSecret: process.env.HMAC_SECRET!,
  bcryptRounds: 12,
  allowedCommands: ['git', 'npm', 'npx', 'node']
});

// Hash a password
const hash = await security.passwordHasher.hash('userPassword123');

// Validate a path
const pathResult = await security.pathValidator.validate('/workspaces/project/src/file.ts');

// Execute command safely
const output = await security.safeExecutor.execute('git', ['status']);

// Generate secure credentials
const creds = await security.credentialGenerator.generate();
```

## API Reference

### Password Hashing (CVE-2 Fix)

```typescript
import { PasswordHasher, createPasswordHasher } from '@claude-flow/security';

const hasher = createPasswordHasher({ rounds: 12 });

// Hash password
const hash = await hasher.hash('password');

// Verify password
const isValid = await hasher.verify('password', hash);

// Check if hash needs rehashing
const needsRehash = hasher.needsRehash(hash);
```

### Credential Generation (CVE-3 Fix)

```typescript
import { CredentialGenerator, generateCredentials } from '@claude-flow/security';

const generator = new CredentialGenerator();

// Generate API key
const apiKey = await generator.generateApiKey({
  prefix: 'cf',
  length: 32
});

// Generate complete credentials
const creds = generateCredentials({
  includeApiKey: true,
  includeSecret: true
});
```

### Safe Command Execution (HIGH-1 Fix)

```typescript
import { SafeExecutor, createDevelopmentExecutor } from '@claude-flow/security';

const executor = createDevelopmentExecutor();

// Execute allowed command
const result = await executor.execute('git', ['status']);

// With timeout
const result2 = await executor.execute('npm', ['install'], {
  timeout: 60000,
  cwd: '/workspaces/project'
});
```

### Path Validation (HIGH-2 Fix)

```typescript
import { PathValidator, createProjectPathValidator } from '@claude-flow/security';

const validator = createProjectPathValidator('/workspaces/project');

// Validate path
const result = await validator.validate('../../../etc/passwd');
// { valid: false, reason: 'Path traversal detected' }

// Safe path
const result2 = await validator.validate('/workspaces/project/src/index.ts');
// { valid: true, normalized: '/workspaces/project/src/index.ts' }
```

### Input Validation

```typescript
import {
  InputValidator,
  SafeStringSchema,
  EmailSchema,
  PasswordSchema,
  SpawnAgentSchema
} from '@claude-flow/security';

// Validate email
const email = EmailSchema.parse('user@example.com');

// Validate password
const password = PasswordSchema.parse('SecurePass123!');

// Validate agent spawn request
const agentRequest = SpawnAgentSchema.parse({
  type: 'coder',
  name: 'code-agent-1'
});

// Sanitize HTML
import { sanitizeHtml } from '@claude-flow/security';
const safe = sanitizeHtml('<script>alert("xss")</script>Hello');
// 'Hello'
```

### Token Generation

```typescript
import { TokenGenerator, quickGenerate } from '@claude-flow/security';

const generator = new TokenGenerator({
  hmacSecret: process.env.HMAC_SECRET!
});

// Generate signed token
const token = await generator.generate({
  type: 'session',
  expiresIn: 3600
});

// Verify token
const verified = await generator.verify(token);

// Quick generation
const sessionToken = quickGenerate.sessionToken();
const verificationCode = quickGenerate.verificationCode();
```

## Security Constants

```typescript
import {
  MIN_BCRYPT_ROUNDS,      // 12
  MAX_BCRYPT_ROUNDS,      // 14
  MIN_PASSWORD_LENGTH,    // 8
  MAX_PASSWORD_LENGTH,    // 72 (bcrypt limit)
  DEFAULT_TOKEN_EXPIRATION,   // 3600 (1 hour)
  DEFAULT_SESSION_EXPIRATION  // 86400 (24 hours)
} from '@claude-flow/security';
```

## Security Audit

```typescript
import { auditSecurityConfig } from '@claude-flow/security';

const warnings = auditSecurityConfig({
  bcryptRounds: 10,
  hmacSecret: 'short'
});

// ['bcryptRounds (10) below recommended minimum (12)',
//  'hmacSecret should be at least 32 characters']
```

## Validation Schemas

| Schema | Description |
|--------|-------------|
| `SafeStringSchema` | Basic safe string with length limits |
| `IdentifierSchema` | Alphanumeric identifiers |
| `FilenameSchema` | Safe filenames |
| `EmailSchema` | Email addresses |
| `PasswordSchema` | Secure passwords |
| `UUIDSchema` | UUID v4 format |
| `HttpsUrlSchema` | HTTPS URLs only |
| `SemverSchema` | Semantic versions |
| `PortSchema` | Valid port numbers |
| `IPv4Schema` | IPv4 addresses |
| `SpawnAgentSchema` | Agent spawn requests |
| `TaskInputSchema` | Task definitions |
| `SecurityConfigSchema` | Security configuration |

## Dependencies

- `bcrypt` - Password hashing
- `zod` - Schema validation

## Related Packages

- [@claude-flow/shared](../shared) - Shared types and utilities
- [@claude-flow/swarm](../swarm) - Swarm coordination (secure agent spawning)

## License

MIT
