---
name: claude-flow-memory
description: Interact with Claude-Flow memory system using batchtools optimization
---

# Claude-Flow Memory System (Batchtools Optimized)

The memory system provides persistent storage with enhanced batch operations for efficient cross-session and cross-agent collaboration.

## Batch Store Operations
```bash
# Single store (traditional)
npx claude-flow memory store "key" "value" --namespace project

# Batch store multiple key-value pairs
npx claude-flow memory batch-store --data '{
  "project_specs": "e-commerce platform requirements",
  "api_design": "RESTful API architecture",
  "db_schema": "PostgreSQL database design"
}' --namespace project

# Bulk import from file
npx claude-flow memory bulk-import data.json --parallel
```

## Parallel Query Operations
```bash
# Single query (traditional)
npx claude-flow memory query "search term" --limit 10

# Parallel multi-term search
npx claude-flow memory batch-query --terms "api,database,authentication" --parallel

# Cross-namespace parallel search
npx claude-flow memory multi-query "pattern" --namespaces "all" --concurrent
```

## Batch Statistics & Analysis
```bash
# Comprehensive stats across all namespaces
npx claude-flow memory batch-stats --detailed --parallel

# Analyze memory usage patterns
npx claude-flow memory analyze --patterns --concurrent

# Generate usage reports
npx claude-flow memory batch-report --format "json,csv,html"
```

## Bulk Export/Import Operations
```bash
# Export multiple namespaces concurrently
npx claude-flow memory batch-export --namespaces "project,agents,tasks" --output exports/

# Parallel import with validation
npx claude-flow memory batch-import --files "*.json" --validate --parallel

# Incremental backup with compression
npx claude-flow memory backup --incremental --compress --parallel
```

## Enhanced Namespace Operations
```bash
# Create multiple namespaces
npx claude-flow memory batch-create-ns "feature1,feature2,feature3"

# Clone namespaces in parallel
npx claude-flow memory batch-clone --source project --targets "dev,test,prod"

# Merge namespaces concurrently
npx claude-flow memory batch-merge --sources "temp1,temp2" --target main
```

## Advanced Batch Operations

### Parallel Data Processing
```bash
# Transform data across namespaces
npx claude-flow memory batch-transform --operation "encrypt" --namespaces "sensitive"

# Aggregate data from multiple sources
npx claude-flow memory batch-aggregate --sources "logs,metrics,events" --operation "summarize"
```

### Concurrent Synchronization
```bash
# Sync memory across agents
npx claude-flow memory batch-sync --agents "all" --bidirectional

# Replicate to remote storage
npx claude-flow memory batch-replicate --destinations "s3,gcs" --parallel
```

### Bulk Cleanup Operations
```bash
# Clean old data in parallel
npx claude-flow memory batch-clean --older-than "30d" --namespaces "all"

# Optimize storage concurrently
npx claude-flow memory batch-optimize --compact --dedupe --parallel
```

## Performance Optimizations

### Batch Read Operations
```bash
# Prefetch related data
npx claude-flow memory batch-prefetch --keys "user_*" --cache

# Parallel read with fallback
npx claude-flow memory batch-read --keys-file keys.txt --fallback-ns default
```

### Batch Write Operations
```bash
# Atomic batch writes
npx claude-flow memory batch-write --atomic --data updates.json

# Conditional batch updates
npx claude-flow memory batch-update --if-exists --data changes.json
```

## Monitoring & Analytics

### Real-time Batch Monitoring
```bash
# Monitor batch operations
npx claude-flow memory monitor --batch-ops --real-time

# Track memory usage patterns
npx claude-flow memory track --patterns --visualize
```

### Performance Analysis
```bash
# Analyze batch operation performance
npx claude-flow memory perf-analyze --operations "read,write,query"

# Generate optimization recommendations
npx claude-flow memory optimize-suggest --based-on-usage
```

## Best Practices for Batch Operations
- Use `--parallel` for independent operations
- Enable `--atomic` for data consistency
- Leverage `--cache` for repeated reads
- Use `--stream` for large datasets
- Enable `--compress` for network transfers
- Set `--batch-size` based on memory limits
- Use `--retry` for resilient operations
- Enable `--validate` for data integrity

## Examples of Complex Workflows

### Project Initialization
```bash
# Initialize complete project memory in parallel
npx claude-flow memory batch-init --template "web-app" --namespaces "specs,arch,impl,tests"
```

### Data Migration
```bash
# Migrate data between formats
npx claude-flow memory batch-migrate --from "v1" --to "v2" --transform migrate.js --parallel
```

### Distributed Processing
```bash
# Process memory data across multiple workers
npx claude-flow memory distribute --operation "analyze" --workers 4 --queue-size 1000
```