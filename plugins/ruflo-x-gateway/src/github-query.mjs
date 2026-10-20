// Read-only query of rUv's PUBLIC GitHub repositories (and npm latest versions)
// for the x.ruv.io gateway. See v3/docs/adr/ADR-485.
//
// WHAT THIS IS NOT: a generic HTTP fetcher. No caller-supplied URL, host, header
// or redirect target ever reaches `fetch`. Every upstream URL is assembled here
// from segments that were each validated against a narrow pattern, on one of two
// fixed hosts, and the assembled URL is re-checked against those hosts before it
// is used. Redirects are refused, not followed, so a 3xx cannot move a request
// (or the optional server-side token) off the pinned host.
//
// Everything this module returns is third-party text and is wrapped by the
// caller in the untrusted envelope (untrusted.mjs, source:'github').

const GITHUB_API = 'https://api.github.com';
const NPM_REGISTRY = 'https://registry.npmjs.org';
const PINNED_ORIGINS = new Set([GITHUB_API, NPM_REGISTRY]);

// ---- validation -----------------------------------------------------------
// GitHub login: alphanumerics and single hyphens, 1-39 chars.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// Repo name: letters, digits, '.', '_', '-'. Not "." or "..".
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// One path segment. Deliberately narrow: no '%', '\\', ':', whitespace, control
// or non-ASCII characters, so encoded slashes, backslashes and unicode
// look-alikes are rejected rather than normalised.
const SEGMENT_RE = /^[A-Za-z0-9._@+=,~-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._\/-]{1,100}$/;
// Free-text search: no ':' (which would admit user:/org:/repo:/is: qualifiers
// and let a caller widen the search past the allowlisted owner), no brackets.
const QUERY_RE = /^[A-Za-z0-9 _.\-/"'+#@]{1,200}$/;
const LANG_RE = /^[A-Za-z0-9+#.-]{1,30}$/;
const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export class GithubQueryError extends Error {
  constructor(code, message, extra = {}) { super(message); this.name = 'GithubQueryError'; this.code = code; this.extra = extra; }
}
const bad = (message) => new GithubQueryError('invalid_input', message);

// Files a read tool must never return, wherever they sit in a public repo.
// Public repos do sometimes contain these by mistake; echoing them through an
// AI-facing tool would amplify the leak, so the tool refuses by name.
const SENSITIVE_SEGMENT_RES = [
  /^\.env(?:\..*)?$/i, /^\.envrc$/i, /^\.npmrc$/i, /^\.netrc$/i, /^\.pypirc$/i,
  /^\.git$/i, /^\.ssh$/i, /^\.aws$/i, /^\.gnupg$/i, /^\.kube$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?$/i,
  /^credentials?(?:\..*)?$/i, /^secrets?(?:\..*)?$/i,
  /^service[-_]?account.*\.json$/i, /^.*\.tfstate(?:\..*)?$/i,
];
const SENSITIVE_EXT_RE = /\.(?:pem|key|p12|pfx|jks|keystore|asc|gpg|pgp|kdbx|ovpn|crt|cer|der)$/i;

export function validateOwner(owner, allowed) {
  if (typeof owner !== 'string' || !OWNER_RE.test(owner)) throw bad('owner must be a GitHub login (letters, digits, hyphens)');
  if (!allowed.includes(owner.toLowerCase())) {
    throw new GithubQueryError('owner_not_allowed', `owner is not on this gateway's allowlist (${allowed.join(', ')})`);
  }
  return owner;
}
export function validateRepo(repo) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo) || repo === '.' || repo === '..' || repo.endsWith('.git')) {
    throw bad('repo must be a repository name (letters, digits, ., _, -)');
  }
  return repo;
}
export function validatePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 300) throw bad('path must be 1-300 characters');
  const parts = path.split('/');
  if (parts.length > 12) throw bad('path has too many segments');
  for (const seg of parts) {
    if (seg === '' || seg === '.' || seg === '..') throw bad('path must not contain empty, "." or ".." segments');
    if (!SEGMENT_RE.test(seg)) throw bad('path segments may only contain letters, digits and . _ @ + = , ~ -');
    if (SENSITIVE_SEGMENT_RES.some((re) => re.test(seg))) throw new GithubQueryError('path_refused', 'this path looks like a credential or key file and is not served');
  }
  if (SENSITIVE_EXT_RE.test(parts[parts.length - 1])) throw new GithubQueryError('path_refused', 'this path looks like a credential or key file and is not served');
  return parts;
}
export function validateRef(ref) {
  if (ref === undefined) return undefined;
  if (typeof ref !== 'string' || !REF_RE.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.startsWith('-') || ref.endsWith('/')) {
    throw bad('ref must be a branch, tag or commit name');
  }
  return ref;
}
export function validateQuery(q) {
  if (typeof q !== 'string' || !QUERY_RE.test(q.trim())) {
    throw bad('query must be 1-200 plain-text characters; qualifiers such as user:, org:, repo: and is: are not accepted');
  }
  return q.trim();
}
export function validateNpmName(name) {
  if (typeof name !== 'string' || name.length > 214 || !NPM_NAME_RE.test(name)) throw bad('package must be a valid npm package name');
  return name;
}

export function parseOwners(raw) {
  const list = String(raw ?? 'ruvnet').split(',').map((s) => s.trim().toLowerCase()).filter((s) => OWNER_RE.test(s));
  return list.length ? [...new Set(list)] : ['ruvnet'];
}

// ---- bounded response reading --------------------------------------------
async function readCapped(res, max) {
  const declared = Number(res.headers?.get?.('content-length') || 0);
  if (declared > max) { try { await res.body?.cancel(); } catch { /* best effort */ } return { text: '', truncated: true, bytes: declared }; }
  if (!res.body?.getReader) { // stubbed responses
    const t = await res.text();
    return t.length > max ? { text: t.slice(0, max), truncated: true, bytes: t.length } : { text: t, truncated: false, bytes: t.length };
  }
  const reader = res.body.getReader();
  const chunks = []; let bytes = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > max) { chunks.push(value.subarray(0, value.length - (bytes - max))); truncated = true; try { await reader.cancel(); } catch { /* best effort */ } break; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated, bytes };
}

export const hourOf = (now) => Math.floor(now / 3_600_000);

/**
 * @param {object} o
 * @param {typeof fetch} [o.fetchImpl]   injectable for tests
 * @param {string[]} [o.owners]          lower-case owner allowlist
 * @param {string}  [o.token]            optional server-side token; used only as a request header
 */
export function createGithubQuery({
  fetchImpl = globalThis.fetch,
  owners = parseOwners(process.env.RUFLO_GITHUB_OWNERS),
  token = process.env.RUFLO_GITHUB_TOKEN || undefined,
  npmMaintainers = String(process.env.RUFLO_NPM_MAINTAINERS || 'ruvnet').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  now = () => Date.now(),
  freshMs = 5 * 60_000,         // serve from cache without asking upstream
  staleMs = 60 * 60_000,        // beyond this an entry is dropped; before it, revalidate with If-None-Match
  timeoutMs = 8_000,
  jsonCap = 512 * 1024,
  fileCap = 64 * 1024,
  readmeCap = 8 * 1024,
  maxEntries = 300,
  hourlyBudget = Number(process.env.RUFLO_GITHUB_HOURLY_BUDGET || (token ? 1500 : 45)),
  ipHourlyCap = Number(process.env.RUFLO_GITHUB_IP_HOURLY_CAP || 60),
} = {}) {
  const cache = new Map();          // url -> { etag, body, ts }
  // GitHub keeps separate limits for core (60/h unauthenticated) and search (10/min); npm has
  // its own. A limit on one bucket must not block the others.
  const limitedUntil = { core: 0, search: 0, npm: 0 };
  const bucketOf = (u) => (u.origin === NPM_REGISTRY ? 'npm' : u.pathname.startsWith('/search/') ? 'search' : 'core');
  const budget = { hour: -1, used: 0 };
  const perIp = new Map();

  /** Per-client allowance, modelled on seraphinaAllowance: counts every call. */
  function allowance(ip, t = now()) {
    const hour = hourOf(t);
    if (perIp.size > 5000) perIp.clear();
    const rec = perIp.get(ip) || { hour, n: 0 };
    if (rec.hour !== hour) { rec.hour = hour; rec.n = 0; }
    if (rec.n >= ipHourlyCap) { perIp.set(ip, rec); return { allowed: false, reason: `This client has used its ${ipHourlyCap} GitHub query calls for the hour.` }; }
    rec.n += 1; perIp.set(ip, rec);
    return { allowed: true };
  }

  function spendUpstream() {
    const hour = hourOf(now());
    if (budget.hour !== hour) { budget.hour = hour; budget.used = 0; }
    if (budget.used >= hourlyBudget) {
      throw new GithubQueryError('upstream_budget', `This gateway's shared upstream budget (${hourlyBudget} GitHub calls per hour) is spent; cached results are still served.`,
        { resetAt: new Date((hour + 1) * 3_600_000).toISOString() });
    }
    budget.used += 1;
  }

  function assertPinned(url) {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !PINNED_ORIGINS.has(u.origin) || u.username || u.password) throw new GithubQueryError('internal', 'refusing to fetch an unpinned origin');
    return u;
  }

  function evict() {
    const t = now();
    for (const [k, v] of cache) if (t - v.ts > staleMs) cache.delete(k);
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
  }

  /** GET one pinned URL: TTL cache, ETag revalidation, size/time caps, no redirects. */
  async function get(url, { accept = 'application/vnd.github+json', cap = jsonCap, authed = true } = {}) {
    const u = assertPinned(url);
    const key = `${accept}|${url}`;
    const hit = cache.get(key);
    if (hit && now() - hit.ts < freshMs) return { ...hit.body, cached: true };
    const bucket = bucketOf(u);
    if (now() < limitedUntil[bucket]) {
      if (hit) return { ...hit.body, cached: true, stale: true };
      throw new GithubQueryError('github_rate_limited', 'GitHub rate limit reached for this gateway.', { resetAt: new Date(limitedUntil[bucket]).toISOString(), bucket });
    }
    spendUpstream();
    const headers = { accept, 'user-agent': 'ruflo-x-gateway (+https://x.ruv.io)' };
    if (u.origin === GITHUB_API) {
      headers['x-github-api-version'] = '2022-11-28';
      if (token && authed) headers.authorization = `Bearer ${token}`; // never leaves api.github.com: redirects are refused
    }
    if (hit?.etag) headers['if-none-match'] = hit.etag;
    let res;
    try {
      res = await fetchImpl(u.href, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const m = String(e?.cause?.message || e?.message || e);
      if (/redirect/i.test(m)) throw new GithubQueryError('redirect_refused', 'upstream tried to redirect; the repository may have been renamed or moved');
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new GithubQueryError('timeout', `upstream did not answer within ${timeoutMs} ms`);
      throw new GithubQueryError('upstream_unreachable', 'upstream could not be reached');
    }
    if (res.status >= 300 && res.status < 400 && res.status !== 304) throw new GithubQueryError('redirect_refused', 'upstream tried to redirect; the repository may have been renamed or moved');
    if (res.status === 304 && hit) { hit.ts = now(); return { ...hit.body, cached: true, revalidated: true }; }
    const remaining = res.headers?.get?.('x-ratelimit-remaining');
    if (res.status === 429 || (res.status === 403 && remaining === '0')) {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const retry = Number(res.headers.get('retry-after') || 0) * 1000;
      limitedUntil[bucket] = Math.max(reset || (retry ? now() + retry : now() + 60_000), now() + 1_000);
      try { await res.body?.cancel(); } catch { /* best effort */ }
      throw new GithubQueryError('github_rate_limited',
        token ? 'GitHub rate limit reached.' : 'GitHub rate limit reached (unauthenticated: 60 requests per hour per egress IP, shared by all callers of this gateway).',
        { resetAt: new Date(limitedUntil[bucket]).toISOString(), bucket });
    }
    if (res.status === 401) { try { await res.body?.cancel(); } catch { /* best effort */ } throw new GithubQueryError('auth_required', 'GitHub requires authentication for this query and the gateway has no server-side token configured.'); }
    if (res.status === 404) { try { await res.body?.cancel(); } catch { /* best effort */ } throw new GithubQueryError('not_found', 'not found, or not public'); }
    if (res.status === 422) { try { await res.body?.cancel(); } catch { /* best effort */ } throw new GithubQueryError('invalid_input', 'GitHub rejected the query'); }
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* best effort */ } throw new GithubQueryError('upstream_error', `upstream answered HTTP ${res.status}`); }
    const read = await readCapped(res, cap);
    const body = { text: read.text, truncated: read.truncated, bytes: read.bytes, contentType: res.headers?.get?.('content-type') || '' };
    const etag = res.headers?.get?.('etag');
    if (etag && !read.truncated) { evict(); cache.set(key, { etag, body, ts: now() }); }
    else if (!read.truncated) { evict(); cache.set(key, { etag: undefined, body, ts: now() }); }
    return { ...body, cached: false };
  }

  const parse = (r) => { if (r.truncated) throw new GithubQueryError('too_large', 'upstream response exceeded the size cap'); try { return JSON.parse(r.text); } catch { throw new GithubQueryError('upstream_error', 'upstream returned malformed JSON'); } };
  const excerpt = (s, n) => (typeof s === 'string' && s.length > n ? { text: s.slice(0, n), truncated: true } : { text: s ?? null, truncated: false });

  async function assertPublicRepo(owner, repo) {
    const meta = parse(await get(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`));
    // A token can see private repositories; the flag, not the credential, decides.
    if (meta.private !== false || (meta.visibility && meta.visibility !== 'public')) throw new GithubQueryError('not_found', 'not found, or not public');
    if (!owners.includes(String(meta.owner?.login || '').toLowerCase())) throw new GithubQueryError('owner_not_allowed', 'repository owner is not on the allowlist');
    return meta;
  }

  const slimRepo = (r) => ({
    full_name: r.full_name, description: r.description ?? null, html_url: r.html_url, language: r.language ?? null,
    stars: r.stargazers_count, forks: r.forks_count, open_issues: r.open_issues_count, topics: r.topics ?? [],
    license: r.license?.spdx_id ?? null, default_branch: r.default_branch, archived: !!r.archived, fork: !!r.fork,
    pushed_at: r.pushed_at, updated_at: r.updated_at, created_at: r.created_at,
  });

  return {
    owners, allowance,
    hasToken: !!token,
    _cacheSize: () => cache.size,

    async search({ query, kind = 'repositories', owner, language, limit = 10 } = {}) {
      const q = validateQuery(query);
      const o = validateOwner(owner ?? owners[0], owners);
      if (!['repositories', 'issues', 'code'].includes(kind)) throw bad('kind must be repositories, issues or code');
      const n = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : 10;
      let full = `${q} user:${o}`;
      if (language !== undefined) { if (typeof language !== 'string' || !LANG_RE.test(language)) throw bad('language must be a language name'); full += ` language:${language}`; }
      if (kind === 'repositories') full += ' is:public';
      if (kind === 'issues') full += ' is:public';
      if (kind === 'code' && !token) throw new GithubQueryError('auth_required', 'GitHub code search requires authentication and this gateway has no server-side token configured; repository and issue search are available.');
      const path = kind === 'repositories' ? 'repositories' : kind;
      const data = parse(await get(`${GITHUB_API}/search/${path}?q=${encodeURIComponent(full)}&per_page=${n}`));
      const items = Array.isArray(data.items) ? data.items : [];
      let out;
      if (kind === 'repositories') out = items.filter((r) => r.private === false).map(slimRepo);
      else if (kind === 'issues') {
        out = items.filter((i) => typeof i.repository_url === 'string').map((i) => ({
          title: i.title, number: i.number, state: i.state, html_url: i.html_url, is_pull_request: !!i.pull_request,
          repository: String(i.repository_url).replace(`${GITHUB_API}/repos/`, ''), labels: (i.labels || []).map((l) => l.name),
          comments: i.comments, created_at: i.created_at, updated_at: i.updated_at, body_excerpt: excerpt(i.body, 400),
        }));
      } else {
        out = items.filter((c) => c.repository?.private === false).map((c) => ({ repository: c.repository?.full_name, path: c.path, html_url: c.html_url }));
      }
      return { kind, owner: o, total_count: data.total_count ?? out.length, returned: out.length, incomplete_results: !!data.incomplete_results, items: out };
    },

    async repo({ owner, repo, include = ['release'] } = {}) {
      const o = validateOwner(owner ?? owners[0], owners);
      const r = validateRepo(repo);
      const inc = new Set(Array.isArray(include) ? include : []);
      for (const x of inc) if (!['release', 'readme', 'files'].includes(x)) throw bad('include entries must be release, readme or files');
      const meta = await assertPublicRepo(o, r);
      const base = `${GITHUB_API}/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
      const out = { repository: slimRepo(meta) };
      if (inc.has('release')) {
        try {
          const rel = parse(await get(`${base}/releases/latest`));
          out.latest_release = { tag_name: rel.tag_name, name: rel.name ?? null, html_url: rel.html_url, published_at: rel.published_at, prerelease: !!rel.prerelease };
        } catch (e) {
          if (e.code !== 'not_found') throw e;
          out.latest_release = null;
          try { const tags = parse(await get(`${base}/tags?per_page=1`)); out.latest_tag = tags[0]?.name ?? null; } catch (e2) { if (e2.code !== 'not_found') throw e2; out.latest_tag = null; }
        }
      }
      if (inc.has('readme')) {
        try {
          const rd = await get(`${base}/readme`, { accept: 'application/vnd.github.raw+json', cap: readmeCap * 4 });
          const ex = excerpt(rd.text, readmeCap);
          out.readme = { excerpt: ex.text, truncated: ex.truncated || rd.truncated };
        } catch (e) { if (e.code !== 'not_found') throw e; out.readme = null; }
      }
      if (inc.has('files')) {
        const list = parse(await get(`${base}/contents/`));
        out.files = (Array.isArray(list) ? list : []).slice(0, 200).map((f) => ({ name: f.name, type: f.type, size: f.size }));
      }
      return out;
    },

    async file({ owner, repo, path, ref } = {}) {
      const o = validateOwner(owner ?? owners[0], owners);
      const r = validateRepo(repo);
      const parts = validatePath(path);
      const rf = validateRef(ref);
      await assertPublicRepo(o, r);
      const url = `${GITHUB_API}/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}/contents/${parts.map(encodeURIComponent).join('/')}${rf ? `?ref=${encodeURIComponent(rf)}` : ''}`;
      const f = await get(url, { accept: 'application/vnd.github.raw+json', cap: fileCap });
      if (/json/i.test(f.contentType) && f.text.trimStart().startsWith('[')) throw bad('path is a directory; list a repository root with ruv_github_repo include "files"');
      if (f.text.includes('\u0000')) return { repository: `${o}/${r}`, path, ref: rf ?? null, binary: true, bytes: f.bytes, content: null };
      return { repository: `${o}/${r}`, path, ref: rf ?? null, bytes: f.bytes, truncated: f.truncated, size_cap: fileCap, content: f.text };
    },

    async registryLatest({ package: name } = {}) {
      const n = validateNpmName(name);
      const d = parse(await get(`${NPM_REGISTRY}/${n.replace(/\//g, '%2f')}/latest`, { accept: 'application/json', authed: false }));
      const who = [...(d.maintainers || []).map((m) => m?.name), d._npmUser?.name].filter(Boolean).map((s) => String(s).toLowerCase());
      if (!who.some((w) => npmMaintainers.includes(w))) throw new GithubQueryError('owner_not_allowed', 'package is not maintained by an allowlisted npm account');
      return { name: d.name, latest: d.version, description: d.description ?? null, license: d.license ?? null, homepage: d.homepage ?? null, repository: d.repository?.url ?? null };
    },
  };
}

/** Turn a thrown error into a structured, secret-free tool error payload. */
export function errorPayload(e) {
  if (e instanceof GithubQueryError) return { error: e.code, message: e.message, ...e.extra };
  return { error: 'internal', message: 'unexpected error' };
}
