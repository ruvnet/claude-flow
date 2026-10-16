# External SGit memory checkpoints governed by an ABP

This opt-in community example connects an Agent Behaviour Policy to a local memory adapter:

**ABP mandate → strict compiler → Ruflo evaluator (enforce mode) → adapter operation → SGit encrypted vault.**

It runs as a separate stdio MCP server. It does not register a native Ruflo memory backend or alter Ruflo's default/running policy configuration.

[Source and reproducible example](https://github.com/mondweep/sgit-ruv-memory/tree/e86cefa88da5f46e43af9bdc822b27909ac46a0b) · [SGit executable-example PR](https://github.com/SGit-AI/SGit-AI__Website__Ruv/pull/1).

## Install and reproduce

Requires Linux/macOS, Python 3.11+, Git and Node 24+ for TypeScript stripping. The recorded run used Linux and Python 3.12.

```bash
git clone https://github.com/mondweep/sgit-ruv-memory.git
cd sgit-ruv-memory
git checkout e86cefa88da5f46e43af9bdc822b27909ac46a0b
python -m venv .venv
. .venv/bin/activate
pip install .
python -m unittest discover -s tests -v
python demo.py
```

SGit is pinned to source commit `559752641bc520986fb0851b4a43875b6ad0d4ad`, whose declared version is 0.22.3, because that version was unavailable from the package index. The adapter uses the MIT-licensed Ruflo evaluator from `1882006a02487590c8c66a7eec8d7504f6af33c3`, with attribution. It is currently vendored, not dynamically connected to Ruflo's running policy state.

## Define policy before connecting memory

Copy the source repository's `examples/config.json` and `examples/memory.abp.json` into a private directory. Edit absolute database/storage paths, review the role mandate, set its owner and future expiry, and set both files to mode `0600`.

Configuration supplies only the fixed principal, source allowlist, private directories and `abp_path`. The ABP supplies role permissions and expiry. Raw rule/expiry overrides are rejected. The principal must match an ABP role. A new policy requires restarting the server; expiry is checked on every call.

The compiler follows SGit's `abp_version: 0.1-poc` structure with explicit profile `sgit-ruv-memory/v1`. Three capabilities below are proposed vocabulary extensions, not claims of existing upstream support:

| ABP capability | MCP operation | Origin |
|---|---|---|
| `write.memory.project` | `checkpoint(namespace)` | Adapter extension |
| `read.memory.project` | `restore(checkpoint_id, workspace)` | Adapter extension; includes isolated recovery |
| `read.record.history` | `inspect(checkpoint_id)` | Existing primitive |
| `delete.memory.project` | `close_run(checkpoint_id)` | Adapter extension |

Rows contain capability, boolean reach, yes/no/approval mandate, reason and explicit namespace instances. Deny/approval rows require a barrier. All effects retain their namespace scope. Unsupported capabilities, ambiguous/wildcard/unknown instances, duplicate roles/capabilities, invalid profiles or unknown fields reject the whole document; no row is silently skipped. The sample deletion mandate requires approval, so the MVP blocks deletion while leaving the checkpoint intact. No human approval fulfilment UI is implemented.

The example ABP was checked against SGit's upstream structural JSON Schema in addition to strict profile validation. Its schema match does not imply the unextended upstream compiler recognises the new memory vocabulary. A date expires at the start of that UTC date; timezone-aware timestamps are also accepted by this profile.

## Connect the MCP host

```json
{"mcpServers":{"sgit-ruv-memory":{
  "command":"/absolute/sgit-ruv-memory/.venv/bin/sgit-ruv-memory",
  "env":{"SGIT_RUV_CONFIG":"/absolute/private/config.json"}
}}}
```

This is a generic MCP host configuration, not a new Ruflo CLI command. Existing adapter directories require mode `0700`; keep key records separate from ciphertext. Identify the actual SQLite database used by the installed Ruflo commands first: layouts vary. A namespace authorises the whole database, not selected rows.

Checkpoint uses SQLite online backup and integrity checking, then SGit init/commit. Only the encrypted bare store is retained outside private staging. The encrypted manifest binds database, source-ABP and compiled-rule digests, profile, owner and principal. Restore checks those historical records and current policy before creating a new workspace; it never overwrites an existing workspace.

These hashes are not independent signatures or immutable audit receipts. The local host/configuration/key records are trusted. Restored workspaces intentionally contain plaintext. One independent vault per checkpoint avoids binary database merges; this does not provide cross-checkpoint shared branch history.

## Evidence and remaining integration work

16 tests pass, covering compilation, scoped decisions, malformed-policy rejection, raw-rule bypass rejection, role mismatch, ABP/rule hash binding, approval/deny enforcement, expiry, wrong keys, tampering, live WAL writes and concurrent checkpoints. The real MCP demonstration compiles an ABP, blocks a forbidden namespace and approval-required deletion, removes the original database, restores both synthetic facts in a new server process and rejects tampering. Evidence and source hashes are in the linked repository.

This is not yet validated through Ruflo CLI semantic recall or embeddings. SQLite backup covers one DB, not a coordinated multi-database/project snapshot. Native plugin registration, RVF, remote sync, Federation announcements, signed manifests and a general ABP compiler remain follow-ups. Adapter policy does not restrict other shell or MCP tools; there is no global erase, multi-tenant isolation, key-rotation/HSM or crash-orphan reconciliation guarantee. Local deletion leaves source databases, restored copies, OS caches and external backups untouched.

The next integration gate is actual Ruflo store/checkpoint/restore/recall on a pinned version, followed by a supported live policy interface to replace vendoring. This PR changes documentation only; it adds no Ruflo runtime dependencies or defaults.
