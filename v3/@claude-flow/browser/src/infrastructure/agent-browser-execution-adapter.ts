/**
 * @claude-flow/browser - Agent-Browser Execution Adapter (ADR-122 Phase 6)
 *
 * The first concrete BrowserExecutionAdapter — wraps the existing
 * AgentBrowserAdapter so callers can program against the substrate interface
 * without caring which backend they're talking to.
 */

import { AgentBrowserAdapter } from './agent-browser-adapter.js';
import type { ActionResult, Snapshot } from '../domain/types.js';
import type { BrowserExecutionAdapter, Observation, AdapterBackend } from '../domain/browser-adapter.js';

export class AgentBrowserExecutionAdapter implements BrowserExecutionAdapter {
  readonly backend: AdapterBackend = 'agent-browser';
  private readonly adapter: AgentBrowserAdapter;

  constructor(adapter?: AgentBrowserAdapter) {
    this.adapter = adapter ?? new AgentBrowserAdapter();
  }

  open(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<ActionResult> {
    return this.adapter.open({ url, waitUntil: options?.waitUntil });
  }

  snapshot(options?: { interactive?: boolean; compact?: boolean }): Promise<ActionResult<Snapshot>> {
    return this.adapter.snapshot({ interactive: options?.interactive, compact: options?.compact });
  }

  click(target: string): Promise<ActionResult> {
    return this.adapter.click({ target });
  }

  fill(target: string, value: string): Promise<ActionResult> {
    return this.adapter.fill({ target, value });
  }

  type(target: string, text: string): Promise<ActionResult> {
    return this.adapter.type({ target, text });
  }

  screenshot(): Promise<ActionResult<string>> {
    return this.adapter.screenshot();
  }

  wait(input: { selector?: string; timeout?: number; text?: string; url?: string }): Promise<ActionResult> {
    return this.adapter.wait(input);
  }

  getUrl(): Promise<ActionResult<string>> {
    return this.adapter.getUrl();
  }

  getTitle(): Promise<ActionResult<string>> {
    return this.adapter.getTitle();
  }

  getText(target: string): Promise<ActionResult<string>> {
    return this.adapter.getText(target);
  }

  close(): Promise<ActionResult> {
    return this.adapter.close();
  }

  async observe(): Promise<Observation> {
    const [urlResult, titleResult, snapshotResult] = await Promise.all([
      this.getUrl(),
      this.getTitle(),
      this.snapshot({ interactive: true, compact: true }),
    ]);
    const url = (urlResult.data as string) ?? '';
    let origin = '';
    try {
      origin = url ? new URL(url).origin : '';
    } catch {
      origin = url;
    }
    return {
      url,
      title: (titleResult.data as string) ?? '',
      snapshot: snapshotResult.data as Snapshot | undefined,
      origin,
      backend: this.backend,
      timestamp: new Date().toISOString(),
    };
  }
}
