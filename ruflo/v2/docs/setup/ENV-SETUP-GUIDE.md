# .env Configuration Guide for Claude-Flow

## Overview

The `.env` file is **required** for ReasoningBank memory capabilities in claude-flow. Without it, the system falls back to heuristic mode (simple regex pattern matching) with no actual learning.

## Quick Start

### 1. Generate .env Template

```bash
claude-flow init --env
```

This creates a comprehensive `.env` template with:
- API key placeholders and setup instructions
- Cost optimization guidance (46% savings)
- Configuration examples for all supported providers
- Security best practices

### 2. Add Your API Keys

Open `.env` and add at minimum one of these:

```bash
# Required: Choose at least one
ANTHROPIC_API_KEY=sk-ant-xxxxx  # Get from https://console.anthropic.com/settings/keys
OPENROUTER_API_KEY=sk-or-v1-xxxxx  # Get from https://openrouter.ai/keys
GOOGLE_GEMINI_API_KEY=...
```

### 3. Get API Keys

- **Anthropic**: https://console.anthropic.com/settings/keys
- **OpenRouter**: https://openrouter.ai/keys (recommended for cost savings)
- **Gemini**: https://aistudio.google.com/app/apikey (free tier)

## What Happens Without .env?

### ❌ Without .env File

When you run:
```bash
claude-flow agent run coder "Build API" --enable-memory
```

**Result:**
```
⚠️  ReasoningBank memory requires .env configuration

📋 Setting up .env for ReasoningBank capabilities:
1. Create .env file:
   claude-flow init --env

2. Add your API keys to .env:
   ANTHROPIC_API_KEY=sk-ant-...
   OPENROUTER_API_KEY=sk-or-v1-...

3. Get API keys:
   • Anthropic: https://console.anthropic.com/settings/keys
   • OpenRouter: https://openrouter.ai/keys

💡 Without API keys:
   • ReasoningBank falls back to regex pattern matching (no learning)
   • Memory operations will appear to work but won't actually learn

❌ Cannot use --enable-memory without .env file
```

### ⚠️ With Empty .env (No API Keys)

If `.env` exists but has no API keys:

```
⚠️  No API keys found in .env file

⚠️  ReasoningBank will fall back to heuristic mode (regex matching)
   Without API keys, memory will NOT learn from experience!

❌ Add API keys to .env to enable actual learning
```

### ✅ With Valid .env and API Keys

```
✅ API keys configured:
   • Anthropic (Claude)
   • OpenRouter (cost optimization available)

🚀 Executing coder agent with agentic-flow...
Task: Build API
[... actual agent execution with learning ...]
```

## Configuration Precedence

1. **Environment variables** (from `.env` or manually exported)
2. **ReasoningBank YAML** (`.swarm/reasoningbank.yaml`)
3. **Default models** (claude-3-5-sonnet-20241022)

## Advanced: Cost Optimization

With OpenRouter + DeepSeek R1, you can reduce costs by 46%:

### Traditional Setup (All Claude):
- Main task: $0.20
- Judge: $0.05
- Distill: $0.10
- Embeddings: $0.02
- **TOTAL: $0.37 per task**

### Optimized Setup (Hybrid):
- Main task: $0.20 (Claude - keep quality)
- Judge: $0.001 (DeepSeek - 99% cheaper!)
- Distill: $0.002 (DeepSeek - 99% cheaper!)
- Embeddings: $0.0005 (DeepSeek)
- **TOTAL: $0.20 per task** (46% savings!)

### Setup Script

```bash
# 1. Add to .env
OPENROUTER_API_KEY=sk-or-v1-...

# 2. Create .swarm/reasoningbank.yaml
mkdir -p .swarm
cat > .swarm/reasoningbank.yaml << 'EOF'
reasoningbank:
  judge:
    model: "deepseek/deepseek-r1"
    max_tokens: 512
    temperature: 0
  distill:
    model: "deepseek/deepseek-r1"
    max_tokens: 2048
    temperature: 0.3
  embeddings:
    provider: "openrouter"
    model: "deepseek/deepseek-r1"
    dimensions: 1024
EOF

# 3. Use memory with cost optimization
claude-flow agent run coder "Build API" \
  --enable-memory \
  --memory-domain api/authentication \
  --memory-k 5
```

See [REASONINGBANK-COST-OPTIMIZATION.md](./REASONINGBANK-COST-OPTIMIZATION.md) for detailed cost analysis.

## Using Memory Without .env (Alternative Methods)

If you don't want to use `.env`, you can:

### Option 1: Export Variables Directly
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENROUTER_API_KEY="sk-or-v1-..."
claude-flow agent run coder "task" --enable-memory
```

### Option 2: Inline Environment Variables
```bash
ANTHROPIC_API_KEY="sk-ant-..." \
  claude-flow agent run coder "task" --enable-memory
```

### Option 3: System-Wide Configuration
```bash
# Add to ~/.bashrc or ~/.zshrc
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENROUTER_API_KEY="sk-or-v1-..."
```

## Security Best Practices

1. **NEVER commit .env to git** (it's in `.gitignore`)
2. Use different keys for dev/staging/production
3. Rotate keys regularly
4. Use key-specific permissions when possible
5. Monitor API usage for anomalies

## Commands Reference

### Generate .env Template
```bash
claude-flow init --env                # Create new .env
claude-flow init --env --force        # Overwrite existing .env
```

### Using Memory with .env
```bash
# Basic memory
claude-flow agent run coder "task" --enable-memory

# Advanced memory
claude-flow agent run coder "task" \
  --enable-memory \
  --memory-domain api/authentication \
  --memory-k 5 \
  --memory-min-confidence 0.7
```

### Check Help
```bash
claude-flow init --help               # See all init options
claude-flow agent --help              # See all agent options
```

## Evidence: Fake vs Real ReasoningBank

### Without API Keys (Heuristic Mode):
```
Duration: 2ms
Memories: 0 (fake)
Success rate: 67% (regex-based)
Learning: None
```

### With API Keys (Real LLM Mode):
```
Duration: 19,036ms
Memories: 20 (real)
Success rate: 88% (learned)
Learning: Actual pattern consolidation
Database: 20 entries with embeddings
```

## Troubleshooting

### Problem: "Cannot use --enable-memory without .env file"
**Solution:** Run `claude-flow init --env` and add API keys

### Problem: "No API keys found in .env file"
**Solution:** Add at least one valid API key to `.env`

### Problem: Memory appears to work but doesn't learn
**Cause:** No API keys configured, using heuristic fallback
**Solution:** Add API keys to `.env` file

### Problem: High costs with memory
**Solution:** See [REASONINGBANK-COST-OPTIMIZATION.md](./REASONINGBANK-COST-OPTIMIZATION.md)

## Related Documentation

- [REASONINGBANK-AGENT-CREATION-GUIDE.md](./REASONINGBANK-AGENT-CREATION-GUIDE.md) - Creating custom reasoning agents
- [AGENTIC-FLOW-INTEGRATION-GUIDE.md](./AGENTIC-FLOW-INTEGRATION-GUIDE.md) - Complete command reference
- [REASONINGBANK-COST-OPTIMIZATION.md](./REASONINGBANK-COST-OPTIMIZATION.md) - Cost savings strategies

## Template Contents

The generated `.env` template includes:

✅ API key placeholders for all providers
✅ Setup instructions with direct links
✅ Cost optimization examples
✅ Model configuration defaults
✅ Optional service keys (Perplexity, HuggingFace, E2B, Supabase)
✅ Comprehensive comments explaining behavior
✅ Security best practices

Total template size: ~150 lines with extensive documentation

## Support

For issues or questions:
- GitHub Issues: https://github.com/ruvnet/claude-flow/issues
- Documentation: https://github.com/ruvnet/claude-flow
- Agentic-Flow: https://github.com/ruvnet/agentic-flow
