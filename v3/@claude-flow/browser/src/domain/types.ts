/**
 * @claude-flow/browser - Domain Types
 * Core type definitions for browser automation
 */

import { z } from 'zod';

// ============================================================================
// Element Reference (from agent-browser snapshots)
// ============================================================================

export const ElementRefSchema = z.string().regex(/^@e\d+$/, 'Must be in format @e1, @e2, etc.');
export type ElementRef = z.infer<typeof ElementRefSchema>;

export const SelectorSchema = z.union([
  ElementRefSchema,
  z.string().min(1), // CSS selector, text=, xpath=, etc.
]);
export type Selector = z.infer<typeof SelectorSchema>;

// ============================================================================
// Snapshot Types
// ============================================================================

export interface SnapshotNode {
  role: string;
  name?: string;
  ref?: string;
  value?: string;
  description?: string;
  level?: number;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  children?: SnapshotNode[];
}

export interface Snapshot {
  tree: SnapshotNode;
  refs: Record<string, SnapshotNode>;
  url: string;
  title: string;
  timestamp: string;
}

export interface SnapshotOptions {
  interactive?: boolean;  // -i: Only interactive elements
  compact?: boolean;      // -c: Remove empty structural elements
  depth?: number;         // -d: Limit tree depth
  selector?: string;      // -s: Scope to CSS selector
}

// ============================================================================
// Session Types
// ============================================================================

export interface BrowserSession {
  id: string;
  createdAt: string;
  lastActivity: string;
  currentUrl?: string;
  cookies: Cookie[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  history: string[];
  authState?: string; // Path to saved auth state
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

// ============================================================================
// Network Types
// ============================================================================

export interface NetworkRoute {
  urlPattern: string;
  action: 'intercept' | 'abort' | 'mock';
  mockResponse?: {
    status?: number;
    headers?: Record<string, string>;
    body?: string | object;
  };
}

export interface NetworkRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  timestamp: string;
  status?: number;
  responseHeaders?: Record<string, string>;
}

// ============================================================================
// Viewport & Device Types
// ============================================================================

export interface Viewport {
  width: number;
  height: number;
}

export interface DeviceDescriptor {
  name: string;
  viewport: Viewport;
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

// ============================================================================
// Action Result Types
// ============================================================================

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration?: number;
  screenshot?: string; // Base64 if captured
}

export interface ClickResult extends ActionResult {
  data?: {
    clicked: boolean;
    position?: { x: number; y: number };
  };
}

export interface FillResult extends ActionResult {
  data?: {
    filled: boolean;
    previousValue?: string;
    newValue: string;
  };
}

export interface ScreenshotResult extends ActionResult<string> {
  data?: string; // Base64 PNG
  path?: string; // If saved to file
}

export interface EvalResult<T = unknown> extends ActionResult<T> {
  data?: T;
}

// ============================================================================
// Command Input Schemas
// ============================================================================

export const OpenInputSchema = z.object({
  url: z.string().url(),
  session: z.string().optional(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().positive().optional(),
});
export type OpenInput = z.infer<typeof OpenInputSchema>;

export const ClickInputSchema = z.object({
  target: SelectorSchema,
  button: z.enum(['left', 'right', 'middle']).optional(),
  clickCount: z.number().int().positive().optional(),
  delay: z.number().nonnegative().optional(),
  force: z.boolean().optional(),
  timeout: z.number().positive().optional(),
});
export type ClickInput = z.infer<typeof ClickInputSchema>;

export const FillInputSchema = z.object({
  target: SelectorSchema,
  value: z.string(),
  force: z.boolean().optional(),
  timeout: z.number().positive().optional(),
});
export type FillInput = z.infer<typeof FillInputSchema>;

export const TypeInputSchema = z.object({
  target: SelectorSchema,
  text: z.string(),
  delay: z.number().nonnegative().optional(),
  timeout: z.number().positive().optional(),
});
export type TypeInput = z.infer<typeof TypeInputSchema>;

export const PressInputSchema = z.object({
  key: z.string(),
  delay: z.number().nonnegative().optional(),
});
export type PressInput = z.infer<typeof PressInputSchema>;

export const SnapshotInputSchema = z.object({
  interactive: z.boolean().optional(),
  compact: z.boolean().optional(),
  depth: z.number().int().positive().optional(),
  selector: z.string().optional(),
});
export type SnapshotInput = z.infer<typeof SnapshotInputSchema>;

export const ScreenshotInputSchema = z.object({
  path: z.string().optional(),
  fullPage: z.boolean().optional(),
  clip: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});
export type ScreenshotInput = z.infer<typeof ScreenshotInputSchema>;

export const WaitInputSchema = z.object({
  selector: z.string().optional(),
  timeout: z.number().positive().optional(),
  text: z.string().optional(),
  url: z.string().optional(),
  load: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
  fn: z.string().optional(), // JavaScript condition
});
export type WaitInput = z.infer<typeof WaitInputSchema>;

export const EvalInputSchema = z.object({
  script: z.string(),
  args: z.array(z.unknown()).optional(),
});
export type EvalInput = z.infer<typeof EvalInputSchema>;

export const GetInputSchema = z.object({
  type: z.enum(['text', 'html', 'value', 'attr', 'title', 'url', 'count', 'box']),
  target: SelectorSchema.optional(),
  attribute: z.string().optional(), // For 'attr' type
});
export type GetInput = z.infer<typeof GetInputSchema>;

export const SetViewportInputSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type SetViewportInput = z.infer<typeof SetViewportInputSchema>;

export const SetDeviceInputSchema = z.object({
  device: z.string(),
});
export type SetDeviceInput = z.infer<typeof SetDeviceInputSchema>;

export const NetworkRouteInputSchema = z.object({
  urlPattern: z.string(),
  abort: z.boolean().optional(),
  body: z.union([z.string(), z.object({})]).optional(),
  status: z.number().int().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type NetworkRouteInput = z.infer<typeof NetworkRouteInputSchema>;

// ============================================================================
// Domain Events
// ============================================================================

export type BrowserEvent =
  | { type: 'session:created'; sessionId: string; timestamp: string }
  | { type: 'session:closed'; sessionId: string; timestamp: string }
  | { type: 'page:navigated'; url: string; title: string; timestamp: string }
  | { type: 'page:loaded'; url: string; loadTime: number; timestamp: string }
  | { type: 'element:clicked'; ref: string; selector?: string; timestamp: string }
  | { type: 'element:filled'; ref: string; value: string; timestamp: string }
  | { type: 'snapshot:taken'; refs: number; interactive: number; timestamp: string }
  | { type: 'screenshot:captured'; path?: string; size: number; timestamp: string }
  | { type: 'network:intercepted'; url: string; action: string; timestamp: string }
  | { type: 'error:occurred'; message: string; stack?: string; timestamp: string };

// ============================================================================
// Integration with agentic-flow
// ============================================================================

export interface BrowserTrajectory {
  id: string;
  sessionId: string;
  goal: string;
  steps: BrowserTrajectoryStep[];
  startedAt: string;
  completedAt?: string;
  success?: boolean;
  verdict?: string;
}

export interface BrowserTrajectoryStep {
  action: string;
  input: Record<string, unknown>;
  result: ActionResult;
  snapshot?: Snapshot;
  timestamp: string;
}

// ============================================================================
// Swarm Integration
// ============================================================================

export interface BrowserSwarmConfig {
  topology: 'hierarchical' | 'mesh' | 'star';
  maxSessions: number;
  sessionPrefix: string;
  sharedCookies?: boolean;
  coordinatorSession?: string;
}

export interface BrowserAgentConfig {
  sessionId: string;
  role: 'navigator' | 'scraper' | 'validator' | 'tester' | 'monitor';
  capabilities: string[];
  defaultTimeout: number;
  headless: boolean;
}
