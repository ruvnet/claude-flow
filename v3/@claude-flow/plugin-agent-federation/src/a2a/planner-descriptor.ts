import { validateAgentCard, type A2AAgentCard } from './agent-card.js';

const CAPABILITY_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,126}[A-Za-z0-9])?$/;
const FORBIDDEN_CONTROLS_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;
const MAX_REMOTE_SKILLS = 256;
const MAX_CAPABILITIES = 32;
const MAX_FIELD_CHARS = 2_048;
const MAX_CONSTRAINTS = 16;
const MAX_CONSTRAINT_CHARS = 512;

/**
 * Host-owned planner semantics for a registered capability identifier.
 * Remote registration metadata may select an identifier, but never supplies
 * these planner-visible strings directly.
 */
export interface PlannerCapabilityDefinition {
  readonly id: string;
  readonly functionality: string;
  readonly inputSpecification: string;
  readonly outputSpecification: string;
  readonly usageConstraints: readonly string[];
}

export interface PlannerDescriptorPolicy {
  /** Resolve only identifiers the host has explicitly approved for planning. */
  readonly resolveCapability: (canonicalSkillId: string) => PlannerCapabilityDefinition | undefined;
  readonly maximumCapabilities?: number;
}

export interface PlannerSafeAgentDescriptor {
  readonly schema: 'ruflo/planner-safe-agent-descriptor/v1';
  readonly source: 'a2a-agent-card';
  readonly capabilities: readonly PlannerCapabilityDefinition[];
  readonly authority: 'none';
}

export interface PlannerDescriptorProjection {
  readonly descriptor: PlannerSafeAgentDescriptor;
  readonly rejectedSkillCount: number;
  readonly duplicateSkillCount: number;
}

/**
 * Project a third-party A2A Agent Card into planner-visible metadata.
 *
 * Security boundary: card descriptions, skill descriptions, examples, tags,
 * provider text, documentation URLs, extension parameters, and all other
 * remote prose are deliberately absent from the return type. Only a bounded
 * canonical skill identifier may cross the registration boundary, and its
 * planner semantics come from a host-controlled resolver.
 */
export function projectPlannerSafeAgentCard(
  card: A2AAgentCard,
  policy: PlannerDescriptorPolicy,
): PlannerDescriptorProjection {
  const validation = validateAgentCard(card);
  if (!validation.valid) {
    throw new Error('A2A Agent Card is structurally invalid');
  }
  if (card.skills.length > MAX_REMOTE_SKILLS) {
    throw new Error('A2A Agent Card exceeds the remote skill limit');
  }

  const maximumCapabilities = policy.maximumCapabilities ?? MAX_CAPABILITIES;
  if (!Number.isSafeInteger(maximumCapabilities) || maximumCapabilities < 1 || maximumCapabilities > MAX_CAPABILITIES) {
    throw new Error('Planner capability limit is invalid');
  }

  const capabilities: PlannerCapabilityDefinition[] = [];
  const seen = new Set<string>();
  let rejectedSkillCount = 0;
  let duplicateSkillCount = 0;

  for (const skill of card.skills) {
    const id = canonicalCapabilityId(skill.id);
    if (id === undefined) {
      rejectedSkillCount += 1;
      continue;
    }
    if (seen.has(id)) {
      duplicateSkillCount += 1;
      continue;
    }
    seen.add(id);

    const resolved = policy.resolveCapability(id);
    if (resolved === undefined) {
      rejectedSkillCount += 1;
      continue;
    }
    capabilities.push(validateResolvedCapability(id, resolved));
    if (capabilities.length >= maximumCapabilities) break;
  }

  return {
    descriptor: {
      schema: 'ruflo/planner-safe-agent-descriptor/v1',
      source: 'a2a-agent-card',
      capabilities,
      authority: 'none',
    },
    rejectedSkillCount,
    duplicateSkillCount,
  };
}

function canonicalCapabilityId(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC');
  if (FORBIDDEN_CONTROLS_RE.test(normalized)) return undefined;
  if (!CAPABILITY_ID_RE.test(normalized)) return undefined;
  return normalized;
}

function validateResolvedCapability(
  expectedId: string,
  definition: PlannerCapabilityDefinition,
): PlannerCapabilityDefinition {
  const id = canonicalCapabilityId(definition.id);
  if (id === undefined || id !== expectedId) {
    throw new Error('Resolved planner capability identifier does not match registration identifier');
  }
  if (!Array.isArray(definition.usageConstraints) || definition.usageConstraints.length > MAX_CONSTRAINTS) {
    throw new Error('Resolved planner capability constraints are invalid');
  }

  return {
    id,
    functionality: canonicalPlannerText(definition.functionality, MAX_FIELD_CHARS, 'functionality'),
    inputSpecification: canonicalPlannerText(definition.inputSpecification, MAX_FIELD_CHARS, 'input specification'),
    outputSpecification: canonicalPlannerText(definition.outputSpecification, MAX_FIELD_CHARS, 'output specification'),
    usageConstraints: definition.usageConstraints.map((constraint) =>
      canonicalPlannerText(constraint, MAX_CONSTRAINT_CHARS, 'usage constraint'),
    ),
  };
}

function canonicalPlannerText(value: string, maximumChars: number, field: string): string {
  if (typeof value !== 'string') throw new Error(`Resolved planner ${field} must be text`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < 1 || normalized.length > maximumChars || FORBIDDEN_CONTROLS_RE.test(normalized)) {
    throw new Error(`Resolved planner ${field} is invalid`);
  }
  return normalized;
}
