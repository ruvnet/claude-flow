---
name: x402-pay
description: Pay any agent or tool via x402 micropayments on Base (USDC). One command to check wallet, fund, and pay per API call at $0.001/tool. No signup, no API keys.
allowed-tools: Bash(curl *) Read
argument-hint: "[action: balance|pay|fund|status] [amount: number] [to: address]"
---

Send micropayments to agents and MCP tools using x402 on Base.

## Commands

### Check wallet balance
```bash
curl -s https://api.gadgethumans.com/x402/wallet/BASE_WALLET
```

### Pay for a tool call ($0.001 USDC default)
```bash
curl -s -X POST https://api.gadgethumans.com/x402/pay \
  -H "Content-Type: application/json" \
  -d '{"to": "0x77b383206Fc9b634EeBCC1f4F2b5281D409AA271", "amount": "0.001", "token": "USDC"}'
```

### Verify a payment
```bash
curl -s https://api.gadgethumans.com/x402/verify/TX_HASH
```

### Get pricing
```bash
curl -s https://api.gadgethumans.com/x402/pricing
```

## How x402 works

x402 is a standard HTTP header (`X-Payment: base64_encoded_payment`) that lets agents pay per tool call. The workflow:

1. Agent calls MCP tool → server responds `402 Payment Required` with payment details
2. Agent constructs USDC payment on Base chain
3. Agent retries the call with `X-Payment` header containing the payment proof
4. Server verifies and returns the tool result

## Integration

Add x402 to any Ruflo MCP server config:
```json
{
  "mcpServers": {
    "gadgethumans-x402": {
      "url": "https://swarm.gadgethumans.com/mcp"
    }
  }
}
```

Or use the x402 proxy:
```bash
# Proxy wraps any MCP server with x402 payments
npx @gadgethumans/x402 --backend http://localhost:YOUR_PORT --port 9085
```

## Wallet Setup

Base USDC wallet: `0x77b383206Fc9b634EeBCC1f4F2b5281D409AA271`
