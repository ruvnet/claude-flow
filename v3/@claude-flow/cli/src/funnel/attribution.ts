/**
 * Attribution URL builder — appends UTM parameters and the pseudonymous funnel
 * ID to outbound funnel links so cognitum.one traffic analytics can attribute
 * a landing back to the surface, message, and campaign that produced it
 * (ADR-305 measurement plane).
 *
 * Failure discipline (ADR-301 no-runtime-network invariant, Phase 1):
 *   - This function is PURE — it never makes a network call. Attribution is
 *     shipped as query params on a link the user's own browser resolves; the
 *     CLI has zero runtime dependency on cognitum.one being reachable.
 *     If the whole API is down, the OSC 8 label still renders correctly, the
 *     click still leaves the terminal, and only the landing page fails (which
 *     is a browser-visible problem, not a statusline problem).
 *   - If the base URL is malformed, we return it verbatim rather than
 *     synthesizing a broken analytics endpoint. The OSC 8 renderer then
 *     re-validates the host against its allowlist and, on failure, drops
 *     the escape entirely and shows the plain label — never a raw URL.
 *
 * Privacy discipline (ADR-309):
 *   - `fid` (the pseudonymous funnel ID) is appended only when telemetry
 *     consent is present. Without consent, getFunnelId() returns null and
 *     the URL carries only the UTM fields — same landing page, no join key.
 *   - The base URL must already be an allowlisted https target; the OSC 8
 *     renderer re-validates the host at render time regardless.
 */
import { getFunnelId } from './events.js';

export interface AttributionInput {
  /** UTM `medium` — the surface (e.g. 'statusline', 'enrollment', 'exhaustion'). */
  medium: string;
  /** UTM `campaign` — the message kind ('disclosure' | 'promotional' | 'educational'). */
  campaign: string;
  /** UTM `content` — the specific message id ('promo-meta-llm-routing' etc.). */
  content: string;
  /** Static UTM `source` — always 'ruflo' but overridable for tests. */
  source?: string;
  /** Injectable for deterministic tests. Defaults to the live clock. */
  now?: Date;
}

/**
 * Return `url` with UTM parameters appended, and — when telemetry consent is
 * granted — a `fid` query parameter carrying the pseudonymous funnel ID.
 * Preserves any query parameters the base URL already carried.
 */
export function attributionUrl(url: string, input: AttributionInput): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // Defense in depth: reject non-https schemes at the builder stage. The OSC 8
  // renderer allowlist would drop them at render time too, but decorating a
  // `javascript:` or `data:` URL with a valid-looking `fid` would still be a
  // record we don't want to emit. Fail closed by returning the input verbatim.
  if (parsed.protocol !== 'https:') return url;

  const params = parsed.searchParams;
  params.set('utm_source', input.source ?? 'ruflo');
  params.set('utm_medium', input.medium);
  params.set('utm_campaign', input.campaign);
  params.set('utm_content', input.content);

  const fid = getFunnelId(input.now ?? new Date());
  if (fid) params.set('fid', fid);

  return parsed.toString();
}
