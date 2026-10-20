/**
 * ADR-406 §6 — the canonical command registry contract.
 *
 * `CommandDefinition` mirrors the ADR's proposed TypeScript contract field for
 * field. Every object is `.strict()` (unknown fields are rejected), every
 * string and array is capped, and `argumentsSchema` is capped by its
 * serialized size. A definition carries no executable path, shell template,
 * network grant or approval override: `bindingId` is only a key into a
 * reviewed allowlist owned by runtime code.
 *
 * Inventory facts (where a command was found, its digest, how the engine
 * spells it) live beside the definition in a catalog entry, never inside it,
 * so the §6 shape stays exact.
 */

import { z } from 'zod';

export const COMMAND_CATALOG_CONTRACT = 'ruflo.command-catalog/1' as const;

export const LIMITS = Object.freeze({
  id: 160,
  name: 128,
  names: 16,
  path: 512,
  ownerPlugin: 96,
  capabilities: 64,
  capability: 128,
  argumentsSchemaBytes: 4_096,
  entries: 4_096,
  note: 512,
});

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:/-]*$/i;
// A command spelling as the engine accepts it: letters, digits, `-`, `_`,
// `.` and the `:` namespace separator. No whitespace, no shell metacharacters.
const COMMAND_NAME = /^[a-z0-9][a-z0-9._:-]*$/i;
// Repository-relative, forward slashes, no `..` segment, no leading slash.
const REL_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\0\\]+$/;

export const commandKindSchema = z.enum(['prompt', 'query', 'mutation', 'workflow', 'help']);
export const modDispositionSchema = z.enum(['view', 'dispatch', 'delegate', 'legacy']);

const nameSchema = z.string().min(1).max(LIMITS.name).regex(COMMAND_NAME);
const relPathSchema = z.string().min(1).max(LIMITS.path).regex(REL_PATH);

const argumentsSchemaSchema = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= LIMITS.argumentsSchemaBytes, {
    message: `argumentsSchema exceeds ${LIMITS.argumentsSchemaBytes} serialized bytes`,
  });

export const commandDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(LIMITS.id).regex(SAFE_ID),
    revision: z.number().int().min(1).max(1_000_000),
    ownerPlugin: z.string().min(1).max(LIMITS.ownerPlugin).regex(SAFE_ID),
    legacyNames: z.array(nameSchema).max(LIMITS.names),
    modNames: z.array(nameSchema).max(LIMITS.names),
    kind: commandKindSchema,
    argumentsSchema: argumentsSchemaSchema,
    resultSchemaId: z.string().min(1).max(LIMITS.id).regex(SAFE_ID).optional(),
    prompt: z
      .object({
        path: relPathSchema,
        sha256: z.string().regex(SHA256),
        substitution: z.enum(['$ARGUMENTS', 'positional', 'none']),
      })
      .strict()
      .optional(),
    bindingId: z.string().min(1).max(LIMITS.id).regex(SAFE_ID).optional(),
    requiredCapabilities: z.array(z.string().min(1).max(LIMITS.capability)).max(LIMITS.capabilities),
    requiredHostFeatures: z.array(z.string().min(1).max(LIMITS.capability)).max(LIMITS.capabilities),
    disposition: modDispositionSchema,
    viewId: z.string().min(1).max(LIMITS.id).regex(SAFE_ID).optional(),
    modelVisibility: z.enum(['same-as-legacy', 'explicit-summary']),
    source: z
      .object({
        repository: z.string().min(1).max(LIMITS.id),
        commit: z.string().regex(/^(?:[a-f0-9]{40}|uncommitted)$/),
        path: relPathSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((def, ctx) => {
    if (def.legacyNames.length + def.modNames.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a command needs at least one name' });
    }
    if (def.kind === 'prompt' && !def.prompt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a prompt command must record its prompt provenance' });
    }
    // §7: prompt dispatch is not verified on any engine yet, so a prompt
    // workflow can be delegated or kept legacy but never claim `dispatch`.
    if (def.kind === 'prompt' && def.disposition === 'dispatch') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'prompt workflows cannot use dispatch (ADR-406 §7)' });
    }
    if (def.disposition === 'dispatch' && !def.bindingId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'dispatch requires a reviewed bindingId' });
    }
    if (def.disposition === 'view' && !def.viewId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'view disposition requires a viewId' });
    }
  });

export type CommandKind = z.infer<typeof commandKindSchema>;
export type ModDisposition = z.infer<typeof modDispositionSchema>;
export type CommandDefinition = z.infer<typeof commandDefinitionSchema>;

/** Where an inventoried command came from. */
export const deliveryChannelSchema = z.enum([
  'repo-project-commands', // `.claude/commands/**` at the repository root
  'cli-init-template', // packaged `.claude/commands/**` that `init` copies
  'marketplace-plugin', // `plugins/<p>/commands/*.md` listed in the marketplace
  'source-plugin', // a plugin command folder not listed in any marketplace
  'mod-registration', // `$.command.register` inside a function-hook mod
]);

export const inventorySourceSchema = z
  .object({
    channel: deliveryChannelSchema,
    package: z.string().min(1).max(LIMITS.id),
    sourcePath: relPathSchema,
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    observedInvocation: z.string().min(1).max(LIMITS.name + 1),
    // How the engine reaches it: a Markdown file load, a mod `command.register`,
    // or mod middleware attached to a Markdown command (`command.run` match).
    binding: z.enum(['markdown-loader', 'mod-register', 'mod-middleware-on-markdown']),
    initCategory: z.string().max(LIMITS.ownerPlugin).optional(),
    shippedIn: z.array(z.string().max(LIMITS.ownerPlugin)).max(8),
  })
  .strict();

export const catalogEntrySchema = z
  .object({
    definition: commandDefinitionSchema,
    status: z.enum(['shipped', 'source-only', 'documentation']),
    divergent: z.boolean(),
    sources: z.array(inventorySourceSchema).min(1).max(8),
    notes: z.array(z.string().max(LIMITS.note)).max(8),
  })
  .strict();

export const commandCatalogSchema = z
  .object({
    contractVersion: z.literal(COMMAND_CATALOG_CONTRACT),
    sourceCommit: z.string().regex(/^(?:[a-f0-9]{40}|uncommitted)$/),
    sourceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    entries: z.array(catalogEntrySchema).max(LIMITS.entries),
  })
  .strict();

export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;
export type InventorySource = z.infer<typeof inventorySourceSchema>;
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type CommandCatalog = z.infer<typeof commandCatalogSchema>;
