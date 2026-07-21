/**
 * Ephemeral-port localhost callback server for the browser-based OAuth flow
 * (ADR-306). A minimal single-request HTTP server — deliberately not a full
 * framework for one GET route that lives for one request and then shuts
 * down. A TypeScript port of meta-proxy's `src/oauth/callback_server.rs`.
 *
 * @module v3/security/oauth/callback-server
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CallbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
}

const SUCCESS_PAGE = `<html>
<body style="background:#0a0a0a; color:#f5f5f5; font-family:sans-serif;
    display:flex; align-items:center; justify-content:center;
    height:100vh; margin:0;">
    <div style="text-align:center;">
    <h1>&#10003; ruflo login successful</h1>
    <p>You can close this tab and return to your terminal.</p>
    </div>
</body>
</html>`;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes, matches meta-proxy's CALLBACK_TIMEOUT

export class CallbackTimeoutError extends Error {
  constructor() {
    super('timed out waiting for OAuth callback');
    this.name = 'CallbackTimeoutError';
  }
}

export class CallbackServer {
  private constructor(
    private readonly server: Server,
    public readonly redirectUri: string,
    public readonly port: number,
  ) {}

  /**
   * Binds `127.0.0.1:0` (OS-assigned ephemeral port) and returns the server
   * plus the exact `redirect_uri` to send in the authorize request — must be
   * the `http://127.0.0.1:<port>/oauth/callback` shape identity's
   * `validate_redirect_uri` accepts.
   */
  static async bind(): Promise<CallbackServer> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        const addr = server.address() as AddressInfo;
        const redirectUri = `http://127.0.0.1:${addr.port}/oauth/callback`;
        resolve(new CallbackServer(server, redirectUri, addr.port));
      });
    });
  }

  /**
   * Waits for exactly one `GET /oauth/callback?...` request, replies with the
   * browser success page, closes the server, and returns the parsed query
   * parameters. Times out after `waitForMs` so a login attempt the user
   * abandons in the browser doesn't hang the CLI forever.
   */
  async awaitCallback(waitForMs = DEFAULT_TIMEOUT_MS): Promise<CallbackResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.server.close();
        reject(new CallbackTimeoutError());
      }, waitForMs);

      this.server.once('request', (req, res) => {
        clearTimeout(timer);
        const url = new URL(req.url ?? '/oauth/callback', 'http://127.0.0.1');
        const result: CallbackResult = {
          code: url.searchParams.get('code'),
          state: url.searchParams.get('state'),
          error: url.searchParams.get('error'),
        };
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          connection: 'close',
        });
        res.end(SUCCESS_PAGE, () => {
          this.server.close();
          resolve(result);
        });
      });
    });
  }
}
