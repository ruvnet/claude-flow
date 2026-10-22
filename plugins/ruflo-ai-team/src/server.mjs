import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { authenticate, challengeHeader, hasScope, protectedResourceMetadata, SCOPES } from './auth.mjs';
import { storeFromEnv } from './store.mjs';
import { vectorMemoryFromEnv } from './vector-memory.mjs';
import { TEAM_TEMPLATES, templateById } from './templates.mjs';
import { fenced, scanStoredText } from './untrusted.mjs';
import { privacyPage, supportPage, termsPage } from './public-pages.mjs';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const TEAM_BOARD_URI = 'ui://ruflo-ai-team/board-v4.html';
const TEAM_BOARD_HTML = readFileSync(new URL('../ui/team-board.html', import.meta.url), 'utf8');
const MAX_BODY = 512 * 1024;
// Browser origins allowed to read responses cross-origin. ChatGPT and Claude
// call the MCP endpoint server-side and the board UI makes no network requests,
// so this only governs browser-based MCP clients. ALLOWED_ORIGINS (comma
// separated) replaces the default list.
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze(['https://chatgpt.com', 'https://chat.openai.com', 'https://claude.ai']);
export function parseAllowedOrigins(value) {
  const list = value == null || String(value).trim() === '' ? DEFAULT_ALLOWED_ORIGINS : String(value).split(',');
  const origins = new Set();
  for (const raw of list) {
    try { const u = new URL(String(raw).trim()); if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') origins.add(u.origin); } catch { /* ignore malformed entries */ }
  }
  return origins;
}
const TOOL_SCOPES = Object.freeze({
  team_templates_list: SCOPES.read, team_list: SCOPES.read, team_get: SCOPES.read, team_board: SCOPES.read,
  task_list: SCOPES.read, memory_search: SCOPES.read, evidence_export: SCOPES.read,
  team_create: SCOPES.write, team_update: SCOPES.write, run_create: SCOPES.run,
  task_create: SCOPES.write, task_update: SCOPES.write, memory_remember: SCOPES.write,
});
const READ = (title) => ({ title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const WRITE = (title, idempotent = false) => ({ title, readOnlyHint: false, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });
const text = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const notFound = () => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'not_found' }) }] });
const denied = (scope) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'insufficient_scope', required_scope: scope }) }] });

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function createAiTeamService({ store, vectorMemory, verifyToken, port, allowedOrigins: allowedOriginsOption } = {}) {
  const allowedOrigins = allowedOriginsOption ? parseAllowedOrigins(allowedOriginsOption.join(',')) : parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  store ||= await storeFromEnv();
  vectorMemory ||= await vectorMemoryFromEnv(store);
  const publicUrl = (process.env.RUFLO_AI_TEAM_PUBLIC_URL || 'https://team.ruv.io').replace(/\/$/, '');
  const issuer = (process.env.RUFLO_AI_TEAM_OAUTH_ISSUER || 'https://auth.cognitum.one').replace(/\/$/, '');
  const audience = process.env.RUFLO_AI_TEAM_OAUTH_AUDIENCE || `${publicUrl}/mcp`;
  const jwksUri = process.env.RUFLO_AI_TEAM_OAUTH_JWKS_URI || `${issuer}/.well-known/jwks.json`;
  const authConfig = { issuer, audience, jwksUri };
  const metadataUrl = `${publicUrl}/.well-known/oauth-protected-resource/mcp`;

  const buildMcp = (auth) => {
    const mcp = new McpServer({ name: 'ruflo-ai-team', version: VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} } });
    const scoped = (scope, fn) => async (args) => hasScope(auth, scope) ? fn(args) : denied(scope);
    mcp.tool('team_templates_list', 'Lists first-party AI-team playbooks and their roles. Requires team:read. Does not create or run a team.', {}, READ('List team templates'), scoped(SCOPES.read, async () => text({ templates: TEAM_TEMPLATES })));
    mcp.tool('team_create', 'Creates a tenant-local AI-team record from a reviewed goal and optional playbook. Requires team:write. Does not start agents, contact external services, or incur model charges.', {
      name: z.string().min(1).max(100), objective: z.string().min(1).max(5000), templateId: z.string().optional(), roles: z.array(z.string().min(1).max(60)).max(8).optional(),
    }, WRITE('Create AI team'), scoped(SCOPES.write, async (a) => {
      const template = a.templateId ? templateById(a.templateId) : undefined;
      if (a.templateId && !template) return text({ error: 'unknown_template' });
      const roles = a.roles?.length ? a.roles : (template?.roles || ['coordinator', 'researcher', 'verifier']);
      return text(await store.createTeam(auth.tenantId, { name: a.name, objective: a.objective, roles }, auth.subjectHash));
    }));
    mcp.tool('team_list', 'Lists AI teams owned by the authenticated tenant. Requires team:read. Returns no other tenant data.', {}, READ('List AI teams'), scoped(SCOPES.read, async () => text({ teams: await store.listTeams(auth.tenantId) })));
    mcp.tool('team_get', 'Reads one AI team owned by the authenticated tenant. Requires team:read. Foreign and missing IDs both return not_found.', { teamId: z.string() }, READ('Get AI team'), scoped(SCOPES.read, async ({ teamId }) => { const value=await store.getTeam(auth.tenantId,teamId); return value?text(value):notFound(); }));
    mcp.registerTool('team_board', {
      title: 'Show AI team board',
      description: 'Opens one private, read-only ChatGPT workspace for teams, runs, tasks, and evidence summaries. Requires team:read. The user can navigate and refresh inside this one widget; avoid calling it repeatedly in the same chat. No actions are executed.',
      inputSchema: { runId: z.string().optional() },
      annotations: READ('Show AI team board'),
      _meta: { ui: { resourceUri: TEAM_BOARD_URI }, 'openai/outputTemplate': TEAM_BOARD_URI },
    }, scoped(SCOPES.read, async ({ runId }) => {
      const teams = await store.listTeams(auth.tenantId);
      const runs = await store.listRuns(auth.tenantId);
      const run = runId ? await store.getRun(auth.tenantId, runId) : null;
      if (runId && !run) return notFound();
      const tasks = run ? await store.listTasks(auth.tenantId, runId) : [];
      const evidence = run ? await store.evidence(auth.tenantId, runId) : null;
      const board = { teams: teams.map(({ id, name, status }) => ({ id, name, status })), runs: runs.slice(0, 100).map(({ id, teamId, objective, status, budgetUnits, spentUnits }) => ({ id, teamId, objective: objective.slice(0, 160), status, budgetUnits, spentUnits })), run: run && { id: run.id, objective: run.objective, status: run.status, budgetUnits: run.budgetUnits, spentUnits: run.spentUnits }, tasks: tasks.map(({ id, title, status }) => ({ id, title, status })), evidence: evidence && { runId, generatedAt: evidence.generatedAt, auditEvents: evidence.audit.length, taskCount: evidence.tasks.length, teamName: evidence.team?.name ?? '' } };
      return { ...text(board), structuredContent: board };
    }));
    mcp.tool('team_update', 'Updates the name, objective, roles, or status of an existing tenant-local team. Requires team:write. It does not run agents or perform external actions.', {
      teamId:z.string(), name:z.string().min(1).max(100).optional(), objective:z.string().min(1).max(5000).optional(), roles:z.array(z.string().min(1).max(60)).max(8).optional(), status:z.enum(['active','paused','complete']).optional(),
    }, WRITE('Update AI team', true), scoped(SCOPES.write, async ({teamId,...patch}) => { const value=await store.updateTeam(auth.tenantId,teamId,patch,auth.subjectHash); return value?text(value):notFound(); }));
    mcp.tool('run_create', 'Creates a budgeted coordination run for an existing team. Requires team:run. This records the run but does not contact external systems or spend provider credits.', {
      teamId:z.string(), objective:z.string().min(1).max(5000), budgetUnits:z.number().int().min(1).max(100).default(25),
    }, WRITE('Create team run'), scoped(SCOPES.run, async (a) => { const value=await store.createRun(auth.tenantId,a,auth.subjectHash); return value?text(value):notFound(); }));
    mcp.tool('run_complete', 'Marks a tenant-local coordination run complete only when it has at least one task and every task is complete. Requires team:run. Does not execute agents or external actions.', { runId: z.string() }, WRITE('Complete team run', true), scoped(SCOPES.run, async ({ runId }) => {
      const run = await store.getRun(auth.tenantId, runId);
      if (!run) return notFound();
      if (run.status === 'complete') return text(run);
      const tasks = await store.listTasks(auth.tenantId, runId);
      if (!tasks.length || tasks.some((task) => task.status !== 'complete')) return text({ error: 'tasks_incomplete' });
      return text(await store.updateRun(auth.tenantId, runId, { status: 'complete' }, auth.subjectHash));
    }));
    mcp.tool('task_create', 'Adds a bounded task to a tenant-local run. Requires team:write. It records coordination state only and does not execute the task.', {
      runId:z.string(), title:z.string().min(1).max(160), description:z.string().min(1).max(8000), assigneeRole:z.string().min(1).max(60),
    }, WRITE('Create team task'), scoped(SCOPES.write, async (a) => { const value=await store.createTask(auth.tenantId,a,auth.subjectHash); return value?text(value):notFound(); }));
    mcp.tool('task_list', 'Lists tasks for a tenant-local run. Requires team:read. Stored task text is returned as provenance-labelled untrusted data.', { runId:z.string() }, READ('List run tasks'), scoped(SCOPES.read, async ({runId}) => { const run=await store.getRun(auth.tenantId,runId); return run?text(fenced(await store.listTasks(auth.tenantId,runId),'tenant run tasks')):notFound(); }));
    mcp.tool('task_update', 'Updates status or result for a tenant-local task. Requires team:write. It cannot execute commands, publish messages, or approve external actions.', {
      taskId:z.string(), status:z.enum(['open','claimed','blocked','complete']).optional(), result:z.string().max(12000).optional(),
    }, WRITE('Update team task', true), scoped(SCOPES.write, async ({taskId,...patch}) => { const value=await store.updateTask(auth.tenantId,taskId,patch,auth.subjectHash); return value?text(value):notFound(); }));
    mcp.tool('memory_remember', 'Stores approved tenant-local team context for later vector retrieval. Requires team:write. Content is safety-scanned, isolated to the OAuth tenant, and never used for cross-tenant learning.', {
      teamId:z.string(), runId:z.string().optional(), key:z.string().max(120).optional(), text:z.string().min(1).max(12000), tags:z.array(z.string().max(60)).max(20).optional(), provenance:z.enum(['user','agent','artifact']).optional(),
    }, WRITE('Remember team context', true), scoped(SCOPES.write, async (a) => { if(!await store.getTeam(auth.tenantId,a.teamId))return notFound(); const scan=scanStoredText(a.text); if(!scan.safe)return text({error:'unsafe_content',safetyStatus:scan.status}); const value=await store.remember(auth.tenantId,{...a,safetyStatus:scan.status},auth.subjectHash); vectorMemory.invalidate(auth.tenantId); return text({id:value.id,teamId:value.teamId,contentHash:value.contentHash,safetyStatus:value.safetyStatus,updatedAt:value.updatedAt}); }));
    mcp.tool('memory_search', 'Searches tenant-local team memory using a tenant-separated RuVector index when available, with an explicitly labelled lexical fallback. Requires team:read. Results are fenced as untrusted stored data.', {
      teamId:z.string(), query:z.string().min(1).max(2000), limit:z.number().int().min(1).max(10).default(5),
    }, READ('Search team memory'), scoped(SCOPES.read, async (a) => { if(!await store.getTeam(auth.tenantId,a.teamId))return notFound(); return text(fenced(await vectorMemory.search(auth.tenantId,a),'RuVector tenant memory')); }));
    mcp.tool('evidence_export', 'Builds a read-only evidence bundle for one tenant-local run, including team metadata, tasks, and privacy-minimized audit events. Requires team:read. It does not publish or share the bundle.', {runId:z.string()}, READ('Export run evidence'), scoped(SCOPES.read, async ({runId}) => { const value=await store.evidence(auth.tenantId,runId); return value?text(fenced(value,'tenant run evidence')):notFound(); }));

    mcp.resource('team-templates','ruv://team/templates',async()=>({contents:[{uri:'ruv://team/templates',mimeType:'application/json',text:JSON.stringify(TEAM_TEMPLATES)}]}));
    mcp.registerResource('team-board', TEAM_BOARD_URI, { mimeType: 'text/html;profile=mcp-app' }, async () => ({ contents: [{ uri: TEAM_BOARD_URI, mimeType: 'text/html;profile=mcp-app', text: TEAM_BOARD_HTML, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] }));
    mcp.prompt('plan-ai-team','Plan an AI team without starting work',{goal:z.string(),templateId:z.string().optional()},async({goal,templateId})=>({messages:[{role:'user',content:{type:'text',text:`Plan a bounded AI team for this goal: ${goal}\nPreferred template: ${templateId||'choose the safest fit'}. Show roles, tasks, budget, risks, and acceptance criteria. Do not start a run.`}}]}));
    mcp.prompt('review-team-result','Review a run using evidence rather than agent assertions',{runId:z.string()},async({runId})=>({messages:[{role:'user',content:{type:'text',text:`Review RuFlo AI Team run ${runId}. Retrieve its evidence bundle, distinguish verified evidence from stored assertions, report uncertainty, budget use, and unresolved work.`}}]}));
    return mcp;
  };

  const server = createServer(async (req,res) => {
    res.setHeader('x-content-type-options','nosniff'); res.setHeader('referrer-policy','no-referrer'); res.setHeader('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('vary','Origin');
    const origin=req.headers.origin;
    if(origin&&allowedOrigins.has(origin)){res.setHeader('access-control-allow-origin',origin);res.setHeader('access-control-expose-headers','www-authenticate,mcp-session-id,mcp-protocol-version');}
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(req.method==='OPTIONS'){res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');res.setHeader('access-control-allow-headers','content-type,authorization,mcp-session-id,mcp-protocol-version,accept');return res.writeHead(204).end();}
    if(url.pathname==='/health')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true,service:'ruflo-ai-team',version:VERSION}));
    if(url.pathname==='/.well-known/oauth-protected-resource/mcp'||url.pathname==='/.well-known/oauth-protected-resource')return res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(protectedResourceMetadata({resource:url.pathname.endsWith('/mcp')?`${publicUrl}/mcp`:publicUrl,issuer})));
    if(req.method==='GET'&&url.pathname==='/privacy')return res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end(privacyPage());
    if(req.method==='GET'&&url.pathname==='/terms')return res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end(termsPage());
    if(req.method==='GET'&&url.pathname==='/support')return res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end(supportPage());
    if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/mcp'))return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({service:'ruflo-ai-team',version:VERSION,endpoint:`${publicUrl}/mcp`,authentication:'oauth2',scopes:Object.values(SCOPES),resources:['ruv://team/templates']}));
    if(url.pathname!=='/mcp'||req.method!=='POST')return res.writeHead(404).end('not found');
    let parsed; try{parsed=JSON.parse(await readBody(req)||'{}');}catch{return res.writeHead(400,{'content-type':'application/json'}).end('{"error":"invalid_request"}');}
    const called=parsed?.method==='tools/call'?parsed?.params?.name:null;
    const publicUiRead=parsed?.method==='resources/read'&&parsed?.params?.uri===TEAM_BOARD_URI;
    const needsAuth=called||(parsed?.method==='resources/read'&&!publicUiRead);
    // Discovery is public even when a client sends an expired or legacy-audience
    // bearer. Never downgrade a protected call or an unknown method.
    const publicDiscovery=new Set(['initialize','ping','tools/list','resources/list','prompts/list']);
    let auth=await authenticate(req,authConfig,verifyToken);
    if(auth.mode==='denied'&&(publicDiscovery.has(parsed?.method)||publicUiRead))auth={mode:'anonymous',scopes:[]};
    if(auth.mode==='denied')return res.writeHead(401,{'content-type':'application/json','www-authenticate':challengeHeader(metadataUrl,{error:auth.error,description:auth.description,scope:SCOPES.read})}).end(JSON.stringify({error:auth.error,error_description:auth.description}));
    if(needsAuth&&auth.mode!=='oauth'){const scope=called?TOOL_SCOPES[called]:SCOPES.read;return res.writeHead(401,{'content-type':'application/json','www-authenticate':challengeHeader(metadataUrl,{error:'invalid_token',description:'OAuth authorization is required for tenant data',scope})}).end(JSON.stringify({error:'invalid_token'}));}
    if(called&&TOOL_SCOPES[called]&&!hasScope(auth,TOOL_SCOPES[called]))return res.writeHead(403,{'content-type':'application/json','www-authenticate':challengeHeader(metadataUrl,{error:'insufficient_scope',description:`${TOOL_SCOPES[called]} is required`,scope:TOOL_SCOPES[called]})}).end(JSON.stringify({error:'insufficient_scope'}));
    const mcp=buildMcp(auth); const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); res.on('close',()=>{transport.close();mcp.close();}); await mcp.connect(transport); return transport.handleRequest(req,res,parsed);
  });
  return {server,store,vectorMemory,listen:(p=port??Number(process.env.PORT||8080))=>new Promise(r=>server.listen(p,()=>r(server.address().port)))};
}

if(import.meta.url===`file://${process.argv[1]}`){const service=await createAiTeamService();const p=await service.listen();console.log(`ruflo-ai-team :${p}`);}
