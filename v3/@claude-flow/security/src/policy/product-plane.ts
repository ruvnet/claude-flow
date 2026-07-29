/**
 * Cognitum product-plane claim federation primitives.
 *
 * This module intentionally contains no grant-verification or domain mutation
 * logic. It validates the portable, reference-only envelope that a local
 * policy enforcement point can evaluate before consulting its authoritative
 * identity, tenancy, and permission stores.
 */

import { createHash, verify as verifyCryptoSignature, type KeyLike } from 'node:crypto';

export const PRODUCT_ACTION_ENVELOPE_VERSION = 'cognitum.action.v1' as const;

export const PRODUCT_ACTIONS = [
  'dashboard.read',
  'dashboard.status.read',
  'inference.invoke',
  'inference.stream',
  'usage.read',
  'pod.spawn',
  'benchmark.run',
  'evolution.propose',
  'evolution.promote',
  'comms.thread.read',
  'comms.thread.post',
  'comms.projection.read',
  'comms.board.admin',
  'cog.proposal.create',
  'cog.proposal.review',
  'cog.proposal.approve',
  'cog.instance.acquire',
  'cog.instance.operate',
  'cog.deploy',
  'cog.rollback',
  'ruview.space.read',
  'ruview.semantic.publish',
  'ruview.automation.propose',
  'ruview.automation.approve',
  'ruview.device.command',
  'cognition.route',
  'cognition.critique',
  'memory.recall',
  'memory.propose',
  'evidence.read',
  'memory.commit-validated',
] as const;

export type ProductAction = (typeof PRODUCT_ACTIONS)[number];

export const PRODUCT_AUTHORITIES = [
  'cognitum.control-plane',
  'cognitum.cog',
  'meta-llm',
  'comms',
  'agentbbs',
  'ruview.edge',
  'ruflo.policy',
  'ruflo.memory',
] as const;

export type ProductAuthority = (typeof PRODUCT_AUTHORITIES)[number];

export const IDENTITY_NAMESPACES = [
  'cognitum-principal',
  'firebase-subject',
  'meta-llm-account',
  'agentbbs-public-key',
  'workload',
  'ruflo-agent',
  'legacy-principal',
] as const;

export type IdentityNamespace = (typeof IDENTITY_NAMESPACES)[number];

export const TENANT_NAMESPACES = [
  'cognitum-tenant',
  'meta-llm-account',
  'meta-llm-sub-tenant',
  'comms-tenant',
  'agentbbs-board',
  'ruview-space',
] as const;

export type TenantNamespace = (typeof TENANT_NAMESPACES)[number];
export type PrivacyClass = 'P0' | 'P1' | 'P2' | 'P3';

export interface NamespacedIdentity {
  namespace: IdentityNamespace;
  id: string;
}

export interface NamespacedTenantRef {
  namespace: TenantNamespace;
  id: string;
}

export interface AuthoritativeReference {
  authority: ProductAuthority;
  tenantRef: NamespacedTenantRef;
  /**
   * Authority-qualified record kind, for example
   * `meta-llm/inference` or `ruview.edge/semantic-observation`.
   */
  sourceType: string;
  sourceId: string;
  sourceVersion: string;
  sourceDigest: `sha256:${string}`;
}

export interface ProductActionEnvelopeV1 {
  schemaVersion: typeof PRODUCT_ACTION_ENVELOPE_VERSION;
  eventId: string;
  issuer: ProductAuthority;
  audience: ProductAuthority;
  subject: NamespacedIdentity;
  actor?: NamespacedIdentity;
  tenantRef: NamespacedTenantRef;
  action: ProductAction;
  resourceRefs: string[];
  requestDigest?: `sha256:${string}`;
  contentDigest?: `sha256:${string}`;
  idempotencyKey?: string;
  correlationId: string;
  causationId?: string;
  authoritativeSource: AuthoritativeReference;
  sequence?: string;
  policyReceiptId: string;
  capabilityId?: string;
  validationReceiptId?: string;
  occurredAt: string;
  expiresAt?: string;
  privacyClass: PrivacyClass;
}

export type AvailabilityCheck = 'yes' | 'no' | 'unknown';
export type IdentityAvailability = 'verified' | 'unverified' | 'invalid' | 'unknown';

/**
 * Independent integration-health dimensions. In particular, an authorized
 * claim changes only `authorized`; it does not imply configuration,
 * reachability, service health, or verified browser/workload identity.
 */
export interface ProductAvailabilityDimensions {
  identity: IdentityAvailability;
  configured: AvailabilityCheck;
  reachable: AvailabilityCheck;
  healthy: AvailabilityCheck;
  authorized: AvailabilityCheck;
}

export type ProductAvailability = 'available' | 'degraded' | 'blocked' | 'unavailable';

export function classifyProductAvailability(
  dimensions: ProductAvailabilityDimensions,
): ProductAvailability {
  if (dimensions.authorized === 'no' || dimensions.identity === 'invalid') return 'blocked';
  if (dimensions.configured === 'no' || dimensions.reachable === 'no' || dimensions.healthy === 'no') {
    return 'unavailable';
  }
  if (
    dimensions.identity === 'verified'
    && dimensions.configured === 'yes'
    && dimensions.reachable === 'yes'
    && dimensions.healthy === 'yes'
    && dimensions.authorized === 'yes'
  ) {
    return 'available';
  }
  return 'degraded';
}

export interface RuViewSemanticObservationV1 {
  schemaVersion: 'ruview.semantic-observation.v1';
  spaceRef: NamespacedTenantRef & { namespace: 'ruview-space' };
  observationType: string;
  /**
   * Privacy-minimized semantic data only. Binary values, arrays, and raw
   * sensing field names are rejected by the wire validator.
   */
  value: Record<string, string | number | boolean | null>;
  confidence: number;
  uncertainty?: number;
  abstained: boolean;
  modelDigest: `sha256:${string}`;
  calibrationDigest?: `sha256:${string}`;
  hardwareRef?: string;
  privacyClass: 'P2' | 'P3';
  observedAt: string;
  expiresAt: string;
  /** Canonical unsigned decimal string; JSON cannot safely carry bigint. */
  sequence: string;
}

export interface ValidationIssue {
  path: string;
  code:
    | 'invalid_type'
    | 'missing'
    | 'unknown_field'
    | 'unsupported_value'
    | 'invalid_format'
    | 'invalid_authority'
    | 'identity_namespace_required'
    | 'tenant_mismatch'
    | 'privacy_ceiling_exceeded';
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export interface ProductActionRequirements {
  requestDigest: boolean;
  contentDigest: boolean;
  idempotencyKey: boolean;
  expiry: boolean;
  capability: boolean;
  validationReceipt: boolean;
}

const ACTION_SET = new Set<string>(PRODUCT_ACTIONS);
const AUTHORITY_SET = new Set<string>(PRODUCT_AUTHORITIES);
const IDENTITY_NAMESPACE_SET = new Set<string>(IDENTITY_NAMESPACES);
const TENANT_NAMESPACE_SET = new Set<string>(TENANT_NAMESPACES);
const PRIVACY_CLASS_SET = new Set<string>(['P0', 'P1', 'P2', 'P3']);
const SHA256_RE = /^sha256:[a-f0-9]{64}$/;
const UNSIGNED_DECIMAL_RE = /^(0|[1-9][0-9]*)$/;
const CANONICAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;
const SOURCE_TYPE_RE = /^[a-z][a-z0-9.-]{1,63}\/[a-z][a-z0-9.-]{0,63}$/;
const BASE64_SHAPED_RE = /^(?:[A-Za-z0-9+/]{4}){7,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_SHAPED_RE = /^[A-Za-z0-9_-]{32,}$/;

const ENVELOPE_FIELDS = new Set([
  'schemaVersion',
  'eventId',
  'issuer',
  'audience',
  'subject',
  'actor',
  'tenantRef',
  'action',
  'resourceRefs',
  'requestDigest',
  'contentDigest',
  'idempotencyKey',
  'correlationId',
  'causationId',
  'authoritativeSource',
  'sequence',
  'policyReceiptId',
  'capabilityId',
  'validationReceiptId',
  'occurredAt',
  'expiresAt',
  'privacyClass',
]);

const AUTHORITY_FIELDS = new Set([
  'authority',
  'tenantRef',
  'sourceType',
  'sourceId',
  'sourceVersion',
  'sourceDigest',
]);

const IDENTITY_FIELDS = new Set(['namespace', 'id']);
const TENANT_FIELDS = new Set(['namespace', 'id']);
const RUVIEW_FIELDS = new Set([
  'schemaVersion',
  'spaceRef',
  'observationType',
  'value',
  'confidence',
  'uncertainty',
  'abstained',
  'modelDigest',
  'calibrationDigest',
  'hardwareRef',
  'privacyClass',
  'observedAt',
  'expiresAt',
  'sequence',
]);

/**
 * Actions must be anchored in the product that owns their authoritative
 * outcome. Read-model actions permit the explicitly listed source domains.
 */
export const ACTION_AUTHORITIES: Readonly<Record<ProductAction, readonly ProductAuthority[]>> = {
  'dashboard.read': ['cognitum.control-plane'],
  'dashboard.status.read': [
    'cognitum.control-plane',
    'cognitum.cog',
    'meta-llm',
    'comms',
    'agentbbs',
    'ruview.edge',
    'ruflo.policy',
  ],
  'inference.invoke': ['meta-llm'],
  'inference.stream': ['meta-llm'],
  'usage.read': ['meta-llm'],
  'pod.spawn': ['meta-llm'],
  'benchmark.run': ['meta-llm'],
  'evolution.propose': ['meta-llm'],
  'evolution.promote': ['meta-llm'],
  'comms.thread.read': ['agentbbs'],
  'comms.thread.post': ['agentbbs'],
  'comms.projection.read': [
    'cognitum.cog',
    'meta-llm',
    'comms',
    'agentbbs',
    'ruview.edge',
  ],
  'comms.board.admin': ['comms'],
  'cog.proposal.create': ['cognitum.cog'],
  'cog.proposal.review': ['cognitum.cog'],
  'cog.proposal.approve': ['cognitum.cog'],
  'cog.instance.acquire': ['cognitum.cog'],
  'cog.instance.operate': ['cognitum.cog'],
  'cog.deploy': ['cognitum.cog'],
  'cog.rollback': ['cognitum.cog'],
  'ruview.space.read': ['ruview.edge'],
  'ruview.semantic.publish': ['ruview.edge'],
  'ruview.automation.propose': ['ruview.edge'],
  'ruview.automation.approve': ['ruview.edge'],
  'ruview.device.command': ['ruview.edge'],
  'cognition.route': ['ruflo.policy'],
  'cognition.critique': ['ruflo.policy'],
  'memory.recall': ['ruflo.memory'],
  'memory.propose': ['ruflo.memory'],
  'evidence.read': ['ruflo.memory'],
  'memory.commit-validated': ['ruflo.memory'],
};

const NO_SIDE_EFFECT_REQUIREMENTS: ProductActionRequirements = {
  requestDigest: false,
  contentDigest: false,
  idempotencyKey: false,
  expiry: false,
  capability: false,
  validationReceipt: false,
};

const SCOPED_READ_REQUIREMENTS: ProductActionRequirements = {
  requestDigest: true,
  contentDigest: false,
  idempotencyKey: false,
  expiry: true,
  capability: true,
  validationReceipt: false,
};

const MUTATION_REQUIREMENTS: ProductActionRequirements = {
  requestDigest: true,
  contentDigest: false,
  idempotencyKey: true,
  expiry: true,
  capability: true,
  validationReceipt: false,
};

/**
 * Explicit obligations avoid inference from action spelling. New actions do
 * not become privileged merely because a caller supplies a valid signature.
 */
export const PRODUCT_ACTION_REQUIREMENTS: Readonly<Record<ProductAction, ProductActionRequirements>> = {
  'dashboard.read': NO_SIDE_EFFECT_REQUIREMENTS,
  'dashboard.status.read': NO_SIDE_EFFECT_REQUIREMENTS,
  'inference.invoke': MUTATION_REQUIREMENTS,
  'inference.stream': MUTATION_REQUIREMENTS,
  'usage.read': SCOPED_READ_REQUIREMENTS,
  'pod.spawn': MUTATION_REQUIREMENTS,
  'benchmark.run': MUTATION_REQUIREMENTS,
  'evolution.propose': MUTATION_REQUIREMENTS,
  'evolution.promote': MUTATION_REQUIREMENTS,
  'comms.thread.read': SCOPED_READ_REQUIREMENTS,
  'comms.thread.post': MUTATION_REQUIREMENTS,
  'comms.projection.read': SCOPED_READ_REQUIREMENTS,
  'comms.board.admin': MUTATION_REQUIREMENTS,
  'cog.proposal.create': MUTATION_REQUIREMENTS,
  'cog.proposal.review': MUTATION_REQUIREMENTS,
  'cog.proposal.approve': MUTATION_REQUIREMENTS,
  'cog.instance.acquire': MUTATION_REQUIREMENTS,
  'cog.instance.operate': MUTATION_REQUIREMENTS,
  'cog.deploy': MUTATION_REQUIREMENTS,
  'cog.rollback': MUTATION_REQUIREMENTS,
  'ruview.space.read': SCOPED_READ_REQUIREMENTS,
  'ruview.semantic.publish': MUTATION_REQUIREMENTS,
  'ruview.automation.propose': MUTATION_REQUIREMENTS,
  'ruview.automation.approve': MUTATION_REQUIREMENTS,
  'ruview.device.command': MUTATION_REQUIREMENTS,
  'cognition.route': MUTATION_REQUIREMENTS,
  'cognition.critique': MUTATION_REQUIREMENTS,
  'memory.recall': SCOPED_READ_REQUIREMENTS,
  'memory.propose': MUTATION_REQUIREMENTS,
  'evidence.read': SCOPED_READ_REQUIREMENTS,
  'memory.commit-validated': {
    requestDigest: true,
    contentDigest: true,
    idempotencyKey: true,
    expiry: true,
    capability: true,
    validationReceipt: true,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(
  issues: ValidationIssue[],
  path: string,
  code: ValidationIssue['code'],
  message: string,
): void {
  issues.push({ path, code, message });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(issues, `${path}.${key}`, 'unknown_field', 'field is not in this schema version');
  }
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  options: { optional?: boolean; max?: number; pattern?: RegExp } = {},
): string | undefined {
  const candidate = value[key];
  if (candidate === undefined) {
    if (!options.optional) issue(issues, `${path}.${key}`, 'missing', 'required field is missing');
    return undefined;
  }
  if (typeof candidate !== 'string') {
    issue(issues, `${path}.${key}`, 'invalid_type', 'must be a string');
    return undefined;
  }
  const max = options.max ?? 256;
  if (candidate.length === 0 || candidate.length > max || /[\u0000-\u001f\u007f]/.test(candidate)) {
    issue(issues, `${path}.${key}`, 'invalid_format', `must contain 1-${max} safe characters`);
    return undefined;
  }
  if (options.pattern && !options.pattern.test(candidate)) {
    issue(issues, `${path}.${key}`, 'invalid_format', 'has an invalid format');
    return undefined;
  }
  return candidate;
}

function validateTimestamp(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  optional = false,
): string | undefined {
  const timestamp = requireString(value, key, path, issues, { optional, max: 24 });
  if (timestamp !== undefined) {
    const milliseconds = Date.parse(timestamp);
    if (
      !CANONICAL_TIMESTAMP_RE.test(timestamp)
      || !Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== timestamp
    ) {
      issue(issues, `${path}.${key}`, 'invalid_format', 'must round-trip as a canonical UTC timestamp');
      return undefined;
    }
  }
  return timestamp;
}

function validateDigest(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
  optional = false,
): string | undefined {
  return requireString(value, key, path, issues, {
    optional,
    max: 71,
    pattern: SHA256_RE,
  });
}

function validateIdentity(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): NamespacedIdentity | undefined {
  if (!isRecord(input)) {
    issue(issues, path, 'invalid_type', 'must be a namespaced identity object');
    return undefined;
  }
  rejectUnknownFields(input, IDENTITY_FIELDS, path, issues);
  const namespace = requireString(input, 'namespace', path, issues, { max: 64 });
  const id = requireString(input, 'id', path, issues, { max: 512 });
  if (namespace !== undefined && !IDENTITY_NAMESPACE_SET.has(namespace)) {
    issue(issues, `${path}.namespace`, 'identity_namespace_required', 'unknown identity namespace');
  }
  if (namespace === undefined || id === undefined || !IDENTITY_NAMESPACE_SET.has(namespace)) return undefined;
  return { namespace: namespace as IdentityNamespace, id };
}

function validateTenantRef(
  input: unknown,
  path: string,
  issues: ValidationIssue[],
): NamespacedTenantRef | undefined {
  if (!isRecord(input)) {
    issue(issues, path, 'invalid_type', 'must be a namespaced tenant reference object');
    return undefined;
  }
  rejectUnknownFields(input, TENANT_FIELDS, path, issues);
  const namespace = requireString(input, 'namespace', path, issues, { max: 64 });
  const id = requireString(input, 'id', path, issues, { max: 256 });
  if (namespace !== undefined && !TENANT_NAMESPACE_SET.has(namespace)) {
    issue(issues, `${path}.namespace`, 'identity_namespace_required', 'unknown tenant namespace');
  }
  if (namespace === undefined || id === undefined || !TENANT_NAMESPACE_SET.has(namespace)) return undefined;
  return { namespace: namespace as TenantNamespace, id };
}

export function identityKey(identity: NamespacedIdentity): string {
  return `${identity.namespace.length}:${identity.namespace}${identity.id.length}:${identity.id}`;
}

export function sameIdentity(left: NamespacedIdentity, right: NamespacedIdentity): boolean {
  return identityKey(left) === identityKey(right);
}

export function tenantRefKey(tenant: NamespacedTenantRef): string {
  return `${tenant.namespace.length}:${tenant.namespace}${tenant.id.length}:${tenant.id}`;
}

export function isProductAction(value: unknown): value is ProductAction {
  return typeof value === 'string' && ACTION_SET.has(value);
}

export function validateAuthoritativeReference(
  input: unknown,
  options: { action?: ProductAction; tenantRef?: NamespacedTenantRef } = {},
): ValidationResult<AuthoritativeReference> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'invalid_type', message: 'authority reference must be an object' }],
    };
  }
  rejectUnknownFields(input, AUTHORITY_FIELDS, '$', issues);
  const authority = requireString(input, 'authority', '$', issues, { max: 64 });
  const tenantRef = validateTenantRef(input.tenantRef, '$.tenantRef', issues);
  const sourceType = requireString(input, 'sourceType', '$', issues, { max: 128, pattern: SOURCE_TYPE_RE });
  const sourceId = requireString(input, 'sourceId', '$', issues, { max: 512 });
  const sourceVersion = requireString(input, 'sourceVersion', '$', issues, {
    max: 128,
    pattern: SAFE_TOKEN_RE,
  });
  const sourceDigest = validateDigest(input, 'sourceDigest', '$', issues);

  if (authority !== undefined && !AUTHORITY_SET.has(authority)) {
    issue(issues, '$.authority', 'invalid_authority', 'unknown product authority');
  }
  if (
    authority !== undefined
    && AUTHORITY_SET.has(authority)
    && sourceType !== undefined
    && !sourceType.startsWith(`${authority}/`)
  ) {
    issue(issues, '$.sourceType', 'invalid_authority', 'source type is not owned by the declared authority');
  }
  if (
    options.action
    && authority !== undefined
    && AUTHORITY_SET.has(authority)
    && !ACTION_AUTHORITIES[options.action].includes(authority as ProductAuthority)
  ) {
    issue(issues, '$.authority', 'invalid_authority', 'authority does not own the action outcome');
  }
  if (
    options.tenantRef
    && tenantRef
    && tenantRefKey(options.tenantRef) !== tenantRefKey(tenantRef)
  ) {
    issue(issues, '$.tenantRef', 'tenant_mismatch', 'source tenant does not match envelope tenant');
  }

  if (
    issues.length > 0
    || authority === undefined
    || !AUTHORITY_SET.has(authority)
    || tenantRef === undefined
    || sourceType === undefined
    || sourceId === undefined
    || sourceVersion === undefined
    || sourceDigest === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      authority: authority as ProductAuthority,
      tenantRef,
      sourceType,
      sourceId,
      sourceVersion,
      sourceDigest: sourceDigest as `sha256:${string}`,
    },
  };
}

export function validateProductActionEnvelope(input: unknown): ValidationResult<ProductActionEnvelopeV1> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'invalid_type', message: 'action envelope must be an object' }],
    };
  }
  rejectUnknownFields(input, ENVELOPE_FIELDS, '$', issues);

  const schemaVersion = requireString(input, 'schemaVersion', '$', issues, { max: 64 });
  if (schemaVersion !== undefined && schemaVersion !== PRODUCT_ACTION_ENVELOPE_VERSION) {
    issue(issues, '$.schemaVersion', 'unsupported_value', 'unsupported action envelope version');
  }
  const eventId = requireString(input, 'eventId', '$', issues, { max: 256, pattern: SAFE_TOKEN_RE });
  const issuer = requireString(input, 'issuer', '$', issues, { max: 64 });
  const audience = requireString(input, 'audience', '$', issues, { max: 64 });
  if (issuer !== undefined && !AUTHORITY_SET.has(issuer)) {
    issue(issues, '$.issuer', 'invalid_authority', 'unknown issuer authority');
  }
  if (audience !== undefined && !AUTHORITY_SET.has(audience)) {
    issue(issues, '$.audience', 'invalid_authority', 'unknown audience authority');
  }

  const subject = validateIdentity(input.subject, '$.subject', issues);
  const actor = input.actor === undefined ? undefined : validateIdentity(input.actor, '$.actor', issues);
  const tenantRef = validateTenantRef(input.tenantRef, '$.tenantRef', issues);
  const actionValue = requireString(input, 'action', '$', issues, { max: 128 });
  if (actionValue !== undefined && !isProductAction(actionValue)) {
    issue(issues, '$.action', 'unsupported_value', 'action is outside the product action vocabulary');
  }
  const action = isProductAction(actionValue) ? actionValue : undefined;

  let resourceRefs: string[] | undefined;
  if (!Array.isArray(input.resourceRefs) || input.resourceRefs.length === 0 || input.resourceRefs.length > 32) {
    issue(issues, '$.resourceRefs', 'invalid_type', 'must be an array of 1-32 resource references');
  } else {
    resourceRefs = [];
    input.resourceRefs.forEach((resource, index) => {
      if (
        typeof resource !== 'string'
        || resource.length === 0
        || resource.length > 512
        || !SAFE_TOKEN_RE.test(resource)
      ) {
        issue(issues, `$.resourceRefs[${index}]`, 'invalid_format', 'invalid resource reference');
      } else if (resourceRefs!.includes(resource)) {
        issue(issues, `$.resourceRefs[${index}]`, 'unsupported_value', 'duplicate resource reference');
      } else {
        resourceRefs!.push(resource);
      }
    });
  }

  const requestDigest = validateDigest(input, 'requestDigest', '$', issues, true);
  const contentDigest = validateDigest(input, 'contentDigest', '$', issues, true);
  const idempotencyKey = requireString(input, 'idempotencyKey', '$', issues, {
    optional: true,
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const correlationId = requireString(input, 'correlationId', '$', issues, {
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const causationId = requireString(input, 'causationId', '$', issues, {
    optional: true,
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const sequence = requireString(input, 'sequence', '$', issues, {
    optional: true,
    max: 40,
    pattern: UNSIGNED_DECIMAL_RE,
  });
  const policyReceiptId = requireString(input, 'policyReceiptId', '$', issues, {
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const capabilityId = requireString(input, 'capabilityId', '$', issues, {
    optional: true,
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const validationReceiptId = requireString(input, 'validationReceiptId', '$', issues, {
    optional: true,
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const occurredAt = validateTimestamp(input, 'occurredAt', '$', issues);
  const expiresAt = validateTimestamp(input, 'expiresAt', '$', issues, true);
  if (
    occurredAt !== undefined
    && expiresAt !== undefined
    && Date.parse(expiresAt) <= Date.parse(occurredAt)
  ) {
    issue(issues, '$.expiresAt', 'unsupported_value', 'expiry must be after occurrence');
  }
  const privacyClass = requireString(input, 'privacyClass', '$', issues, { max: 2 });
  if (privacyClass !== undefined && !PRIVACY_CLASS_SET.has(privacyClass)) {
    issue(issues, '$.privacyClass', 'unsupported_value', 'unknown privacy class');
  }
  if (
    action === 'ruview.semantic.publish'
    && privacyClass !== undefined
    && privacyClass !== 'P2'
    && privacyClass !== 'P3'
  ) {
    issue(issues, '$.privacyClass', 'privacy_ceiling_exceeded', 'RuView semantic events must be P2 or P3');
  }
  if (action) {
    const requirements = PRODUCT_ACTION_REQUIREMENTS[action];
    const required: Array<[boolean, string, string]> = [
      [requirements.requestDigest, 'requestDigest', 'action requires a request digest'],
      [requirements.contentDigest, 'contentDigest', 'validated memory commit requires a content digest'],
      [requirements.idempotencyKey, 'idempotencyKey', 'action requires an idempotency key'],
      [requirements.expiry, 'expiresAt', 'action requires a bounded expiry'],
      [requirements.capability, 'capabilityId', 'action requires a narrow capability'],
      [requirements.validationReceipt, 'validationReceiptId', 'validated memory commit requires a validation receipt'],
    ];
    for (const [isRequired, field, message] of required) {
      if (isRequired && input[field] === undefined) issue(issues, `$.${field}`, 'missing', message);
    }
  }

  const sourceResult = validateAuthoritativeReference(input.authoritativeSource, { action, tenantRef });
  if (!sourceResult.ok) {
    for (const sourceIssue of sourceResult.issues) {
      issues.push({
        ...sourceIssue,
        path: sourceIssue.path === '$'
          ? '$.authoritativeSource'
          : `$.authoritativeSource${sourceIssue.path.slice(1)}`,
      });
    }
  }

  if (
    issues.length > 0
    || schemaVersion !== PRODUCT_ACTION_ENVELOPE_VERSION
    || eventId === undefined
    || issuer === undefined
    || !AUTHORITY_SET.has(issuer)
    || audience === undefined
    || !AUTHORITY_SET.has(audience)
    || subject === undefined
    || tenantRef === undefined
    || action === undefined
    || resourceRefs === undefined
    || correlationId === undefined
    || policyReceiptId === undefined
    || occurredAt === undefined
    || privacyClass === undefined
    || !PRIVACY_CLASS_SET.has(privacyClass)
    || !sourceResult.ok
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      schemaVersion,
      eventId,
      issuer: issuer as ProductAuthority,
      audience: audience as ProductAuthority,
      subject,
      ...(actor ? { actor } : {}),
      tenantRef,
      action,
      resourceRefs,
      ...(requestDigest ? { requestDigest: requestDigest as `sha256:${string}` } : {}),
      ...(contentDigest ? { contentDigest: contentDigest as `sha256:${string}` } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      correlationId,
      ...(causationId ? { causationId } : {}),
      authoritativeSource: sourceResult.value,
      ...(sequence ? { sequence } : {}),
      policyReceiptId,
      ...(capabilityId ? { capabilityId } : {}),
      ...(validationReceiptId ? { validationReceiptId } : {}),
      occurredAt,
      ...(expiresAt ? { expiresAt } : {}),
      privacyClass: privacyClass as PrivacyClass,
    },
  };
}

export type RuViewSemanticFieldKind = 'boolean' | 'number' | 'string' | 'nullable-string';

export interface RuViewSemanticFieldSchema {
  kind: RuViewSemanticFieldKind;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  enum?: readonly string[];
}

export interface RuViewObservationSchema {
  privacyClasses: readonly ('P2' | 'P3')[];
  fields: Readonly<Record<string, RuViewSemanticFieldSchema>>;
}

export type RuViewObservationRegistry = Readonly<Record<string, RuViewObservationSchema>>;

/**
 * The default edge-export surface is deliberately small and semantic. A new
 * observation type or field requires explicit schema registration; arbitrary
 * keys are never accepted based on a deny-list alone.
 */
export const DEFAULT_RUVIEW_OBSERVATION_REGISTRY: RuViewObservationRegistry = Object.freeze({
  'occupancy.state': {
    privacyClasses: ['P2'],
    fields: {
      occupied: { kind: 'boolean', required: true },
      zone: { kind: 'string', maxLength: 64 },
      peopleEstimate: { kind: 'number', min: 0, max: 10_000 },
    },
  },
  'presence.state': {
    privacyClasses: ['P2'],
    fields: {
      present: { kind: 'boolean', required: true },
      zone: { kind: 'string', maxLength: 64 },
    },
  },
  'motion.state': {
    privacyClasses: ['P2'],
    fields: {
      active: { kind: 'boolean', required: true },
      intensity: { kind: 'number', min: 0, max: 1 },
    },
  },
  'vital.summary': {
    privacyClasses: ['P3'],
    fields: {
      state: {
        kind: 'string',
        required: true,
        enum: ['normal', 'attention', 'critical', 'unknown'],
      },
      anomaly: { kind: 'boolean', required: true },
      label: { kind: 'nullable-string', maxLength: 128 },
    },
  },
});

function looksLikeRawEncoding(value: string): boolean {
  return /^data:[^,]{1,128};base64,/i.test(value)
    || BASE64_SHAPED_RE.test(value)
    || BASE64URL_SHAPED_RE.test(value);
}

function validateSemanticValue(
  value: unknown,
  schema: RuViewObservationSchema | undefined,
  privacyClass: unknown,
  issues: ValidationIssue[],
): value is RuViewSemanticObservationV1['value'] {
  if (!schema) {
    issue(issues, '$.observationType', 'unsupported_value', 'observation type is not registered for edge export');
    return false;
  }
  if (privacyClass !== 'P2' && privacyClass !== 'P3') return false;
  if (!schema.privacyClasses.includes(privacyClass)) {
    issue(issues, '$.privacyClass', 'privacy_ceiling_exceeded', 'privacy class is not permitted by the observation schema');
  }
  if (!isRecord(value)) {
    issue(issues, '$.value', 'privacy_ceiling_exceeded', 'registered semantic observations require an object value');
    return false;
  }

  let valid = true;
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(schema.fields, key)) {
      issue(issues, `$.value.${key}`, 'unknown_field', 'field is not registered for this observation type');
      valid = false;
    }
  }
  for (const [key, fieldSchema] of Object.entries(schema.fields)) {
    const field = value[key];
    if (field === undefined) {
      if (fieldSchema.required) {
        issue(issues, `$.value.${key}`, 'missing', 'required semantic field is missing');
        valid = false;
      }
      continue;
    }
    if (typeof field === 'string' && looksLikeRawEncoding(field)) {
      issue(issues, `$.value.${key}`, 'privacy_ceiling_exceeded', 'base64-shaped or data-URL values cannot leave the edge');
      valid = false;
      continue;
    }
    if (fieldSchema.kind === 'boolean') {
      if (typeof field !== 'boolean') {
        issue(issues, `$.value.${key}`, 'invalid_type', 'must be a boolean');
        valid = false;
      }
      continue;
    }
    if (fieldSchema.kind === 'number') {
      if (
        typeof field !== 'number'
        || !Number.isFinite(field)
        || (fieldSchema.min !== undefined && field < fieldSchema.min)
        || (fieldSchema.max !== undefined && field > fieldSchema.max)
      ) {
        issue(issues, `$.value.${key}`, 'invalid_format', 'must be a finite number within the registered bounds');
        valid = false;
      }
      continue;
    }
    if (fieldSchema.kind === 'nullable-string' && field === null) continue;
    if (typeof field !== 'string' || field.length > (fieldSchema.maxLength ?? 256)) {
      issue(issues, `$.value.${key}`, 'invalid_type', 'must be a bounded string');
      valid = false;
      continue;
    }
    if (fieldSchema.enum && !fieldSchema.enum.includes(field)) {
      issue(issues, `$.value.${key}`, 'unsupported_value', 'value is outside the registered semantic vocabulary');
      valid = false;
    }
  }
  return valid;
}

export function validateRuViewSemanticObservation(
  input: unknown,
  registry: RuViewObservationRegistry = DEFAULT_RUVIEW_OBSERVATION_REGISTRY,
): ValidationResult<RuViewSemanticObservationV1> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      issues: [{ path: '$', code: 'invalid_type', message: 'RuView observation must be an object' }],
    };
  }
  rejectUnknownFields(input, RUVIEW_FIELDS, '$', issues);

  const schemaVersion = requireString(input, 'schemaVersion', '$', issues, { max: 64 });
  if (schemaVersion !== undefined && schemaVersion !== 'ruview.semantic-observation.v1') {
    issue(issues, '$.schemaVersion', 'unsupported_value', 'unsupported RuView observation version');
  }
  const spaceRef = validateTenantRef(input.spaceRef, '$.spaceRef', issues);
  if (spaceRef && spaceRef.namespace !== 'ruview-space') {
    issue(issues, '$.spaceRef.namespace', 'identity_namespace_required', 'RuView observation requires a RuView space namespace');
  }
  const observationType = requireString(input, 'observationType', '$', issues, {
    max: 128,
    pattern: SAFE_TOKEN_RE,
  });
  const privacyClass = requireString(input, 'privacyClass', '$', issues, { max: 2 });
  if (privacyClass !== undefined && privacyClass !== 'P2' && privacyClass !== 'P3') {
    issue(issues, '$.privacyClass', 'privacy_ceiling_exceeded', 'RuView product-plane observations must be P2 or P3');
  }
  const valueValid = validateSemanticValue(
    input.value,
    observationType ? registry[observationType] : undefined,
    privacyClass,
    issues,
  );

  const confidence = input.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    issue(issues, '$.confidence', 'invalid_format', 'confidence must be finite and between 0 and 1');
  }
  const uncertainty = input.uncertainty;
  if (
    uncertainty !== undefined
    && (typeof uncertainty !== 'number' || !Number.isFinite(uncertainty) || uncertainty < 0 || uncertainty > 1)
  ) {
    issue(issues, '$.uncertainty', 'invalid_format', 'uncertainty must be finite and between 0 and 1');
  }
  if (typeof input.abstained !== 'boolean') {
    issue(issues, '$.abstained', input.abstained === undefined ? 'missing' : 'invalid_type', 'abstained must be a boolean');
  }
  const modelDigest = validateDigest(input, 'modelDigest', '$', issues);
  const calibrationDigest = validateDigest(input, 'calibrationDigest', '$', issues, true);
  const hardwareRef = requireString(input, 'hardwareRef', '$', issues, {
    optional: true,
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const observedAt = validateTimestamp(input, 'observedAt', '$', issues);
  const expiresAt = validateTimestamp(input, 'expiresAt', '$', issues);
  if (
    observedAt !== undefined
    && expiresAt !== undefined
    && Date.parse(expiresAt) <= Date.parse(observedAt)
  ) {
    issue(issues, '$.expiresAt', 'unsupported_value', 'observation expiry must be after observation time');
  }
  const sequence = requireString(input, 'sequence', '$', issues, {
    max: 40,
    pattern: UNSIGNED_DECIMAL_RE,
  });

  if (
    issues.length > 0
    || schemaVersion !== 'ruview.semantic-observation.v1'
    || spaceRef === undefined
    || spaceRef.namespace !== 'ruview-space'
    || observationType === undefined
    || registry[observationType] === undefined
    || !valueValid
    || typeof confidence !== 'number'
    || typeof input.abstained !== 'boolean'
    || modelDigest === undefined
    || (privacyClass !== 'P2' && privacyClass !== 'P3')
    || observedAt === undefined
    || expiresAt === undefined
    || sequence === undefined
  ) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      schemaVersion,
      spaceRef: { namespace: 'ruview-space', id: spaceRef.id },
      observationType,
      value: input.value as RuViewSemanticObservationV1['value'],
      confidence,
      ...(typeof uncertainty === 'number' ? { uncertainty } : {}),
      abstained: input.abstained,
      modelDigest: modelDigest as `sha256:${string}`,
      ...(calibrationDigest ? { calibrationDigest: calibrationDigest as `sha256:${string}` } : {}),
      ...(hardwareRef ? { hardwareRef } : {}),
      privacyClass,
      observedAt,
      expiresAt,
      sequence,
    },
  };
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError('JCS canonicalization rejects an unpaired high surrogate');
      }
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError('JCS canonicalization rejects an unpaired low surrogate');
    }
  }
}

/**
 * RFC 8785/JCS-compatible canonical JSON for this I-JSON profile.
 *
 * ECMAScript's JSON number serialization supplies the JCS number rendering.
 * Non-finite numbers, sparse arrays, undefined values, non-plain objects, and
 * invalid Unicode are rejected instead of being silently coerced.
 */
export function canonicalizeProductPlane(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    assertUnicodeScalarString(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JCS canonicalization rejects non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError('JCS canonicalization rejects sparse arrays');
      }
      items.push(canonicalizeProductPlane(value[index]));
    }
    return `[${items.join(',')}]`;
  }
  if (!isRecord(value)) {
    throw new TypeError('JCS canonicalization accepts only JSON-compatible plain objects');
  }
  const entries: string[] = [];
  for (const key of Object.keys(value).sort()) {
    assertUnicodeScalarString(key);
    if (value[key] === undefined) {
      throw new TypeError('JCS canonicalization rejects undefined object values');
    }
    entries.push(`${JSON.stringify(key)}:${canonicalizeProductPlane(value[key])}`);
  }
  return `{${entries.join(',')}}`;
}

export function canonicalProductPlaneBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalizeProductPlane(value), 'utf8');
}

export function canonicalProductPlaneDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(canonicalProductPlaneBytes(value)).digest('hex')}`;
}

export interface SignedProductActionEnvelopeV1 {
  envelope: ProductActionEnvelopeV1;
  algorithm: 'Ed25519';
  keyId: string;
  signature: string;
}

export type SignatureVerifier = (input: {
  issuer: ProductAuthority;
  keyId: string;
  algorithm: 'Ed25519';
  canonicalBytes: Uint8Array;
  signature: Uint8Array;
}) => boolean | Promise<boolean>;

export type AuthorityKeyResolver = (
  issuer: ProductAuthority,
  keyId: string,
) => KeyLike | null | undefined | Promise<KeyLike | null | undefined>;

export interface ReplayReservationInput {
  key: string;
  bindingDigest: `sha256:${string}`;
  expiresAt: number;
}

export type ReplayReservation = 'reserved' | 'replay' | 'conflict';

/**
 * The implementation must reserve atomically. A lookup-then-insert adapter is
 * not a conforming replay store under concurrent delivery.
 */
export interface ProductEnvelopeReplayStore {
  reserve(input: ReplayReservationInput): ReplayReservation | Promise<ReplayReservation>;
}

export type LocalAuthorizationDecision =
  | boolean
  | { allowed: boolean; reason?: string };

export interface ProductEnvelopeVerifierOptions {
  expectedAudience: ProductAuthority;
  expectedTenantRef: NamespacedTenantRef;
  now?: () => number;
  maxAgeMs?: number;
  maxFutureSkewMs?: number;
  resolveKey?: AuthorityKeyResolver;
  verifySignature?: SignatureVerifier;
  replayStore: ProductEnvelopeReplayStore;
  policyVerifier: (
    envelope: ProductActionEnvelopeV1,
  ) => LocalAuthorizationDecision | Promise<LocalAuthorizationDecision>;
  capabilityVerifier: (
    envelope: ProductActionEnvelopeV1,
  ) => LocalAuthorizationDecision | Promise<LocalAuthorizationDecision>;
}

export type ProductEnvelopeVerificationCode =
  | 'malformed_signed_envelope'
  | 'invalid_envelope'
  | 'audience_mismatch'
  | 'tenant_mismatch'
  | 'not_yet_valid'
  | 'stale'
  | 'expired'
  | 'signature_configuration_missing'
  | 'key_not_found'
  | 'signature_invalid'
  | 'policy_denied'
  | 'capability_denied'
  | 'replay_detected'
  | 'idempotency_conflict'
  | 'verification_error';

export type ProductEnvelopeVerificationResult =
  | {
    ok: true;
    envelope: ProductActionEnvelopeV1;
    canonicalDigest: `sha256:${string}`;
    replayKey: string;
  }
  | {
    ok: false;
    code: ProductEnvelopeVerificationCode;
    reason: string;
    issues?: ValidationIssue[];
  };

const SIGNED_ENVELOPE_FIELDS = new Set(['envelope', 'algorithm', 'keyId', 'signature']);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function deny(
  code: ProductEnvelopeVerificationCode,
  reason: string,
  issues?: ValidationIssue[],
): ProductEnvelopeVerificationResult {
  return { ok: false, code, reason, ...(issues ? { issues } : {}) };
}

function authorizationAllowed(decision: LocalAuthorizationDecision): boolean {
  return typeof decision === 'boolean' ? decision : decision.allowed;
}

function authorizationReason(decision: LocalAuthorizationDecision, fallback: string): string {
  return typeof decision === 'boolean' ? fallback : decision.reason ?? fallback;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!BASE64URL_RE.test(value)) return undefined;
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== value) return undefined;
  return decoded;
}

function replayKeyFor(envelope: ProductActionEnvelopeV1): string {
  const parts = [
    envelope.issuer,
    tenantRefKey(envelope.tenantRef),
    identityKey(envelope.subject),
    envelope.action,
    envelope.idempotencyKey ?? envelope.eventId,
  ];
  return parts.map((part) => `${part.length}:${part}`).join('');
}

/**
 * Verify a signed product action as an ingress policy-enforcement decision.
 *
 * Signature validity is necessary but insufficient: audience, tenant,
 * freshness, replay state, local policy, and the action-bound capability are
 * checked independently. Service availability is intentionally absent; a
 * valid claim never implies that its target is configured, reachable, or
 * healthy.
 */
export async function verifySignedProductActionEnvelope(
  input: unknown,
  options: ProductEnvelopeVerifierOptions,
): Promise<ProductEnvelopeVerificationResult> {
  if (!isRecord(input)) return deny('malformed_signed_envelope', 'signed envelope must be an object');
  const wrapperIssues: ValidationIssue[] = [];
  rejectUnknownFields(input, SIGNED_ENVELOPE_FIELDS, '$', wrapperIssues);
  const algorithm = requireString(input, 'algorithm', '$', wrapperIssues, { max: 16 });
  const keyId = requireString(input, 'keyId', '$', wrapperIssues, {
    max: 256,
    pattern: SAFE_TOKEN_RE,
  });
  const signatureText = requireString(input, 'signature', '$', wrapperIssues, { max: 128 });
  if (algorithm !== undefined && algorithm !== 'Ed25519') {
    issue(wrapperIssues, '$.algorithm', 'unsupported_value', 'only Ed25519 is supported');
  }
  const signature = signatureText ? decodeBase64Url(signatureText) : undefined;
  if (signatureText && (!signature || signature.length !== 64)) {
    issue(wrapperIssues, '$.signature', 'invalid_format', 'must be a canonical 64-byte base64url signature');
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'envelope')) {
    issue(wrapperIssues, '$.envelope', 'missing', 'signed envelope payload is missing');
  }
  if (wrapperIssues.length > 0 || algorithm !== 'Ed25519' || !keyId || !signature) {
    return deny('malformed_signed_envelope', 'signed envelope wrapper is invalid', wrapperIssues);
  }

  const parsed = validateProductActionEnvelope(input.envelope);
  if (!parsed.ok) return deny('invalid_envelope', 'action envelope is invalid', parsed.issues);
  const envelope = parsed.value;
  if (envelope.audience !== options.expectedAudience) {
    return deny('audience_mismatch', 'envelope audience does not match this service');
  }
  if (tenantRefKey(envelope.tenantRef) !== tenantRefKey(options.expectedTenantRef)) {
    return deny('tenant_mismatch', 'envelope tenant does not match the authenticated local tenant');
  }

  const now = options.now?.() ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 5 * 60_000;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 30_000;
  if (
    !Number.isFinite(now)
    || !Number.isFinite(maxAgeMs)
    || maxAgeMs < 0
    || !Number.isFinite(maxFutureSkewMs)
    || maxFutureSkewMs < 0
  ) {
    return deny('verification_error', 'verifier clock configuration is invalid');
  }
  const occurredAt = Date.parse(envelope.occurredAt);
  if (occurredAt > now + maxFutureSkewMs) return deny('not_yet_valid', 'envelope occurrence is in the future');
  if (now - occurredAt > maxAgeMs) return deny('stale', 'envelope exceeds the accepted freshness window');
  const expiresAt = envelope.expiresAt ? Date.parse(envelope.expiresAt) : occurredAt + maxAgeMs;
  if (expiresAt <= now) return deny('expired', 'envelope has expired');

  let canonicalBytes: Uint8Array;
  let canonicalDigest: `sha256:${string}`;
  try {
    canonicalBytes = canonicalProductPlaneBytes(input.envelope);
    canonicalDigest = canonicalProductPlaneDigest(input.envelope);
  } catch {
    return deny('invalid_envelope', 'envelope cannot be canonically encoded');
  }

  try {
    let signatureValid = false;
    if (options.verifySignature) {
      signatureValid = await options.verifySignature({
        issuer: envelope.issuer,
        keyId,
        algorithm,
        canonicalBytes,
        signature,
      });
    } else if (options.resolveKey) {
      const key = await options.resolveKey(envelope.issuer, keyId);
      if (!key) return deny('key_not_found', 'issuer key is unavailable or untrusted');
      signatureValid = verifyCryptoSignature(null, canonicalBytes, key, signature);
    } else {
      return deny('signature_configuration_missing', 'no authority key resolver or signature verifier is configured');
    }
    if (!signatureValid) return deny('signature_invalid', 'envelope signature is invalid');

    const policyDecision = await options.policyVerifier(envelope);
    if (!authorizationAllowed(policyDecision)) {
      return deny('policy_denied', authorizationReason(policyDecision, 'local policy denied the action'));
    }

    const requirements = PRODUCT_ACTION_REQUIREMENTS[envelope.action];
    if (requirements.capability || envelope.capabilityId) {
      const capabilityDecision = await options.capabilityVerifier(envelope);
      if (!authorizationAllowed(capabilityDecision)) {
        return deny(
          'capability_denied',
          authorizationReason(capabilityDecision, 'local capability verifier denied the action'),
        );
      }
    }

    const replayKey = replayKeyFor(envelope);
    const reservation = await options.replayStore.reserve({
      key: replayKey,
      bindingDigest: canonicalDigest,
      expiresAt,
    });
    if (reservation === 'replay') return deny('replay_detected', 'envelope was already accepted');
    if (reservation === 'conflict') {
      return deny('idempotency_conflict', 'idempotency identity is bound to different canonical bytes');
    }
    if (reservation !== 'reserved') return deny('verification_error', 'replay store returned an invalid result');
    return { ok: true, envelope, canonicalDigest, replayKey };
  } catch {
    return deny('verification_error', 'an authority, policy, capability, or replay verifier failed');
  }
}
