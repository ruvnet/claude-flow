/**
 * V3 Quick Benchmark
 * Tests key performance metrics
 */

import { performance } from 'perf_hooks';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

console.log('=== V3 Performance Benchmark ===\n');

const results = [];

// Test 1: Event bus throughput
async function testEventBus() {
  const bus = new EventEmitter();
  let count = 0;
  bus.on('test', () => count++);

  const start = performance.now();
  for (let i = 0; i < 100000; i++) {
    bus.emit('test');
  }
  const elapsed = performance.now() - start;

  results.push({
    name: 'Event Bus (100k events)',
    time: elapsed,
    ops: 100000 / (elapsed / 1000),
    target: '<50ms'
  });
}

// Test 2: Map operations (O(1) lookup verification)
async function testMapLookup() {
  const map = new Map();

  // Setup
  for (let i = 0; i < 100000; i++) {
    map.set(`key-${i}`, { data: i, timestamp: Date.now() });
  }

  const start = performance.now();
  for (let i = 0; i < 100000; i++) {
    map.get(`key-${i}`);
  }
  const elapsed = performance.now() - start;

  results.push({
    name: 'Map Lookup (100k gets)',
    time: elapsed,
    ops: 100000 / (elapsed / 1000),
    target: '<20ms'
  });
}

// Test 3: Secure ID generation
async function testSecureIds() {
  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(12).toString('hex');
    const id = `agent_${timestamp}_${random}`;
  }
  const elapsed = performance.now() - start;

  results.push({
    name: 'Secure ID Gen (10k IDs)',
    time: elapsed,
    ops: 10000 / (elapsed / 1000),
    target: '<100ms'
  });
}

// Test 4: Array vs Map lookup comparison
async function testLookupComparison() {
  const size = 10000;
  const arr = [];
  const map = new Map();

  // Setup
  for (let i = 0; i < size; i++) {
    const item = { id: `id-${i}`, data: i };
    arr.push(item);
    map.set(item.id, item);
  }

  // Array find (O(n))
  const arrStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    arr.find(x => x.id === `id-${Math.floor(Math.random() * size)}`);
  }
  const arrElapsed = performance.now() - arrStart;

  // Map get (O(1))
  const mapStart = performance.now();
  for (let i = 0; i < 1000; i++) {
    map.get(`id-${Math.floor(Math.random() * size)}`);
  }
  const mapElapsed = performance.now() - mapStart;

  const speedup = (arrElapsed / mapElapsed).toFixed(1);

  results.push({
    name: 'Array.find O(n) vs Map O(1)',
    time: mapElapsed,
    ops: 1000 / (mapElapsed / 1000),
    target: `${speedup}x speedup`,
    extra: `Array: ${arrElapsed.toFixed(2)}ms, Map: ${mapElapsed.toFixed(2)}ms`
  });
}

// Test 5: JSON serialization
async function testSerialization() {
  const data = {
    id: 'test-123',
    type: 'agent',
    status: 'active',
    metadata: { nested: { deep: { value: 123 } } },
    tags: Array(100).fill('tag'),
  };

  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    const str = JSON.stringify(data);
    JSON.parse(str);
  }
  const elapsed = performance.now() - start;

  results.push({
    name: 'JSON roundtrip (10k ops)',
    time: elapsed,
    ops: 10000 / (elapsed / 1000),
    target: '<200ms'
  });
}

// Test 6: Regex validation
async function testRegexValidation() {
  const pattern = /^[a-zA-Z0-9_\-.:]+$/;
  const testStrings = [
    'valid-tag-123',
    'another_tag',
    'tag.with.dots',
    'UPPERCASE_TAG',
  ];

  const start = performance.now();
  for (let i = 0; i < 100000; i++) {
    for (const str of testStrings) {
      pattern.test(str);
    }
  }
  const elapsed = performance.now() - start;

  results.push({
    name: 'Regex validation (400k tests)',
    time: elapsed,
    ops: 400000 / (elapsed / 1000),
    target: '<50ms'
  });
}

// Run all tests
await testEventBus();
await testMapLookup();
await testSecureIds();
await testLookupComparison();
await testSerialization();
await testRegexValidation();

// Print results
console.log('┌─────────────────────────────────────┬───────────┬─────────────┬──────────────┐');
console.log('│ Benchmark                           │ Time      │ Ops/sec     │ Target       │');
console.log('├─────────────────────────────────────┼───────────┼─────────────┼──────────────┤');

for (const r of results) {
  const name = r.name.padEnd(37);
  const time = `${r.time.toFixed(2)}ms`.padStart(9);
  const ops = Math.round(r.ops).toLocaleString().padStart(11);
  const target = r.target.padStart(12);
  console.log(`│ ${name} │ ${time} │ ${ops} │ ${target} │`);
  if (r.extra) {
    console.log(`│   └─ ${r.extra.padEnd(66)} │`);
  }
}

console.log('└─────────────────────────────────────┴───────────┴─────────────┴──────────────┘');

// Summary
console.log('\n✅ All benchmarks completed');
