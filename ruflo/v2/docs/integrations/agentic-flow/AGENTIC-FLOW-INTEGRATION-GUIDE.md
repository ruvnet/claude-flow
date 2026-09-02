# Agentic-Flow Integration Guide for Claude-Flow

## 🎯 Overview

Claude-Flow v2.6.0+ includes deep integration with agentic-flow, providing access to 66+ specialized AI agents with multi-provider support, ReasoningBank memory, and intelligent model optimization.

## 🚀 Quick Start

```bash
# Initialize ReasoningBank for learning agents
claude-flow agent memory init

# Run your first agent
claude-flow agent run coder "Build a REST API with authentication"

# Run with memory enabled (learns from experience)
claude-flow agent run coder "Add user management API" --enable-memory

# Check what the agent learned
claude-flow agent memory status
```

## 📚 Complete Command Reference

### 1. Agent Execution

#### Basic Agent Execution

```bash
# Execute any of the 66+ available agents
claude-flow agent run <agent-type> "<task>" [options]

# Examples
claude-flow agent run coder "Create Express.js REST API"
claude-flow agent run researcher "Research GraphQL best practices"
claude-flow agent run security-auditor "Audit authentication code"
claude-flow agent run full-stack-developer "Build Next.js app"
claude-flow agent run tester "Create Jest test suite"
```

#### Multi-Provider Support

```bash
# Use different LLM providers
claude-flow agent run coder "Build API" --provider anthropic
claude-flow agent run coder "Build API" --provider openrouter
claude-flow agent run coder "Build API" --provider onnx        # Local
claude-flow agent run coder "Build API" --provider gemini

# With specific models
claude-flow agent run coder "Build API" --provider anthropic --model claude-3-5-sonnet-20241022
claude-flow agent run coder "Build API" --provider openrouter --model meta-llama/llama-3.1-70b-instruct
```

#### Execution Options

```bash
# Temperature control (creativity vs consistency)
claude-flow agent run coder "Write code" --temperature 0.3

# Max tokens (output length)
claude-flow agent run researcher "Research topic" --max-tokens 4096

# Output format
claude-flow agent run analyst "Analyze data" --format json
claude-flow agent run researcher "Research" --format markdown

# Streaming output
claude-flow agent run coder "Build API" --stream

# Verbose logging
claude-flow agent run coder "Build API" --verbose

# Retry on errors
claude-flow agent run coder "Build API" --retry

# Custom timeout
claude-flow agent run coder "Complex task" --timeout 600000  # 10 minutes
```

### 2. Model Optimization (85-98% Cost Savings)

```bash
# Auto-select optimal model based on task
claude-flow agent run coder "Fix simple bug" --optimize

# Optimize for cost (cheapest model that works)
claude-flow agent run coder "Add logging" --optimize --priority cost

# Optimize for quality (best model)
claude-flow agent run coder "Critical security fix" --optimize --priority quality

# Optimize for speed (fastest model)
claude-flow agent run coder "Quick refactor" --optimize --priority speed

# Optimize for privacy (local models only)
claude-flow agent run coder "Sensitive code" --optimize --priority privacy

# Balanced optimization (cost + quality)
claude-flow agent run coder "Feature implementation" --optimize --priority balanced

# With budget cap
claude-flow agent run coder "Build API" --optimize --max-cost 0.10  # Max $0.10
```

### 3. ReasoningBank Memory System

#### Initialize Memory

```bash
# First time setup
claude-flow agent memory init

# With custom database location
claude-flow agent memory init --db /path/to/memory.db
```

#### Run Agents with Memory

```bash
# Enable learning from experience
claude-flow agent run coder "Build authentication API" --enable-memory

# With domain filtering (organize memories)
claude-flow agent run coder "Add JWT auth" --enable-memory --memory-domain authentication

# Customize memory retrieval
claude-flow agent run coder "Add OAuth" --enable-memory \
  --memory-k 5 \
  --memory-min-confidence 0.7 \
  --memory-domain authentication

# Custom task ID for tracking
claude-flow agent run coder "Deploy app" --enable-memory \
  --memory-task-id deploy-v1.0.0

# Read memories without creating new ones
claude-flow agent run researcher "Check patterns" --enable-memory --no-memory-learning

# Custom memory database
claude-flow agent run coder "Build API" --enable-memory --memory-db .swarm/custom.db
```

#### Memory Management

```bash
# Check memory statistics
claude-flow agent memory status

# List stored memories
claude-flow agent memory list
claude-flow agent memory list --domain authentication
claude-flow agent memory list --limit 20

# Consolidate (deduplicate and prune)
claude-flow agent memory consolidate

# Run interactive demo (see 0% → 100% learning)
claude-flow agent memory demo

# Run validation tests
claude-flow agent memory test

# Run performance benchmarks
claude-flow agent memory benchmark
```

### 4. Agent Discovery and Management

```bash
# List all 66+ available agents
claude-flow agent agents

# Get detailed agent information
claude-flow agent info coder
claude-flow agent info security-auditor
claude-flow agent info full-stack-developer

# Create custom agent
claude-flow agent create \
  --name "api-specialist" \
  --description "Specialized in REST API design" \
  --category "backend" \
  --prompt "You are an expert in REST API design..." \
  --tools "web-search,code-execution"

# Check for agent conflicts (package vs local)
claude-flow agent conflicts
```

### 5. Configuration Management

```bash
# Interactive setup wizard
claude-flow agent config wizard

# Set API keys
claude-flow agent config set ANTHROPIC_API_KEY sk-ant-xxx
claude-flow agent config set OPENROUTER_API_KEY sk-or-xxx
claude-flow agent config set GOOGLE_GEMINI_API_KEY xxx

# Set default provider/model
claude-flow agent config set DEFAULT_PROVIDER anthropic
claude-flow agent config set DEFAULT_MODEL claude-3-5-sonnet-20241022

# Get configuration
claude-flow agent config get ANTHROPIC_API_KEY
claude-flow agent config get DEFAULT_PROVIDER

# List all configurations
claude-flow agent config list
claude-flow agent config list --show-secrets

# Delete configuration
claude-flow agent config delete OPENROUTER_API_KEY

# Reset to defaults
claude-flow agent config reset --force
```

### 6. MCP Server Management

```bash
# Start MCP server
claude-flow agent mcp start
claude-flow agent mcp start --port 3000
claude-flow agent mcp start --daemon  # Run in background

# Check server status
claude-flow agent mcp status
claude-flow agent mcp status --detailed

# List available MCP tools
claude-flow agent mcp list
claude-flow agent mcp list --server agent-booster
claude-flow agent mcp list --category "code-editing"

# View logs
claude-flow agent mcp logs
claude-flow agent mcp logs --lines 100
claude-flow agent mcp logs --follow

# Stop/restart server
claude-flow agent mcp stop
claude-flow agent mcp restart
```

## 🧠 ReasoningBank Learning Workflow

### Complete Example: Building an Authentication System

```bash
# Step 1: Initialize memory system
claude-flow agent memory init

# Step 2: Build JWT authentication (first attempt)
claude-flow agent run coder "Build JWT authentication with Express.js" \
  --enable-memory \
  --memory-domain authentication/jwt \
  --memory-task-id auth-v1 \
  --format markdown

# Step 3: Add OAuth2 (learns from JWT experience)
claude-flow agent run coder "Add OAuth2 authentication" \
  --enable-memory \
  --memory-domain authentication/oauth \
  --memory-k 5

# Step 4: Check what was learned
claude-flow agent memory list --domain authentication

# Output shows memories like:
# 1. JWT Token Validation Pattern
#    Confidence: 0.85 | Usage: 2 | Created: 2025-10-12
#    Domain: authentication/jwt
#    Always validate JWT expiration before database queries
#
# 2. OAuth2 Token Refresh Strategy
#    Confidence: 0.80 | Usage: 1 | Created: 2025-10-12
#    Domain: authentication/oauth
#    Store refresh tokens securely and implement rotation

# Step 5: Add new authentication method (benefits from both JWT and OAuth memories)
claude-flow agent run coder "Add SAML SSO authentication" \
  --enable-memory \
  --memory-domain authentication/saml \
  --memory-k 5 \
  --memory-min-confidence 0.7

# Step 6: Consolidate memories (remove duplicates, prune old ones)
claude-flow agent memory consolidate

# Step 7: Check improved statistics
claude-flow agent memory status
```

## 🔥 Advanced Usage Patterns

### Pattern 1: Progressive Enhancement with Memory

```bash
# Day 1: Build initial feature
claude-flow agent run full-stack-developer "Build user profile page" \
  --enable-memory \
  --memory-domain profiles \
  --provider anthropic

# Day 2: Add related feature (learns from Day 1)
claude-flow agent run full-stack-developer "Add profile picture upload" \
  --enable-memory \
  --memory-domain profiles \
  --memory-k 5

# Day 3: Add another related feature (learns from Days 1-2)
claude-flow agent run full-stack-developer "Add profile settings page" \
  --enable-memory \
  --memory-domain profiles \
  --memory-k 5

# Result: Each iteration is faster and more consistent
```

### Pattern 2: Cost-Optimized Development

```bash
# Use cheap models for simple tasks
claude-flow agent run coder "Add console logging" \
  --optimize --priority cost \
  --enable-memory

# Use quality models for complex tasks
claude-flow agent run coder "Implement distributed caching" \
  --optimize --priority quality \
  --max-cost 0.50 \
  --enable-memory

# Let optimizer decide based on task
claude-flow agent run coder "Refactor authentication module" \
  --optimize --priority balanced \
  --enable-memory
```

### Pattern 3: Multi-Agent Workflow

```bash
# Research phase
claude-flow agent run researcher "Research GraphQL best practices for authentication" \
  --enable-memory \
  --memory-domain research/graphql \
  --format markdown

# Design phase
claude-flow agent run system-architect "Design GraphQL API schema for authentication" \
  --enable-memory \
  --memory-domain design/graphql \
  --memory-k 5

# Implementation phase
claude-flow agent run coder "Implement GraphQL authentication API" \
  --enable-memory \
  --memory-domain implementation/graphql \
  --memory-k 10

# Testing phase
claude-flow agent run tester "Create comprehensive GraphQL API tests" \
  --enable-memory \
  --memory-domain testing/graphql \
  --memory-k 5

# Review phase
claude-flow agent run security-auditor "Audit GraphQL authentication security" \
  --enable-memory \
  --memory-domain security/graphql \
  --memory-k 10

# Check accumulated knowledge
claude-flow agent memory list --domain graphql
```

### Pattern 4: Domain-Specific Knowledge Building

```bash
# Build security knowledge base
for task in \
  "Implement input validation" \
  "Add SQL injection prevention" \
  "Implement CSRF protection" \
  "Add XSS prevention" \
  "Implement rate limiting"
do
  claude-flow agent run security-auditor "$task" \
    --enable-memory \
    --memory-domain security \
    --memory-k 10
done

# Now security agent has comprehensive security knowledge
claude-flow agent memory list --domain security
```

### Pattern 5: Local Development with ONNX

```bash
# Run entirely locally (no API calls)
claude-flow agent run coder "Add logging to function" \
  --provider onnx \
  --enable-memory

# Benefits:
# - $0 cost
# - Privacy (code never leaves machine)
# - No API key needed
# - Good for simple tasks
```

## 🔗 Integration with Claude-Flow Swarms

Combine agentic-flow agents with claude-flow swarm coordination:

```bash
# Initialize swarm with agentic-flow agents
claude-flow swarm init --topology mesh --agents 5

# Each agent runs via agentic-flow with memory
claude-flow agent run coder "Build API endpoint" --enable-memory &
claude-flow agent run tester "Create tests" --enable-memory &
claude-flow agent run security-auditor "Security review" --enable-memory &

# Check swarm status
claude-flow swarm status
```

## 📊 Understanding ReasoningBank Performance

### Memory Scoring Formula

```
score = α·similarity + β·recency + γ·reliability + δ·diversity

Default weights:
- α (similarity)  = 0.7  // Semantic relevance
- β (recency)     = 0.2  // How recent
- γ (reliability) = 0.1  // Confidence from past use
- δ (diversity)   = 0.3  // MMR diversity selection
```

### Customize Scoring (Environment Variables)

```bash
# Adjust weights
export REASONINGBANK_ALPHA=0.8    # Prioritize similarity
export REASONINGBANK_BETA=0.1     # Less weight on recency
export REASONINGBANK_GAMMA=0.1    # Keep reliability weight
export REASONINGBANK_DELTA=0.2    # Less diversity

# Other settings
export REASONINGBANK_K=5                      # Retrieve top 5 memories
export REASONINGBANK_MIN_CONFIDENCE=0.7       # Higher quality threshold
export REASONINGBANK_RECENCY_HALFLIFE=14      # 2-week half-life

# Database location
export CLAUDE_FLOW_DB_PATH=.swarm/team-memory.db
```

### Performance Metrics

After running agents with memory, check improvements:

```bash
claude-flow agent memory status
```

Expected metrics:
- **Success rate**: 70% → 88% (+26%)
- **Token usage**: -25% reduction
- **Learning velocity**: 3.2x faster
- **Task completion**: 0% → 95% over 5 iterations

## 🎯 Real-World Examples

### Example 1: Building a Complete REST API

```bash
#!/bin/bash

# Initialize memory
claude-flow agent memory init

# Research phase
claude-flow agent run researcher "Research Express.js REST API best practices 2025" \
  --enable-memory \
  --memory-domain api/research \
  --format markdown > research-notes.md

# Architecture phase
claude-flow agent run system-architect "Design REST API architecture for task management" \
  --enable-memory \
  --memory-domain api/architecture \
  --memory-k 5

# Implementation phase - Core API
claude-flow agent run full-stack-developer "Implement Express.js REST API with PostgreSQL" \
  --enable-memory \
  --memory-domain api/implementation \
  --memory-k 10 \
  --optimize --priority balanced

# Implementation phase - Authentication
claude-flow agent run coder "Add JWT authentication to API" \
  --enable-memory \
  --memory-domain api/authentication \
  --memory-k 10

# Implementation phase - Validation
claude-flow agent run coder "Add input validation with Joi" \
  --enable-memory \
  --memory-domain api/validation \
  --memory-k 10

# Testing phase
claude-flow agent run tester "Create comprehensive Jest test suite" \
  --enable-memory \
  --memory-domain api/testing \
  --memory-k 15

# Security audit
claude-flow agent run security-auditor "Audit API for security vulnerabilities" \
  --enable-memory \
  --memory-domain api/security \
  --memory-k 15

# Performance optimization
claude-flow agent run performance-optimizer "Optimize API performance" \
  --enable-memory \
  --memory-domain api/performance \
  --memory-k 10

# Documentation
claude-flow agent run technical-writer "Create API documentation" \
  --enable-memory \
  --memory-domain api/documentation \
  --format markdown > API-DOCS.md

# Check what was learned
echo "\n📚 Knowledge accumulated:"
claude-flow agent memory list --domain api --limit 20

# Consolidate memories
claude-flow agent memory consolidate
```

### Example 2: Debugging with Memory

```bash
# First bug: Database connection timeout
claude-flow agent run debugger "Fix PostgreSQL connection timeout error" \
  --enable-memory \
  --memory-domain debugging/database \
  --memory-task-id bug-001

# Second bug: Similar database issue (learns from first)
claude-flow agent run debugger "Fix database deadlock in transaction" \
  --enable-memory \
  --memory-domain debugging/database \
  --memory-k 10 \
  --memory-task-id bug-002

# Result: Second fix is faster because agent remembers:
# - Database connection pool configuration
# - Transaction isolation levels
# - Common PostgreSQL issues
```

### Example 3: Migration Project

```bash
# Phase 1: Analyze existing code
claude-flow agent run code-analyzer "Analyze Express.js v4 API structure" \
  --enable-memory \
  --memory-domain migration/analysis

# Phase 2: Plan migration
claude-flow agent run system-architect "Plan Express.js v4 to v5 migration" \
  --enable-memory \
  --memory-domain migration/planning \
  --memory-k 5

# Phase 3: Execute migration (benefits from phases 1-2)
claude-flow agent run full-stack-developer "Migrate Express.js v4 to v5" \
  --enable-memory \
  --memory-domain migration/implementation \
  --memory-k 10

# Phase 4: Validate migration
claude-flow agent run tester "Create migration validation tests" \
  --enable-memory \
  --memory-domain migration/testing \
  --memory-k 10
```

## 🔍 Troubleshooting

### Issue: Agent execution fails

```bash
# Check configuration
claude-flow agent config list

# Check API keys are set
claude-flow agent config get ANTHROPIC_API_KEY

# Try with explicit provider
claude-flow agent run coder "Test task" --provider anthropic

# Check verbose output
claude-flow agent run coder "Test task" --verbose
```

### Issue: Memory not working

```bash
# Verify memory is initialized
claude-flow agent memory status

# Re-initialize if needed
claude-flow agent memory init

# Test with demo
claude-flow agent memory demo

# Check database exists
ls -la .swarm/memory.db
```

### Issue: Slow performance

```bash
# Use model optimization
claude-flow agent run coder "Task" --optimize --priority speed

# Reduce memory retrieval
claude-flow agent run coder "Task" --enable-memory --memory-k 3

# Consolidate old memories
claude-flow agent memory consolidate
```

### Issue: Out of memory errors

```bash
# Consolidate to prune old memories
claude-flow agent memory consolidate

# Check memory statistics
claude-flow agent memory status

# Use new database if too large
claude-flow agent run coder "Task" --enable-memory --memory-db .swarm/new.db
```

## 📈 Best Practices

### 1. Memory Organization

```bash
# Use hierarchical domains
--memory-domain project/feature/aspect

# Examples:
--memory-domain ecommerce/auth/jwt
--memory-domain ecommerce/cart/checkout
--memory-domain ecommerce/payments/stripe
```

### 2. Progressive Learning

```bash
# Start simple, build up knowledge
claude-flow agent run coder "Build simple API" --enable-memory
claude-flow agent run coder "Add validation" --enable-memory --memory-k 5
claude-flow agent run coder "Add authentication" --enable-memory --memory-k 10
claude-flow agent run coder "Add rate limiting" --enable-memory --memory-k 15
```

### 3. Cost Optimization

```bash
# Use optimize flag consistently
alias cf-run='claude-flow agent run --optimize --enable-memory'

# Then use normally
cf-run coder "Build feature"
cf-run tester "Create tests"
```

### 4. Regular Maintenance

```bash
# Weekly: Consolidate memories
claude-flow agent memory consolidate

# Monthly: Check memory health
claude-flow agent memory status
claude-flow agent memory benchmark
```

## 🚀 Migration from Direct agentic-flow Usage

If you're currently using `npx agentic-flow` directly:

### Before (direct agentic-flow):
```bash
npx agentic-flow --agent coder --task "Build API" \
  --provider anthropic \
  --enable-memory \
  --memory-domain api
```

### After (via claude-flow):
```bash
claude-flow agent run coder "Build API" \
  --provider anthropic \
  --enable-memory \
  --memory-domain api
```

### Benefits of using claude-flow wrapper:
1. Shorter commands
2. Integrated with claude-flow swarms
3. Better error handling
4. Consistent logging
5. Access to claude-flow hooks
6. Unified configuration
7. Easier MCP integration

## 🔗 Related Documentation

- **ReasoningBank Paper**: https://arxiv.org/html/2509.25140v1
- **Agent Creation Guide**: `docs/REASONINGBANK-AGENT-CREATION-GUIDE.md`
- **Reasoning Agents**: `.claude/agents/reasoning/README.md`
- **Available Agents**: Run `claude-flow agent agents`

## 🆘 Support

- GitHub Issues: https://github.com/ruvnet/claude-flow/issues
- Agentic-Flow Issues: https://github.com/ruvnet/agentic-flow/issues
- Documentation: https://github.com/ruvnet/claude-flow

---

**Version**: 2.6.0+
**Last Updated**: 2025-10-12
**Status**: Production-ready
