import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const SCOPES = Object.freeze({ read: 'team:read', write: 'team:write', run: 'team:run' });

let cachedJwks;
let cachedJwksUri;
const jwksFor = (uri) => {
  if (!cachedJwks || cachedJwksUri !== uri) {
    cachedJwks = createRemoteJWKSet(new URL(uri));
    cachedJwksUri = uri;
  }
  return cachedJwks;
};

export function protectedResourceMetadata({ resource, issuer }) {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: Object.values(SCOPES),
    bearer_methods_supported: ['header'],
    resource_documentation: resource.replace(/\/mcp$/, '/'),
  };
}

export function challengeHeader(metadataUrl, { error, description, scope } = {}) {
  const parts = [`Bearer resource_metadata="${metadataUrl}"`];
  if (error) parts.push(`error="${String(error).replace(/["\\]/g, '')}"`);
  if (description) parts.push(`error_description="${String(description).replace(/["\\]/g, '').slice(0, 180)}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(', ');
}

function tokenFrom(req) {
  const raw = String(req?.headers?.authorization || '');
  if (raw.length > 8192) return { error: 'authorization header is too large' };
  if (raw.slice(0, 6).toLowerCase() !== 'bearer' || !/^\s/.test(raw.slice(6))) return {};
  const token = raw.slice(6).trim();
  return token ? { token } : {};
}

export function tenantIdFromClaims(payload) {
  const source = payload.tenant_id ?? payload.org_id ?? payload.workspace_id ?? payload.sub;
  if (!source) return undefined;
  return `t_${createHash('sha256').update(String(source)).digest('hex').slice(0, 24)}`;
}

export async function authenticate(req, config, verify = jwtVerify) {
  const parsed = tokenFrom(req);
  if (parsed.error) return { mode: 'denied', error: 'invalid_request', description: parsed.error };
  if (!parsed.token) return { mode: 'anonymous', scopes: [] };
  try {
    const { payload } = await verify(parsed.token, jwksFor(config.jwksUri), {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: 30,
    });
    const tenantId = tenantIdFromClaims(payload);
    if (!tenantId) return { mode: 'denied', error: 'invalid_token', description: 'token has no tenant-bound subject' };
    const rawScopes = payload.scope ?? payload.scp ?? [];
    const scopes = Array.isArray(rawScopes) ? rawScopes.map(String) : String(rawScopes).split(/\s+/).filter(Boolean);
    return {
      mode: 'oauth', tenantId, scopes,
      subjectHash: createHash('sha256').update(String(payload.sub || '')).digest('hex').slice(0, 16),
    };
  } catch (error) {
    return { mode: 'denied', error: 'invalid_token', description: String(error?.message || 'token verification failed').slice(0, 180) };
  }
}

export const hasScope = (auth, scope) => auth?.mode === 'oauth' && auth.scopes.includes(scope);
