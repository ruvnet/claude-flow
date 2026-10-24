# AgentDB Integration Test Suite

Comprehensive test suite for AgentDB v1.3.9 integration into claude-flow.

## Overview

This test suite validates the complete AgentDB integration with **170+ tests** covering:

- ✅ **50+ Unit Tests** - AgentDB Memory Adapter
- ✅ **40+ Unit Tests** - AgentDB Backend
- ✅ **30+ Unit Tests** - Legacy Data Bridge (Migration)
- ✅ **30+ Integration Tests** - System Integration
- ✅ **20+ Performance Tests** - Benchmark Validation

## Test Coverage

### Target: >90% Code Coverage

- **Statements**: >90%
- **Branches**: >85%
- **Functions**: >90%
- **Lines**: >90%

## Test Structure

```
tests/
├── unit/memory/agentdb/
│   ├── adapter.test.js        # AgentDBMemoryAdapter tests
│   ├── backend.test.js        # AgentDBBackend tests
│   └── migration.test.js      # LegacyDataBridge tests
├── integration/agentdb/
│   └── compatibility.test.js  # Full integration tests
├── performance/agentdb/
│   └── benchmarks.test.js     # Performance validation
├── utils/
│   └── agentdb-test-helpers.js  # Test utilities
└── run-agentdb-tests.sh       # Test runner script
```

## Running Tests

### Run All Tests

```bash
# Run complete test suite with coverage
./tests/run-agentdb-tests.sh

# Or using npm
npm run test:agentdb
```

### Run Specific Test Suites

```bash
# Adapter tests only
npm test tests/unit/memory/agentdb/adapter.test.js

# Backend tests only
npm test tests/unit/memory/agentdb/backend.test.js

# Migration tests only
npm test tests/unit/memory/agentdb/migration.test.js

# Integration tests only
npm test tests/integration/agentdb/compatibility.test.js

# Performance benchmarks only
npm test tests/performance/agentdb/benchmarks.test.js
```

### Run with Coverage

```bash
# Full coverage report
npm run test:coverage -- tests/unit/memory/agentdb/ tests/integration/agentdb/

# View coverage in browser
open coverage/lcov-report/index.html
```

### Run in Watch Mode

```bash
npm run test:watch -- tests/unit/memory/agentdb/
```

## Test Categories

### 1. Adapter Unit Tests (50+ tests)

**File**: `tests/unit/memory/agentdb/adapter.test.js`

Tests for `AgentDBMemoryAdapter`:

#### Initialization (10 tests)
- Hybrid mode initialization
- AgentDB-only mode
- Legacy-only mode
- Custom database paths
- Quantization options
- HNSW configuration
- Error handling
- Auto-creation of directories

#### Backward Compatibility (15 tests)
- All EnhancedMemory methods
- Session management
- Workflow tracking
- Agent coordination
- Knowledge management
- Performance tracking
- Namespace support
- Metadata handling
- TTL expiration

#### New AgentDB Methods (15 tests)
- `vectorSearch()` - Semantic search
- `storeWithEmbedding()` - Vector storage
- `semanticRetrieve()` - Similarity retrieval
- Distance metrics (cosine, euclidean, dot)
- Namespace/metadata filtering
- Batch operations
- Embedding statistics

#### Fallback Behavior (10 tests)
- Graceful degradation
- Error recovery
- Mixed data handling
- Health checks
- Mode switching

### 2. Backend Unit Tests (40+ tests)

**File**: `tests/unit/memory/agentdb/backend.test.js`

Tests for `AgentDBBackend`:

#### Database Initialization (10 tests)
- Database file creation
- Schema validation
- HNSW index setup
- Custom configurations
- Directory auto-creation

#### Vector Storage (10 tests)
- Embedding storage
- Normalization
- Metadata handling
- Namespace isolation
- Dimension validation
- Large value handling
- TTL support
- Concurrent writes

#### HNSW Search (10 tests)
- Search accuracy
- Similarity scoring
- Distance metrics
- Namespace filtering
- Metadata filtering
- Performance tuning
- Empty result handling

#### Quantization (10 tests)
- Binary quantization
- Scalar quantization
- Product quantization
- Memory reduction validation
- Search accuracy maintenance
- Performance benchmarks

### 3. Migration Tests (30+ tests)

**File**: `tests/unit/memory/agentdb/migration.test.js`

Tests for `LegacyDataBridge`:

#### Data Migration (10 tests)
- Complete migration
- Data preservation
- Namespace migration
- Metadata migration
- Batch processing
- Embedding generation
- Selective migration
- Duplicate handling

#### Data Integrity (10 tests)
- Record count validation
- Value comparison
- Corruption detection
- Nested object preservation
- Checksum verification
- Encoding validation

#### Progress Tracking (5 tests)
- Real-time progress
- ETA calculation
- Speed metrics
- Resumable migration

#### Rollback Mechanism (5 tests)
- Backup creation
- Rollback on failure
- Database restoration
- Backup history
- Point-in-time recovery

### 4. Integration Tests (30+ tests)

**File**: `tests/integration/agentdb/compatibility.test.js`

Full system integration tests:

#### MCP Tools Integration (10 tests)
- `memory_usage`
- `memory_search`
- `swarm_status`
- `agent_list`
- `task_orchestrate`
- `neural_patterns`
- `performance_report`
- `cache_manage`
- `workflow_status`
- `state_snapshot`

#### Hooks System Integration (10 tests)
- `pre-task` hook
- `post-edit` hook
- `session-restore` hook
- `session-end` hook
- `notify` hook
- Auto-format hook
- Neural training hook
- Performance tracking hook
- Token usage hook
- Cache optimization hook

#### Swarm Coordination (5 tests)
- Multi-agent coordination
- Knowledge sharing
- Task assignment
- Agent heartbeats
- Failure recovery

#### Session Persistence (5 tests)
- Session restart persistence
- Active sessions list
- Session history tracking
- Old session cleanup
- Export/import

### 5. Performance Benchmarks (20+ tests)

**File**: `tests/performance/agentdb/benchmarks.test.js`

Performance validation against targets:

#### Pattern Search (5 tests)
- ✅ Search under 100µs (vs 15ms baseline)
- ✅ 150x speedup over legacy
- ✅ Complex regex efficiency
- ✅ Filtered search speed
- ✅ Concurrent search handling

#### Batch Operations (5 tests)
- ✅ 100 items under 2ms (vs 1000ms baseline)
- ✅ 500x speedup over legacy
- ✅ Batch retrieve efficiency
- ✅ Batch delete performance
- ✅ Large batch handling

#### Large Queries (5 tests)
- ✅ 10K vectors under 10ms (vs 100s baseline)
- ✅ HNSW search scaling
- ✅ Complex filters on large datasets
- ✅ Pagination efficiency
- ✅ Index optimization

#### Memory Usage (3 tests)
- ✅ 4-32x reduction with quantization
- ✅ Efficient memory under load
- ✅ Memory cleanup on delete

#### Startup Time (2 tests)
- ✅ Initialize under 10ms
- ✅ Quick reload with data

## Test Utilities

**File**: `tests/utils/agentdb-test-helpers.js`

Comprehensive test utilities:

### Data Generation
- `generateRandomEmbedding(dimension)` - Create test vectors
- `generateTestDataset(count, options)` - Generate datasets
- `createPatternedData(patterns)` - Special test cases

### Database Management
- `createTempDbPath(prefix)` - Temporary databases
- `cleanupTestDb(dbPath)` - Database cleanup
- `populateDatabase(backend, count)` - Bulk population

### Testing Utilities
- `deepEqual(obj1, obj2)` - Deep comparison
- `cosineSimilarity(vec1, vec2)` - Vector similarity
- `measureTime(fn)` - Performance measurement
- `runBenchmark(fn, iterations)` - Statistical benchmarking

### Helpers
- `validateSchema(backend)` - Schema validation
- `assertPerformance(time, threshold, op)` - Performance assertions
- `MockAgentDBBackend` - Mock backend for unit tests
- `withTimeout(promise, timeout)` - Timeout wrapper
- `retry(fn, options)` - Retry with backoff

## Performance Targets

All benchmarks must meet these targets:

| Metric | Target | Baseline | Improvement |
|--------|--------|----------|-------------|
| Pattern Search | <100µs | 15ms | 150x |
| Batch Insert (100) | <2ms | 1000ms | 500x |
| Large Query (10K) | <10ms | 100s | 10,000x |
| Memory Usage | 4-32x reduction | - | Quantization |
| Startup Time | <10ms | - | - |

## Continuous Integration

Tests run automatically on:

- ✅ Pull request creation
- ✅ Pull request updates
- ✅ Merge to main
- ✅ Nightly builds

### CI Configuration

```yaml
# .github/workflows/agentdb-tests.yml
- name: Run AgentDB Tests
  run: ./tests/run-agentdb-tests.sh

- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    files: ./coverage/lcov.info
    flags: agentdb
```

## Test Data

### Sample Test Data

```javascript
{
  key: 'test-0',
  value: {
    content: 'Test content 0',
    index: 0,
    category: 'cat-0'
  },
  embedding: [0.12, -0.34, 0.56, ...], // 384 dimensions
  metadata: {
    type: 'test',
    category: 0,
    tags: ['tag-0', 'tag-0'],
    priority: 0
  },
  namespace: 'ns1'
}
```

### Edge Cases Tested

- ✅ Empty databases
- ✅ Large values (>1MB)
- ✅ Special characters (Unicode, emojis)
- ✅ Circular references
- ✅ Null/undefined values
- ✅ Concurrent operations
- ✅ Database corruption
- ✅ Memory limits
- ✅ Invalid dimensions
- ✅ Malformed metadata

## Debugging Tests

### Enable Verbose Output

```bash
VERBOSE=true ./tests/run-agentdb-tests.sh
```

### Debug Single Test

```bash
npm run test:debug -- tests/unit/memory/agentdb/adapter.test.js
```

### View Test Logs

```bash
# Run with console output
npm test -- tests/unit/memory/agentdb/adapter.test.js --verbose

# Save to file
npm test -- tests/unit/memory/agentdb/adapter.test.js > test-output.log 2>&1
```

## Common Issues

### Issue: Tests Timeout

**Solution**: Increase test timeout in jest.config.js:
```javascript
testTimeout: 60000 // 60 seconds
```

### Issue: Database Locked

**Solution**: Clean up test databases:
```bash
rm -f /tmp/test-*.db /tmp/*.db-shm /tmp/*.db-wal
```

### Issue: Coverage Below Threshold

**Solution**: Check coverage report:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Contributing

When adding new tests:

1. ✅ Follow existing test structure
2. ✅ Use test utilities from `agentdb-test-helpers.js`
3. ✅ Include performance assertions
4. ✅ Test both success and error cases
5. ✅ Clean up test databases in `afterEach`
6. ✅ Update this README

## Related Documentation

- [AgentDB Integration Plan](../docs/AGENTDB_INTEGRATION_PLAN.md)
- [EnhancedMemory API](../src/memory/enhanced-memory.js)
- [Test Writing Guide](../docs/TESTING.md)
- [Performance Benchmarks](../docs/PERFORMANCE.md)

## License

MIT - Same as claude-flow

## Support

For test-related issues:
1. Check existing tests for examples
2. Review test utilities documentation
3. Open an issue on GitHub
4. Contact @agent2 (Testing Specialist)
