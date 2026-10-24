/**
 * @claude-flow/browser - Agent Browser Adapter
 * Wraps agent-browser CLI for programmatic access
 */

import { spawn, execSync, execFileSync } from 'child_process';
import type {
  ActionResult,
  Snapshot,
  SnapshotOptions,
  OpenInput,
  ClickInput,
  FillInput,
  TypeInput,
  ScreenshotInput,
  WaitInput,
  EvalInput,
  GetInput,
  BrowserSession,
  NetworkRouteInput,
} from '../domain/types.js';

export interface AgentBrowserAdapterOptions {
  session?: string;
  timeout?: number;
  headless?: boolean;
  executablePath?: string;
  proxy?: string;
  viewport?: { width: number; height: number };
  debug?: boolean;
}

export class AgentBrowserAdapter {
  private session: string;
  private timeout: number;
  private headless: boolean;
  private executablePath?: string;
  private proxy?: string;
  private viewport?: { width: number; height: number };
  private debug: boolean;

  constructor(options: AgentBrowserAdapterOptions = {}) {
    this.session = options.session || 'default';
    this.timeout = options.timeout || 30000;
    this.headless = options.headless !== false;
    this.executablePath = options.executablePath;
    this.proxy = options.proxy;
    this.viewport = options.viewport;
    this.debug = options.debug || false;
  }

  // ===========================================================================
  // Core Command Execution
  // ===========================================================================

  private async exec<T = unknown>(args: string[], jsonOutput = true): Promise<ActionResult<T>> {
    const startTime = Date.now();
    const fullArgs = [
      '--session', this.session,
      ...(this.timeout ? ['--timeout', String(this.timeout)] : []),
      ...(!this.headless ? ['--headed'] : []),
      ...(this.executablePath ? ['--executable-path', this.executablePath] : []),
      ...(this.proxy ? ['--proxy-server', this.proxy] : []),
      ...(jsonOutput ? ['--json'] : []),
      ...args,
    ];

    if (this.debug) {
      console.log(`[agent-browser] ${fullArgs.join(' ')}`);
    }

    return new Promise((resolve) => {
      try {
        const result = execFileSync('agent-browser', fullArgs, {
          encoding: 'utf-8',
          timeout: this.timeout + 5000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const duration = Date.now() - startTime;

        if (jsonOutput) {
          try {
            const parsed = JSON.parse(result);
            resolve({
              success: parsed.success !== false,
              data: (parsed.data || parsed) as T,
              duration,
            });
          } catch {
            resolve({ success: true, data: result.trim() as T, duration });
          }
        } else {
          resolve({ success: true, data: result.trim() as T, duration });
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);
        resolve({ success: false, error: message, duration });
      }
    });
  }

  // ===========================================================================
  // Navigation Commands
  // ===========================================================================

  async open(input: OpenInput): Promise<ActionResult> {
    const args = ['open', input.url];
    if (input.waitUntil) args.push('--wait', input.waitUntil);
    if (input.headers) args.push('--headers', JSON.stringify(input.headers));
    return this.exec(args);
  }

  async back(): Promise<ActionResult> {
    return this.exec(['back']);
  }

  async forward(): Promise<ActionResult> {
    return this.exec(['forward']);
  }

  async reload(): Promise<ActionResult> {
    return this.exec(['reload']);
  }

  async close(): Promise<ActionResult> {
    return this.exec(['close']);
  }

  // ===========================================================================
  // Interaction Commands
  // ===========================================================================

  async click(input: ClickInput): Promise<ActionResult> {
    const args = ['click', input.target];
    if (input.button) args.push('--button', input.button);
    if (input.clickCount) args.push('--click-count', String(input.clickCount));
    if (input.force) args.push('--force');
    return this.exec(args);
  }

  async dblclick(target: string): Promise<ActionResult> {
    return this.exec(['dblclick', target]);
  }

  async fill(input: FillInput): Promise<ActionResult> {
    return this.exec(['fill', input.target, input.value]);
  }

  async type(input: TypeInput): Promise<ActionResult> {
    const args = ['type', input.target, input.text];
    if (input.delay) args.push('--delay', String(input.delay));
    return this.exec(args);
  }

  async press(key: string, delay?: number): Promise<ActionResult> {
    const args = ['press', key];
    if (delay) args.push('--delay', String(delay));
    return this.exec(args);
  }

  async hover(target: string): Promise<ActionResult> {
    return this.exec(['hover', target]);
  }

  async focus(target: string): Promise<ActionResult> {
    return this.exec(['focus', target]);
  }

  async select(target: string, value: string): Promise<ActionResult> {
    return this.exec(['select', target, value]);
  }

  async check(target: string): Promise<ActionResult> {
    return this.exec(['check', target]);
  }

  async uncheck(target: string): Promise<ActionResult> {
    return this.exec(['uncheck', target]);
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', pixels?: number): Promise<ActionResult> {
    const args = ['scroll', direction];
    if (pixels) args.push(String(pixels));
    return this.exec(args);
  }

  async scrollIntoView(target: string): Promise<ActionResult> {
    return this.exec(['scrollintoview', target]);
  }

  async drag(source: string, target: string): Promise<ActionResult> {
    return this.exec(['drag', source, target]);
  }

  async upload(target: string, files: string[]): Promise<ActionResult> {
    return this.exec(['upload', target, ...files]);
  }

  // ===========================================================================
  // Information Retrieval
  // ===========================================================================

  async get(input: GetInput): Promise<ActionResult> {
    const args = ['get', input.type];
    if (input.target) args.push(input.target);
    if (input.attribute && input.type === 'attr') args.push(input.attribute);
    return this.exec(args);
  }

  async getText(target: string): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'text', target]);
  }

  async getHtml(target: string): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'html', target]);
  }

  async getValue(target: string): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'value', target]);
  }

  async getAttr(target: string, attribute: string): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'attr', target, attribute]);
  }

  async getTitle(): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'title']);
  }

  async getUrl(): Promise<ActionResult<string>> {
    return this.exec<string>(['get', 'url']);
  }

  async getCount(selector: string): Promise<ActionResult<number>> {
    return this.exec<number>(['get', 'count', selector]);
  }

  async getBox(target: string): Promise<ActionResult<{ x: number; y: number; width: number; height: number }>> {
    return this.exec<{ x: number; y: number; width: number; height: number }>(['get', 'box', target]);
  }

  // ===========================================================================
  // State Checks
  // ===========================================================================

  async isVisible(target: string): Promise<ActionResult<boolean>> {
    return this.exec<boolean>(['is', 'visible', target]);
  }

  async isEnabled(target: string): Promise<ActionResult<boolean>> {
    return this.exec<boolean>(['is', 'enabled', target]);
  }

  async isChecked(target: string): Promise<ActionResult<boolean>> {
    return this.exec<boolean>(['is', 'checked', target]);
  }

  // ===========================================================================
  // Snapshot & Screenshot
  // ===========================================================================

  async snapshot(options: SnapshotOptions = {}): Promise<ActionResult<Snapshot>> {
    const args = ['snapshot'];
    if (options.interactive) args.push('-i');
    if (options.compact) args.push('-c');
    if (options.depth) args.push('-d', String(options.depth));
    if (options.selector) args.push('-s', options.selector);
    return this.exec<Snapshot>(args);
  }

  async screenshot(input: ScreenshotInput = {}): Promise<ActionResult<string>> {
    const args = ['screenshot'];
    if (input.path) args.push(input.path);
    if (input.fullPage) args.push('--full');
    return this.exec<string>(args);
  }

  async pdf(path: string): Promise<ActionResult> {
    return this.exec(['pdf', path]);
  }

  // ===========================================================================
  // Wait Commands
  // ===========================================================================

  async wait(input: WaitInput): Promise<ActionResult> {
    if (input.selector) {
      return this.exec(['wait', input.selector]);
    }
    if (typeof input.timeout === 'number' && !input.text && !input.url && !input.load && !input.fn) {
      return this.exec(['wait', String(input.timeout)]);
    }
    const args = ['wait'];
    if (input.text) args.push('--text', input.text);
    if (input.url) args.push('--url', input.url);
    if (input.load) args.push('--load', input.load);
    if (input.fn) args.push('--fn', input.fn);
    return this.exec(args);
  }

  async waitForSelector(selector: string, timeout?: number): Promise<ActionResult> {
    const args = ['wait', selector];
    if (timeout) args.push('--timeout', String(timeout));
    return this.exec(args);
  }

  async waitForText(text: string): Promise<ActionResult> {
    return this.exec(['wait', '--text', text]);
  }

  async waitForUrl(pattern: string): Promise<ActionResult> {
    return this.exec(['wait', '--url', pattern]);
  }

  async waitForLoad(state: 'load' | 'domcontentloaded' | 'networkidle'): Promise<ActionResult> {
    return this.exec(['wait', '--load', state]);
  }

  async waitForFunction(fn: string): Promise<ActionResult> {
    return this.exec(['wait', '--fn', fn]);
  }

  // ===========================================================================
  // JavaScript Execution
  // ===========================================================================

  async eval<T = unknown>(input: EvalInput): Promise<ActionResult<T>> {
    return this.exec<T>(['eval', input.script]);
  }

  /** Alias for {@link eval} — some callers expect the DOM-style `evaluate` name. */
  async evaluate<T = unknown>(input: EvalInput): Promise<ActionResult<T>> {
    return this.eval<T>(input);
  }

  // ===========================================================================
  // Mouse Control
  // ===========================================================================

  async mouseMove(x: number, y: number): Promise<ActionResult> {
    return this.exec(['mouse', 'move', String(x), String(y)]);
  }

  async mouseDown(button: 'left' | 'right' | 'middle' = 'left'): Promise<ActionResult> {
    return this.exec(['mouse', 'down', button]);
  }

  async mouseUp(button: 'left' | 'right' | 'middle' = 'left'): Promise<ActionResult> {
    return this.exec(['mouse', 'up', button]);
  }

  async mouseWheel(deltaY: number, deltaX = 0): Promise<ActionResult> {
    return this.exec(['mouse', 'wheel', String(deltaY), String(deltaX)]);
  }

  // ===========================================================================
  // Browser Settings
  // ===========================================================================

  async setViewport(width: number, height: number): Promise<ActionResult> {
    return this.exec(['set', 'viewport', String(width), String(height)]);
  }

  async setDevice(device: string): Promise<ActionResult> {
    return this.exec(['set', 'device', device]);
  }

  async setGeolocation(lat: number, lng: number): Promise<ActionResult> {
    return this.exec(['set', 'geo', String(lat), String(lng)]);
  }

  async setOffline(enabled: boolean): Promise<ActionResult> {
    return this.exec(['set', 'offline', enabled ? 'on' : 'off']);
  }

  async setHeaders(headers: Record<string, string>): Promise<ActionResult> {
    return this.exec(['set', 'headers', JSON.stringify(headers)]);
  }

  async setCredentials(username: string, password: string): Promise<ActionResult> {
    return this.exec(['set', 'credentials', username, password]);
  }

  async setMedia(scheme: 'dark' | 'light'): Promise<ActionResult> {
    return this.exec(['set', 'media', scheme]);
  }

  // ===========================================================================
  // Cookies & Storage
  // ===========================================================================

  async getCookies(): Promise<ActionResult> {
    return this.exec(['cookies']);
  }

  async setCookie(name: string, value: string): Promise<ActionResult> {
    return this.exec(['cookies', 'set', name, value]);
  }

  async clearCookies(): Promise<ActionResult> {
    return this.exec(['cookies', 'clear']);
  }

  async getLocalStorage(key?: string): Promise<ActionResult> {
    const args = ['storage', 'local'];
    if (key) args.push(key);
    return this.exec(args);
  }

  async setLocalStorage(key: string, value: string): Promise<ActionResult> {
    return this.exec(['storage', 'local', 'set', key, value]);
  }

  async clearLocalStorage(): Promise<ActionResult> {
    return this.exec(['storage', 'local', 'clear']);
  }

  async getSessionStorage(key?: string): Promise<ActionResult> {
    const args = ['storage', 'session'];
    if (key) args.push(key);
    return this.exec(args);
  }

  async setSessionStorage(key: string, value: string): Promise<ActionResult> {
    return this.exec(['storage', 'session', 'set', key, value]);
  }

  async clearSessionStorage(): Promise<ActionResult> {
    return this.exec(['storage', 'session', 'clear']);
  }

  // ===========================================================================
  // Network
  // ===========================================================================

  async networkRoute(input: NetworkRouteInput): Promise<ActionResult> {
    const args = ['network', 'route', input.urlPattern];
    if (input.abort) args.push('--abort');
    if (input.body) args.push('--body', typeof input.body === 'string' ? input.body : JSON.stringify(input.body));
    if (input.status) args.push('--status', String(input.status));
    if (input.headers) args.push('--headers', JSON.stringify(input.headers));
    return this.exec(args);
  }

  async networkUnroute(urlPattern?: string): Promise<ActionResult> {
    const args = ['network', 'unroute'];
    if (urlPattern) args.push(urlPattern);
    return this.exec(args);
  }

  async networkRequests(filter?: string): Promise<ActionResult> {
    const args = ['network', 'requests'];
    if (filter) args.push('--filter', filter);
    return this.exec(args);
  }

  // ===========================================================================
  // Tabs & Windows
  // ===========================================================================

  async listTabs(): Promise<ActionResult> {
    return this.exec(['tab']);
  }

  async newTab(url?: string): Promise<ActionResult> {
    const args = ['tab', 'new'];
    if (url) args.push(url);
    return this.exec(args);
  }

  async switchTab(index: number): Promise<ActionResult> {
    return this.exec(['tab', String(index)]);
  }

  async closeTab(index?: number): Promise<ActionResult> {
    const args = ['tab', 'close'];
    if (index !== undefined) args.push(String(index));
    return this.exec(args);
  }

  async newWindow(): Promise<ActionResult> {
    return this.exec(['window', 'new']);
  }

  // ===========================================================================
  // Frames
  // ===========================================================================

  async switchFrame(selector: string): Promise<ActionResult> {
    return this.exec(['frame', selector]);
  }

  async switchToMainFrame(): Promise<ActionResult> {
    return this.exec(['frame', 'main']);
  }

  // ===========================================================================
  // Dialogs
  // ===========================================================================

  async dialogAccept(text?: string): Promise<ActionResult> {
    const args = ['dialog', 'accept'];
    if (text) args.push(text);
    return this.exec(args);
  }

  async dialogDismiss(): Promise<ActionResult> {
    return this.exec(['dialog', 'dismiss']);
  }

  // ===========================================================================
  // Debug & Trace
  // ===========================================================================

  async traceStart(path?: string): Promise<ActionResult> {
    const args = ['trace', 'start'];
    if (path) args.push(path);
    return this.exec(args);
  }

  async traceStop(path?: string): Promise<ActionResult> {
    const args = ['trace', 'stop'];
    if (path) args.push(path);
    return this.exec(args);
  }

  async getConsole(): Promise<ActionResult> {
    return this.exec(['console']);
  }

  async clearConsole(): Promise<ActionResult> {
    return this.exec(['console', '--clear']);
  }

  async getErrors(): Promise<ActionResult> {
    return this.exec(['errors']);
  }

  async clearErrors(): Promise<ActionResult> {
    return this.exec(['errors', '--clear']);
  }

  async highlight(selector: string): Promise<ActionResult> {
    return this.exec(['highlight', selector]);
  }

  async saveState(path: string): Promise<ActionResult> {
    return this.exec(['state', 'save', path]);
  }

  async loadState(path: string): Promise<ActionResult> {
    return this.exec(['state', 'load', path]);
  }

  // ===========================================================================
  // Find Commands (Semantic Locators)
  // ===========================================================================

  async findByRole(role: string, action: string, options?: { name?: string; exact?: boolean }): Promise<ActionResult> {
    const args = ['find', 'role', role, action];
    if (options?.name) args.push('--name', options.name);
    if (options?.exact) args.push('--exact');
    return this.exec(args);
  }

  async findByText(text: string, action: string): Promise<ActionResult> {
    return this.exec(['find', 'text', text, action]);
  }

  async findByLabel(label: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'label', label, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  async findByPlaceholder(placeholder: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'placeholder', placeholder, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  async findByTestId(testId: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'testid', testId, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  async findFirst(selector: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'first', selector, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  async findLast(selector: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'last', selector, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  async findNth(n: number, selector: string, action: string, value?: string): Promise<ActionResult> {
    const args = ['find', 'nth', String(n), selector, action];
    if (value) args.push(value);
    return this.exec(args);
  }

  // ===========================================================================
  // Session Management
  // ===========================================================================

  async listSessions(): Promise<ActionResult> {
    return this.exec(['session', 'list']);
  }

  async getCurrentSession(): Promise<ActionResult> {
    return this.exec(['session']);
  }

  setSession(sessionId: string): void {
    this.session = sessionId;
  }

  getSession(): string {
    return this.session;
  }

  // ===========================================================================
  // CDP Connection
  // ===========================================================================

  async connect(port: number): Promise<ActionResult> {
    return this.exec(['connect', String(port)]);
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  static async install(withDeps = false): Promise<ActionResult> {
    const args = ['install'];
    if (withDeps) args.push('--with-deps');

    return new Promise((resolve) => {
      try {
        const result = execFileSync('agent-browser', args, {
          encoding: 'utf-8',
          timeout: 300000, // 5 minutes for download
        });
        resolve({ success: true, data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolve({ success: false, error: message });
      }
    });
  }
}

export default AgentBrowserAdapter;
