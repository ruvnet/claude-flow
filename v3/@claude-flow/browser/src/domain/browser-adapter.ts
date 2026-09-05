/**
 * @claude-flow/browser - Browser Execution Adapter (ADR-122 Phase 6)
 *
 * Single interface above the browser-tool wars. Concrete adapters:
 *   - agent-browser (existing AgentBrowserAdapter — already wraps a Playwright CLI)
 *   - Stagehand (future)
 *   - Browserbase (future)
 *   - Browser Use (future)
 *   - local Chrome profile via CDP (future)
 *   - remote browser pool (future)
 *   - Surfer-H + Holo1 visual adapter (future)
 *
 * Phase 6 ships the interface + the AgentBrowserExecutionAdapter that wraps
 * the existing adapter. Adding additional adapters in later phases is a
 * single-file change (implement the interface + register in a factory).
 */

import type { ActionResult, Snapshot } from './types.js';

/** Backend identifier. */
export type AdapterBackend = 'agent-browser' | 'stagehand' | 'browserbase' | 'browser-use' | 'local-chrome' | 'remote-pool' | 'surfer-h';

/** Standardized observation shape across all adapters. */
export interface Observation {
  url: string;
  title: string;
  snapshot?: Snapshot;
  /** Optional screenshot — base64 PNG. */
  screenshot?: string;
  /** Origin of the page. */
  origin: string;
  /** Backend that produced this observation. */
  backend: AdapterBackend;
  timestamp: string;
}

export interface BrowserExecutionAdapter {
  /** Identifier — what backend this adapter wraps. */
  readonly backend: AdapterBackend;
  /** Open a URL. */
  open(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' }): Promise<ActionResult>;
  /** Get an accessibility snapshot with refs. */
  snapshot(options?: { interactive?: boolean; compact?: boolean }): Promise<ActionResult<Snapshot>>;
  /** Click. */
  click(target: string): Promise<ActionResult>;
  /** Fill a form field. */
  fill(target: string, value: string): Promise<ActionResult>;
  /** Type with key events. */
  type(target: string, text: string): Promise<ActionResult>;
  /** Take a screenshot. */
  screenshot(): Promise<ActionResult<string>>;
  /** Wait for selector / time / condition. */
  wait(input: { selector?: string; timeout?: number; text?: string; url?: string }): Promise<ActionResult>;
  /** Get URL / title / text. */
  getUrl(): Promise<ActionResult<string>>;
  getTitle(): Promise<ActionResult<string>>;
  getText(target: string): Promise<ActionResult<string>>;
  /** Close. */
  close(): Promise<ActionResult>;
  /** Produce a normalised observation for current state. */
  observe(): Promise<Observation>;
}
