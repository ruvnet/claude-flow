/**
 * @claude-flow/mcp - OAuth 2.1 Authentication
 *
 * MCP 2025-11-25 compliant OAuth 2.1 with PKCE
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type { ILogger } from './types.js';

/**
 * OAuth 2.1 configuration
 */
export interface OAuthConfig {
  /** Client ID */
  clientId: string;
  /** Client secret (for confidential clients) */
  clientSecret?: string;
  /** Authorization endpoint */
  authorizationEndpoint: string;
  /** Token endpoint */
  tokenEndpoint: string;
  /** Redirect URI */
  redirectUri: string;
  /** Scopes to request */
  scopes?: string[];
  /** Token storage adapter */
  tokenStorage?: TokenStorage;
  /** Enable PKCE (default: true) */
  usePKCE?: boolean;
  /** State parameter generator */
  stateGenerator?: () => string;
}

/**
 * OAuth tokens
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresIn?: number;
  expiresAt?: number;
  scope?: string;
}

/**
 * Token storage interface
 */
export interface TokenStorage {
  save(key: string, tokens: OAuthTokens): Promise<void>;
  load(key: string): Promise<OAuthTokens | null>;
  delete(key: string): Promise<void>;
}

/**
 * Authorization request
 */
export interface AuthorizationRequest {
  url: string;
  state: string;
  codeVerifier?: string;
}

/**
 * Token response from OAuth server
 */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

/**
 * In-memory token storage (for development)
 */
export class InMemoryTokenStorage implements TokenStorage {
  private tokens: Map<string, OAuthTokens> = new Map();

  async save(key: string, tokens: OAuthTokens): Promise<void> {
    this.tokens.set(key, tokens);
  }

  async load(key: string): Promise<OAuthTokens | null> {
    return this.tokens.get(key) || null;
  }

  async delete(key: string): Promise<void> {
    this.tokens.delete(key);
  }
}

/**
 * OAuth 2.1 Manager
 */
export class OAuthManager extends EventEmitter {
  private readonly config: OAuthConfig;
  private readonly tokenStorage: TokenStorage;
  private pendingRequests: Map<string, { codeVerifier?: string; timestamp: number }> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly logger: ILogger,
    config: OAuthConfig
  ) {
    super();
    this.config = {
      usePKCE: true,
      scopes: [],
      stateGenerator: () => this.generateRandomString(32),
      ...config,
    };
    this.tokenStorage = config.tokenStorage || new InMemoryTokenStorage();
    this.startCleanup();
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  createAuthorizationRequest(): AuthorizationRequest {
    const state = this.config.stateGenerator!();
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (this.config.usePKCE) {
      codeVerifier = this.generateCodeVerifier();
      codeChallenge = this.generateCodeChallenge(codeVerifier);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
    });

    if (this.config.scopes && this.config.scopes.length > 0) {
      params.set('scope', this.config.scopes.join(' '));
    }

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    // Store pending request for validation
    this.pendingRequests.set(state, {
      codeVerifier,
      timestamp: Date.now(),
    });

    const url = `${this.config.authorizationEndpoint}?${params.toString()}`;

    this.logger.debug('Created authorization request', { state, usePKCE: !!codeVerifier });
    this.emit('authorization:created', { state });

    return { url, state, codeVerifier };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(code: string, state: string): Promise<OAuthTokens> {
    const pending = this.pendingRequests.get(state);
    if (!pending) {
      throw new Error('Invalid or expired state parameter');
    }

    this.pendingRequests.delete(state);

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      params.set('client_secret', this.config.clientSecret);
    }

    if (pending.codeVerifier) {
      params.set('code_verifier', pending.codeVerifier);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error('Token exchange failed', { status: response.status, error });
      throw new Error(`Token exchange failed: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    const tokens = this.parseTokenResponse(data);

    await this.tokenStorage.save('default', tokens);
    this.logger.info('Token exchange successful');
    this.emit('tokens:received', { expiresIn: tokens.expiresIn });

    return tokens;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshTokens(storageKey: string = 'default'): Promise<OAuthTokens> {
    const existing = await this.tokenStorage.load(storageKey);
    if (!existing?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: existing.refreshToken,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      params.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error('Token refresh failed', { status: response.status, error });
      // Clear invalid tokens
      await this.tokenStorage.delete(storageKey);
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = (await response.json()) as TokenResponse;
    const tokens = this.parseTokenResponse(data);

    // Preserve refresh token if not returned in response
    if (!tokens.refreshToken && existing.refreshToken) {
      tokens.refreshToken = existing.refreshToken;
    }

    await this.tokenStorage.save(storageKey, tokens);
    this.logger.info('Token refresh successful');
    this.emit('tokens:refreshed', { expiresIn: tokens.expiresIn });

    return tokens;
  }

  /**
   * Get valid access token (auto-refresh if expired)
   */
  async getAccessToken(storageKey: string = 'default'): Promise<string | null> {
    const tokens = await this.tokenStorage.load(storageKey);
    if (!tokens) {
      return null;
    }

    // Check if token is expired (with 60 second buffer)
    if (tokens.expiresAt && Date.now() >= tokens.expiresAt - 60000) {
      if (tokens.refreshToken) {
        try {
          const refreshed = await this.refreshTokens(storageKey);
          return refreshed.accessToken;
        } catch {
          return null;
        }
      }
      return null;
    }

    return tokens.accessToken;
  }

  /**
   * Revoke tokens
   */
  async revokeTokens(storageKey: string = 'default'): Promise<void> {
    await this.tokenStorage.delete(storageKey);
    this.logger.info('Tokens revoked');
    this.emit('tokens:revoked', { storageKey });
  }

  /**
   * Check if authenticated
   */
  async isAuthenticated(storageKey: string = 'default'): Promise<boolean> {
    const token = await this.getAccessToken(storageKey);
    return token !== null;
  }

  /**
   * Destroy manager and cleanup
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.pendingRequests.clear();
    this.removeAllListeners();
  }

  /**
   * Parse token response
   */
  private parseTokenResponse(data: TokenResponse): OAuthTokens {
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      scope: data.scope,
    };
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    return this.generateRandomString(64);
  }

  /**
   * Generate PKCE code challenge (S256)
   */
  private generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return this.base64UrlEncode(hash);
  }

  /**
   * Generate random string
   */
  private generateRandomString(length: number): string {
    const bytes = crypto.randomBytes(length);
    return this.base64UrlEncode(bytes).substring(0, length);
  }

  /**
   * Base64 URL encode
   */
  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Start cleanup of expired pending requests
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const expireTime = 10 * 60 * 1000; // 10 minutes

      for (const [state, request] of this.pendingRequests) {
        if (now - request.timestamp > expireTime) {
          this.pendingRequests.delete(state);
          this.logger.debug('Expired pending OAuth request', { state });
        }
      }
    }, 60000);
  }
}

/**
 * Create OAuth manager
 */
export function createOAuthManager(logger: ILogger, config: OAuthConfig): OAuthManager {
  return new OAuthManager(logger, config);
}

/**
 * OAuth middleware for Express/Connect
 */
export function oauthMiddleware(oauthManager: OAuthManager, storageKey: string = 'default') {
  return async (req: any, res: any, next: () => void) => {
    const token = await oauthManager.getAccessToken(storageKey);

    if (!token) {
      res.status(401).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message: 'Unauthorized - OAuth authentication required',
        },
      });
      return;
    }

    req.oauthToken = token;
    next();
  };
}

/**
 * Create GitHub OAuth provider config
 */
export function createGitHubOAuthConfig(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes: string[] = ['read:user']
): OAuthConfig {
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    usePKCE: false, // GitHub doesn't support PKCE for OAuth apps
  };
}

/**
 * Create Google OAuth provider config
 */
export function createGoogleOAuthConfig(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes: string[] = ['openid', 'profile', 'email']
): OAuthConfig {
  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes,
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    usePKCE: true,
  };
}
