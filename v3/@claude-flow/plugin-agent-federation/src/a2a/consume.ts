/**
 * A2A Agent Card consumption — fetch + validate a remote card and map it
 * into the bespoke federation registry so A2A peers appear in federation
 * discovery. Cards only (no A2A Tasks/messaging in this iteration).
 */

import type { DiscoveryService } from '../domain/services/discovery-service.js';
import type { FederationNode } from '../domain/entities/federation-node.js';
import {
  A2A_WELL_KNOWN_PATH,
  fromAgentCard,
  validateAgentCard,
  type A2AAgentCard,
} from './agent-card.js';

export interface FetchAgentCardOptions {
  /** Injectable fetch for tests / restricted environments. Default: globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Response size cap in bytes (defense against decompression floods). Default 256 KiB. */
  readonly maxBytes?: number;
}

export interface FetchAgentCardResult {
  readonly card: A2AAgentCard;
  readonly sourceUrl: string;
}

/**
 * Resolve the card URL: a bare base URL (`https://host[:port]` or a path-less
 * URL) gets the A2A well-known path appended; anything already pointing at a
 * JSON document is used as-is.
 */
export function resolveAgentCardUrl(baseOrCardUrl: string): string {
  const url = new URL(baseOrCardUrl);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = A2A_WELL_KNOWN_PATH;
  }
  return url.toString();
}

/** Fetch and structurally validate a remote A2A Agent Card. */
export async function fetchAgentCard(
  baseOrCardUrl: string,
  options: FetchAgentCardOptions = {},
): Promise<FetchAgentCardResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchAgentCard: no fetch implementation available');
  }
  const sourceUrl = resolveAgentCardUrl(baseOrCardUrl);
  const maxBytes = options.maxBytes ?? 256 * 1024;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let text: string;
  try {
    const res = await fetchImpl(sourceUrl, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`fetchAgentCard: ${sourceUrl} returned HTTP ${res.status}`);
    }
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  if (text.length > maxBytes) {
    throw new Error(`fetchAgentCard: card exceeds ${maxBytes} bytes`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`fetchAgentCard: ${sourceUrl} did not return valid JSON`);
  }

  const validation = validateAgentCard(parsed);
  if (!validation.valid) {
    throw new Error(
      `fetchAgentCard: invalid A2A agent card from ${sourceUrl}: ${validation.errors.join('; ')}`,
    );
  }
  return { card: parsed as A2AAgentCard, sourceUrl };
}

/**
 * Fetch a remote Agent Card and register the peer in federation discovery.
 * The peer enters at TrustLevel.UNTRUSTED (see fromAgentCard) — the card is
 * self-asserted metadata, and trust is earned through the normal handshake.
 */
export async function consumeAgentCard(
  discovery: DiscoveryService,
  baseOrCardUrl: string,
  options: FetchAgentCardOptions = {},
): Promise<FederationNode> {
  const { card, sourceUrl } = await fetchAgentCard(baseOrCardUrl, options);
  const node = fromAgentCard(card, sourceUrl);
  return discovery.registerExternalPeer(node);
}
