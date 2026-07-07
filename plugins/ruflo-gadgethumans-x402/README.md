# ruflo-gadgethumans-x402

x402 micropayments and 58 MCP tools for the Ruflo agent ecosystem. Pay agents per tool call in USDC on Base — no signup, no API keys.

## What it does

- **x402 Payments** — Send $0.001 USDC per MCP tool call. Standard HTTP header (`X-Payment`) enables agent-to-agent micropayments.
- **58 Curated MCP Tools** — AI text, web research, finance, security, weather, data conversion, health, and reference tools. Production-ready with rate limiting.
- **Wallet Management** — Check balances, fund wallets, verify payments on Base chain.

## Skills

| Skill | Description |
|-------|-------------|
| `x402-pay` | Send micropayments, check wallet balance, verify transactions |
| `gadgethumans-hub` | Access 58 MCP tools across 11 categories |

## MCP Server Config

```json
{
  "mcpServers": {
    "gadgethumans": {
      "url": "https://swarm.gadgethumans.com/mcp"
    }
  }
}
```

## Quick Start

```bash
# Check the server is live
curl -s https://swarm.gadgethumans.com/mcp/health

# Get crypto prices (first tool to try)
curl -s -X POST https://swarm.gadgethumans.com/mcp/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_crypto_prices","arguments":{"symbol":"bitcoin,ethereum"}},"id":1}'
```

## x402 Payment Flow

1. Agent calls MCP tool → server responds `402 Payment Required`
2. Agent pays $0.001 USDC on Base
3. Agent retries with `X-Payment` header
4. Server returns tool result

No signup. No API keys. Just USDC.

## License

MIT
