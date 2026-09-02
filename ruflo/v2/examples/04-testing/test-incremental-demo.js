#!/usr/bin/env node

/**
 * Simple demonstration of incremental update patterns
 * This shows the core incremental update concepts without dependencies
 */

console.log('🧪 Incremental Updates Demo\n');

// Pattern 1: Version Tracking
class VersionedStore {
  constructor() {
    this.data = new Map();
  }
  
  set(key, value) {
    this.data.set(key, {
      value,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      history: []
    });
  }
  
  update(key, newValue) {
    const existing = this.data.get(key);
    if (!existing) throw new Error('Key not found');
    
    existing.history.push({
      value: existing.value,
      version: existing.version,
      timestamp: existing.updatedAt
    });
    
    existing.value = newValue;
    existing.version++;
    existing.updatedAt = Date.now();
    
    // Keep only last 10 versions
    if (existing.history.length > 10) {
      existing.history.shift();
    }
    
    return existing;
  }
  
  get(key) {
    return this.data.get(key);
  }
}

// Pattern 2: Atomic Counters
class MetricsCounter {
  constructor() {
    this.counters = {};
  }
  
  increment(name) {
    this.counters[name] = (this.counters[name] || 0) + 1;
    return this.counters[name];
  }
  
  decrement(name) {
    this.counters[name] = (this.counters[name] || 0) - 1;
    return this.counters[name];
  }
  
  getStats() {
    return { ...this.counters };
  }
}

// Pattern 3: Deep Merge Updates
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

// Pattern 4: Cache with Hit/Miss Tracking
class IncrementalCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.hits = 0;
    this.misses = 0;
  }
  
  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }
  
  get(key) {
    if (this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key);
    }
    this.misses++;
    return null;
  }
  
  stats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits / (this.hits + this.misses) || 0
    };
  }
}

// Test 1: Version Tracking
console.log('1️⃣ Testing Version Tracking');
const store = new VersionedStore();
store.set('config', { theme: 'light', fontSize: 14 });
console.log('  ✓ Initial: version=1');

for (let i = 0; i < 5; i++) {
  const current = store.get('config');
  store.update('config', { ...current.value, fontSize: current.value.fontSize + 1 });
  console.log(`  ✓ Update ${i + 1}: fontSize=${current.value.fontSize + 1}, version=${current.version + 1}`);
}

const final = store.get('config');
console.log(`  📊 Final: version=${final.version}, history_length=${final.history.length}`);

// Test 2: Metrics Counters
console.log('\n2️⃣ Testing Metrics Counters');
const metrics = new MetricsCounter();

// Simulate API calls
for (let i = 0; i < 10; i++) {
  metrics.increment('api_calls');
  if (Math.random() > 0.8) {
    metrics.increment('api_errors');
  }
}

const stats = metrics.getStats();
console.log(`  📊 Stats: ${JSON.stringify(stats)}`);

// Test 3: Deep Merge Configuration
console.log('\n3️⃣ Testing Deep Merge Updates');
const baseConfig = {
  server: {
    port: 3000,
    host: 'localhost',
    ssl: {
      enabled: false,
      cert: null
    }
  },
  features: {
    auth: true,
    logging: true
  }
};

const update1 = {
  server: {
    port: 8080,
    ssl: {
      enabled: true
    }
  }
};

const merged = deepMerge(baseConfig, update1);
console.log('  ✓ Port updated:', merged.server.port);
console.log('  ✓ SSL enabled:', merged.server.ssl.enabled);
console.log('  ✓ Host preserved:', merged.server.host);
console.log('  ✓ Features preserved:', merged.features.auth);

// Test 4: Cache Performance
console.log('\n4️⃣ Testing Cache Hit/Miss Tracking');
const cache = new IncrementalCache(5);

// Add items
for (let i = 0; i < 3; i++) {
  cache.set(`key${i}`, `value${i}`);
}

// Generate hits and misses
cache.get('key0'); // hit
cache.get('key1'); // hit
cache.get('key0'); // hit
cache.get('key5'); // miss
cache.get('key6'); // miss

const cacheStats = cache.stats();
console.log(`  📊 Cache stats: ${JSON.stringify(cacheStats, null, 2)}`);

// Test 5: Concurrent Counter Simulation
console.log('\n5️⃣ Testing Concurrent Updates');
async function simulateConcurrentUpdates() {
  const sharedCounter = { value: 0, updates: 0 };
  
  const updateCounter = async (agentId, updates) => {
    for (let i = 0; i < updates; i++) {
      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
      sharedCounter.value++;
      sharedCounter.updates++;
    }
  };
  
  // Simulate 5 agents doing 10 updates each
  const agents = [];
  for (let i = 0; i < 5; i++) {
    agents.push(updateCounter(i, 10));
  }
  
  await Promise.all(agents);
  
  console.log(`  ✓ Final counter value: ${sharedCounter.value}`);
  console.log(`  ✓ Total updates: ${sharedCounter.updates}`);
  console.log(`  ✓ Expected: 50, Actual: ${sharedCounter.value}`);
}

// Test 6: Batch Processing Progress
console.log('\n6️⃣ Testing Batch Processing Progress');
async function processBatch() {
  const items = Array(20).fill(null).map((_, i) => ({ id: i, processed: false }));
  let processed = 0;
  
  for (const item of items) {
    item.processed = true;
    processed++;
    
    if (processed % 5 === 0) {
      const progress = (processed / items.length) * 100;
      console.log(`  📊 Progress: ${progress}% (${processed}/${items.length})`);
    }
    
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log('  ✅ Batch processing complete');
}

// Run async tests
(async () => {
  await simulateConcurrentUpdates();
  await processBatch();
  
  console.log('\n✨ All incremental update patterns demonstrated successfully!');
})();