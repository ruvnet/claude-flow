# Docker Deployment Guide

## Quick Start (Local / Self-Hosted)

```bash
# 1. Configure
cp .env.example .env
# Edit .env with your API keys

# 2. Generate config (for Cloud Run builds)
cp config/config.example.json config/config.json
# Edit config/config.json with your brand/model settings
node scripts/generate-config.js

# 3. Start
docker compose up -d
```

Open http://localhost:3000

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Chat UI    │────▶│  MCP Bridge  │────▶│   MongoDB    │
│  :3000       │     │  :3001       │     │  :27017      │
│              │     │              │     │              │
│  SvelteKit   │     │  Express.js  │     │  mongo:7     │
│  HF Chat UI  │     │  Proxy + MCP │     │  Persistence │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │
       │                    ├──▶ OpenAI API
       │                    ├──▶ Google Gemini API
       │                    └──▶ OpenRouter API
       │
       └── OPENAI_BASE_URL=http://mcp-bridge:3001
```

All model requests from Chat UI go through the MCP Bridge, which:
1. Resolves the correct upstream provider from the model name
2. Injects the server-side API key (never exposed to the client)
3. Proxies the OpenAI-compatible request to the upstream provider

## Services

### MongoDB (`mongodb`)
- Image: `mongo:7`
- Port: 27017
- Volume: `mongo-data` (persistent)
- Stores: conversations, user sessions, settings

### MCP Bridge (`mcp-bridge`)
- Build: `./mcp-bridge/Dockerfile`
- Port: 3001
- Healthcheck: `/health`
- Provides:
  - `/chat/completions` — OpenAI-compatible proxy (routes to Gemini/OpenAI/OpenRouter)
  - `/mcp` — MCP JSON-RPC endpoint for tool calls
  - `/health` — Health check

### Chat UI (`chat-ui`)
- Build: `./chat-ui/Dockerfile` (extends `ghcr.io/huggingface/chat-ui-db:latest`)
- Port: 3000
- Depends on: mongodb, mcp-bridge
- Config baked in via `dotenv-local.txt` → `.env.local`

## Environment Variables

### Required (at least one AI provider key)

| Variable | Description |
|----------|-------------|
| `GOOGLE_API_KEY` | Google Gemini API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ORCAROUTER_API_KEY` | [OrcaRouter](https://www.orcarouter.ai) gateway API key (for `orcarouter/*` models) |

### Optional — Branding

| Variable | Default | Description |
|----------|---------|-------------|
| `BRAND_NAME` | AI Assistant | App title |
| `BRAND_DESCRIPTION` | AI-powered assistant | App subtitle |
| `PUBLIC_ORIGIN` | http://localhost:3000 | Public URL |
| `MONGODB_DB_NAME` | chat-db | MongoDB database name |

### Optional — Authentication (OIDC)

| Variable | Description |
|----------|-------------|
| `OPENID_PROVIDER_URL` | e.g., `https://accounts.google.com` |
| `OPENID_CLIENT_ID` | OAuth client ID |
| `OPENID_CLIENT_SECRET` | OAuth client secret |
| `OPENID_SCOPES` | Default: `openid profile email` |
| `OPENID_NAME_CLAIM` | Default: `name` |
| `COOKIE_SECURE` | `true` for HTTPS |
| `COOKIE_SAMESITE` | Default: `lax` |

### Optional — Backend Services

| Variable | Description |
|----------|-------------|
| `SEARCH_API_URL` | Your search/knowledge base endpoint |
| `RESEARCH_API_URL` | Your research/grounding endpoint |

## Common Operations

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f
docker compose logs -f mcp-bridge   # specific service

# Restart after .env changes
docker compose up -d --force-recreate

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

## Adding Models

Edit `config/config.example.json` → `models` array:

```json
{
  "name": "gemini-2.5-pro",
  "displayName": "Gemini 2.5 Pro",
  "description": "Google's most capable model",
  "provider": "gemini",
  "supportsTools": true
}
```

Provider is resolved from the model name prefix:
- `gemini-*` → Google Generative Language API
- `gpt-*` → OpenAI API
- Everything else → OpenRouter API

Then regenerate and rebuild:
```bash
node scripts/generate-config.js
docker compose build chat-ui
docker compose up -d
```

## Adding MCP Tools

Edit `mcp-bridge/index.js`:

1. Add your tool to the `tools` array
2. Add a handler in the `tools/call` switch
3. Rebuild: `docker compose build mcp-bridge && docker compose up -d`

## Production (HTTPS + Domain)

For production, put a reverse proxy (nginx, Caddy, Traefik) in front:

```yaml
# Add to docker-compose.yml
services:
  caddy:
    image: caddy:2
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy-data:/data
    depends_on:
      - chat-ui

volumes:
  caddy-data:
```

```
# Caddyfile
yourdomain.com {
    reverse_proxy chat-ui:3000
}
```

Set `PUBLIC_ORIGIN=https://yourdomain.com` and `COOKIE_SECURE=true` in `.env`.
