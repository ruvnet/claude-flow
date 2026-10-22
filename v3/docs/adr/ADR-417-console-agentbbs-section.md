# ADR 417: The AgentBBS section of the x.ruv.io view

Status: Accepted (ships in ruflo-console 0.19.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/xruv.ts` (the catalog and the argument parsers), `hooks/views/xruv.ts` (the section), `tests/agentbbs.spec.ts`, `tests/xruv.test.ts`.

Extends: ADR 407. Companion to ADR 412 (answers open where asked) and ADR 411 (Ask Claude).

## 1. Context

ruflo ships nine `federation_bbs_*` MCP tools (rooms, envelopes, pinned peers, a pull endpoint, sync). The console reached only `federation_bbs_identity`, as one row among the x.ruv.io identity rows. Someone who wanted to register a room, publish to it or pin a peer had to leave the console and write the tool call by hand.

The x.ruv.io view already owns `ruflo-bbs-federation` in the plugin map and already has the pattern these tools need: a catalog entry with fixed argv through `mcp exec -t`, a typed field, a confirm row for anything that writes, and a result panel at the top.

## 2. Decision

Add an **AgentBBS** section to the x.ruv.io view, between Channels and Admin, as seven catalog entries in a new `agentbbs` group.

| Row | Tool | Kind | Takes | Reach |
|---|---|---|---|---|
| PEERS | `federation_bbs_peers` | read | nothing | local |
| ROOM | `federation_bbs_register` | write | `#sales` | local |
| PUBLISH | `federation_bbs_publish` | write | `<roomId> Type: text` | local |
| WATCH | `federation_bbs_watch` | read | `<roomId> [limit]` | local |
| PIN PEER | `federation_bbs_peer_add` | write | `<nodeId> <url> <pubkey> [label]` | local |
| SYNC ROOM | `federation_bbs_sync` | write | `<roomId> [nodeId]` | network |
| SERVE | `federation_bbs_serve` | typed in the terminal | nothing | long-running |

- Reads run at once; writes ask first and the confirm row says whether the effect is local or on the network. Only SYNC reaches the network, and only to the URLs of peers already pinned.
- Every argument is validated before anything runs, with the same shapes the tools enforce: room ids and labels from a restricted character set, a 1 to 500 limit, a 16-hex node id, a 64-hex public key, and a peer URL that is plain `http(s)://host[:port]`. A URL carrying credentials is refused, so a secret can never be written into `peers.json` by the console.
- **SERVE is not run by the board.** The endpoint stays up for hours and `bindHost` decides who can reach it. The row types the command (loopback, port 7777) into the terminal for the person to run, and to add a tailnet `bindHost` themselves.
- **`federation_bbs_human_join` is deliberately not offered.** It mints a bearer token for a human operator. The console never shows a bearer secret (the same rule as invite codes), so the section says to use the terminal.

## 3. Alternatives considered

- **A new view.** Rejected: the x.ruv.io view already owns the plugin and its confirm and result machinery; a second view would split one federation story.
- **Running SERVE from the board.** Rejected: a one-shot run with a timeout is the wrong shape for a server, and the bind address is a network decision.
- **Letting peer_add take a key from a result or an envelope.** Rejected: the tool's own description says trusting a key carried in an envelope proves nothing. The person types all three values from the peer's own identity.

## 4. Consequences

- Rooms, envelopes and pinned peers are reachable from the console with no hand-written tool call.
- The catalog file grows to 453 lines, under the 500-line limit.
- A future `federation_bbs_peers` unpin (the `remove` parameter) can be added as one more entry; it is left out here because it is not a pure read or a pure add and deserves its own confirm wording.

## 5. Safety

- No secret is read or shown: the node's private key stays in `.agentbbs/node-identity.json`, which no tool here returns.
- Every write is confirm-gated; every row that can reach the network says so.
- Spend: none. All seven tools are $0.

## 6. Tests

- `tests/agentbbs.spec.ts`: each parser accepts its good shape and refuses the bad ones (including a credentialed URL), the reads are read-only, SYNC says "network", the local writes say "local", SERVE returns no spec and explains the loopback default.
- `tests/xruv.test.ts`: the section's buttons and fields are on the board.
