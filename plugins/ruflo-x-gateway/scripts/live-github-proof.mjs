#!/usr/bin/env node
// One-shot LIVE read against the real GitHub API and npm registry, with no token.
// Not part of `npm test` (the suite never touches the network). Run by hand:
//   node scripts/live-github-proof.mjs
import { createGithubQuery, errorPayload } from '../src/github-query.mjs';

const gh = createGithubQuery({ token: undefined, owners: ['ruvnet'] });
const show = (label, v) => console.log(`\n## ${label}\n${JSON.stringify(v, null, 2)}`);
const attempt = async (label, fn) => { try { show(label, await fn()); } catch (e) { show(`${label} (error)`, errorPayload(e)); process.exitCode = process.exitCode || 0; } };

await attempt('ruv_github_repo ruvnet/ruflo include=[release,readme,files] (README clipped to 300 chars for display)', async () => {
  const r = await gh.repo({ repo: 'ruflo', include: ['release', 'readme', 'files'] });
  if (r.readme?.excerpt) r.readme.excerpt = r.readme.excerpt.slice(0, 300);
  if (r.files) r.files = `${r.files.length} entries, first 8: ${r.files.slice(0, 8).map((f) => f.name).join(', ')}`;
  return r;
});
await attempt('ruv_github_search kind=repositories query="federation" limit=3', async () => {
  const r = await gh.search({ query: 'federation', kind: 'repositories', limit: 3 });
  return { total_count: r.total_count, returned: r.returned, names: r.items.map((i) => i.full_name) };
});
await attempt('ruv_github_file ruvnet/ruflo plugins/ruflo-x-gateway/package.json', async () => {
  const f = await gh.file({ repo: 'ruflo', path: 'plugins/ruflo-x-gateway/package.json' });
  return { ...f, content: f.content.slice(0, 200) };
});
await attempt('ruv_registry_latest ruflo', () => gh.registryLatest({ package: 'ruflo' }));
await attempt('negative: .env refused (no network)', () => gh.file({ repo: 'ruflo', path: '.env' }));
await attempt('negative: owner outside allowlist refused (no network)', () => gh.repo({ owner: 'torvalds', repo: 'linux' }));
await attempt('negative: renamed repo -> redirect refused, not followed', () => gh.repo({ repo: 'claude-flow' }));
await attempt('negative: code search without a server token', () => gh.search({ query: 'federation', kind: 'code' }));
