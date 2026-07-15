/**
 * Plugin Permission Manifest (ADR-320 Part B, Phase P3)
 *
 * Schema + load-time validation for the declarative capability manifest a
 * plugin's `package.json['claude-flow'].permissions` block may declare.
 *
 * Scope note: this file only defines the schema and validates/normalizes
 * untrusted `package.json` content into a well-typed manifest. It does NOT
 * enforce the manifest against actual plugin behavior — that is P4 (runtime
 * enforcement in `manager.ts`'s load-time gate + per-capability invocation
 * wrapper), a separate phase of ADR-320 Part B.
 *
 * This is a system boundary: `raw` originates from an installed (and
 * potentially malicious or simply malformed) npm package's `package.json`,
 * so every field is validated defensively rather than trusted.
 */

/** A plugin's declared capability manifest. */
export interface PluginPermissionManifest {
  /** Glob patterns for filesystem paths the plugin may read/write. */
  filesystem: {
    read: string[];
    write: string[];
  };
  /** Hosts the plugin may make outbound network calls to. */
  network: {
    allowedHosts: string[];
  };
  /** Hook names the plugin may register. */
  hooks: string[];
  /** Memory namespaces the plugin may read/write. */
  memoryNamespaces: string[];
  /** Whether the plugin may shell out / spawn subprocesses at all. */
  subprocess: boolean;
}

/**
 * Most-restrictive manifest: no filesystem, network, hooks, memory, or
 * subprocess access. Used when a plugin declares a `permissions` block but
 * individual fields are missing or malformed (fail-safe default).
 */
function emptyManifest(): PluginPermissionManifest {
  return {
    filesystem: { read: [], write: [] },
    network: { allowedHosts: [] },
    hooks: [],
    memoryNamespaces: [],
    subprocess: false,
  };
}

/**
 * SECURITY-RELEVANT DEFAULT — "legacy maximal grant" (ADR-320 §Backwards
 * compatibility, §Part B): a plugin published before this manifest format
 * existed has NO `permissions` block at all in its `claude-flow` metadata.
 * Per the ADR's explicit backwards-compat rule, absence of the entire block
 * (distinct from an empty/malformed block — see `validatePermissionManifest`
 * below, which treats those as the most-restrictive `emptyManifest()`) is
 * treated as "this plugin predates permission enforcement" and is granted
 * full legacy authority so it keeps working unmodified: filesystem
 * read/write anywhere (`**`), unrestricted network (`*`), all hooks/memory
 * namespaces implicitly allowed (`*` sentinel — a future P4 enforcement
 * layer must special-case this wildcard rather than treat it as a literal
 * name), and subprocess access.
 *
 * This is intentionally NOT a safe default — it exists solely to avoid
 * breaking every plugin published before ADR-320 shipped. It must be
 * retired once `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` flips to strict-by
 * -default in v4.0.
 *
 * P5: strict-mode-default flip in v4.0, see ADR-320 §Integration plan
 */
export const LEGACY_MAXIMAL_GRANT: PluginPermissionManifest = {
  filesystem: { read: ['**'], write: ['**'] },
  network: { allowedHosts: ['*'] },
  hooks: ['*'],
  memoryNamespaces: ['*'],
  subprocess: true,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function validateFilesystem(value: unknown): PluginPermissionManifest['filesystem'] {
  if (!isPlainObject(value)) {
    return { read: [], write: [] };
  }
  return {
    read: validateStringArray(value.read),
    write: validateStringArray(value.write),
  };
}

function validateNetwork(value: unknown): PluginPermissionManifest['network'] {
  if (!isPlainObject(value)) {
    return { allowedHosts: [] };
  }
  return { allowedHosts: validateStringArray(value.allowedHosts) };
}

/**
 * Validate and normalize whatever arbitrary JSON came from a plugin's
 * `package.json['claude-flow'].permissions` field.
 *
 * - `raw` is `undefined`/`null` (the whole `permissions` block, or the
 *   whole `claude-flow` block, is absent) -> {@link LEGACY_MAXIMAL_GRANT}.
 * - `raw` is present but not a plain object, or individual fields are the
 *   wrong shape -> those fields fail safe to the most-restrictive default
 *   (empty arrays / `false`) rather than rejecting the whole manifest or
 *   throwing, mirroring how `manager.ts` already defaults `commands`/
 *   `hooks` to `[]` today when absent or malformed.
 */
export function validatePermissionManifest(raw: unknown): PluginPermissionManifest {
  if (raw === undefined || raw === null) {
    return LEGACY_MAXIMAL_GRANT;
  }

  if (!isPlainObject(raw)) {
    return emptyManifest();
  }

  return {
    filesystem: validateFilesystem(raw.filesystem),
    network: validateNetwork(raw.network),
    hooks: validateStringArray(raw.hooks),
    memoryNamespaces: validateStringArray(raw.memoryNamespaces),
    subprocess: typeof raw.subprocess === 'boolean' ? raw.subprocess : false,
  };
}
