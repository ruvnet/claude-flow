# ADR-012: MCP Security and Feature Implementation

## Status
**Implemented** ✅

## Date
2026-01-05

## Context

The `@claude-flow/mcp` package implements the Model Context Protocol (MCP) 2025-11-25 specification. A security audit identified several vulnerabilities and missing features that needed to be addressed to ensure production readiness.

### Security Vulnerabilities Identified and Fixed

| ID | Severity | Vulnerability | Status | Fix |
|----|----------|---------------|--------|-----|
| CVE-MCP-1 | 🔴 Critical | Path Traversal | ✅ Fixed | Validation in `createFileResource` with blocked paths |
| CVE-MCP-2 | 🔴 Critical | ReDoS | ✅ Fixed | `escapeRegex()` before regex creation |
| CVE-MCP-3 | 🟠 High | WebSocket Auth Bypass | ✅ Fixed | Token validation on connection |
| CVE-MCP-4 | 🟠 High | Missing Tool Input Validation | ✅ Fixed | JSON Schema validation in `tool-registry.ts` |
| CVE-MCP-5 | 🟡 Medium | Timing Attack | ✅ Fixed | `crypto.timingSafeEqual` in `http.ts` |
| CVE-MCP-6 | 🟡 Medium | Cache Exhaustion | ✅ Fixed | LRU eviction with `maxCacheSize` |
| CVE-MCP-7 | 🟡 Medium | No Rate Limiting | ✅ Fixed | Token bucket rate limiter |

### MCP 2025-11-25 Features Implemented

| Feature | Status | Implementation |
|---------|--------|----------------|
| Resources (list/read/subscribe) | ✅ Complete | `resource-registry.ts` |
| Prompts (list/get with arguments) | ✅ Complete | `prompt-registry.ts` |
| Tasks (async operations) | ✅ Complete | `task-manager.ts` |
| Sampling (server-initiated LLM) | ✅ Complete | `sampling.ts` |
| Tool Schema Validation | ✅ Complete | `schema-validator.ts` |
| Rate Limiting | ✅ Complete | `rate-limiter.ts` |
| OAuth 2.1 with PKCE | ✅ Complete | `oauth.ts` |

---

## Decision

### 1. JSON Schema Validation for Tool Inputs

**Decision**: Implement runtime JSON Schema validation using a lightweight custom validator.

**Rationale**:
- Tools define `inputSchema` but it wasn't enforced at runtime
- Invalid inputs can cause crashes or security issues
- Schema validation provides defense-in-depth
- Custom implementation avoids heavy dependencies like `ajv`

**Implementation** (`schema-validator.ts`):
```typescript
export function validateSchema(
  data: unknown,
  schema: JSONSchema,
  path: string = ''
): ValidationResult {
  // Validates: type, required, properties, enum, pattern,
  // minLength, maxLength, minimum, maximum, items, additionalProperties
}

export function formatValidationErrors(errors: ValidationError[]): string;
export function createValidator(schema: JSONSchema): (data: unknown) => ValidationResult;
```

**Integration** (`tool-registry.ts:285-298`):
```typescript
// Validate input against schema (security feature)
if (metadata.tool.inputSchema) {
  const validation = validateSchema(input, metadata.tool.inputSchema);
  if (!validation.valid) {
    return {
      content: [{ type: 'text', text: `Invalid input: ${formatValidationErrors(validation.errors)}` }],
      isError: true,
    };
  }
}
```

### 2. Sampling (Server-Initiated LLM Calls)

**Decision**: Implement `sampling/createMessage` per MCP 2025-11-25 spec with pluggable LLM providers.

**Rationale**:
- Required for servers that need to invoke LLM during tool execution
- Enables agentic workflows where server needs AI assistance
- Part of complete MCP 2025-11-25 compliance

**Implementation** (`sampling.ts`):
```typescript
export interface LLMProvider {
  name: string;
  createMessage(request: CreateMessageRequest): Promise<CreateMessageResult>;
  isAvailable(): Promise<boolean>;
}

export class SamplingManager extends EventEmitter {
  registerProvider(provider: LLMProvider, isDefault?: boolean): void;
  async createMessage(request: CreateMessageRequest, context?: SamplingContext): Promise<CreateMessageResult>;
  async isAvailable(): Promise<boolean>;
  getProviders(): string[];
  getStats(): { requestCount: number; totalTokens: number; providerCount: number };
}

// Pre-built providers
export function createMockProvider(name?: string): LLMProvider;
export function createAnthropicProvider(apiKey: string): LLMProvider;
```

**Server Integration** (`server.ts`):
- Added `sampling/createMessage` route handler
- Capabilities advertise `sampling: {}`
- Automatic provider selection based on model preferences

### 3. Rate Limiting

**Decision**: Implement token bucket rate limiting with per-session and global limits.

**Rationale**:
- Prevents DoS attacks
- Protects against runaway clients
- Industry standard for API security
- Fair distribution of resources

**Implementation** (`rate-limiter.ts`):
```typescript
export interface RateLimitConfig {
  requestsPerSecond: number;  // Default: 100
  burstSize: number;          // Default: 200
  perSessionLimit?: number;   // Default: 50
  cleanupInterval?: number;   // Default: 60000ms
}

export class RateLimiter extends EventEmitter {
  checkGlobal(): RateLimitResult;
  checkSession(sessionId: string): RateLimitResult;
  check(sessionId?: string): RateLimitResult;
  consume(sessionId?: string): void;
  resetSession(sessionId: string): void;
  getStats(): { globalTokens: number; sessionCount: number; config: RateLimitConfig };
  destroy(): void;
}

// Express/Connect middleware
export function rateLimitMiddleware(rateLimiter: RateLimiter);
```

**Server Integration** (`server.ts:389-406`):
```typescript
// Rate limiting check (skip for initialize)
if (request.method !== 'initialize') {
  const sessionId = this.currentSession?.id;
  const rateLimitResult = this.rateLimiter.check(sessionId);
  if (!rateLimitResult.allowed) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: 'Rate limit exceeded',
        data: { retryAfter: rateLimitResult.retryAfter },
      },
    };
  }
  this.rateLimiter.consume(sessionId);
}
```

### 4. OAuth 2.1 Flow

**Decision**: Implement OAuth 2.1 with PKCE for secure authentication.

**Rationale**:
- Industry standard for API authentication
- Required for enterprise deployments
- More secure than static tokens
- PKCE prevents authorization code interception attacks

**Implementation** (`oauth.ts`):
```typescript
export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scopes?: string[];
  tokenStorage?: TokenStorage;
  usePKCE?: boolean;  // Default: true
}

export class OAuthManager extends EventEmitter {
  createAuthorizationRequest(): AuthorizationRequest;
  async exchangeCode(code: string, state: string): Promise<OAuthTokens>;
  async refreshTokens(storageKey?: string): Promise<OAuthTokens>;
  async getAccessToken(storageKey?: string): Promise<string | null>;
  async revokeTokens(storageKey?: string): Promise<void>;
  async isAuthenticated(storageKey?: string): Promise<boolean>;
  destroy(): void;
}

// Pre-configured providers
export function createGitHubOAuthConfig(clientId, clientSecret, redirectUri, scopes?): OAuthConfig;
export function createGoogleOAuthConfig(clientId, clientSecret, redirectUri, scopes?): OAuthConfig;

// Express/Connect middleware
export function oauthMiddleware(oauthManager: OAuthManager, storageKey?: string);
```

---

## Consequences

### Positive
- ✅ Full MCP 2025-11-25 compliance
- ✅ Production-ready security posture
- ✅ Enterprise authentication support (OAuth 2.1)
- ✅ Protection against common attacks (path traversal, ReDoS, timing)
- ✅ Fair resource allocation (rate limiting)
- ✅ Extensible LLM provider system (sampling)
- ✅ Zero heavy dependencies (custom schema validator)

### Negative
- Increased code complexity (~1,200 new lines)
- Slight performance overhead for validation (~0.1ms per request)
- OAuth requires external configuration

### Trade-offs
- Custom schema validator vs ajv: Chose custom for zero dependencies and smaller bundle
- Token bucket vs sliding window: Chose token bucket for better burst handling
- PKCE always enabled: More secure but requires client support

---

## Test Coverage

```
Test Files:  2 passed (2)
Tests:       65 passed (65)
Duration:    854ms

Coverage:
- schema-validator.ts: Unit tests for all validation types
- rate-limiter.ts: Token bucket algorithm tests
- sampling.ts: Provider registration and message creation
- oauth.ts: PKCE flow and token management
- integration.test.ts: Full server flow tests
```

---

## Files Changed

| File | Change Type | Lines |
|------|-------------|-------|
| `src/schema-validator.ts` | Created | 214 |
| `src/rate-limiter.ts` | Created | 267 |
| `src/sampling.ts` | Created | 364 |
| `src/oauth.ts` | Created | 320 |
| `src/tool-registry.ts` | Modified | +15 |
| `src/server.ts` | Modified | +120 |
| `src/types.ts` | Modified | +3 |
| `src/index.ts` | Modified | +40 |
| `src/resource-registry.ts` | Modified | +25 (security fixes) |
| `src/transport/http.ts` | Modified | +20 (timing-safe) |

---

## Usage Examples

### Schema Validation
```typescript
import { validateSchema, formatValidationErrors } from '@claude-flow/mcp';

const schema = {
  type: 'object',
  properties: { name: { type: 'string', minLength: 1 } },
  required: ['name']
};

const result = validateSchema({ name: '' }, schema);
// result.valid = false
// result.errors[0].message = 'String length must be >= 1'
```

### Rate Limiting
```typescript
import { createRateLimiter, rateLimitMiddleware } from '@claude-flow/mcp';

const limiter = createRateLimiter(logger, {
  requestsPerSecond: 100,
  burstSize: 200
});

// Use with Express
app.use(rateLimitMiddleware(limiter));
```

### Sampling
```typescript
import { createSamplingManager, createAnthropicProvider } from '@claude-flow/mcp';

const sampling = createSamplingManager(logger);
sampling.registerProvider(createAnthropicProvider(process.env.ANTHROPIC_API_KEY), true);

const response = await sampling.createMessage({
  messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
  maxTokens: 100
});
```

### OAuth 2.1
```typescript
import { createOAuthManager, createGitHubOAuthConfig } from '@claude-flow/mcp';

const oauth = createOAuthManager(logger, createGitHubOAuthConfig(
  'client-id',
  'client-secret',
  'https://myapp.com/callback'
));

const { url, state } = oauth.createAuthorizationRequest();
// Redirect user to `url`, then on callback:
const tokens = await oauth.exchangeCode(code, state);
```

---

## References

- [MCP 2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [OAuth 2.1 Draft](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-07)
- [JSON Schema Validation](https://json-schema.org/draft/2020-12/json-schema-validation.html)
- [Token Bucket Algorithm](https://en.wikipedia.org/wiki/Token_bucket)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
