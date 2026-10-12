import { createHash, randomUUID } from 'node:crypto';

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();

export class InMemoryStore {
  #tenants = new Map();
  #bucket(tenantId) {
    if (!this.#tenants.has(tenantId)) this.#tenants.set(tenantId, { teams: new Map(), runs: new Map(), tasks: new Map(), memories: new Map(), audit: [] });
    return this.#tenants.get(tenantId);
  }
  async createTeam(tenantId, input, actor = '-') {
    const bucket = this.#bucket(tenantId);
    const id = `team_${randomUUID()}`;
    const value = { id, name: input.name, objective: input.objective, roles: input.roles, status: 'active', createdAt: now(), updatedAt: now() };
    bucket.teams.set(id, value); this.#audit(bucket, actor, 'team.created', id); return clone(value);
  }
  async listTeams(tenantId) { return [...this.#bucket(tenantId).teams.values()].map(clone); }
  async getTeam(tenantId, id) { const value = this.#bucket(tenantId).teams.get(id); return value ? clone(value) : null; }
  async updateTeam(tenantId, id, patch, actor = '-') {
    const bucket = this.#bucket(tenantId); const current = bucket.teams.get(id); if (!current) return null;
    const value = { ...current, ...patch, id, updatedAt: now() }; bucket.teams.set(id, value); this.#audit(bucket, actor, 'team.updated', id); return clone(value);
  }
  async createRun(tenantId, input, actor = '-') {
    const bucket = this.#bucket(tenantId); if (!bucket.teams.has(input.teamId)) return null;
    const id = `run_${randomUUID()}`; const value = { id, teamId: input.teamId, objective: input.objective, budgetUnits: input.budgetUnits, spentUnits: 0, status: 'planned', createdAt: now(), updatedAt: now() };
    bucket.runs.set(id, value); this.#audit(bucket, actor, 'run.created', id); return clone(value);
  }
  async getRun(tenantId, id) { const value = this.#bucket(tenantId).runs.get(id); return value ? clone(value) : null; }
  async listRuns(tenantId) { return [...this.#bucket(tenantId).runs.values()].map(clone); }
  async updateRun(tenantId, id, patch, actor = '-') {
    const bucket = this.#bucket(tenantId); const current = bucket.runs.get(id); if (!current) return null;
    const value = { ...current, ...patch, id, updatedAt: now() }; bucket.runs.set(id, value); this.#audit(bucket, actor, `run.${value.status}`, id); return clone(value);
  }
  async createTask(tenantId, input, actor = '-') {
    const bucket = this.#bucket(tenantId); const run = bucket.runs.get(input.runId); if (!run || run.status === 'complete') return null;
    const id = `task_${randomUUID()}`; const value = { id, runId: input.runId, title: input.title, description: input.description, assigneeRole: input.assigneeRole, status: 'open', result: null, createdAt: now(), updatedAt: now() };
    bucket.tasks.set(id, value); this.#audit(bucket, actor, 'task.created', id); return clone(value);
  }
  async listTasks(tenantId, runId) { return [...this.#bucket(tenantId).tasks.values()].filter((x) => x.runId === runId).map(clone); }
  async updateTask(tenantId, id, patch, actor = '-') {
    const bucket = this.#bucket(tenantId); const current = bucket.tasks.get(id); if (!current || bucket.runs.get(current.runId)?.status === 'complete') return null;
    const value = { ...current, ...patch, id, updatedAt: now() }; bucket.tasks.set(id, value); this.#audit(bucket, actor, 'task.updated', id); return clone(value);
  }
  async remember(tenantId, input, actor = '-') {
    const bucket = this.#bucket(tenantId); const id = input.key || `mem_${randomUUID()}`;
    const timestamp = now();
    const value = { id, teamId: input.teamId, runId: input.runId || null, text: input.text, tags: input.tags || [], provenance: input.provenance || 'user', actorHash: actor,
      contentHash: createHash('sha256').update(input.text).digest('hex'), safetyStatus: input.safetyStatus || 'accepted', embeddingModel: 'feature-hash-256', embeddingVersion: '1', createdAt: timestamp, updatedAt: timestamp };
    bucket.memories.set(id, value); this.#audit(bucket, actor, 'memory.remembered', id); return clone(value);
  }
  async listMemories(tenantId, { teamId } = {}) { return [...this.#bucket(tenantId).memories.values()].filter((x) => !teamId || x.teamId === teamId).map(clone); }
  async usage(tenantId) {
    const b = this.#bucket(tenantId); return { teams: b.teams.size, runs: b.runs.size, tasks: b.tasks.size, memories: b.memories.size, limits: { teams: 1, agentsPerTeam: 3, monthlyTasks: 100, runBudgetUnits: 100 } };
  }
  async evidence(tenantId, runId) {
    const b = this.#bucket(tenantId); const run = b.runs.get(runId); if (!run) return null;
    return { schema: 'ruflo.ai-team.evidence.v1', generatedAt: now(), run: clone(run), team: clone(b.teams.get(run.teamId)), tasks: await this.listTasks(tenantId, runId), audit: b.audit.filter((x) => x.targetId === runId || x.targetId === run.teamId) };
  }
  #audit(bucket, actor, eventType, targetId) { bucket.audit.push({ id: randomUUID(), at: now(), actor, eventType, targetId }); }
}

export async function storeFromEnv(options = {}) {
  // Explicit deployment options (and any future CLI flags) take precedence over env configuration.
  const storeMode = options.storeMode ?? process.env.RUFLO_AI_TEAM_STORE ?? 'memory';
  if (storeMode !== 'firestore') return new InMemoryStore();
  const { Firestore } = await import('@google-cloud/firestore');
  const projectId = options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT;
  const databaseId = options.databaseId ?? process.env.RUFLO_AI_TEAM_DATABASE ?? '(default)';
  return new FirestoreStore(new Firestore({ projectId, databaseId }));
}

export class FirestoreStore {
  constructor(db) { this.db = db; }
  #tenant(id) { return this.db.collection('ruflo_ai_team_tenants').doc(id); }
  async #put(tenantId, kind, value) { await this.#tenant(tenantId).collection(kind).doc(value.id).set(value); return clone(value); }
  async #get(tenantId, kind, id) { const snap = await this.#tenant(tenantId).collection(kind).doc(id).get(); return snap.exists ? snap.data() : null; }
  async #list(tenantId, kind, limit = 1000) { const snap = await this.#tenant(tenantId).collection(kind).limit(limit).get(); return snap.docs.map((d) => d.data()); }
  async #audit(tenantId, actor, eventType, targetId) { const id = randomUUID(); await this.#put(tenantId, 'audit', { id, at: now(), actor, eventType, targetId }); }
  async createTeam(t, i, a='-') { const v={id:`team_${randomUUID()}`,name:i.name,objective:i.objective,roles:i.roles,status:'active',createdAt:now(),updatedAt:now()}; await this.#put(t,'teams',v); await this.#audit(t,a,'team.created',v.id); return v; }
  async listTeams(t) { return this.#list(t,'teams'); }
  async getTeam(t,id) { return this.#get(t,'teams',id); }
  async updateTeam(t,id,p,a='-') { const c=await this.#get(t,'teams',id); if(!c)return null; const v={...c,...p,id,updatedAt:now()}; await this.#put(t,'teams',v); await this.#audit(t,a,'team.updated',id); return v; }
  async createRun(t,i,a='-') { if(!await this.#get(t,'teams',i.teamId))return null; const v={id:`run_${randomUUID()}`,teamId:i.teamId,objective:i.objective,budgetUnits:i.budgetUnits,spentUnits:0,status:'planned',createdAt:now(),updatedAt:now()}; await this.#put(t,'runs',v); await this.#audit(t,a,'run.created',v.id); return v; }
  async getRun(t,id) { return this.#get(t,'runs',id); }
  async listRuns(t) { return this.#list(t,'runs',100); }
  async updateRun(t,id,p,a='-') { const c=await this.#get(t,'runs',id); if(!c)return null; const v={...c,...p,id,updatedAt:now()}; await this.#put(t,'runs',v); await this.#audit(t,a,`run.${v.status}`,id); return v; }
  async createTask(t,i,a='-') { const run=await this.#get(t,'runs',i.runId); if(!run||run.status==='complete')return null; const v={id:`task_${randomUUID()}`,runId:i.runId,title:i.title,description:i.description,assigneeRole:i.assigneeRole,status:'open',result:null,createdAt:now(),updatedAt:now()}; await this.#put(t,'tasks',v); await this.#audit(t,a,'task.created',v.id); return v; }
  async listTasks(t,runId) { const snap=await this.#tenant(t).collection('tasks').where('runId','==',runId).limit(200).get(); return snap.docs.map(d=>d.data()); }
  async updateTask(t,id,p,a='-') { const c=await this.#get(t,'tasks',id); if(!c||(await this.#get(t,'runs',c.runId))?.status==='complete')return null; const v={...c,...p,id,updatedAt:now()}; await this.#put(t,'tasks',v); await this.#audit(t,a,'task.updated',id); return v; }
  async remember(t,i,a='-') { const timestamp=now(); const v={id:i.key||`mem_${randomUUID()}`,teamId:i.teamId,runId:i.runId||null,text:i.text,tags:i.tags||[],provenance:i.provenance||'user',actorHash:a,contentHash:createHash('sha256').update(i.text).digest('hex'),safetyStatus:i.safetyStatus||'accepted',embeddingModel:'feature-hash-256',embeddingVersion:'1',createdAt:timestamp,updatedAt:timestamp}; await this.#put(t,'memories',v); await this.#audit(t,a,'memory.remembered',v.id); return v; }
  async listMemories(t,{teamId}={}) { let query=this.#tenant(t).collection('memories'); if(teamId)query=query.where('teamId','==',teamId); const snap=await query.limit(1000).get(); return snap.docs.map(d=>d.data()); }
  async usage(t) { const [teams,runs,tasks,memories]=await Promise.all(['teams','runs','tasks','memories'].map(k=>this.#list(t,k))); return {teams:teams.length,runs:runs.length,tasks:tasks.length,memories:memories.length,limits:{teams:1,agentsPerTeam:3,monthlyTasks:100,runBudgetUnits:100}}; }
  async evidence(t,runId) { const run=await this.#get(t,'runs',runId); if(!run)return null; return {schema:'ruflo.ai-team.evidence.v1',generatedAt:now(),run,team:await this.#get(t,'teams',run.teamId),tasks:await this.listTasks(t,runId),audit:(await this.#list(t,'audit')).filter(x=>x.targetId===runId||x.targetId===run.teamId)}; }
}
