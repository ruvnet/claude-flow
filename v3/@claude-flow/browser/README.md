# @claude-flow/browser

<div align="center">

[![npm version](https://img.shields.io/npm/v/@claude-flow/browser?style=for-the-badge&logo=npm&color=blue)](https://www.npmjs.com/package/@claude-flow/browser)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/browser?style=for-the-badge&logo=npm&color=cb3837)](https://www.npmjs.com/package/@claude-flow/browser)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/Tests-128%20passing-green?style=for-the-badge&logo=vitest)](./tests)

**AI-Optimized Browser Automation for Claude-Flow Swarms**

*Integrate [agent-browser](https://github.com/AugmentCode/agent-browser) with claude-flow for intelligent web automation, trajectory learning, security scanning, and multi-agent browser coordination.*

</div>

---

## Overview

`@claude-flow/browser` provides a comprehensive browser automation layer for AI agents, combining Vercel Labs' `agent-browser` CLI with claude-flow's learning, memory, and security capabilities. It enables agents to navigate websites, fill forms, extract data, and learn from successful interaction patterns.

### Architecture

```
Agent Request → Security Scan → Browser Adapter → agent-browser CLI → Playwright
                    ↓                                      ↓
              URL/PII Check                          Element Refs (@e1, @e2)
                    ↓                                      ↓
              Memory Store ← Trajectory ← Snapshot ← AI-Optimized DOM
```

### Key Features

🌐 **59 MCP Browser Tools** - Complete browser automation via MCP protocol with element refs, snapshots, forms, navigation, and JavaScript execution.

🔒 **Security-First Design** - Built-in URL validation, phishing detection, PII scanning, XSS/SQL injection prevention, and domain blocking.

🧠 **Trajectory Learning** - Records browser interactions for ReasoningBank/SONA learning. Successful patterns are stored and reused.

📊 **AI-Optimized Snapshots** - 93% context reduction using element refs (`@e1`, `@e2`) instead of full CSS selectors.

🐝 **Swarm Coordination** - Multi-session browser coordination for parallel scraping, testing, and validation tasks.

📋 **9 Workflow Templates** - Pre-built automation patterns for login, OAuth, scraping, form submission, and monitoring.

---

## Installation

```bash
# Install the package
npm install @claude-flow/browser

# Peer dependency (if not already installed)
npm install @claude-flow/cli@^3.0.0-alpha

# agent-browser CLI (required)
npm install -g agent-browser
```

### Requirements

- Node.js 18+
- `agent-browser` CLI installed globally
- Playwright browsers (installed automatically by agent-browser)

---

## Quick Start

### Basic Usage

```typescript
import { createBrowserService, browserTools } from '@claude-flow/browser';

// Create a browser service with security and memory enabled
const browser = createBrowserService({
  sessionId: 'my-session',
  enableSecurity: true,  // URL validation, PII detection
  enableMemory: true,    // Trajectory storage for learning
});

// Start tracking for learning
const trajectoryId = browser.startTrajectory('Login to dashboard');

// Navigate (automatically security-scanned)
await browser.open('https://example.com/login');

// Get AI-optimized snapshot with element refs
const snapshot = await browser.snapshot({ interactive: true });
// Returns: { refs: { '@e1': {role: 'textbox', name: 'Email'}, '@e2': ... } }

// Fill form using refs (93% less context than CSS selectors)
await browser.fill('@e1', 'user@example.com');
await browser.fill('@e2', 'password');
await browser.click('@e3'); // Submit button

// End trajectory and store for learning
const trajectory = await browser.endTrajectory(true, 'Login successful');

// Close browser
await browser.close();
```

### MCP Integration

Register browser tools with claude-flow's MCP server:

```typescript
import { browserTools } from '@claude-flow/browser';

// browserTools contains 59 MCP-compatible tools
// Register with your MCP server
mcpServer.registerTools(browserTools);
```

Available MCP tools:
- `browser/open` - Navigate to URL
- `browser/snapshot` - Get AI-optimized accessibility tree
- `browser/click` - Click element by ref or selector
- `browser/fill` - Fill input field
- `browser/type` - Type text with keyboard events
- `browser/screenshot` - Capture page screenshot
- `browser/wait` - Wait for element/condition
- `browser/eval` - Execute JavaScript
- And 51 more...

---

<details>
<summary><strong>🎯 Core Concepts</strong></summary>

### Element Refs (`@e1`, `@e2`, etc.)

agent-browser generates AI-optimized element references that reduce context by 93%:

```typescript
// Traditional (verbose)
await page.click('body > div.container > form#login > button[type="submit"].btn.btn-primary');

// With element refs (compact)
await browser.click('@e3');
```

Refs are generated from accessibility tree snapshots and map to interactive elements.

### Trajectory Tracking

Every browser session can record a trajectory for learning:

```typescript
// Start tracking
const id = browser.startTrajectory('Complete checkout flow');

// All actions are recorded: open, click, fill, type, etc.
await browser.open('https://shop.example.com/cart');
await browser.click('@e1'); // Checkout button
await browser.fill('@e2', '4111111111111111'); // Card number
// ...

// End with verdict
const trajectory = await browser.endTrajectory(true, 'Checkout completed successfully');

// Trajectory contains:
// - goal: 'Complete checkout flow'
// - steps: [{action: 'open', input: {...}, result: {...}, snapshot: {...}}, ...]
// - success: true
// - verdict: 'Checkout completed successfully'
```

Trajectories are automatically stored in memory and used by ReasoningBank for pattern learning.

### Security Scanning

All URLs are scanned before navigation:

```typescript
// Automatic scanning (enabled by default)
const result = await browser.open('http://suspicious-login.xyz');
// Returns: { success: false, error: 'Security scan failed: phishing detected' }

// Manual scanning
const scanResult = await browser.scanUrl('https://example.com');
// Returns: { safe: true, score: 1.0, threats: [], pii: [] }

// PII detection in form values
const piiResult = browser.scanForPII('SSN: 123-45-6789');
// Returns: { pii: [{type: 'ssn', masked: '***-**-6789', confidence: 0.95}] }
```

</details>

---

<details>
<summary><strong>🔌 Integrations</strong></summary>

### Memory Integration

Store and search browser patterns using HNSW-indexed memory:

```typescript
import { createMemoryManager } from '@claude-flow/browser';

const memory = createMemoryManager('session-1');

// Store a pattern
await memory.storePattern('login-github', 'Login to GitHub', [
  { action: 'fill', selector: '#login_field', value: '${username}' },
  { action: 'fill', selector: '#password', value: '${password}' },
  { action: 'click', selector: '[type="submit"]' },
], true);

// Find similar patterns (semantic search)
const similar = await memory.findSimilarTrajectories('Sign in to GitHub');

// Get session statistics
const stats = await memory.getSessionStats();
// { trajectories: 5, patterns: 12, snapshots: 23, errors: 1, successRate: 0.83 }
```

### Security Integration

Comprehensive threat detection:

```typescript
import { getSecurityScanner, isUrlSafe, containsPII } from '@claude-flow/browser';

const scanner = getSecurityScanner({
  requireHttps: true,
  blockedDomains: ['bit.ly', 'tinyurl.com'],
  allowedDomains: ['github.com', 'google.com'],
});

// URL scanning
const urlResult = await scanner.scanUrl('https://paypa1-secure.xyz/login');
// Detects: phishing (lookalike domain), suspicious TLD

// Content scanning
const contentResult = scanner.scanContent('Email: test@example.com, Card: 4111-1111-1111-1111');
// Detects: email, credit-card with masking

// Input validation (XSS, SQL injection)
const inputResult = scanner.validateInput('<script>alert(1)</script>', 'comment');
// Detects: xss threat

// Quick checks
await isUrlSafe('https://example.com'); // true
containsPII('My SSN is 123-45-6789'); // true
```

### Workflow Templates

Pre-built automation workflows:

```typescript
import { listWorkflows, getWorkflow, getWorkflowManager } from '@claude-flow/browser';

// List all templates
const workflows = listWorkflows();
// ['login-basic', 'login-oauth', 'logout', 'scrape-table', 'scrape-list',
//  'contact-form', 'visual-regression', 'smoke-test', 'uptime-check']

// Get specific template
const loginTemplate = getWorkflow('login-basic');
// {
//   id: 'login-basic',
//   name: 'Basic Login',
//   category: 'authentication',
//   variables: [{name: 'url', required: true}, {name: 'username'}, ...],
//   steps: [{action: 'open', target: '${url}'}, {action: 'fill', ...}, ...]
// }

// Validate variables
const manager = getWorkflowManager();
const validation = manager.validateVariables('login-basic', {
  url: 'https://example.com/login',
  username: 'user',
  password: 'pass',
});
// { valid: true, errors: [] }
```

#### Available Templates

| Template | Category | Description |
|----------|----------|-------------|
| `login-basic` | authentication | Standard username/password login |
| `login-oauth` | authentication | OAuth/SSO login flow (Google, GitHub) |
| `logout` | authentication | Standard logout flow |
| `scrape-table` | data-extraction | Extract data from HTML tables |
| `scrape-list` | data-extraction | Extract items from repeated elements |
| `contact-form` | form-submission | Fill and submit contact forms |
| `visual-regression` | testing | Screenshot-based visual testing |
| `smoke-test` | testing | Basic page load verification |
| `uptime-check` | monitoring | Page availability monitoring |

### Hooks Integration

Pre-browse and post-browse hooks for learning:

```typescript
import { preBrowseHook, postBrowseHook, browserHooks } from '@claude-flow/browser';

// Before browsing - get recommendations
const preResult = await preBrowseHook({
  goal: 'Login to admin panel',
  url: 'https://example.com/admin',
});
// {
//   recommendedSteps: [{action: 'fill', selector: '#username'}, ...],
//   similarPatterns: 3,
//   suggestedModel: 'sonnet',
//   estimatedDuration: 5000,
//   warnings: ['URL is not HTTPS - authentication data may be at risk']
// }

// After browsing - record outcome
const postResult = await postBrowseHook({
  trajectoryId: 'traj-123',
  success: true,
  verdict: 'Login successful',
  duration: 4500,
  stepsCompleted: 5,
});
// { patternStored: true, patternId: 'pattern-traj-123', learnedFrom: true }
```

</details>

---

<details>
<summary><strong>🐝 Swarm Coordination</strong></summary>

Coordinate multiple browser sessions for parallel tasks:

```typescript
import { createBrowserSwarm } from '@claude-flow/browser';

// Create a swarm coordinator
const swarm = createBrowserSwarm({
  topology: 'hierarchical',
  maxSessions: 5,
  sessionPrefix: 'scraper',
});

// Spawn browser agents with specific roles
const navigator = await swarm.spawnAgent('navigator');
const scraper1 = await swarm.spawnAgent('scraper');
const scraper2 = await swarm.spawnAgent('scraper');
const validator = await swarm.spawnAgent('validator');

// Share data between agents
swarm.shareData('targetUrls', ['https://example.com/page1', 'https://example.com/page2']);

// Each agent can access shared data
const urls = swarm.getSharedData<string[]>('targetUrls');

// Get swarm stats
const stats = swarm.getStats();
// { activeSessions: 4, maxSessions: 5, topology: 'hierarchical' }

// Close all sessions
await swarm.closeAll();
```

### Agent Roles

| Role | Capabilities | Use Case |
|------|-------------|----------|
| `navigator` | Navigation, authentication, session management | Login, navigate to pages |
| `scraper` | Snapshots, extraction, pagination | Data collection |
| `validator` | Assertions, state checks, screenshots | Verify results |
| `tester` | Forms, interactions, assertions | E2E testing |
| `monitor` | Network, console, errors | Performance monitoring |

</details>

---

<details>
<summary><strong>📚 API Reference</strong></summary>

### BrowserService

```typescript
interface BrowserServiceConfig {
  sessionId?: string;          // Browser session ID
  enableMemory?: boolean;      // Enable trajectory storage (default: true)
  enableSecurity?: boolean;    // Enable URL/PII scanning (default: true)
  requireHttps?: boolean;      // Require HTTPS URLs
  blockedDomains?: string[];   // Block specific domains
  allowedDomains?: string[];   // Allow only specific domains
  defaultTimeout?: number;     // Default operation timeout
  headless?: boolean;          // Run headless (default: true)
}

class BrowserService {
  // Trajectory tracking
  startTrajectory(goal: string): string;
  endTrajectory(success: boolean, verdict?: string): Promise<BrowserTrajectory | null>;
  getCurrentTrajectory(): TrajectoryTracker | null;

  // Navigation
  open(url: string, options?: OpenOptions): Promise<ActionResult>;
  close(): Promise<ActionResult>;

  // Snapshots
  snapshot(options?: SnapshotOptions): Promise<ActionResult<Snapshot>>;
  getLatestSnapshot(): Snapshot | null;

  // Interactions
  click(target: string, options?: ClickOptions): Promise<ActionResult>;
  fill(target: string, value: string, options?: FillOptions): Promise<ActionResult>;
  type(target: string, text: string, options?: TypeOptions): Promise<ActionResult>;
  press(key: string, delay?: number): Promise<ActionResult>;

  // Waiting
  wait(options: WaitOptions): Promise<ActionResult>;

  // Data extraction
  getText(target: string): Promise<ActionResult<string>>;
  eval<T>(script: string): Promise<ActionResult<T>>;
  extractData(refs: string[]): Promise<Record<string, string>>;

  // Screenshots
  screenshot(options?: ScreenshotOptions): Promise<ActionResult<string>>;

  // Security
  scanUrl(url: string): Promise<ThreatScanResult>;
  scanForPII(content: string, context?: string): ThreatScanResult;

  // Memory
  findSimilarTrajectories(goal: string, topK?: number): Promise<BrowserTrajectory[]>;
  getMemoryStats(): Promise<MemoryStats | null>;

  // High-level operations
  submitForm(fields: Array<{target: string, value: string}>, submitButton: string): Promise<ActionResult>;
  navigateAndWait(url: string, selector: string, timeout?: number): Promise<ActionResult>;
  authenticateWithHeaders(url: string, headers: Record<string, string>): Promise<ActionResult>;
}
```

### Security Scanner

```typescript
interface SecurityConfig {
  enableUrlValidation: boolean;
  enablePIIDetection: boolean;
  enableThreatScanning: boolean;
  blockedDomains: string[];
  allowedDomains: string[];
  maxRedirects: number;
  requireHttps: boolean;
  piiMaskingEnabled: boolean;
}

class BrowserSecurityScanner {
  scanUrl(url: string): Promise<ThreatScanResult>;
  scanContent(content: string, context?: string): ThreatScanResult;
  validateInput(value: string, fieldType: string): ThreatScanResult;
  sanitizeInput(value: string): string;
  maskPII(value: string, type: PIIType): string;
}

interface ThreatScanResult {
  safe: boolean;
  threats: Threat[];
  pii: PIIMatch[];
  score: number;  // 0-1 (1 = safe)
  scanDuration: number;
}
```

### Memory Manager

```typescript
class BrowserMemoryManager {
  storeTrajectory(trajectory: BrowserTrajectory): Promise<void>;
  storePattern(id: string, goal: string, steps: PatternStep[], success: boolean): Promise<void>;
  storeSnapshot(id: string, snapshot: Snapshot): Promise<void>;
  storeError(id: string, error: Error, context: object): Promise<void>;
  findSimilarTrajectories(goal: string, topK?: number): Promise<BrowserTrajectory[]>;
  findPatterns(goal: string, successfulOnly?: boolean): Promise<MemorySearchResult[]>;
  getSessionStats(): Promise<SessionStats>;
}
```

</details>

---

<details>
<summary><strong>🧪 Testing</strong></summary>

### Unit Tests

```bash
# Run all tests
npm test

# Run with watch mode
npm run test:watch

# Run specific test file
npm test -- tests/security-integration.test.ts
```

### E2E Tests (Docker)

```bash
# Navigate to docker directory
cd docker

# Run E2E tests with browser
docker compose --profile e2e up browser-e2e

# Run in debug mode (keeps container running)
docker compose --profile debug up browser-debug
```

### Test Coverage

| Component | Tests | Status |
|-----------|-------|--------|
| BrowserService | 18 | ✅ |
| AgentBrowserAdapter | 27 | ✅ |
| SecurityScanner | 30 | ✅ |
| MemoryManager | 16 | ✅ |
| WorkflowTemplates | 25 | ✅ |
| ReasoningBankAdapter | 12 | ✅ |
| **Total** | **128** | ✅ |

</details>

---

<details>
<summary><strong>⚙️ Configuration</strong></summary>

### TypeScript

```typescript
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true
  }
}
```

### Environment Variables

```bash
# Browser settings
BROWSER_HEADLESS=true
BROWSER_DEFAULT_TIMEOUT=30000

# Security settings
BROWSER_REQUIRE_HTTPS=true
BROWSER_BLOCKED_DOMAINS=bit.ly,tinyurl.com

# Memory settings
BROWSER_ENABLE_MEMORY=true
BROWSER_MEMORY_NAMESPACE=browser
```

</details>

---

<details>
<summary><strong>💡 Examples</strong></summary>

### Login and Extract Data

```typescript
import { createBrowserService } from '@claude-flow/browser';

const browser = createBrowserService();

async function loginAndExtract() {
  browser.startTrajectory('Login and extract user data');

  // Login
  await browser.open('https://app.example.com/login');
  await browser.fill('#email', 'user@example.com');
  await browser.fill('#password', 'secretpassword');
  await browser.click('#login-button');

  // Wait for dashboard
  await browser.wait({ selector: '.dashboard' });

  // Get snapshot and extract data
  const snapshot = await browser.snapshot({ interactive: true });
  const data = await browser.extractData(['@e1', '@e2', '@e3']);

  await browser.endTrajectory(true, 'Data extracted successfully');
  await browser.close();

  return data;
}
```

### Parallel Scraping

```typescript
import { createBrowserSwarm } from '@claude-flow/browser';

async function parallelScrape(urls: string[]) {
  const swarm = createBrowserSwarm({ maxSessions: 5 });
  const results: any[] = [];

  // Spawn scrapers for each URL
  const promises = urls.map(async (url) => {
    const scraper = await swarm.spawnAgent('scraper');
    await scraper.open(url);
    const snapshot = await scraper.snapshot();
    const text = await scraper.getText('main');
    return { url, content: text.data };
  });

  const data = await Promise.all(promises);
  await swarm.closeAll();

  return data;
}
```

### Security-First Automation

```typescript
import { createBrowserService, getSecurityScanner } from '@claude-flow/browser';

async function secureAutomation(url: string, formData: Record<string, string>) {
  const scanner = getSecurityScanner({ requireHttps: true });

  // Pre-scan URL
  const urlScan = await scanner.scanUrl(url);
  if (!urlScan.safe) {
    throw new Error(`Unsafe URL: ${urlScan.threats.map(t => t.description).join(', ')}`);
  }

  // Scan form data for sensitive info
  for (const [field, value] of Object.entries(formData)) {
    const piiScan = scanner.scanContent(value, field);
    if (piiScan.pii.length > 0) {
      console.log(`Warning: PII detected in ${field}:`, piiScan.pii.map(p => p.type));
    }
  }

  // Proceed with automation
  const browser = createBrowserService({ enableSecurity: true });
  await browser.open(url);

  for (const [selector, value] of Object.entries(formData)) {
    await browser.fill(selector, value);
  }

  await browser.close();
}
```

</details>

---

<details>
<summary><strong>🔧 Troubleshooting</strong></summary>

### Common Issues

**agent-browser not found**
```bash
npm install -g agent-browser
```

**Playwright browsers missing**
```bash
npx playwright install
```

**Security scan blocking legitimate URLs**
```typescript
const browser = createBrowserService({
  allowedDomains: ['trusted-domain.com'],
  // Or disable for specific navigations
});
await browser.open('http://trusted-domain.com', { skipSecurityCheck: true });
```

**Memory not persisting**
```typescript
// Ensure endTrajectory is called
const trajectory = await browser.endTrajectory(true); // Must await!
```

</details>

---

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) in the root repository.

## License

MIT License - see [LICENSE](../../LICENSE) for details.

## Links

- [GitHub Repository](https://github.com/ruvnet/claude-flow)
- [agent-browser](https://github.com/AugmentCode/agent-browser)
- [Claude-Flow Documentation](https://github.com/ruvnet/claude-flow#readme)
- [MCP Protocol](https://modelcontextprotocol.io)

---

<div align="center">

**Part of the [Claude-Flow](https://github.com/ruvnet/claude-flow) ecosystem**

Made with ❤️ by [ruvnet](https://github.com/ruvnet)

</div>
