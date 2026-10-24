# Domain Expert Model - Usage Guide

This guide shows how to leverage the Domain Expert ReasoningBank model for expert-level technical decision-making across 5 domains.

## Quick Start

### 1. Test the Model

```bash
cd /workspaces/claude-code-flow/docs/reasoningbank/models/domain-expert

# Query the database directly
sqlite3 memory.db "SELECT problem, solution, confidence FROM patterns WHERE domain = 'DevOps & Infrastructure' LIMIT 1;"
```

### 2. Semantic Search Examples

```bash
# DevOps: Kubernetes patterns
sqlite3 memory.db "SELECT problem, domain, confidence FROM patterns WHERE problem LIKE '%Kubernetes%' LIMIT 5;"

# Security: OAuth patterns
sqlite3 memory.db "SELECT problem, solution, domain FROM patterns WHERE problem LIKE '%OAuth%' LIMIT 3;"

# Data Engineering: ETL patterns
sqlite3 memory.db "SELECT problem, solution, domain FROM patterns WHERE problem LIKE '%ETL%' LIMIT 3;"

# API: Rate limiting patterns
sqlite3 memory.db "SELECT problem, solution, domain FROM patterns WHERE problem LIKE '%rate limit%' LIMIT 3;"

# Performance: Caching patterns
sqlite3 memory.db "SELECT problem, solution, domain FROM patterns WHERE problem LIKE '%caching%' LIMIT 3;"
```

### 3. Cross-Domain Pattern Discovery

```bash
# Find patterns linked to a specific pattern
sqlite3 memory.db "
SELECT p.problem, p.domain, pl.link_type
FROM patterns p
JOIN pattern_links pl ON p.id = pl.target_id
WHERE pl.source_id = 1
LIMIT 5;
"

# Find patterns that enhance each other
sqlite3 memory.db "
SELECT p1.problem as source, p2.problem as enhances
FROM pattern_links pl
JOIN patterns p1 ON pl.source_id = p1.id
JOIN patterns p2 ON pl.target_id = p2.id
WHERE pl.link_type = 'enhances'
LIMIT 5;
"
```

### 4. Domain-Specific Queries

#### DevOps & Infrastructure
```bash
# CI/CD patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%CI/CD%' LIMIT 3;"

# Kubernetes patterns
sqlite3 memory.db "SELECT problem, success_rate FROM patterns WHERE tags LIKE '%Kubernetes%' LIMIT 3;"

# Monitoring patterns
sqlite3 memory.db "SELECT problem, solution FROM patterns WHERE tags LIKE '%Monitoring%' LIMIT 2;"
```

#### Data Engineering & ML
```bash
# ETL patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%ETL%' LIMIT 3;"

# ML Operations
sqlite3 memory.db "SELECT problem, solution FROM patterns WHERE tags LIKE '%MLOps%' LIMIT 2;"

# Feature Engineering
sqlite3 memory.db "SELECT problem, success_rate FROM patterns WHERE tags LIKE '%Feature-Engineering%' LIMIT 3;"
```

#### Security & Compliance
```bash
# Authentication patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%Authentication%' LIMIT 3;"

# GDPR patterns
sqlite3 memory.db "SELECT problem, solution FROM patterns WHERE tags LIKE '%GDPR%' LIMIT 2;"

# Encryption patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%Encryption%' LIMIT 3;"
```

#### API Design & Integration
```bash
# REST API patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%REST%' LIMIT 3;"

# GraphQL patterns
sqlite3 memory.db "SELECT problem, solution FROM patterns WHERE tags LIKE '%GraphQL%' LIMIT 2;"

# Webhook patterns
sqlite3 memory.db "SELECT problem, success_rate FROM patterns WHERE tags LIKE '%Webhooks%' LIMIT 3;"
```

#### Performance & Scalability
```bash
# Caching patterns
sqlite3 memory.db "SELECT problem, confidence FROM patterns WHERE tags LIKE '%Caching%' LIMIT 3;"

# Load Balancing patterns
sqlite3 memory.db "SELECT problem, solution FROM patterns WHERE tags LIKE '%Load-Balancing%' LIMIT 2;"

# Database optimization
sqlite3 memory.db "SELECT problem, success_rate FROM patterns WHERE tags LIKE '%Database%' LIMIT 3;"
```

## Integration with Agentic-Flow

### Use with Specialized Agents

```bash
# DevOps agent with domain expertise
npx agentic-flow agent devops \
  "Design a CI/CD pipeline for microservices" \
  --model claude-sonnet-4-5-20250929

# Security agent with compliance patterns
npx agentic-flow agent security-engineer \
  "Implement OAuth 2.0 with PKCE for mobile app" \
  --model claude-sonnet-4-5-20250929

# Data engineer with ML patterns
npx agentic-flow agent data-engineer \
  "Build a real-time ETL pipeline with quality checks" \
  --model claude-sonnet-4-5-20250929

# API architect with design patterns
npx agentic-flow agent system-architect \
  "Design a RESTful API with versioning and rate limiting" \
  --model claude-sonnet-4-5-20250929
```

## Advanced Queries

### High-Confidence Patterns
```bash
# Get patterns with >90% confidence
sqlite3 memory.db "
SELECT domain, COUNT(*) as count
FROM patterns
WHERE confidence > 0.90
GROUP BY domain
ORDER BY count DESC;
"
```

### High-Success Patterns
```bash
# Get patterns with >90% success rate
sqlite3 memory.db "
SELECT problem, confidence, success_rate, domain
FROM patterns
WHERE success_rate > 0.90
ORDER BY success_rate DESC
LIMIT 10;
"
```

### Cross-Domain Analysis
```bash
# Find patterns that appear across multiple domains (via links)
sqlite3 memory.db "
SELECT p.domain, COUNT(DISTINCT pl.target_id) as linked_to
FROM patterns p
JOIN pattern_links pl ON p.id = pl.source_id
GROUP BY p.domain
ORDER BY linked_to DESC;
"
```

### Tag Analysis
```bash
# Most common tags
sqlite3 memory.db "
SELECT tags, COUNT(*) as frequency
FROM patterns
GROUP BY tags
ORDER BY frequency DESC
LIMIT 20;
"
```

## Performance Benchmarks

Run these to test query performance:

```bash
# Measure simple query performance
time sqlite3 memory.db "SELECT COUNT(*) FROM patterns;"

# Measure join query performance
time sqlite3 memory.db "
SELECT COUNT(*)
FROM patterns p
JOIN pattern_links pl ON p.id = pl.source_id;
"

# Measure complex query performance
time sqlite3 memory.db "
SELECT p.domain, AVG(p.confidence), COUNT(*)
FROM patterns p
JOIN pattern_links pl ON p.id = pl.source_id
WHERE p.confidence > 0.85
GROUP BY p.domain;
"
```

Expected performance:
- Simple queries: < 5ms
- Join queries: < 10ms
- Complex aggregations: < 20ms

## Export Patterns for Analysis

```bash
# Export to CSV
sqlite3 memory.db <<EOF
.headers on
.mode csv
.output domain-expert-patterns.csv
SELECT domain, problem, confidence, success_rate, tags FROM patterns;
.output stdout
EOF

# Export specific domain
sqlite3 memory.db <<EOF
.headers on
.mode csv
.output devops-patterns.csv
SELECT problem, solution, confidence, success_rate FROM patterns WHERE domain = 'DevOps & Infrastructure';
.output stdout
EOF
```

## Debugging & Inspection

```bash
# Check database integrity
sqlite3 memory.db "PRAGMA integrity_check;"

# View table schemas
sqlite3 memory.db ".schema patterns"
sqlite3 memory.db ".schema pattern_links"
sqlite3 memory.db ".schema pattern_embeddings"

# Database statistics
sqlite3 memory.db "
SELECT
  'Patterns' as table_name,
  COUNT(*) as rows
FROM patterns
UNION ALL
SELECT
  'Links',
  COUNT(*)
FROM pattern_links
UNION ALL
SELECT
  'Embeddings',
  COUNT(*)
FROM pattern_embeddings;
"

# Index usage
sqlite3 memory.db "PRAGMA index_list(patterns);"
```

## Common Use Cases

### 1. Architecture Decision Support
```bash
# Find patterns for microservices architecture
sqlite3 memory.db "
SELECT problem, solution, confidence
FROM patterns
WHERE (problem LIKE '%microservice%' OR solution LIKE '%microservice%')
ORDER BY confidence DESC
LIMIT 5;
"
```

### 2. Security Best Practices
```bash
# Find all security-related patterns
sqlite3 memory.db "
SELECT problem, confidence, success_rate
FROM patterns
WHERE domain = 'Security & Compliance'
ORDER BY confidence DESC, success_rate DESC
LIMIT 10;
"
```

### 3. Performance Optimization
```bash
# Find performance patterns with proven success
sqlite3 memory.db "
SELECT problem, solution, success_rate
FROM patterns
WHERE domain = 'Performance & Scalability'
  AND success_rate > 0.85
ORDER BY success_rate DESC
LIMIT 5;
"
```

### 4. Compliance Implementation
```bash
# Find GDPR and SOC2 patterns
sqlite3 memory.db "
SELECT problem, rationale, confidence
FROM patterns
WHERE (tags LIKE '%GDPR%' OR tags LIKE '%SOC2%')
ORDER BY confidence DESC
LIMIT 5;
"
```

## Troubleshooting

### Database locked error
```bash
# Check for active connections
fuser memory.db

# Kill processes if needed
fuser -k memory.db
```

### Slow queries
```bash
# Analyze query plan
sqlite3 memory.db "EXPLAIN QUERY PLAN SELECT * FROM patterns WHERE domain = 'DevOps & Infrastructure';"

# Rebuild indexes if needed
sqlite3 memory.db "REINDEX;"

# Analyze database for optimization
sqlite3 memory.db "ANALYZE;"
```

### Memory errors
```bash
# Check database size
ls -lh memory.db

# Compact database
sqlite3 memory.db "VACUUM;"
```

## Model Updates

To retrain with updated patterns:

```bash
# Backup current model
cp memory.db memory.db.backup

# Run training script
node train-domain.js

# Validate
node validate.js

# Compare results
sqlite3 memory.db "SELECT COUNT(*) FROM patterns;" | head -1
sqlite3 memory.db.backup "SELECT COUNT(*) FROM patterns;" | head -1
```

## Support & Feedback

- **Issues**: Report bugs or request features at https://github.com/ruvnet/claude-flow/issues
- **Documentation**: https://github.com/ruvnet/claude-flow
- **Community**: Join the Claude Flow Discord

---

**Last Updated**: 2025-10-15
**Model Version**: 1.0.0
**Database Size**: 2.39 MB
**Query Performance**: < 5ms average
