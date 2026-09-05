/**
 * @claude-flow/browser - Signed Trajectory MCP Tools (ADR-122 Phase 1)
 *
 * Exposes seal/verify/plan-replay/build-delta over MCP so agents can produce
 * and consume signed browser-session artifacts as portable, verifiable units.
 */

import {
  sealTrajectory,
  verifySealedTrajectory,
  writeSealedTrajectory,
  readSealedTrajectory,
  planReplay,
  buildReplayDelta,
} from '../application/signed-trajectory-service.js';
import { generateWitnessKey, loadWitnessKey } from '../infrastructure/witness-signer.js';
import type { BrowserTrajectory } from '../domain/types.js';
import type {
  SignedTrajectoryEnvelope,
  ReplayMutation,
} from '../domain/signed-trajectory.js';
import type { MCPTool } from './browser-tools.js';

function decodeScreenshots(input: unknown): Record<string, Buffer> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, Buffer> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    // Permit either base64 or raw text — base64 first, fall back to utf-8 bytes.
    try {
      out[k] = Buffer.from(v, 'base64');
      // Sanity check: if decode produced empty buffer for non-empty input, fall back.
      if (out[k].length === 0 && v.length > 0) out[k] = Buffer.from(v, 'utf8');
    } catch {
      out[k] = Buffer.from(v, 'utf8');
    }
  }
  return out;
}

export const signedTrajectoryTools: MCPTool[] = [
  {
    name: 'browser/sign-trajectory',
    description:
      'Seal a BrowserTrajectory into an Ed25519-signed envelope (ADR-122 Phase 1). Returns the envelope JSON. Optional `outputPath` writes to disk. Forging any field of the returned envelope breaks verification.',
    category: 'browser-trajectory',
    inputSchema: {
      type: 'object',
      properties: {
        trajectory: { type: 'object', description: 'BrowserTrajectory to seal' },
        projectId: { type: 'string', description: 'Project / installation ID embedded in the envelope (federation trust boundary)' },
        screenshots: {
          type: 'object',
          description: 'Map of step-id → base64 screenshot bytes. SHA-256 hashes are sealed into the envelope.',
          additionalProperties: { type: 'string' },
        },
        outputPath: { type: 'string', description: 'If set, write the signed envelope to this path' },
        privateKeyPem: { type: 'string', description: 'Optional Ed25519 PEM private key (else env RUFLO_BROWSER_WITNESS_KEY or ephemeral)' },
        parentTrajectoryId: { type: 'string', description: 'If this is a replay-delta, the parent trajectory ID' },
      },
      required: ['trajectory'],
    },
    handler: async (input) => {
      const trajectory = input.trajectory as BrowserTrajectory;
      const witnessKey = input.privateKeyPem ? loadWitnessKey(input.privateKeyPem as string) : undefined;
      const sealed = sealTrajectory({
        trajectory,
        projectId: input.projectId as string | undefined,
        screenshots: decodeScreenshots(input.screenshots),
        witnessKey,
        parentTrajectoryId: input.parentTrajectoryId as string | undefined,
      });
      if (input.outputPath) {
        await writeSealedTrajectory(sealed.envelope, input.outputPath as string);
      }
      return {
        success: true,
        envelope: sealed.envelope,
        publicKey: sealed.publicKeyHex,
        outputPath: input.outputPath ?? null,
      };
    },
  },
  {
    name: 'browser/verify-trajectory',
    description:
      'Verify a signed trajectory envelope. Either pass the envelope inline or a path. Returns valid/reason/publicKey. Optional `trustedPublicKeys` restricts accepted signers (federation trust boundary).',
    category: 'browser-trajectory',
    inputSchema: {
      type: 'object',
      properties: {
        envelope: { type: 'object', description: 'Signed envelope to verify' },
        path: { type: 'string', description: 'Path to a signed envelope on disk (alternative to envelope)' },
        trustedPublicKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of Ed25519 public-key hex strings allowed as signers',
        },
      },
    },
    handler: async (input) => {
      let envelope: unknown = input.envelope;
      if (!envelope && input.path) {
        envelope = await readSealedTrajectory(input.path as string);
      }
      if (!envelope) {
        return { success: false, error: 'must provide either envelope or path' };
      }
      const result = verifySealedTrajectory(envelope, {
        trustedPublicKeys: input.trustedPublicKeys as string[] | undefined,
      });
      return { success: true, ...result };
    },
  },
  {
    name: 'browser/plan-replay',
    description:
      'Plan a replay from a signed envelope with optional mutations (replaceStepInput / skipSteps / goal override). Does not execute the browser — produces an inspectable step plan for dry-run or downstream execution.',
    category: 'browser-trajectory',
    inputSchema: {
      type: 'object',
      properties: {
        envelope: { type: 'object', description: 'Signed envelope to plan from' },
        path: { type: 'string', description: 'Path to signed envelope on disk (alternative to envelope)' },
        mutations: {
          type: 'object',
          description: 'Replay mutations',
          properties: {
            replaceStepInput: {
              type: 'object',
              description: 'Map of step-index → replacement-input fields',
              additionalProperties: { type: 'object' },
            },
            skipSteps: {
              type: 'array',
              items: { type: 'number' },
              description: 'Step indexes to skip',
            },
            goal: { type: 'string', description: 'Override the trajectory goal (informational)' },
          },
        },
        requireValid: { type: 'boolean', description: 'Refuse to plan if signature is invalid (default: true)' },
      },
    },
    handler: async (input) => {
      let envelope: SignedTrajectoryEnvelope | undefined;
      if (input.envelope) envelope = input.envelope as SignedTrajectoryEnvelope;
      else if (input.path) envelope = await readSealedTrajectory(input.path as string);
      if (!envelope) return { success: false, error: 'must provide either envelope or path' };

      const requireValid = input.requireValid !== false;
      if (requireValid) {
        const verification = verifySealedTrajectory(envelope);
        if (!verification.valid) {
          return {
            success: false,
            error: 'cannot plan replay from invalid envelope: ' + verification.reason,
            verification,
          };
        }
      }

      const plan = planReplay(envelope, (input.mutations ?? {}) as ReplayMutation);
      return { success: true, plan };
    },
  },
  {
    name: 'browser/build-replay-delta',
    description:
      'Compute the delta between an original signed trajectory and a fresh replay trajectory. Detects action drift, outcome drift, and missing/extra steps — foundation for visual-regression CI gates.',
    category: 'browser-trajectory',
    inputSchema: {
      type: 'object',
      properties: {
        envelope: { type: 'object', description: 'Original signed envelope' },
        path: { type: 'string', description: 'Path to original signed envelope (alternative to envelope)' },
        newTrajectory: { type: 'object', description: 'Fresh trajectory produced by replay' },
      },
      required: ['newTrajectory'],
    },
    handler: async (input) => {
      let envelope: SignedTrajectoryEnvelope | undefined;
      if (input.envelope) envelope = input.envelope as SignedTrajectoryEnvelope;
      else if (input.path) envelope = await readSealedTrajectory(input.path as string);
      if (!envelope) return { success: false, error: 'must provide either envelope or path' };

      const delta = buildReplayDelta(envelope, input.newTrajectory as BrowserTrajectory);
      return { success: true, delta };
    },
  },
  {
    name: 'browser/generate-witness-key',
    description:
      'Generate a fresh Ed25519 witness keypair for signing trajectories. Returns publicKeyHex + PEM-encoded private key. Store the private key securely (e.g. RUFLO_BROWSER_WITNESS_KEY env var).',
    category: 'browser-trajectory',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const key = generateWitnessKey();
      const privateKeyPem = key.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const publicKeyPem = key.publicKey.export({ format: 'pem', type: 'spki' }).toString();
      return {
        success: true,
        publicKeyHex: key.publicKeyHex,
        privateKeyPem,
        publicKeyPem,
        envVarHint: 'set RUFLO_BROWSER_WITNESS_KEY to the privateKeyPem value',
      };
    },
  },
];
