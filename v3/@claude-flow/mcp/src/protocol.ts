/**
 * @claude-flow/mcp - Protocol Version Negotiation
 *
 * Dual-revision support: the legacy stateful 2025-11-25 revision and the
 * stateless 2026-07-28 revision (MRTR, transport headers, deprecations).
 * See ADR-179 for the adoption strategy.
 */

import type { MCPProtocolVersion, MCPRequest } from './types.js';

export const PROTOCOL_2025_11_25: MCPProtocolVersion = '2025-11-25';
export const PROTOCOL_2026_07_28: MCPProtocolVersion = '2026-07-28';

export const LATEST_PROTOCOL_VERSION: MCPProtocolVersion = PROTOCOL_2026_07_28;

/** Revisions this server implements, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly MCPProtocolVersion[] = [
  PROTOCOL_2026_07_28,
  PROTOCOL_2025_11_25,
];

/**
 * Pick the protocol revision for a session.
 *
 * A supported requested version is echoed back. Unknown or missing versions
 * fall back to 2025-11-25, NOT the latest: pre-2026 clients (e.g. Claude
 * Code requesting 2025-06-18) historically received 2025-11-25 from this
 * server and interoperate with it, while 2026-07-28 clients always request
 * their revision explicitly.
 */
export function negotiateProtocolVersion(requested?: string): MCPProtocolVersion {
  if (requested && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return PROTOCOL_2025_11_25;
}

/**
 * The 2026-07-28 revision removes the initialize handshake and session
 * management. Date-string versions compare lexicographically.
 */
export function isStatelessProtocol(version: MCPProtocolVersion): boolean {
  return version >= PROTOCOL_2026_07_28;
}

/** MRTR (InputRequiredResult) is part of the 2026-07-28 revision. */
export function supportsMrtr(version: MCPProtocolVersion): boolean {
  return isStatelessProtocol(version);
}

/**
 * Capabilities deprecated (still functional) in 2026-07-28:
 * roots, sampling, and logging.
 */
export const DEPRECATED_METHODS_2026_07_28: ReadonlySet<string> = new Set([
  'sampling/createMessage',
  'logging/setLevel',
  'roots/list',
]);

// ============================================================================
// Transport Headers (2026-07-28)
// ============================================================================

/** Carried on every request so gateways can route without parsing bodies. */
export const MCP_METHOD_HEADER = 'mcp-method';
/** Carried on tool/resource/prompt requests: the tool/prompt name or resource URI. */
export const MCP_NAME_HEADER = 'mcp-name';
/** Protocol revision the client speaks; replaces initialize-time negotiation for stateless clients. */
export const MCP_PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';

/**
 * Derive the Mcp-Name header value for a request, per the 2026-07-28
 * transport-header rules: tool/prompt name or resource URI, when present.
 */
export function extractMcpName(request: Pick<MCPRequest, 'method' | 'params'>): string | undefined {
  const params = request.params as { name?: unknown; uri?: unknown } | undefined;

  switch (request.method) {
    case 'tools/call':
    case 'prompts/get':
      return typeof params?.name === 'string' ? params.name : undefined;
    case 'resources/read':
    case 'resources/subscribe':
    case 'resources/unsubscribe':
      return typeof params?.uri === 'string' ? params.uri : undefined;
    default:
      return undefined;
  }
}
