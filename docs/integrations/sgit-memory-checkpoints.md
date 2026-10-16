# External SGit memory checkpoint MCP example

This opt-in community example checkpoints a host-allowlisted SQLite memory database into an encrypted SGit vault and restores it into an isolated workspace. It runs as a separate local MCP server. It does not register a native Ruflo memory backend or change Ruflo's default policy.

Source and reproducible demonstration: [mondweep/sgit-ruv-memory](https://github.com/mondweep/sgit-ruv-memory/tree/0e8eed5d6bb4b0ae60f50bac52853d5b4d0028c1).

## Why an external checkpoint adapter?

Operational memory and recovery artifacts have different jobs. SQLite's online backup API can capture one consistent database while committed WAL writes continue; SGit then encrypts and commits that snapshot. Restore verifies the stored digest, decrypted manifest and SQLite integrity before renaming a staging directory into a new workspace.

The adapter uses SGit 0.22.3 and a pinned copy of Ruflo's MIT-licensed policy evaluator from commit `1882006a02487590c8c66a7eec8d7504f6af33c3`, in enforce mode. It is not wired into Ruflo's running policy state. The standalone repository documents provenance and includes the license. Migrating to a supported evaluator dependency is a follow-up integration question.

## Install and reproduce

Requires Linux or macOS, Python 3.11+ and Node 24+ (for TypeScript stripping). The recorded run used Linux and Python 3.12.

```bash
git clone https://github.com/mondweep/sgit-ruv-memory.git
cd sgit-ruv-memory
git checkout 0e8eed5d6bb4b0ae60f50bac52853d5b4d0028c1
python -m venv .venv
. .venv/bin/activate
pip install .
python -m unittest discover -s tests -v
python demo.py
```

The demo talks to the actual server through MCP stdio. It stores two synthetic role-labelled facts, blocks a forbidden namespace, checkpoints, removes the original database, starts a fresh server process, restores both facts and rejects tampered ciphertext. It does not exercise Ruflo CLI retrieval, embeddings or semantic search. Recorded outputs are linked from the standalone repository's `evidence/` directory.

## Configure an actual database

First identify the SQLite database used by your installed Ruflo version and verify its store/retrieve behaviour. Different versions and commands may use different stores; do not assume `.swarm/memory.db` is universally correct. Do not point this example at RVF files. A checkpoint covers one SQLite database, not a whole project or a consistent set of multiple databases.

Create `/absolute/private/config.json` with mode `0600`:

```json
{
  "store": "/absolute/private/checkpoints",
  "keys": "/absolute/private/key-records",
  "restore_root": "/absolute/private/restored",
  "principal": "local-agent",
  "valid_until": "2027-01-01T00:00:00+00:00",
  "sources": {"project": "/absolute/project/verified-memory.sqlite"},
  "rules": [{
    "id": "project-checkpoint",
    "effect": "allow",
    "actions": ["memory.checkpoint", "memory.inspect", "memory.restore"],
    "principals": ["local-agent"],
    "resources": ["project"]
  }]
}
```

Set the expiry to an appropriate future date. The adapter creates private directories with mode `0700`; pre-existing directories must already use that mode. Keep keys outside the ciphertext store. Each source namespace exposes its entire database, not an authorised subset of its rows.

Add the separate server to a compatible MCP host using its Python environment's absolute executable path:

```json
{
  "mcpServers": {
    "sgit-ruv-memory": {
      "command": "/absolute/sgit-ruv-memory/.venv/bin/sgit-ruv-memory",
      "env": {"SGIT_RUV_CONFIG": "/absolute/private/config.json"}
    }
  }
}
```

This is a generic MCP host configuration, not a new Ruflo CLI command.

## Tools and trust boundary

| Tool | Result |
|---|---|
| `checkpoint(namespace)` | Consistent SQLite backup, SGit encrypted commit and separate private key record |
| `inspect(checkpoint_id)` | Manifest metadata and ciphertext digest comparison |
| `restore(checkpoint_id, workspace)` | Verified plaintext database in a new isolated workspace; no overwrite |
| `close_run(checkpoint_id)` | Local checkpoint/key-record deletion, only with explicit `memory.delete` permission |

Unknown actions default deny. Expired mandates and approval-required decisions are blocked. The host fixes the principal; callers cannot supply an identity or arbitrary source path. This policy boundary covers adapter tools only and does not constrain another shell or MCP server.

One independent vault is used per checkpoint; binary databases are not merged. Keys and trusted digests are local private records. The manifest is digest-bound, not independently signed. A process controlling both keys and ciphertext can forge those records. Plaintext exists during staging and intentionally remains in restored workspaces. Fragment probes are not a cryptographic audit.

Remote sync, Federation announcements, RVF exports, automatic promotion into a running Ruflo project, multi-tenant isolation and end-to-end Ruflo semantic recall remain unimplemented. Local deletion does not erase source databases, restored workspaces, retained keys elsewhere, caches or backups.
