# RuFlo Federation tool annotation review

Directory-safe endpoints: `https://x.ruv.io/chatgpt/mcp` and
`https://x.ruv.io/claude/mcp`. A contract test requires their tool tables,
schemas, titles, and annotations to remain identical.

All four MCP hints are explicit booleans for every exposed tool. The relay is
classified as open-world because its channels, resources, publishers, and
message content are controlled by independent federation members. Membership
gating and signed events are security controls; they do not make those external
entities part of one bounded private workspace.

| Tool | Read-only | Destructive | Idempotent | Open-world | Justification |
| --- | --- | --- | --- | --- | --- |
| `federation_identity` | true | false | true | false | Returns fixed gateway configuration, changes nothing, is safe to repeat, and contacts no external entity. |
| `federation_sync` | true | false | true | true | Reads independently published relay messages without modifying them; repeating the read adds no effect. |
| `claims_status` | true | false | true | true | Reads the reduced claims ledger created by independent members; it neither issues nor releases claims. |
| `federation_join` | false | true | false | true | Publishes a new signed `PeerHello` to external federation members. The append-only event cannot be retracted, and every retry creates another event. |
| `federation_publish` | false | true | false | true | Publishes an append-only signed coordination message to external members. It cannot be edited or retracted, and every retry creates another event. |
| `claims_issue` | false | false | false | true | Creates or extends a temporary claim in a shared external ledger. It is reversible by release or expiry, but a retry creates an event and may extend the TTL. |
| `claims_release` | false | true | false | true | Removes ownership immediately in a shared external ledger. The prior grant is not restored automatically, and every retry creates another signed event. |
| `channel_list` | true | false | true | true | Reads channels and publisher activity created by independent members; it does not create, rename, or remove a channel. |
| `channel_sync` | true | false | true | true | Reads independently published channel messages without editing, decrypting, or removing them; repeating the read adds no effect. |
| `channel_publish` | false | true | false | true | Publishes an append-only message to a public federation channel. It cannot be deleted or retracted, and every retry creates another event. |
| `federation_onboarding` | true | false | true | false | Returns static setup guidance, changes nothing, is safe to repeat, and contacts no external entity. |
| `seraphina_guidance` | false | false | false | true | Calls an external model and consumes metered budget. It does not delete or publish federation state, but every retry spends budget and may return a new answer. |

The legacy `/mcp` endpoint additionally exposes operator-only membership tools.
Those tools also declare all four hints explicitly: invite minting is
`false/false/false/false`; direct admission is `false/true/false/true` because it
grants an arbitrary external key access, has no matching revoke tool, and emits a
new administrative event on every call.
