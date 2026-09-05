/**
 * @claude-flow/browser - MCP Tools
 * 50+ browser automation tools for claude-flow MCP server
 */

import { AgentBrowserAdapter } from '../infrastructure/agent-browser-adapter.js';
import type { ActionResult, Snapshot } from '../domain/types.js';

// Session registry for multi-agent coordination
const sessions = new Map<string, AgentBrowserAdapter>();

function getAdapter(sessionId?: string): AgentBrowserAdapter {
  const id = sessionId || 'default';
  if (!sessions.has(id)) {
    sessions.set(id, new AgentBrowserAdapter({ session: id }));
  }
  return sessions.get(id)!;
}

export interface MCPTool {
  name: string;
  description: string;
  category: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

// ============================================================================
// Navigation Tools
// ============================================================================

const navigationTools: MCPTool[] = [
  {
    name: 'browser/open',
    description: 'Navigate to a URL. Returns page title and final URL after redirects.',
    category: 'browser-navigation',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session: { type: 'string', description: 'Session ID for isolated browser instance' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'When to consider navigation complete',
        },
        headers: {
          type: 'object',
          description: 'HTTP headers to set (scoped to URL origin)',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.open({
        url: input.url as string,
        waitUntil: input.waitUntil as 'load' | 'domcontentloaded' | 'networkidle',
        headers: input.headers as Record<string, string>,
      });
    },
  },
  {
    name: 'browser/back',
    description: 'Navigate back in browser history',
    category: 'browser-navigation',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.back();
    },
  },
  {
    name: 'browser/forward',
    description: 'Navigate forward in browser history',
    category: 'browser-navigation',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.forward();
    },
  },
  {
    name: 'browser/reload',
    description: 'Reload the current page',
    category: 'browser-navigation',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.reload();
    },
  },
  {
    name: 'browser/close',
    description: 'Close the browser session',
    category: 'browser-navigation',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      const result = await adapter.close();
      sessions.delete(input.session as string || 'default');
      return result;
    },
  },
];

// ============================================================================
// Snapshot Tools (AI-Optimized)
// ============================================================================

const snapshotTools: MCPTool[] = [
  {
    name: 'browser/snapshot',
    description: 'Get accessibility tree with element refs (@e1, @e2). Best for AI - use refs to interact with elements. Returns structured tree with interactive elements highlighted.',
    category: 'browser-snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        interactive: { type: 'boolean', description: 'Only show interactive elements (buttons, links, inputs)', default: true },
        compact: { type: 'boolean', description: 'Remove empty structural elements', default: true },
        depth: { type: 'number', description: 'Limit tree depth (e.g., 3 levels)' },
        selector: { type: 'string', description: 'Scope snapshot to CSS selector' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.snapshot({
        interactive: input.interactive !== false,
        compact: input.compact !== false,
        depth: input.depth as number,
        selector: input.selector as string,
      });
    },
  },
  {
    name: 'browser/screenshot',
    description: 'Capture screenshot. Returns base64 PNG if no path specified.',
    category: 'browser-snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'File path to save (optional, returns base64 if omitted)' },
        fullPage: { type: 'boolean', description: 'Capture full scrollable page', default: false },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.screenshot({
        path: input.path as string,
        fullPage: input.fullPage as boolean,
      });
    },
  },
  {
    name: 'browser/pdf',
    description: 'Save page as PDF',
    category: 'browser-snapshot',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'File path to save PDF' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.pdf(input.path as string);
    },
  },
];

// ============================================================================
// Interaction Tools
// ============================================================================

const interactionTools: MCPTool[] = [
  {
    name: 'browser/click',
    description: 'Click an element. Use @e1 refs from snapshot or CSS selectors.',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
        clickCount: { type: 'number', description: 'Number of clicks (2 for double-click)' },
        force: { type: 'boolean', description: 'Force click even if element is not visible' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.click({
        target: input.target as string,
        button: input.button as 'left' | 'right' | 'middle',
        clickCount: input.clickCount as number,
        force: input.force as boolean,
      });
    },
  },
  {
    name: 'browser/fill',
    description: 'Clear and fill an input field. Use @e1 refs from snapshot.',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        value: { type: 'string', description: 'Text to fill' },
        force: { type: 'boolean', description: 'Force fill even if element is not visible' },
      },
      required: ['target', 'value'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.fill({
        target: input.target as string,
        value: input.value as string,
        force: input.force as boolean,
      });
    },
  },
  {
    name: 'browser/type',
    description: 'Type text character by character (with key events). Slower than fill but simulates real typing.',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        text: { type: 'string', description: 'Text to type' },
        delay: { type: 'number', description: 'Delay between keystrokes in ms' },
      },
      required: ['target', 'text'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.type({
        target: input.target as string,
        text: input.text as string,
        delay: input.delay as number,
      });
    },
  },
  {
    name: 'browser/press',
    description: 'Press a keyboard key (Enter, Tab, Escape, Control+a, etc.)',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        key: { type: 'string', description: 'Key to press (Enter, Tab, Control+a, etc.)' },
        delay: { type: 'number', description: 'Key hold duration in ms' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.press(input.key as string, input.delay as number);
    },
  },
  {
    name: 'browser/hover',
    description: 'Hover over an element',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.hover(input.target as string);
    },
  },
  {
    name: 'browser/select',
    description: 'Select dropdown option by value',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        value: { type: 'string', description: 'Option value to select' },
      },
      required: ['target', 'value'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.select(input.target as string, input.value as string);
    },
  },
  {
    name: 'browser/check',
    description: 'Check a checkbox',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.check(input.target as string);
    },
  },
  {
    name: 'browser/uncheck',
    description: 'Uncheck a checkbox',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.uncheck(input.target as string);
    },
  },
  {
    name: 'browser/scroll',
    description: 'Scroll the page or element',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        pixels: { type: 'number', description: 'Pixels to scroll (default: viewport height)' },
      },
      required: ['direction'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.scroll(
        input.direction as 'up' | 'down' | 'left' | 'right',
        input.pixels as number
      );
    },
  },
  {
    name: 'browser/upload',
    description: 'Upload files to a file input',
    category: 'browser-interaction',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        files: { type: 'array', items: { type: 'string' }, description: 'File paths to upload' },
      },
      required: ['target', 'files'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.upload(input.target as string, input.files as string[]);
    },
  },
];

// ============================================================================
// Get Info Tools
// ============================================================================

const getInfoTools: MCPTool[] = [
  {
    name: 'browser/get-text',
    description: 'Get text content of an element',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getText(input.target as string);
    },
  },
  {
    name: 'browser/get-html',
    description: 'Get innerHTML of an element',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getHtml(input.target as string);
    },
  },
  {
    name: 'browser/get-value',
    description: 'Get value of an input element',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getValue(input.target as string);
    },
  },
  {
    name: 'browser/get-attr',
    description: 'Get an attribute value from an element',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        attribute: { type: 'string', description: 'Attribute name (href, src, data-*, etc.)' },
      },
      required: ['target', 'attribute'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getAttr(input.target as string, input.attribute as string);
    },
  },
  {
    name: 'browser/get-title',
    description: 'Get the page title',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getTitle();
    },
  },
  {
    name: 'browser/get-url',
    description: 'Get the current page URL',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getUrl();
    },
  },
  {
    name: 'browser/get-count',
    description: 'Count elements matching a selector',
    category: 'browser-info',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'CSS selector to count' },
      },
      required: ['selector'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getCount(input.selector as string);
    },
  },
];

// ============================================================================
// State Check Tools
// ============================================================================

const stateTools: MCPTool[] = [
  {
    name: 'browser/is-visible',
    description: 'Check if an element is visible',
    category: 'browser-state',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.isVisible(input.target as string);
    },
  },
  {
    name: 'browser/is-enabled',
    description: 'Check if an element is enabled',
    category: 'browser-state',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.isEnabled(input.target as string);
    },
  },
  {
    name: 'browser/is-checked',
    description: 'Check if a checkbox is checked',
    category: 'browser-state',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.isChecked(input.target as string);
    },
  },
];

// ============================================================================
// Wait Tools
// ============================================================================

const waitTools: MCPTool[] = [
  {
    name: 'browser/wait',
    description: 'Wait for element, time, text, URL, or load state',
    category: 'browser-wait',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        selector: { type: 'string', description: 'Wait for element to be visible' },
        timeout: { type: 'number', description: 'Wait for milliseconds' },
        text: { type: 'string', description: 'Wait for text to appear on page' },
        url: { type: 'string', description: 'Wait for URL pattern (glob)' },
        load: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Wait for load state' },
        fn: { type: 'string', description: 'Wait for JavaScript condition to be true' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.wait({
        selector: input.selector as string,
        timeout: input.timeout as number,
        text: input.text as string,
        url: input.url as string,
        load: input.load as 'load' | 'domcontentloaded' | 'networkidle',
        fn: input.fn as string,
      });
    },
  },
];

// ============================================================================
// JavaScript Execution
// ============================================================================

// Defense-in-depth: pattern blocklist for eval scripts (CRIT-03)
// NOTE: This is a best-effort defense layer, not a sandbox. Determined attackers can bypass
// pattern matching via encoding/obfuscation. The primary defense is the browser sandbox itself.
// This blocklist catches accidental misuse and unsophisticated injection attempts.
const DANGEROUS_EVAL_PATTERNS = [
  /\bprocess\b/,           // Node.js process access
  /\brequire\b/,           // CommonJS require
  /\b__dirname\b/,         // Node path leaking
  /\b__filename\b/,        // Node path leaking
  /\bchild_process\b/,     // Command execution
  /\bglobal\b\s*\./,       // Global object mutation
  /\bglobalThis\b/,        // globalThis access (bypasses global. check)
  /\bFunction\s*\(/,       // Function constructor (eval-equivalent)
  /\.constructor\b/,       // Constructor access (e.g., "".constructor)
  /\bReflect\b/,           // Reflect API (can invoke constructors)
  /\bimport\s*\(/,         // Dynamic import
  /\beval\s*\(/,           // Direct eval calls
];

const DEFAULT_MAX_EVAL_SCRIPT_LENGTH = 20_000;
const MAX_EVAL_SCRIPT_LENGTH = parseInt(process.env.CLAUDE_FLOW_MAX_EVAL_SCRIPT_LENGTH || '', 10) || DEFAULT_MAX_EVAL_SCRIPT_LENGTH;

const evalTools: MCPTool[] = [
  {
    name: 'browser/eval',
    description: 'Execute JavaScript in the page context (validated, length-limited)',
    category: 'browser-eval',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        script: {
          type: 'string',
          description: `JavaScript code to execute (max ${MAX_EVAL_SCRIPT_LENGTH} chars)`,
          maxLength: MAX_EVAL_SCRIPT_LENGTH,
        },
      },
      required: ['script'],
    },
    handler: async (input) => {
      const script = input.script as string;

      // Validate script length
      if (!script || script.length === 0) {
        throw new Error('browser/eval: script must not be empty');
      }
      if (script.length > MAX_EVAL_SCRIPT_LENGTH) {
        throw new Error(`browser/eval: script exceeds maximum length of ${MAX_EVAL_SCRIPT_LENGTH} characters`);
      }

      // Check for dangerous patterns
      for (const pattern of DANGEROUS_EVAL_PATTERNS) {
        if (pattern.test(script)) {
          throw new Error(`browser/eval: script contains disallowed pattern: ${pattern.source}`);
        }
      }

      // Audit log
      console.info(`[browser/eval] Executing script (${script.length} chars) in session ${input.session || 'default'}`);

      const adapter = getAdapter(input.session as string);
      return adapter.eval({ script });
    },
  },
];

// ============================================================================
// Storage Tools
// ============================================================================

const storageTools: MCPTool[] = [
  {
    name: 'browser/cookies-get',
    description: 'Get all cookies for the current page',
    category: 'browser-storage',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getCookies();
    },
  },
  {
    name: 'browser/cookies-set',
    description: 'Set a cookie',
    category: 'browser-storage',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        name: { type: 'string', description: 'Cookie name' },
        value: { type: 'string', description: 'Cookie value' },
      },
      required: ['name', 'value'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setCookie(input.name as string, input.value as string);
    },
  },
  {
    name: 'browser/cookies-clear',
    description: 'Clear all cookies',
    category: 'browser-storage',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.clearCookies();
    },
  },
  {
    name: 'browser/localstorage-get',
    description: 'Get localStorage value (or all if no key)',
    category: 'browser-storage',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        key: { type: 'string', description: 'Key to get (omit for all)' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.getLocalStorage(input.key as string);
    },
  },
  {
    name: 'browser/localstorage-set',
    description: 'Set localStorage value',
    category: 'browser-storage',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        key: { type: 'string', description: 'Key to set' },
        value: { type: 'string', description: 'Value to set' },
      },
      required: ['key', 'value'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setLocalStorage(input.key as string, input.value as string);
    },
  },
];

// ============================================================================
// Network Tools
// ============================================================================

const networkTools: MCPTool[] = [
  {
    name: 'browser/network-route',
    description: 'Intercept, block, or mock network requests',
    category: 'browser-network',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        urlPattern: { type: 'string', description: 'URL pattern to match (glob)' },
        abort: { type: 'boolean', description: 'Block matching requests' },
        body: { type: 'string', description: 'Mock response body (JSON string)' },
        status: { type: 'number', description: 'Mock response status code' },
      },
      required: ['urlPattern'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.networkRoute({
        urlPattern: input.urlPattern as string,
        abort: input.abort as boolean,
        body: input.body as string,
        status: input.status as number,
      });
    },
  },
  {
    name: 'browser/network-unroute',
    description: 'Remove network route',
    category: 'browser-network',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        urlPattern: { type: 'string', description: 'URL pattern to remove (omit for all)' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.networkUnroute(input.urlPattern as string);
    },
  },
  {
    name: 'browser/network-requests',
    description: 'Get tracked network requests',
    category: 'browser-network',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        filter: { type: 'string', description: 'Filter by URL substring' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.networkRequests(input.filter as string);
    },
  },
];

// ============================================================================
// Tab & Session Tools
// ============================================================================

const tabTools: MCPTool[] = [
  {
    name: 'browser/tab-list',
    description: 'List all open tabs',
    category: 'browser-tabs',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.listTabs();
    },
  },
  {
    name: 'browser/tab-new',
    description: 'Open a new tab',
    category: 'browser-tabs',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        url: { type: 'string', description: 'URL to open in new tab' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.newTab(input.url as string);
    },
  },
  {
    name: 'browser/tab-switch',
    description: 'Switch to a specific tab',
    category: 'browser-tabs',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        index: { type: 'number', description: 'Tab index (0-based)' },
      },
      required: ['index'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.switchTab(input.index as number);
    },
  },
  {
    name: 'browser/tab-close',
    description: 'Close a tab',
    category: 'browser-tabs',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        index: { type: 'number', description: 'Tab index to close (current if omitted)' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.closeTab(input.index as number);
    },
  },
  {
    name: 'browser/session-list',
    description: 'List all active browser sessions',
    category: 'browser-session',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const adapter = getAdapter();
      return adapter.listSessions();
    },
  },
];

// ============================================================================
// Settings Tools
// ============================================================================

const settingsTools: MCPTool[] = [
  {
    name: 'browser/set-viewport',
    description: 'Set browser viewport size',
    category: 'browser-settings',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        width: { type: 'number', description: 'Viewport width' },
        height: { type: 'number', description: 'Viewport height' },
      },
      required: ['width', 'height'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setViewport(input.width as number, input.height as number);
    },
  },
  {
    name: 'browser/set-device',
    description: 'Emulate a device (iPhone 14, Pixel 5, etc.)',
    category: 'browser-settings',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        device: { type: 'string', description: 'Device name (e.g., "iPhone 14", "Pixel 5")' },
      },
      required: ['device'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setDevice(input.device as string);
    },
  },
  {
    name: 'browser/set-geolocation',
    description: 'Set geolocation',
    category: 'browser-settings',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        latitude: { type: 'number', description: 'Latitude' },
        longitude: { type: 'number', description: 'Longitude' },
      },
      required: ['latitude', 'longitude'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setGeolocation(input.latitude as number, input.longitude as number);
    },
  },
  {
    name: 'browser/set-offline',
    description: 'Toggle offline mode',
    category: 'browser-settings',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        enabled: { type: 'boolean', description: 'Enable offline mode' },
      },
      required: ['enabled'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setOffline(input.enabled as boolean);
    },
  },
  {
    name: 'browser/set-media',
    description: 'Emulate color scheme (dark/light mode)',
    category: 'browser-settings',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        scheme: { type: 'string', enum: ['dark', 'light'], description: 'Color scheme' },
      },
      required: ['scheme'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.setMedia(input.scheme as 'dark' | 'light');
    },
  },
];

// ============================================================================
// Debug Tools
// ============================================================================

const debugTools: MCPTool[] = [
  {
    name: 'browser/trace-start',
    description: 'Start recording a trace for debugging',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Path to save trace' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.traceStart(input.path as string);
    },
  },
  {
    name: 'browser/trace-stop',
    description: 'Stop recording trace and save',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Path to save trace' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.traceStop(input.path as string);
    },
  },
  {
    name: 'browser/console',
    description: 'Get console messages',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        clear: { type: 'boolean', description: 'Clear console after getting messages' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      if (input.clear) {
        return adapter.clearConsole();
      }
      return adapter.getConsole();
    },
  },
  {
    name: 'browser/errors',
    description: 'Get page errors',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        clear: { type: 'boolean', description: 'Clear errors after getting' },
      },
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      if (input.clear) {
        return adapter.clearErrors();
      }
      return adapter.getErrors();
    },
  },
  {
    name: 'browser/highlight',
    description: 'Highlight an element on the page (for visual debugging)',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.highlight(input.target as string);
    },
  },
  {
    name: 'browser/state-save',
    description: 'Save authentication state (cookies, localStorage) to file',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Path to save state file' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.saveState(input.path as string);
    },
  },
  {
    name: 'browser/state-load',
    description: 'Load authentication state from file',
    category: 'browser-debug',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Path to state file' },
      },
      required: ['path'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.loadState(input.path as string);
    },
  },
];

// ============================================================================
// Semantic Locator Tools (Find Commands)
// ============================================================================

const findTools: MCPTool[] = [
  {
    name: 'browser/find-role',
    description: 'Find element by ARIA role and perform action',
    category: 'browser-find',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        role: { type: 'string', description: 'ARIA role (button, link, textbox, etc.)' },
        action: { type: 'string', enum: ['click', 'fill', 'check', 'hover', 'text'], description: 'Action to perform' },
        name: { type: 'string', description: 'Accessible name to match' },
        value: { type: 'string', description: 'Value for fill action' },
        exact: { type: 'boolean', description: 'Exact text match' },
      },
      required: ['role', 'action'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.findByRole(input.role as string, input.action as string, {
        name: input.name as string,
        exact: input.exact as boolean,
      });
    },
  },
  {
    name: 'browser/find-text',
    description: 'Find element by text content and perform action',
    category: 'browser-find',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        text: { type: 'string', description: 'Text to find' },
        action: { type: 'string', enum: ['click', 'hover', 'text'], description: 'Action to perform' },
      },
      required: ['text', 'action'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.findByText(input.text as string, input.action as string);
    },
  },
  {
    name: 'browser/find-label',
    description: 'Find input by label and perform action',
    category: 'browser-find',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        label: { type: 'string', description: 'Label text' },
        action: { type: 'string', enum: ['click', 'fill', 'check', 'hover', 'text'], description: 'Action to perform' },
        value: { type: 'string', description: 'Value for fill action' },
      },
      required: ['label', 'action'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.findByLabel(input.label as string, input.action as string, input.value as string);
    },
  },
  {
    name: 'browser/find-testid',
    description: 'Find element by data-testid and perform action',
    category: 'browser-find',
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        testId: { type: 'string', description: 'data-testid value' },
        action: { type: 'string', enum: ['click', 'fill', 'check', 'hover', 'text'], description: 'Action to perform' },
        value: { type: 'string', description: 'Value for fill action' },
      },
      required: ['testId', 'action'],
    },
    handler: async (input) => {
      const adapter = getAdapter(input.session as string);
      return adapter.findByTestId(input.testId as string, input.action as string, input.value as string);
    },
  },
];

// ============================================================================
// Export All Tools
// ============================================================================

import { signedTrajectoryTools } from './signed-trajectory-tools.js';

export const browserTools: MCPTool[] = [
  ...navigationTools,
  ...snapshotTools,
  ...interactionTools,
  ...getInfoTools,
  ...stateTools,
  ...waitTools,
  ...evalTools,
  ...storageTools,
  ...networkTools,
  ...tabTools,
  ...settingsTools,
  ...debugTools,
  ...findTools,
  ...signedTrajectoryTools, // ADR-122 Phase 1
];

export default browserTools;
