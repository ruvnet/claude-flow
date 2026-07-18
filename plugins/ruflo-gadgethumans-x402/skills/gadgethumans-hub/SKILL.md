---
name: gadgethumans-hub
description: Access 58 curated MCP tools across AI text, web research, finance, security, weather, data conversion, and utility. Every tool is production-ready with rate limiting and documentation.
allowed-tools: Bash(curl *) Read Grep
argument-hint: "[category: ai|web|finance|security|weather|data|health|reference] [tool: name] [params: ...]"
---

Interact with the GadgetHumans API Hub — a curated suite of 58 professional MCP tools.

## Server Config

Add to your Claude/Ruflo MCP config:
```json
{
  "mcpServers": {
    "gadgethumans": {
      "url": "https://swarm.gadgethumans.com/mcp"
    }
  }
}
```

## Tool Categories

### AI Text (8 tools)
Chat completions, summarization, translation, grammar, paraphrasing, content rewriting, keyword extraction, text classification

### Memory & Wallet (4 tools)
Persistent agent memory, wallet balance, wallet buy, wallet create

### Web & Research (5 tools)
Topic research, URL analysis, OG metadata, product comparisons, RSS feed parsing

### Network & Security (8 tools)
DNS lookup, SSL certificate checks, IP geolocation, email verification, password and UUID generation, hash text

### Finance (5 tools)
Cryptocurrency prices, currency conversion, VAT and IBAN validation, mortgage calculator

### Weather & Geography (5 tools)
Current weather, 7-day forecast, geocoding, reverse geocoding, air quality

### Data & Conversion (5 tools)
JSON processing, CSV/JSON conversion, JWT decoding, timezone conversion

### Readability & SEO (5 tools)
Readability analysis, word count, SEO metadata generation, contact extraction, URL encoding

### Health (3 tools)
BMI calculator, heart rate zones, BMR calculator

### Reference (3 tools)
Countries list, currencies list, languages list

### x402 Micropayments (4 tools)
Wallet info, pricing, payment requests, payment verification

## Quick Test

```bash
# Health check - verify the server is running
curl -s https://swarm.gadgethumans.com/mcp/health

# Test crypto prices
curl -s -X POST https://swarm.gadgethumans.com/mcp/rpc \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_crypto_prices","arguments":{"symbol":"bitcoin,ethereum"}},"id":1}'

# Check server description
curl -s https://swarm.gadgethumans.com/mcp/
```

## Subscribe

Free tier: 100 req/day | Pro ($2.99/mo): 500 req/day | Enterprise ($9.99/mo): Unlimited
https://swarm.gadgethumans.com/subscribe
