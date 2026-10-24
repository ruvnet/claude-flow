# LiteLLM Multi-Tenant Gateway for Claude Code

A production-ready, multi-tenant LiteLLM proxy that enables Claude Code to seamlessly route requests across multiple LLM providers (OpenAI, Azure, OpenRouter, Bedrock, Ollama, etc.) with enterprise features.

## 🚀 Quick Start

### 1. Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 8GB RAM minimum
- Valid API keys for desired LLM providers

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow/examples/litellm

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
nano .env

# Deploy the stack
./scripts/deploy.sh start
```

### 3. Configure Claude Code

```bash
# Set environment variables
export ANTHROPIC_BASE_URL=http://localhost:4000
export ANTHROPIC_AUTH_TOKEN=<your-litellm-master-key>

# Use Claude Code with different models
claude --model codex-mini "Write a Python function"
claude --model o3-pro "Explain quantum computing"
claude --model deepseek-coder "Refactor this code"
```

## 📊 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Claude Code │────▶│ Load Balancer│────▶│  LiteLLM    │
└─────────────┘     └──────────────┘     │  Proxies    │
                                         └─────┬───────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
              ┌─────▼─────┐          ┌────────▼────────┐        ┌────────▼────────┐
              │  OpenAI   │          │   OpenRouter   │        │     Azure      │
              └───────────┘          └────────────────┘        └────────────────┘
```

## 🎯 Features

### Multi-Provider Support
- **OpenAI**: GPT-4, GPT-4o, o3 models
- **OpenRouter**: Qwen3-Coder, DeepSeek, 100+ models
- **Azure OpenAI**: Enterprise Azure deployments
- **Amazon Bedrock**: Claude models via AWS
- **Ollama**: Local models (CodeLlama, Mixtral)
- **Anthropic**: Direct Claude access

### Enterprise Features
- 🔐 **Multi-Tenancy**: Isolated configurations per team
- 💰 **Cost Tracking**: Real-time usage and budget alerts
- 📊 **Monitoring**: Prometheus + Grafana dashboards
- 🔄 **High Availability**: Load-balanced proxy instances
- 🛡️ **Security**: API key management, rate limiting
- 📝 **Audit Logging**: Complete request/response tracking

## 🔧 Configuration

### Model Aliases

Edit `config/config.yaml` to customize model routing:

```yaml
model_list:
  - model_name: "fast-code"
    litellm_params:
      model: "openrouter/qwen/qwen-3-coder"
      max_tokens: 8192
      temperature: 0.2
      
  - model_name: "reasoning"
    litellm_params:
      model: "openai/o3-pro"
      max_tokens: 4096
      temperature: 0.7
```

### Tenant Management

Create and manage tenants:

```bash
# Create a new tenant
./scripts/manage-tenants.sh create engineering

# List all tenants
./scripts/manage-tenants.sh list

# Update tenant budget
./scripts/manage-tenants.sh update engineering budget 200

# View usage statistics
./scripts/manage-tenants.sh usage engineering
```

### Fallback Chains

Configure automatic fallbacks in `config/config.yaml`:

```yaml
fallback_models:
  code_chain:
    - codex-mini       # Primary (fast, cheap)
    - deepseek-coder   # Secondary
    - local-codellama  # Tertiary (free, local)
```

## 📈 Monitoring

### Access Dashboards

- **Grafana**: http://localhost:3000
- **Prometheus**: http://localhost:9090
- **PgAdmin**: http://localhost:5050

### Key Metrics

- Request latency (p50, p95, p99)
- Token usage per model/tenant
- Cost tracking and projections
- Error rates and fallback triggers
- Model availability status

## 🛠️ Operations

### Service Management

```bash
# Start services
./scripts/deploy.sh start

# Stop services
./scripts/deploy.sh stop

# View logs
./scripts/deploy.sh logs

# Check status
./scripts/deploy.sh status

# Clean everything
./scripts/deploy.sh clean
```

### Scaling

Adjust replica count in `docker-compose.yml`:

```yaml
services:
  litellm:
    deploy:
      replicas: 5  # Increase for higher load
```

### Backup & Restore

```bash
# Backup database
docker-compose exec postgres pg_dump -U litellm > backup.sql

# Restore database
docker-compose exec -T postgres psql -U litellm < backup.sql
```

## 🔐 Security

### API Key Rotation

```bash
# Generate new master key
export NEW_KEY=$(openssl rand -hex 32)
echo "LITELLM_MASTER_KEY=sk-litellm-$NEW_KEY" >> .env

# Restart services
docker-compose restart
```

### Network Security

- All services run in isolated Docker network
- PostgreSQL and Redis not exposed externally
- SSL/TLS support for production deployments
- Rate limiting per tenant

## 📚 Examples

### Basic Usage

```bash
# Fast code generation
claude --model codex-mini "Write a REST API endpoint"

# Complex reasoning
claude --model o3-pro "Design a distributed system"

# Local processing (no cloud)
claude --model local-codellama "Refactor this function"
```

### Cost-Optimized Routing

```bash
# Use cheapest model for simple tasks
export ANTHROPIC_MODEL=claude-3-haiku
claude "Format this JSON"

# Use powerful model for complex tasks
export ANTHROPIC_MODEL=o3-pro
claude "Solve this algorithm problem"
```

### Multi-Tenant Usage

```bash
# Engineering team
export ANTHROPIC_AUTH_TOKEN=$TENANT_ENGINEERING_KEY
claude --model codex-mini "Build feature"

# Research team
export ANTHROPIC_AUTH_TOKEN=$TENANT_RESEARCH_KEY
claude --model o3-pro "Analyze dataset"
```

## 🐛 Troubleshooting

### Common Issues

1. **Connection Refused**
   ```bash
   # Check if services are running
   docker-compose ps
   
   # Check LiteLLM logs
   docker-compose logs litellm-1
   ```

2. **Authentication Failed**
   ```bash
   # Verify master key in .env
   grep LITELLM_MASTER_KEY .env
   
   # Test connection
   curl http://localhost:4000/health
   ```

3. **Model Not Found**
   ```bash
   # Check available models
   curl -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
        http://localhost:4000/models
   ```

### Debug Mode

Enable debug logging:

```yaml
# In docker-compose.yml
environment:
  - LITELLM_LOG_LEVEL=DEBUG
  - DEBUG=true
```

## 📖 Advanced Topics

### Custom Model Providers

Add custom providers in `config/config.yaml`:

```yaml
model_list:
  - model_name: "custom-model"
    litellm_params:
      model: "custom_provider/model_name"
      api_base: "https://api.custom.com/v1"
      api_key: ${CUSTOM_API_KEY}
      custom_llm_provider: "custom"
```

### Performance Tuning

```yaml
# Optimize for high throughput
router_settings:
  max_parallel_requests: 100
  request_timeout: 30
  enable_caching: true
  cache_ttl: 3600
```

### Cost Optimization

```yaml
# Implement cost controls
cost_tracking:
  alert_thresholds:
    - threshold: 80
      action: notify
    - threshold: 100
      action: block
```

## 🤝 Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 🔗 Resources

- [LiteLLM Documentation](https://docs.litellm.ai)
- [Claude Code Guide](https://docs.anthropic.com/en/docs/claude-code)
- [OpenRouter Models](https://openrouter.ai/models)
- [Docker Compose Reference](https://docs.docker.com/compose/)

## 💬 Support

- GitHub Issues: [Report bugs](https://github.com/ruvnet/claude-flow/issues)
- Discussions: [Ask questions](https://github.com/ruvnet/claude-flow/discussions)
- Wiki: [Documentation](https://github.com/ruvnet/claude-flow/wiki)

---

Built with ❤️ by the Claude Flow team