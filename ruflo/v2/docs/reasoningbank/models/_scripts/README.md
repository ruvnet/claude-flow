# Scripts - Utility Tools

This folder contains utility scripts for managing ReasoningBank models.

## Available Scripts

### Schema Management

**`fix-schema-compatibility.cjs`** - Add claude-flow tables to models
- Adds missing memory tables (`memory`, `memory_entries`, `collective_memory`, etc.)
- Creates automatic backups (`.backup` files)
- Optimizes databases (indexes, ANALYZE, VACUUM)
- Generates verification reports

**Usage**:
```bash
# Fix all models
node _scripts/fix-schema-compatibility.cjs

# Output: Updates all 5 models with full schema
```

**Features**:
- ✅ Safe: Creates backups before changes
- ✅ Idempotent: Can run multiple times safely
- ✅ Fast: Processes all models in ~30 seconds
- ✅ Verified: Generates reports for each model

---

**`schema-validator.cjs`** - Validate database schema
- Checks for required tables
- Validates table structures
- Identifies missing columns
- Can auto-fix schema issues

**Usage**:
```bash
# Validate a model
node _scripts/schema-validator.cjs safla/memory.db validate

# Fix schema issues
node _scripts/schema-validator.cjs safla/memory.db fix

# Generate report
node _scripts/schema-validator.cjs safla/memory.db report
```

**Checks**:
- ✅ All 12 required tables present
- ✅ Correct column definitions
- ✅ Indexes created
- ✅ Foreign keys valid

---

### Quality Assurance

**`validation-suite.cjs`** - Comprehensive quality validation
- Pattern count and data quality
- Embedding coverage (should be 100%)
- Confidence and success rate statistics
- Query performance benchmarks
- Storage efficiency analysis

**Usage**:
```bash
# Validate a model
node _scripts/validation-suite.cjs safla safla

# Output: validation-report.md with 10 quality checks
```

**Quality Checks**:
1. ✅ Database schema
2. ✅ Pattern count (>1000)
3. ✅ Embedding coverage (100%)
4. ✅ Confidence scores (>70%)
5. ✅ Success rates (>75%)
6. ✅ Pattern links (>2 per pattern)
7. ✅ Query performance (<5ms)
8. ✅ Storage efficiency (<10KB/pattern)
9. ✅ Domain coverage (>3 domains)
10. ✅ Data integrity

---

**`benchmark-all.cjs`** - Performance benchmarking
- Tests all 5 models in parallel
- Measures query latency
- Analyzes storage efficiency
- Generates comparison reports

**Usage**:
```bash
# Benchmark all models
node _scripts/benchmark-all.cjs

# Output: benchmark-report.md for each model + summary
```

**Benchmarks**:
- Simple queries (should be <2ms)
- Filtered queries (should be <3ms)
- JOIN operations (should be <5ms)
- Aggregate queries (should be <10ms)
- Storage per pattern (should be <10KB)

---

### Training Coordination

**`training-coordinator.cjs`** - Multi-agent training orchestration
- Initializes swarm coordination
- Manages agent progress tracking
- Coordinates shared memory
- Finalizes training sessions

**Usage**:
```javascript
const TrainingCoordinator = require('./_scripts/training-coordinator.cjs');
const coordinator = new TrainingCoordinator();

await coordinator.initializeSwarm();
await coordinator.reportProgress('model-name', { patterns: 500 });
await coordinator.finalizeSwarm();
```

**Features**:
- Shared memory coordination
- Progress tracking per agent
- Session management
- Status reporting

---

## Quick Reference

### Common Tasks

**Validate all models**:
```bash
for model in safla google-research problem-solving domain-expert; do
  node _scripts/validation-suite.cjs $model $model
done
```

**Fix schema for all models**:
```bash
node _scripts/fix-schema-compatibility.cjs
```

**Benchmark performance**:
```bash
node _scripts/benchmark-all.cjs
```

**Check schema compliance**:
```bash
node _scripts/schema-validator.cjs safla/memory.db validate
```

---

## Script Dependencies

All scripts use:
- **better-sqlite3** - SQLite database access
- **Node.js** - Runtime (v18+)

Install dependencies:
```bash
npm install better-sqlite3
```

Or use the scripts directly (they use the project's installed dependencies):
```bash
cd /workspaces/claude-code-flow/docs/reasoningbank/models
node _scripts/fix-schema-compatibility.cjs
```

---

## Output Files

Scripts generate various output files:

### Reports
- `validation-report.md` - Quality validation results
- `benchmark-report.md` - Performance benchmarks
- `SCHEMA-FIX-REPORT.md` - Schema update details
- `schema-report.md` - Schema validation results

### Backups
- `memory.db.backup` - Automatic backups before schema changes

### Logs
- Console output with progress and status

---

## Troubleshooting

### Script fails with "module not found"

**Solution**: Install dependencies
```bash
npm install better-sqlite3
```

### "Database locked" error

**Solution**: Close other connections
```bash
# Ensure no other processes are using the database
lsof | grep memory.db
```

### Schema validation fails

**Solution**: Run the fix script
```bash
node _scripts/fix-schema-compatibility.cjs
```

### Performance issues

**Solution**: Optimize database
```bash
sqlite3 model/memory.db "REINDEX; ANALYZE; VACUUM;"
```

---

## Contributing

When adding new scripts:

1. **Use `.cjs` extension** for CommonJS modules
2. **Add usage documentation** in this README
3. **Include error handling** for robustness
4. **Generate reports** for audit trails
5. **Make idempotent** where possible

---

## Navigation

```
models/
├── _docs/              ← Technical documentation
├── _scripts/           ← You are here (utility scripts)
│   ├── fix-schema-compatibility.cjs
│   ├── schema-validator.cjs
│   ├── validation-suite.cjs
│   ├── benchmark-all.cjs
│   └── training-coordinator.cjs
├── safla/              ← Model directories
├── google-research/
├── code-reasoning/
├── problem-solving/
├── domain-expert/
└── ...
```

---

**Last Updated**: 2025-10-15
**Total Scripts**: 5
**Purpose**: Model management and quality assurance
