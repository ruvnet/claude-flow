# Performance Metrics Enhancement Guide

## Overview

The `performance.json` file has been enhanced with comprehensive metrics for tracking memory operations, mode usage, and ReasoningBank-specific performance.

## Enhanced Structure

### Session Information
```json
{
  "startTime": 1234567890,
  "sessionId": "session-1234567890",
  "lastActivity": 1234567890,
  "sessionDuration": 12345
}
```
Tracks when the session started, unique session ID, last activity timestamp, and total session duration in milliseconds.

### Memory Mode Tracking
```json
{
  "memoryMode": {
    "reasoningbankOperations": 45,
    "basicOperations": 12,
    "autoModeSelections": 50,
    "modeOverrides": 7,
    "currentMode": "auto"
  }
}
```
Tracks which memory mode (ReasoningBank vs Basic/JSON) is being used, how often AUTO MODE selects each, and manual overrides.

### Operation Type Breakdown
```json
{
  "operations": {
    "store": { "count": 20, "totalDuration": 1234, "errors": 0 },
    "retrieve": { "count": 45, "totalDuration": 2345, "errors": 1 },
    "query": { "count": 30, "totalDuration": 15000, "errors": 0 },
    "list": { "count": 10, "totalDuration": 500, "errors": 0 },
    "delete": { "count": 3, "totalDuration": 200, "errors": 0 },
    "search": { "count": 25, "totalDuration": 12000, "errors": 0 },
    "init": { "count": 1, "totalDuration": 500, "errors": 0 }
  }
}
```
Detailed breakdown of each operation type with count, total duration, and error count.

### Performance Statistics
```json
{
  "performance": {
    "avgOperationDuration": 450.5,
    "minOperationDuration": 10,
    "maxOperationDuration": 5000,
    "slowOperations": 3,
    "fastOperations": 100,
    "totalOperationTime": 45050
  }
}
```
- `avgOperationDuration`: Average time per operation (ms)
- `minOperationDuration`: Fastest operation time (ms)
- `maxOperationDuration`: Slowest operation time (ms)
- `slowOperations`: Count of operations > 5000ms
- `fastOperations`: Count of operations < 100ms
- `totalOperationTime`: Cumulative time for all operations (ms)

### Storage Statistics
```json
{
  "storage": {
    "totalEntries": 150,
    "reasoningbankEntries": 120,
    "basicEntries": 30,
    "databaseSize": 2048000,
    "lastBackup": 1234567890,
    "growthRate": 12.5
  }
}
```
- `totalEntries`: Total memory entries across all modes
- `reasoningbankEntries`: Entries in ReasoningBank database
- `basicEntries`: Entries in JSON storage
- `databaseSize`: Database file size in bytes
- `lastBackup`: Timestamp of last backup
- `growthRate`: Entries per hour growth rate

### Error Tracking
```json
{
  "errors": {
    "total": 5,
    "byType": {
      "timeout": 2,
      "connection": 1,
      "validation": 2
    },
    "byOperation": {
      "query": 3,
      "store": 2
    },
    "recent": [
      {
        "operation": "query",
        "type": "timeout",
        "timestamp": 1234567890,
        "mode": "reasoningbank"
      }
    ]
  }
}
```
Comprehensive error tracking by type, operation, and recent error history.

### ReasoningBank Specific Metrics
```json
{
  "reasoningbank": {
    "semanticSearches": 45,
    "sqlFallbacks": 12,
    "embeddingGenerated": 40,
    "consolidations": 3,
    "avgQueryTime": 450.5,
    "cacheHits": 25,
    "cacheMisses": 20
  }
}
```
- `semanticSearches`: Number of semantic vector searches
- `sqlFallbacks`: Number of SQL fallback queries (when semantic returns empty)
- `embeddingGenerated`: Number of text embeddings created
- `consolidations`: Number of memory consolidation runs
- `avgQueryTime`: Average query execution time (ms)
- `cacheHits`: Successful cache retrievals
- `cacheMisses`: Cache misses requiring computation

## Usage Examples

### Tracking Memory Operations

```javascript
import { trackMemoryOperation } from './performance-metrics.js';

// Track a successful query
const startTime = Date.now();
const result = await queryMemory('search term');
const duration = Date.now() - startTime;

await trackMemoryOperation('query', 'reasoningbank', duration, true);

// Track a failed operation with error
try {
  await storeMemory(data);
} catch (error) {
  const duration = Date.now() - startTime;
  await trackMemoryOperation('store', 'basic', duration, false, 'validation_error');
}
```

### Tracking Mode Selection

```javascript
import { trackModeSelection } from './performance-metrics.js';

// AUTO MODE selection
const mode = await detectMemoryMode();
await trackModeSelection(mode, true); // true = automatic selection

// Manual override
if (flags.reasoningbank) {
  await trackModeSelection('reasoningbank', false); // false = manual override
}
```

### Tracking ReasoningBank Operations

```javascript
import { trackReasoningBankOperation } from './performance-metrics.js';

// Track semantic search
const startTime = Date.now();
const results = await semanticSearch(query);
const duration = Date.now() - startTime;

if (results.length === 0) {
  // Semantic search returned empty, using SQL fallback
  await trackReasoningBankOperation('sql_fallback', duration);
} else {
  await trackReasoningBankOperation('semantic_search', duration);
}

// Track cache hits/misses
if (cacheHit) {
  await trackReasoningBankOperation('cache_hit', 0);
} else {
  await trackReasoningBankOperation('cache_miss', duration);
}
```

### Getting Performance Summary

```javascript
import { getMemoryPerformanceSummary } from './performance-metrics.js';

const summary = await getMemoryPerformanceSummary();

console.log('Session:', summary.session);
console.log('Mode Usage:', summary.mode);
console.log('Operations:', summary.operations);
console.log('Performance:', summary.performance);
console.log('Storage:', summary.storage);
console.log('ReasoningBank:', summary.reasoningbank);
console.log('Errors:', summary.errors);
```

The summary includes calculated metrics like:
- Error rate percentage
- SQL fallback rate (percentage of semantic searches that fell back to SQL)
- Cache hit rate (percentage of successful cache retrievals)

## Integration Points

These tracking functions should be integrated into:

1. **Memory Command** (`src/cli/simple-commands/memory.js`)
   - Track all store, retrieve, query, list, delete operations
   - Track mode detection and selection

2. **ReasoningBank Adapter** (`src/reasoningbank/reasoningbank-adapter.js`)
   - Track semantic searches
   - Track SQL fallbacks
   - Track embedding generation
   - Track cache hits/misses

3. **Session Hooks** (hooks system)
   - Initialize metrics at session start
   - Export metrics at session end
   - Update storage stats periodically

## Benefits

1. **Visibility**: Understand how AUTO MODE performs in real-world usage
2. **Performance Tuning**: Identify slow operations and bottlenecks
3. **Error Analysis**: Track error patterns and frequency
4. **Mode Optimization**: See which mode performs better for different workloads
5. **Resource Planning**: Monitor growth rates and storage usage
6. **Cache Effectiveness**: Measure cache hit rates for optimization

## Future Enhancements

Potential additions:
- Query pattern analysis (most common queries)
- Operation frequency heatmaps
- Performance degradation alerts
- Automatic recommendation system
- Export to time-series database for long-term analysis
- Real-time dashboards
