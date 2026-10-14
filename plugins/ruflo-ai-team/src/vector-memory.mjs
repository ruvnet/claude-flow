import { createHash } from 'node:crypto';

export function featureVector(text, dimensions = 256) {
  const vector = new Float32Array(dimensions);
  const tokens = String(text).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const slot = digest.readUInt32BE(0) % dimensions;
    vector[slot] += (digest[4] & 1) ? 1 : -1;
  }
  let norm = 0; for (const n of vector) norm += n * n;
  norm = Math.sqrt(norm) || 1; for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

const cosine = (a, b) => { let total = 0; for (let i = 0; i < a.length; i++) total += a[i] * b[i]; return total; };

export class TenantVectorMemory {
  constructor(store, { dimensions = 256, VectorDb, maxIndexes = 64 } = {}) { this.store=store; this.dimensions=dimensions; this.VectorDb=VectorDb; this.maxIndexes=maxIndexes; this.indexes=new Map(); this.generation=0; }
  #rememberIndex(key, value, generation) {
    // A mutation during asynchronous construction must keep this snapshot uncached.
    if (generation !== this.generation) return value;
    if (this.indexes.has(key)) this.indexes.delete(key);
    this.indexes.set(key, value);
    while (this.indexes.size > this.maxIndexes) this.indexes.delete(this.indexes.keys().next().value);
    return value;
  }
  async #index(tenantId, teamId) {
    const key=`${tenantId}:${teamId||'*'}`; if(this.indexes.has(key))return this.indexes.get(key);
    const generation=this.generation;
    const memories=await this.store.listMemories(tenantId,{teamId});
    if (this.VectorDb) {
      const db=new this.VectorDb({dimensions:this.dimensions,maxElements:Math.max(1000,memories.length+100)});
      for(const m of memories) await db.insert({id:m.id,vector:featureVector(m.text,this.dimensions)});
      const value={kind:'ruvector-native',degraded:false,db,items:new Map(memories.map(m=>[m.id,m]))}; return this.#rememberIndex(key,value,generation);
    }
    const value={kind:'lexical-degraded',degraded:true,items:memories.map(m=>({m,v:featureVector(m.text,this.dimensions)}))}; return this.#rememberIndex(key,value,generation);
  }
  invalidate(tenantId) { this.generation++; for(const key of this.indexes.keys())if(key.startsWith(`${tenantId}:`))this.indexes.delete(key); }
  async search(tenantId,{teamId,query,limit=5}) {
    const idx=await this.#index(tenantId,teamId); const vector=featureVector(query,this.dimensions);
    if(idx.kind==='ruvector-native') return {backend:idx.kind,degraded:idx.degraded,results:(await idx.db.search({vector,k:limit})).map(r=>({score:r.score,memory:idx.items.get(r.id)})).filter(x=>x.memory)};
    return {backend:idx.kind,degraded:idx.degraded,results:idx.items.map(x=>({score:cosine(vector,x.v),memory:x.m})).sort((a,b)=>b.score-a.score).slice(0,limit)};
  }
}

export async function vectorMemoryFromEnv(store) {
  // Native acceleration is opt-in. Some platform bindings create a persistent
  // database at the process working directory even when no storage path is
  // requested. Defaulting to the portable backend prevents accidental shared
  // state and keeps every deployment honest about its degraded search mode.
  if (process.env.RUFLO_AI_TEAM_VECTOR !== 'native') return new TenantVectorMemory(store);
  try {
    const module = await import('@ruvector/core'); const VectorDb = module.VectorDb || module.default?.VectorDb; if(!VectorDb)throw new Error('VectorDb export missing');
    // Package wrappers and native optional dependencies can drift independently.
    // Prove this exact binary accepts our configured dimension before advertising it.
    const probe = new VectorDb({dimensions:256,maxElements:2}); const id='__ruflo_probe__';
    await probe.insert({id,vector:new Float32Array(256)}); await probe.search({vector:new Float32Array(256),k:1}); await probe.delete(id);
    return new TenantVectorMemory(store,{VectorDb});
  }
  catch { return new TenantVectorMemory(store); }
}
