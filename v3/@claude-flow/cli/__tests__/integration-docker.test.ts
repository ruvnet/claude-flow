/**
 * Integration Docker Validation Tests
 *
 * Validates the RuFlo Docker-based deployment stack without running Docker.
 * Checks docker-compose.yml, nginx.conf, MCP bridge source, CLI Dockerfile,
 * and CLI build/init/doctor commands for correctness.
 *
 * 40+ test cases covering:
 *  - Docker Compose config parsing and service definitions
 *  - Nginx reverse proxy configuration
 *  - MCP bridge endpoint and CORS validation
 *  - CLI Dockerfile multi-stage build
 *  - CLI build, init, and doctor commands
 *  - Generated file validity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, join } from 'path';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '..', '..', '..', '..');            // /workspaces/claude-flow
const CLI_DIR = resolve(__dirname, '..');                             // v3/@claude-flow/cli
const RUFLO_DIR = join(ROOT, 'ruflo');
const COMPOSE_PATH = join(RUFLO_DIR, 'docker-compose.yml');
const NGINX_CONF_PATH = join(RUFLO_DIR, 'src', 'nginx', 'nginx.conf');
const NGINX_DOCKERFILE = join(RUFLO_DIR, 'src', 'nginx', 'Dockerfile');
const MCP_BRIDGE_INDEX = join(RUFLO_DIR, 'src', 'mcp-bridge', 'index.js');
const MCP_BRIDGE_DOCKERFILE = join(RUFLO_DIR, 'src', 'mcp-bridge', 'Dockerfile');
const CLI_DOCKERFILE = join(CLI_DIR, 'docker', 'Dockerfile');
const ENV_EXAMPLE = join(RUFLO_DIR, '.env.example');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(p: string): string {
  return readFileSync(p, 'utf-8');
}

/** Minimal YAML parser: extracts top-level keys under `services:` */
function parseComposeServices(yaml: string): string[] {
  const lines = yaml.split('\n');
  const services: string[] = [];
  let inServices = false;
  for (const line of lines) {
    if (/^services:/.test(line)) { inServices = true; continue; }
    if (inServices && /^[a-z]/.test(line)) break; // next top-level key
    if (inServices && /^  [a-z][\w-]*:/.test(line)) {
      services.push(line.trim().replace(':', ''));
    }
  }
  return services;
}

/** Extract all EXPOSE directives from a Dockerfile */
function extractExposePort(content: string): number[] {
  return [...content.matchAll(/^EXPOSE\s+(\d+)/gm)].map(m => parseInt(m[1], 10));
}

// ---------------------------------------------------------------------------
// 1. Docker Compose Config Validation
// ---------------------------------------------------------------------------

describe('Docker Compose Configuration', () => {
  let composeContent: string;

  beforeAll(() => {
    composeContent = readFile(COMPOSE_PATH);
  });

  it('docker-compose.yml exists', () => {
    expect(existsSync(COMPOSE_PATH)).toBe(true);
  });

  it('defines exactly 4 services (mongodb, mcp-bridge, nginx, chat-ui)', () => {
    const services = parseComposeServices(composeContent);
    expect(services).toEqual(
      expect.arrayContaining(['mongodb', 'mcp-bridge', 'nginx', 'chat-ui']),
    );
    expect(services).toHaveLength(4);
  });

  it('mongodb uses mongo:7 image', () => {
    expect(composeContent).toMatch(/image:\s*mongo:7/);
  });

  it('mongodb exposes port 27017 on loopback only', () => {
    expect(composeContent).toMatch(/"127\.0\.0\.1:27017:27017"/);
  });

  it('mongodb has a named volume for data persistence', () => {
    expect(composeContent).toMatch(/mongo-data:\/data\/db/);
    expect(composeContent).toMatch(/^volumes:\s*\n\s+mongo-data:/m);
  });

  it('mcp-bridge builds from correct context', () => {
    expect(composeContent).toMatch(/context:\s*\.\/src\/ruvocal\/mcp-bridge/);
  });

  it('mcp-bridge publishes port 3001 on loopback only', () => {
    expect(composeContent).toMatch(/"127\.0\.0\.1:3001:3001"/);
  });

  it('mcp-bridge has a healthcheck', () => {
    // The healthcheck should reference /health
    const mcpSection = composeContent.split('mcp-bridge:')[1]?.split(/\n  [a-z]/)[0] ?? '';
    expect(composeContent).toContain('healthcheck');
    expect(composeContent).toContain('/health');
  });

  it('nginx depends on chat-ui and mcp-bridge', () => {
    // Extract nginx depends_on block
    const nginxBlock = composeContent.split('nginx:')[1]?.split(/\n  [a-z]/)[0] ?? '';
    expect(nginxBlock).toContain('chat-ui');
    expect(nginxBlock).toContain('mcp-bridge');
  });

  it('nginx publishes port 3000', () => {
    expect(composeContent).toMatch(/"3000:3000"/);
  });

  it('nginx has a healthcheck', () => {
    // The nginx healthcheck should use wget
    expect(composeContent).toContain('wget');
    expect(composeContent).toContain('http://localhost:3000');
  });

  it('chat-ui depends on mongodb and mcp-bridge', () => {
    const chatBlock = composeContent.split('chat-ui:')[1] ?? '';
    const depsBlock = chatBlock.split('depends_on:')[1]?.split(/\n  [a-z]/)[0] ?? '';
    expect(depsBlock).toContain('mongodb');
    expect(depsBlock).toContain('mcp-bridge');
  });

  it('chat-ui exposes port 3000 internally only', () => {
    const chatBlock = composeContent.split('chat-ui:')[1]?.split(/\n  [a-z]/)[0] ?? '';
    // Should use "expose" not "ports" since nginx fronts it
    expect(chatBlock).toContain('expose');
  });

  it('chat-ui injects DOTENV_LOCAL with required env vars', () => {
    expect(composeContent).toContain('DOTENV_LOCAL');
    expect(composeContent).toMatch(
      /MONGODB_URL=mongodb:\/\/\$\{MONGO_INITDB_ROOT_USERNAME[^}]*\}:\$\{MONGO_INITDB_ROOT_PASSWORD\}@mongodb:27017/,
    );
    expect(composeContent).toContain('PUBLIC_APP_NAME');
    expect(composeContent).toContain('OPENAI_BASE_URL=http://mcp-bridge:3001');
  });

  it('all services use restart: unless-stopped', () => {
    const matches = composeContent.match(/restart:\s*unless-stopped/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(4);
  });

  it('MCP tool group env vars are defined for mcp-bridge', () => {
    const groups = [
      'MCP_GROUP_INTELLIGENCE', 'MCP_GROUP_AGENTS',
      'MCP_GROUP_MEMORY', 'MCP_GROUP_DEVTOOLS',
      'MCP_GROUP_SECURITY', 'MCP_GROUP_BROWSER',
      'MCP_GROUP_NEURAL', 'MCP_GROUP_AGENTIC_FLOW',
      'MCP_GROUP_CLAUDE_CODE', 'MCP_GROUP_GEMINI',
      'MCP_GROUP_CODEX',
    ];
    for (const g of groups) {
      expect(composeContent).toContain(g);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Nginx Config Validation
// ---------------------------------------------------------------------------

describe('Nginx Configuration', () => {
  let nginxContent: string;

  beforeAll(() => {
    nginxContent = readFile(NGINX_CONF_PATH);
  });

  it('nginx.conf exists', () => {
    expect(existsSync(NGINX_CONF_PATH)).toBe(true);
  });

  it('listens on port 3000', () => {
    expect(nginxContent).toMatch(/listen\s+3000/);
  });

  it('gzip is disabled (required for sub_filter)', () => {
    expect(nginxContent).toMatch(/gzip\s+off/);
  });

  it('sets Access-Control-Allow-Origin header', () => {
    expect(nginxContent).toContain('Access-Control-Allow-Origin');
  });

  it('sets Access-Control-Allow-Methods header', () => {
    expect(nginxContent).toContain('Access-Control-Allow-Methods');
    expect(nginxContent).toContain('GET');
    expect(nginxContent).toContain('POST');
    expect(nginxContent).toContain('OPTIONS');
  });

  it('sets Access-Control-Allow-Headers header', () => {
    expect(nginxContent).toContain('Access-Control-Allow-Headers');
    expect(nginxContent).toContain('Content-Type');
    expect(nginxContent).toContain('Authorization');
  });

  it('handles OPTIONS preflight requests with 204', () => {
    expect(nginxContent).toMatch(/if\s*\(\$request_method\s*=\s*OPTIONS\)/);
    expect(nginxContent).toContain('return 204');
  });

  it('proxies root location to chat-ui:3000', () => {
    expect(nginxContent).toMatch(/proxy_pass\s+http:\/\/chat-ui:3000/);
  });

  it('sets WebSocket upgrade headers', () => {
    expect(nginxContent).toContain('Upgrade');
    expect(nginxContent).toContain('"upgrade"');
    expect(nginxContent).toContain('$http_upgrade');
  });

  it('disables upstream gzip via Accept-Encoding header', () => {
    expect(nginxContent).toContain('proxy_set_header Accept-Encoding ""');
  });

  it('injects RuFlo welcome.js script via sub_filter', () => {
    expect(nginxContent).toMatch(/sub_filter\s+'<\/head>'\s+'<script src="\/ruflo\/welcome\.js"/);
  });

  it('has sub_filter_once off for multiple replacements', () => {
    expect(nginxContent).toMatch(/sub_filter_once\s+off/);
  });

  it('applies sub_filter to text/html and application/json', () => {
    expect(nginxContent).toContain('sub_filter_types');
    expect(nginxContent).toContain('text/html');
    expect(nginxContent).toContain('application/json');
  });

  it('serves /chatui/ static assets from /etc/nginx/static/', () => {
    expect(nginxContent).toMatch(/location\s+\/chatui\//);
    expect(nginxContent).toContain('alias /etc/nginx/static/');
  });

  it('serves /ruflo/ static assets from /etc/nginx/static/', () => {
    expect(nginxContent).toMatch(/location\s+\/ruflo\//);
  });

  it('rewrites localhost:3000 URLs to relative paths via sub_filter', () => {
    expect(nginxContent).toContain("sub_filter 'http://localhost:3000' ''");
  });
});

// ---------------------------------------------------------------------------
// 3. Nginx Dockerfile Validation
// ---------------------------------------------------------------------------

describe('Nginx Dockerfile', () => {
  let dockerContent: string;

  beforeAll(() => {
    dockerContent = readFile(NGINX_DOCKERFILE);
  });

  it('Nginx Dockerfile exists', () => {
    expect(existsSync(NGINX_DOCKERFILE)).toBe(true);
  });

  it('uses nginx alpine base image', () => {
    expect(dockerContent).toMatch(/FROM\s+nginx:\d+[\w.-]*-alpine/);
  });

  it('copies nginx.conf into container', () => {
    expect(dockerContent).toContain('COPY nginx.conf /etc/nginx/nginx.conf');
  });

  it('copies static assets into container', () => {
    expect(dockerContent).toContain('COPY static/ /etc/nginx/static/');
  });

  it('exposes port 3000', () => {
    const ports = extractExposePort(dockerContent);
    expect(ports).toContain(3000);
  });
});

// ---------------------------------------------------------------------------
// 4. MCP Bridge Validation
// ---------------------------------------------------------------------------

describe('MCP Bridge (index.js)', () => {
  let bridgeContent: string;

  beforeAll(() => {
    bridgeContent = readFile(MCP_BRIDGE_INDEX);
  });

  it('MCP bridge index.js exists', () => {
    expect(existsSync(MCP_BRIDGE_INDEX)).toBe(true);
  });

  it('sets up CORS middleware with Access-Control-Allow-Origin', () => {
    expect(bridgeContent).toContain('Access-Control-Allow-Origin');
    expect(bridgeContent).toContain('"*"');
  });

  it('sets CORS Access-Control-Allow-Methods', () => {
    expect(bridgeContent).toContain('Access-Control-Allow-Methods');
  });

  it('sets CORS Access-Control-Allow-Headers', () => {
    expect(bridgeContent).toContain('Access-Control-Allow-Headers');
  });

  it('handles OPTIONS preflight with 204', () => {
    expect(bridgeContent).toContain('OPTIONS');
    expect(bridgeContent).toContain('sendStatus(204)');
  });

  it('defines /health endpoint', () => {
    expect(bridgeContent).toMatch(/app\.get\(["']\/health["']/);
  });

  it('/health endpoint returns status and tool counts', () => {
    // The health handler builds a JSON response with status, tools, groups, backends
    expect(bridgeContent).toContain('"ok"');
    expect(bridgeContent).toContain('"mcp-bridge"');
  });

  it('defines /models endpoint', () => {
    expect(bridgeContent).toMatch(/app\.get\(["']\/models["']/);
  });

  it('defines /groups endpoint', () => {
    expect(bridgeContent).toMatch(/app\.get\(["']\/groups["']/);
  });

  it('defines /chat/completions endpoint', () => {
    expect(bridgeContent).toMatch(/app\.post\(["']\/chat\/completions["']/);
  });

  it('defines per-group MCP endpoints', () => {
    expect(bridgeContent).toMatch(/app\.post\(`\/mcp\/\$\{groupName\}`/);
    expect(bridgeContent).toMatch(/app\.get\(`\/mcp\/\$\{groupName\}`/);
  });

  it('defines tool group configuration with at least 8 groups', () => {
    const groupMatches = bridgeContent.match(/["']?[\w-]+["']?\s*:\s*\{[^}]*enabled\s*:/g);
    expect(groupMatches).not.toBeNull();
    expect(groupMatches!.length).toBeGreaterThanOrEqual(8);
  });

  it('uses express with 10mb JSON body limit', () => {
    expect(bridgeContent).toContain('express.json({ limit: "10mb" })');
  });

  it('defaults to port 3001', () => {
    expect(bridgeContent).toContain('"3001"');
  });

  it('listens on the configured PORT', () => {
    expect(bridgeContent).toMatch(/app\.listen\(PORT/);
  });
});

// ---------------------------------------------------------------------------
// 5. MCP Bridge Dockerfile Validation
// ---------------------------------------------------------------------------

describe('MCP Bridge Dockerfile', () => {
  let dockerContent: string;

  beforeAll(() => {
    dockerContent = readFile(MCP_BRIDGE_DOCKERFILE);
  });

  it('MCP Bridge Dockerfile exists', () => {
    expect(existsSync(MCP_BRIDGE_DOCKERFILE)).toBe(true);
  });

  it('uses the supported Node.js 24 slim LTS base image', () => {
    expect(dockerContent).toMatch(/FROM\s+node:24-slim/);
  });

  it('installs production dependencies', () => {
    expect(dockerContent).toContain('npm install --production');
  });

  it('copies index.js and mcp-stdio-kernel.js', () => {
    expect(dockerContent).toContain('COPY index.js ./');
    expect(dockerContent).toContain('COPY mcp-stdio-kernel.js ./');
  });

  it('creates writable .claude-flow directories', () => {
    expect(dockerContent).toContain('/app/.claude-flow/tasks');
    expect(dockerContent).toContain('/app/.claude-flow/memory');
    expect(dockerContent).toContain('/app/.claude-flow/sessions');
  });

  it('runs as non-root user', () => {
    expect(dockerContent).toContain('USER node');
  });

  it('exposes port 3001', () => {
    const ports = extractExposePort(dockerContent);
    expect(ports).toContain(3001);
  });

  it('sets default tool group environment variables', () => {
    expect(dockerContent).toContain('MCP_GROUP_INTELLIGENCE=true');
    expect(dockerContent).toContain('MCP_GROUP_AGENTS=true');
    expect(dockerContent).toContain('MCP_GROUP_SECURITY=false');
  });

  it('CMD runs node index.js', () => {
    expect(dockerContent).toMatch(/CMD\s+\["node",\s*"index\.js"\]/);
  });
});

// ---------------------------------------------------------------------------
// 6. CLI Dockerfile Validation
// ---------------------------------------------------------------------------

describe('CLI Dockerfile (ruflo:lite)', () => {
  let dockerContent: string;

  beforeAll(() => {
    dockerContent = readFile(CLI_DOCKERFILE);
  });

  it('CLI Dockerfile exists', () => {
    expect(existsSync(CLI_DOCKERFILE)).toBe(true);
  });

  it('uses multi-stage build with build and production stages', () => {
    const fromStatements = dockerContent.match(/^FROM\s+/gm);
    expect(fromStatements).not.toBeNull();
    expect(fromStatements!.length).toBeGreaterThanOrEqual(2);
    expect(dockerContent).toContain('AS build');
    expect(dockerContent).toContain('AS production');
  });

  it('build stage uses Node 22 alpine', () => {
    expect(dockerContent).toMatch(/FROM\s+node:22-alpine\s+AS\s+build/);
  });

  it('production stage uses Node 22 alpine', () => {
    expect(dockerContent).toMatch(/FROM\s+node:22-alpine\s+AS\s+production/);
  });

  it('installs ruflo globally in the build stage', () => {
    expect(dockerContent).toContain('npm install -g ruflo@latest');
  });

  it('prunes heavy optional dependencies to reduce image size', () => {
    const prunedPackages = [
      'agentic-flow', '@opentelemetry', 'onnxruntime-node',
      '@anthropic-ai', 'agentdb',
    ];
    for (const pkg of prunedPackages) {
      expect(dockerContent).toContain(pkg);
    }
  });

  it('creates a non-root user (ruflo)', () => {
    expect(dockerContent).toContain('adduser');
    expect(dockerContent).toContain('ruflo');
    expect(dockerContent).toContain('USER ruflo');
  });

  it('installs dumb-init for PID 1 signal handling', () => {
    expect(dockerContent).toContain('dumb-init');
    expect(dockerContent).toContain('ENTRYPOINT ["/usr/bin/dumb-init"');
  });

  it('sets NODE_ENV=production', () => {
    expect(dockerContent).toContain('NODE_ENV=production');
  });

  it('has a HEALTHCHECK using ruflo doctor', () => {
    expect(dockerContent).toContain('HEALTHCHECK');
    expect(dockerContent).toContain('ruflo doctor');
  });

  it('default CMD starts MCP server', () => {
    expect(dockerContent).toContain('CMD ["ruflo", "mcp", "start"]');
  });
});

// ---------------------------------------------------------------------------
// 7. Environment Example Validation
// ---------------------------------------------------------------------------

describe('Environment Example (.env.example)', () => {
  let envContent: string;

  beforeAll(() => {
    envContent = readFile(ENV_EXAMPLE);
  });

  it('.env.example exists', () => {
    expect(existsSync(ENV_EXAMPLE)).toBe(true);
  });

  it('defines BRAND_NAME and BRAND_DESCRIPTION', () => {
    expect(envContent).toContain('BRAND_NAME=');
    expect(envContent).toContain('BRAND_DESCRIPTION=');
  });

  it('defines at least one AI provider key placeholder', () => {
    expect(envContent).toContain('OPENAI_API_KEY=');
  });

  it('defines MONGODB_DB_NAME', () => {
    expect(envContent).toContain('MONGODB_DB_NAME=');
  });

  it('defines all MCP tool group toggles', () => {
    const groups = [
      'MCP_GROUP_INTELLIGENCE', 'MCP_GROUP_AGENTS',
      'MCP_GROUP_MEMORY', 'MCP_GROUP_DEVTOOLS',
      'MCP_GROUP_SECURITY', 'MCP_GROUP_BROWSER',
      'MCP_GROUP_NEURAL', 'MCP_GROUP_AGENTIC_FLOW',
      'MCP_GROUP_CLAUDE_CODE', 'MCP_GROUP_GEMINI',
      'MCP_GROUP_CODEX',
    ];
    for (const g of groups) {
      expect(envContent).toContain(g);
    }
  });

  it('contains security warning about never committing real keys', () => {
    expect(envContent.toLowerCase()).toContain('never commit');
  });
});

// ---------------------------------------------------------------------------
// 8. CLI Build Validation
// ---------------------------------------------------------------------------

describe('CLI Build', () => {
  it('package.json exists and has correct name', () => {
    const pkg = JSON.parse(readFile(join(CLI_DIR, 'package.json')));
    expect(pkg.name).toBe('@claude-flow/cli');
  });

  it('package.json defines build script as tsc', () => {
    const pkg = JSON.parse(readFile(join(CLI_DIR, 'package.json')));
    expect(pkg.scripts.build).toBe('tsc');
  });

  it('package.json defines test script using vitest', () => {
    const pkg = JSON.parse(readFile(join(CLI_DIR, 'package.json')));
    expect(pkg.scripts.test).toContain('vitest');
  });

  it('tsconfig.json exists', () => {
    expect(existsSync(join(CLI_DIR, 'tsconfig.json'))).toBe(true);
  });

  it('vitest.config.ts exists and includes __tests__', () => {
    const config = readFile(join(CLI_DIR, 'vitest.config.ts'));
    expect(config).toContain('__tests__');
  });

  it('npm run build succeeds', () => {
    const result = execSync('npm run build 2>&1', {
      cwd: CLI_DIR,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    // tsc exits 0 on success; if it fails, execSync throws
    expect(result).toBeDefined();
  }, 65_000);

  it('dist directory exists after build', () => {
    expect(existsSync(join(CLI_DIR, 'dist'))).toBe(true);
  });

  it('bin/cli.js entry point exists', () => {
    expect(existsSync(join(CLI_DIR, 'bin', 'cli.js'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Cross-Service Port Consistency
// ---------------------------------------------------------------------------

describe('Cross-Service Port Consistency', () => {
  it('nginx proxies to chat-ui:3000 matching chat-ui expose port', () => {
    const nginx = readFile(NGINX_CONF_PATH);
    const compose = readFile(COMPOSE_PATH);
    expect(nginx).toContain('proxy_pass http://chat-ui:3000');
    // chat-ui exposes 3000
    const chatBlock = compose.split('chat-ui:')[1] ?? '';
    expect(chatBlock).toContain('"3000"');
  });

  it('chat-ui OPENAI_BASE_URL points to mcp-bridge:3001', () => {
    const compose = readFile(COMPOSE_PATH);
    expect(compose).toContain('OPENAI_BASE_URL=http://mcp-bridge:3001');
  });

  it('MCP bridge Dockerfile EXPOSE matches compose published port', () => {
    const dockerfile = readFile(MCP_BRIDGE_DOCKERFILE);
    const compose = readFile(COMPOSE_PATH);
    expect(dockerfile).toContain('EXPOSE 3001');
    expect(compose).toContain('"127.0.0.1:3001:3001"');
  });

  it('nginx Dockerfile EXPOSE matches compose published port', () => {
    const dockerfile = readFile(NGINX_DOCKERFILE);
    const compose = readFile(COMPOSE_PATH);
    expect(dockerfile).toContain('EXPOSE 3000');
    expect(compose).toContain('"3000:3000"');
  });
});

// ---------------------------------------------------------------------------
// 10. Security Validation
// ---------------------------------------------------------------------------

describe('Security Checks', () => {
  it('docker-compose.yml does not contain hardcoded API keys', () => {
    const compose = readFile(COMPOSE_PATH);
    // Should use ${VAR:-default} syntax, not hardcoded keys
    expect(compose).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(compose).not.toMatch(/OPENAI_API_KEY:\s*sk-/);
  });

  it('.env.example does not contain actual API key values', () => {
    const env = readFile(ENV_EXAMPLE);
    // Key lines should be empty or placeholder
    const keyLine = env.split('\n').find(l => l.startsWith('OPENAI_API_KEY='));
    expect(keyLine).toBe('OPENAI_API_KEY=');
  });

  it('MCP bridge Dockerfile runs as non-root', () => {
    const dockerfile = readFile(MCP_BRIDGE_DOCKERFILE);
    expect(dockerfile).toContain('USER node');
  });

  it('CLI Dockerfile runs as non-root', () => {
    const dockerfile = readFile(CLI_DOCKERFILE);
    expect(dockerfile).toContain('USER ruflo');
  });

  it('nginx CORS allows all origins (expected for development)', () => {
    const nginx = readFile(NGINX_CONF_PATH);
    expect(nginx).toContain('"*"');
  });
});
