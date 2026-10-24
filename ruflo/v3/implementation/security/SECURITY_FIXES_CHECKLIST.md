# Security Fixes Checklist for v3.0.0

This checklist provides actionable steps to address all security vulnerabilities identified in the security audit.

## 🔴 CRITICAL - Fix Immediately (Before ANY Production Use)

### 1. Update Vulnerable Dependencies
**Time Estimate:** 30 minutes
**Files:** `package.json`

```bash
# Update critical vulnerabilities
npm update @anthropic-ai/claude-code@^2.0.31
npm update @modelcontextprotocol/sdk@^1.24.0
npm update body-parser@^2.2.1

# Run full audit fix
npm audit fix --force

# Verify fixes
npm audit
```

**Verification:**
```bash
npm audit | grep -E "(critical|high)"
# Should show 0 critical and 0 high vulnerabilities
```

---

### 2. Fix Password Hashing Implementation
**Time Estimate:** 2 hours
**Files:** `src/api/auth-service.ts`

**Step 1:** Install bcrypt
```bash
npm install bcrypt
npm install --save-dev @types/bcrypt
```

**Step 2:** Replace password hashing functions (Lines 580-588)
```typescript
// BEFORE (INSECURE)
private async hashPassword(password: string): Promise<string> {
  return createHash('sha256').update(password + 'salt').digest('hex');
}

// AFTER (SECURE)
import bcrypt from 'bcrypt';

private async hashPassword(password: string): Promise<string> {
  const rounds = this.config.bcryptRounds || 12;
  return await bcrypt.hash(password, rounds);
}

private async verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}
```

**Step 3:** Update AuthConfig interface
```typescript
export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn?: string;
  apiKeyLength?: number;
  bcryptRounds?: number;     // Add this line
  sessionTimeout?: number;
  // ...
}
```

**Verification:**
```bash
npm run test -- auth-service.test
```

---

### 3. Remove Default Credentials
**Time Estimate:** 3 hours
**Files:** `src/api/auth-service.ts`, `src/cli/commands/init.ts`

**Step 1:** Remove hardcoded passwords (Lines 602-643)
```typescript
// BEFORE (INSECURE)
private initializeDefaultUsers(): void {
  const adminUser: User = {
    id: 'admin_default',
    email: 'admin@claude-flow.local',
    passwordHash: createHash('sha256').update('admin123' + 'salt').digest('hex'),
    // ...
  };
}

// AFTER (SECURE)
private async initializeDefaultUsers(): Promise<void> {
  // Check if admin already exists
  const existingAdmin = Array.from(this.users.values())
    .find(u => u.role === 'admin');

  if (!existingAdmin) {
    // Generate random password
    const randomPassword = this.generateSecurePassword();

    console.log('═══════════════════════════════════════════');
    console.log('IMPORTANT: SAVE THESE CREDENTIALS NOW');
    console.log('═══════════════════════════════════════════');
    console.log('Default Admin Credentials:');
    console.log(`Email: admin@claude-flow.local`);
    console.log(`Password: ${randomPassword}`);
    console.log('═══════════════════════════════════════════');
    console.log('You will NOT see this password again!');
    console.log('Please change it immediately after first login.');
    console.log('═══════════════════════════════════════════\n');

    const adminUser: User = {
      id: 'admin_default',
      email: 'admin@claude-flow.local',
      passwordHash: await this.hashPassword(randomPassword),
      role: 'admin',
      permissions: ROLE_PERMISSIONS.admin,
      apiKeys: [],
      isActive: true,
      loginAttempts: 0,
      mfaEnabled: false,
      mustChangePassword: true,  // Add this field
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.set(adminUser.id, adminUser);
  }
}

private generateSecurePassword(): string {
  const length = 24;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = require('crypto').randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }

  return password;
}
```

**Step 2:** Add password change enforcement
```typescript
async authenticateUser(email: string, password: string, ...): Promise<...> {
  // ... existing authentication code ...

  // After successful authentication
  if (user.mustChangePassword) {
    return {
      user,
      token,
      session,
      requirePasswordChange: true  // Signal to frontend
    };
  }

  return { user, token, session };
}
```

**Verification:**
1. Delete existing database
2. Start fresh instance
3. Verify random password is generated
4. Verify password change is required

---

## 🟠 HIGH PRIORITY - Fix Before v3.0.0

### 4. Fix Command Injection Vulnerabilities
**Time Estimate:** 4 hours
**Files:** `src/cli/commands/hook.ts`, `src/utils/error-recovery.ts`

**Fix 1:** Remove shell:true from spawn calls
```typescript
// File: src/cli/commands/hook.ts:184

// BEFORE (VULNERABLE)
const child = spawn('npx', ['ruv-swarm', 'hook', ...args], {
  stdio: 'inherit',
  shell: true,  // DANGEROUS
});

// AFTER (SECURE)
const child = spawn('npx', ['ruv-swarm', 'hook', ...args], {
  stdio: 'inherit',
  shell: false,  // SAFE
});
```

**Fix 2:** Add argument validation
```typescript
// File: src/cli/commands/hook.ts (add at top)

function validateHookArgs(args: string[]): void {
  const dangerousPatterns = [
    /[;&|`$()]/,           // Shell metacharacters
    /\.\.\//,              // Path traversal
    /~\//,                 // Home directory
    /^-/,                  // Options that could be exploited
  ];

  for (const arg of args) {
    for (const pattern of dangerousPatterns) {
      if (pattern.test(arg)) {
        throw new Error(`Potentially dangerous argument detected: ${arg}`);
      }
    }
  }
}

// Use before spawning
async function executeHook(hookType: string, options: Record<string, any>): Promise<void> {
  const args = buildArgs(hookType, options);
  validateHookArgs(args);  // Add this line

  // ... rest of function
}
```

**Verification:**
```bash
# Should fail with error
claude-flow hook pre-task --description "test; whoami"
claude-flow hook pre-task --description "test && ls"

# Should succeed
claude-flow hook pre-task --description "legitimate task description"
```

---

### 5. Add Path Traversal Protection
**Time Estimate:** 3 hours
**Files:** `src/utils/path-validator.ts` (new), `src/cli/commands/task.ts`

**Step 1:** Create path validation utility
```typescript
// File: src/utils/path-validator.ts (NEW FILE)

import { resolve, join, normalize, isAbsolute } from 'path';
import { access, constants } from 'fs/promises';

export class PathValidator {
  private allowedDirectories: Set<string>;

  constructor(allowedDirs: string[] = []) {
    this.allowedDirectories = new Set(
      allowedDirs.map(dir => resolve(normalize(dir)))
    );
  }

  /**
   * Validate that a file path is within allowed directories
   */
  async validatePath(userPath: string, baseDir?: string): Promise<string> {
    // Normalize and resolve path
    const normalizedPath = normalize(userPath);
    const resolvedPath = baseDir
      ? resolve(baseDir, normalizedPath)
      : resolve(normalizedPath);

    // Check for path traversal attempts
    if (normalizedPath.includes('..')) {
      throw new Error('Path traversal detected: .. not allowed');
    }

    // If no allowed directories specified, use current working directory
    if (this.allowedDirectories.size === 0) {
      const cwd = resolve(process.cwd());
      if (!resolvedPath.startsWith(cwd)) {
        throw new Error(`Path must be within current directory: ${cwd}`);
      }
    } else {
      // Check if path is within any allowed directory
      const isAllowed = Array.from(this.allowedDirectories)
        .some(allowedDir => resolvedPath.startsWith(allowedDir));

      if (!isAllowed) {
        throw new Error(`Path not within allowed directories`);
      }
    }

    // Verify file exists and is accessible
    try {
      await access(resolvedPath, constants.R_OK);
    } catch (error) {
      throw new Error(`File not accessible: ${resolvedPath}`);
    }

    return resolvedPath;
  }

  /**
   * Add an allowed directory
   */
  addAllowedDirectory(dir: string): void {
    this.allowedDirectories.add(resolve(normalize(dir)));
  }
}

export const defaultPathValidator = new PathValidator([
  process.cwd(),
  join(process.cwd(), '.claude-flow'),
  join(process.cwd(), 'workflows'),
]);
```

**Step 2:** Use in task command
```typescript
// File: src/cli/commands/task.ts:66

import { defaultPathValidator } from '../../utils/path-validator.js';

.action(async (workflowFile: string, options: any) => {
  try {
    // Validate path before reading
    const safePath = await defaultPathValidator.validatePath(workflowFile);
    const content = await fs.readFile(safePath, 'utf-8');
    const workflow = JSON.parse(content);
    // ... rest of function
  } catch (error) {
    console.error(chalk.red('Failed to load workflow:'), getErrorMessage(error));
    process.exit(1);
  }
});
```

**Verification:**
```bash
# Should fail
claude-flow task workflow ../../../etc/passwd
claude-flow task workflow ~/.ssh/id_rsa
claude-flow task workflow /etc/hosts

# Should succeed
claude-flow task workflow ./workflows/my-workflow.json
claude-flow task workflow workflows/test.json
```

---

### 6. Add Input Validation to Config Commands
**Time Estimate:** 2 hours
**Files:** `src/cli/commands/config.ts`

**Step 1:** Install Zod for schema validation
```bash
npm install zod
```

**Step 2:** Define config schemas
```typescript
// File: src/cli/commands/config.ts (add at top)

import { z } from 'zod';

// Define allowed config keys and their schemas
const CONFIG_SCHEMAS = {
  'theme': z.enum(['light', 'dark', 'auto']),
  'timeout': z.number().int().min(1000).max(300000),
  'logLevel': z.enum(['debug', 'info', 'warn', 'error']),
  'maxRetries': z.number().int().min(0).max(10),
  'cacheSizeMB': z.number().int().min(10).max(1000),
} as const;

const ALLOWED_CONFIG_KEYS = Object.keys(CONFIG_SCHEMAS);

// Prevent modification of sensitive keys
const PROTECTED_KEYS = [
  'authConfig',
  'jwtSecret',
  'apiKeys',
  'database',
  'credentials',
];
```

**Step 3:** Update set command
```typescript
// File: src/cli/commands/config.ts:28-50

.action(async (key: string, value: string) => {
  try {
    // Check if key is protected
    if (PROTECTED_KEYS.some(pk => key.startsWith(pk))) {
      console.error(chalk.red(`Cannot modify protected config key: ${key}`));
      process.exit(1);
    }

    // Check if key is allowed
    if (!ALLOWED_CONFIG_KEYS.includes(key)) {
      console.error(chalk.red(`Unknown config key: ${key}`));
      console.log(chalk.yellow(`Allowed keys: ${ALLOWED_CONFIG_KEYS.join(', ')}`));
      process.exit(1);
    }

    // Parse and validate value
    let parsedValue: any;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value; // Keep as string if not valid JSON
    }

    // Validate against schema
    const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS];
    const validatedValue = schema.parse(parsedValue);

    await configManager.set(key, validatedValue);
    console.log(
      chalk.green('✓'),
      `Configuration updated: ${key} = ${JSON.stringify(validatedValue)}`
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(chalk.red('Validation error:'), error.errors[0].message);
    } else {
      console.error(chalk.red('Failed to set configuration:'), (error as Error).message);
    }
    process.exit(1);
  }
});
```

**Verification:**
```bash
# Should fail
claude-flow config set "authConfig.jwtSecret" "hacked"
claude-flow config set "__proto__.isAdmin" "true"
claude-flow config set "timeout" "999999999"

# Should succeed
claude-flow config set "theme" "dark"
claude-flow config set "timeout" "30000"
```

---

### 7. Fix Weak Token Generation in MCP Auth
**Time Estimate:** 1 hour
**Files:** `src/mcp/auth.ts`

**Replace Math.random() with crypto.randomBytes()**
```typescript
// File: src/mcp/auth.ts:375-385

// BEFORE (INSECURE)
private createSecureToken(): string {
  const timestamp = Date.now().toString(36);
  const random1 = Math.random().toString(36).substring(2, 15);
  const random2 = Math.random().toString(36).substring(2, 15);
  const hash = createHash('sha256')
    .update(`${timestamp}${random1}${random2}`)
    .digest('hex')
    .substring(0, 32);

  return `mcp_${timestamp}_${hash}`;
}

// AFTER (SECURE)
import { randomBytes } from 'crypto';

private createSecureToken(): string {
  // Generate 32 bytes (256 bits) of cryptographically secure random data
  const tokenBytes = randomBytes(32);
  const token = tokenBytes.toString('hex');
  return `mcp_${token}`;
}
```

**Verification:**
```typescript
// Add test
describe('Token Generation', () => {
  it('should generate unique tokens', () => {
    const authManager = new AuthManager(config, logger);
    const token1 = authManager.generateToken('user1', []);
    const token2 = authManager.generateToken('user1', []);

    expect(token1).not.toBe(token2);
    expect(token1).toMatch(/^mcp_[a-f0-9]{64}$/);
  });
});
```

---

## 🟡 MEDIUM PRIORITY - Fix in v3.1.0

### 8. Implement Comprehensive Audit Logging
**Time Estimate:** 8 hours
**Files:** `src/audit/audit-logger.ts` (new)

```typescript
// File: src/audit/audit-logger.ts (NEW FILE)

import { ILogger } from '../core/logger.js';
import { promises as fs } from 'fs';
import { join } from 'path';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  userId?: string;
  sessionId?: string;
  action: string;
  resource: string;
  result: 'success' | 'failure' | 'denied';
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditLogger {
  private events: AuditEvent[] = [];
  private logPath: string;

  constructor(
    private logger: ILogger,
    logPath: string = './logs/audit.jsonl'
  ) {
    this.logPath = logPath;
  }

  async log(event: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
    const auditEvent: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: new Date(),
      ...event
    };

    this.events.push(auditEvent);

    // Write to file (JSONL format)
    const logLine = JSON.stringify(auditEvent) + '\n';
    await fs.appendFile(this.logPath, logLine, 'utf-8');

    // Log critical events
    if (event.result === 'failure' || event.result === 'denied') {
      this.logger.warn('Audit event', auditEvent);
    }
  }

  async query(filter: Partial<AuditEvent>): Promise<AuditEvent[]> {
    return this.events.filter(event => {
      return Object.entries(filter).every(([key, value]) => {
        return event[key as keyof AuditEvent] === value;
      });
    });
  }
}
```

**Integration:**
```typescript
// Use in auth-service.ts, permission-manager.ts, etc.
await auditLogger.log({
  userId: user.id,
  action: 'user.login',
  resource: 'authentication',
  result: 'success',
  metadata: { method: 'password' }
});
```

---

### 9. Add Secret Management
**Time Estimate:** 6 hours
**Files:** `src/secrets/secret-manager.ts` (new)

```typescript
// File: src/secrets/secret-manager.ts (NEW FILE)

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

export class SecretManager {
  private masterKey: Buffer;

  constructor(masterPassword: string) {
    // Derive master key from password using scrypt
    this.masterKey = scryptSync(masterPassword, 'salt', 32);
  }

  /**
   * Encrypt a secret
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return: iv + authTag + encrypted
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt a secret
   */
  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Store secret in environment
   */
  async storeSecret(key: string, value: string): Promise<void> {
    const encrypted = this.encrypt(value);
    // Store in secure storage (file, database, vault, etc.)
    // For now, just log warning
    console.warn(`Secret ${key} should be stored in secure vault`);
  }
}
```

---

## 🟢 LOW PRIORITY - Address in v3.2.0+

### 10. Add Rate Limiting
### 11. Implement OAuth 2.0
### 12. Add SIEM Integration
### 13. Set up Continuous Security Scanning

---

## Testing Checklist

After implementing each fix:

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Security tests pass
- [ ] Manual testing completed
- [ ] Code reviewed
- [ ] Documentation updated

## Verification Commands

```bash
# Run all tests
npm test

# Run security-specific tests
npm run test:security

# Check for vulnerabilities
npm audit

# Lint code
npm run lint

# Type check
npm run typecheck
```

## Timeline

| Week | Focus | Tasks |
|------|-------|-------|
| 1 | Critical Fixes | Tasks 1-3 |
| 2-3 | High Priority | Tasks 4-7 |
| 4-5 | Medium Priority | Tasks 8-9 |
| 6+ | Low Priority | Tasks 10-13 |

---

**Last Updated:** 2026-01-03
**Document Version:** 1.0
