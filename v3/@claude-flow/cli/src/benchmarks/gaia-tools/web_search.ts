/**
 * GAIA Tool: web_search — ADR-133-PR2
 *
 * Scrapes DuckDuckGo HTML search results for a query string and returns
 * the top-N snippet titles + URLs as a plain-text block.  No API key
 * required; uses DDG's HTML endpoint which is publicly accessible.
 *
 * Design notes:
 * - Uses native Node.js https/http (no external fetch polyfill).
 * - Follows the DDG Lite HTML endpoint: https://html.duckduckgo.com/html/?q=…
 * - Parses result titles + URLs via a simple regex (no DOM parser dependency).
 * - Rate-limit aware: 1-second back-off between calls is the caller's
 *   responsibility (the agent loop enforces this in PR-3).
 * - PDF / binary detection is handled by file_read.ts, not here.
 *
 * Refs: ADR-133, #2156
 */

import * as https from 'node:https';
import * as http from 'node:http';
import { GaiaTool, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

// User-Agent that DDG accepts (plain browser UA).
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// HTML fetch helper
// ---------------------------------------------------------------------------

/**
 * POST to DuckDuckGo's HTML search endpoint and return the raw HTML string.
 * DDG blocks GET for automated scrapers but accepts POST form submissions.
 */
async function fetchDdgHtml(query: string): Promise<string> {
  const body = `q=${encodeURIComponent(query)}&b=&kl=&df=`;
  const bodyBytes = Buffer.from(body, 'utf-8');

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'html.duckduckgo.com',
      path: '/html/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': bodyBytes.length,
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const req = https.request(options, (res) => {
      // Follow a single redirect if needed (DDG occasionally redirects to /html/)
      if (
        res.statusCode !== undefined &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        const loc = res.headers.location;
        res.resume();
        // Simple follow — only handle absolute https redirects
        if (loc.startsWith('https://')) {
          https
            .get(loc, { headers: { 'User-Agent': UA } }, (r2) => {
              const chunks: Buffer[] = [];
              r2.on('data', (c: Buffer) => chunks.push(c));
              r2.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
              r2.on('error', reject);
            })
            .on('error', reject);
        } else {
          reject(new Error(`Unexpected redirect target: ${loc}`));
        }
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`DDG returned HTTP ${res.statusCode ?? 'unknown'}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`web_search timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.write(bodyBytes);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// HTML parser (regex-based, no DOM)
// ---------------------------------------------------------------------------

/**
 * Extract up to `maxResults` search results from DDG HTML.
 *
 * DDG's HTML result structure (stable as of 2026):
 *   <a class="result__a" href="URL">TITLE</a>
 *   <a class="result__snippet">SNIPPET</a>
 *
 * We parse with regex to avoid adding an htmlparser2 dependency.
 */
function parseDdgHtml(html: string, maxResults: number): SearchResult[] {
  const results: SearchResult[] = [];

  // Match result blocks — DDG wraps each result in <div class="result …">
  // We extract title+url from the result__a anchor, and snippet from result__snippet.
  const resultBlockRe =
    /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;

  let match: RegExpExecArray | null;
  while ((match = resultBlockRe.exec(html)) !== null && results.length < maxResults) {
    const rawUrl = match[1] ?? '';
    const rawTitle = match[2] ?? '';
    const rawSnippet = match[3] ?? '';

    // DDG wraps URLs in //duckduckgo.com/l/?uddg=ENCODED_URL
    const url = decodeRawUrl(rawUrl);
    const title = stripHtml(rawTitle).trim();
    const snippet = stripHtml(rawSnippet).trim();

    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

/**
 * Decode the DDG redirect URL back to the real URL.
 * Input example: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F&rut=…
 */
function decodeRawUrl(raw: string): string {
  if (raw.startsWith('//duckduckgo.com/l/')) {
    const qIdx = raw.indexOf('uddg=');
    if (qIdx !== -1) {
      const encoded = raw.slice(qIdx + 5).split('&')[0];
      try {
        return decodeURIComponent(encoded);
      } catch {
        return raw;
      }
    }
  }
  // Direct URL (some results skip the redirect)
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return raw;
}

/** Strip HTML tags and decode common entities. */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Format output for Claude
// ---------------------------------------------------------------------------

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\n    URL: ${r.url}${r.snippet ? '\n    ' + r.snippet : ''}`,
    )
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// GaiaTool implementation
// ---------------------------------------------------------------------------

export class WebSearchTool implements GaiaTool {
  readonly name = 'web_search';

  readonly definition: ToolDefinition = {
    name: 'web_search',
    description:
      'Search the web using DuckDuckGo and return the top results (title, URL, snippet). ' +
      'Use this when you need current information, external facts, or to verify claims.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query string.',
        },
        max_results: {
          type: 'number',
          description: `Maximum number of results to return (default: ${DEFAULT_MAX_RESULTS}, max: 10).`,
        },
      },
      required: ['query'],
    },
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    const query = String(input['query'] ?? '').trim();
    if (!query) throw new Error('web_search: `query` input is required and must be non-empty.');

    const maxResults = Math.min(
      Math.max(1, Number(input['max_results'] ?? DEFAULT_MAX_RESULTS)),
      10,
    );

    const html = await fetchDdgHtml(query);
    const results = parseDdgHtml(html, maxResults);
    return formatResults(results);
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createWebSearchTool(): WebSearchTool {
  return new WebSearchTool();
}
