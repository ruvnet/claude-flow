/**
 * Business-pod MCP tools — ADR-164 Phase 2 + Phase 3.
 *
 * Phase 2 surfaces pod-template validation (`business_pod_validate`).
 * Phase 3 adds the domain-affinity routing decision (`business_pod_route_backend`)
 * so any caller (agent, /loop driver, CI workflow) can ask "which backend
 * should @metaharness/router prefer for this pod?" without re-implementing
 * the §3.4 rules. The decision is structural and deterministic — no learned
 * weights, no schedule, just (preferLocalExecution, budgetUsdMonthly).
 *
 * Both tools accept either a pod template *object* or a string *path* to a
 * JSON file. The path form is provided so /loop drivers can avoid loading
 * the template themselves; the object form is for callers that already have
 * the validated template in hand.
 *
 * @module @claude-flow/cli/mcp-tools/business-pod
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

import type { MCPTool } from './types.js';
import {
  validatePodTemplate,
  PodTemplateValidationError,
  KNOWN_AGENT_TYPES,
} from '../business-pods/pod-schema.js';
import {
  selectAgentBackend,
  CLOUD_BUDGET_THRESHOLD_USD,
  type BackendDecision,
} from '../business-pods/domain-affinity-policy.js';

/**
 * Load a pod template from either an in-memory object or a JSON-file path.
 * Returns either the parsed (unvalidated) JSON or an `error` shape suitable
 * for direct return from an MCP handler.
 */
function loadTemplate(
  input: { podTemplate?: unknown; podTemplatePath?: unknown },
): { ok: true; raw: unknown } | { ok: false; error: string; path: string } {
  if (input.podTemplate !== undefined && input.podTemplate !== null) {
    if (typeof input.podTemplate !== 'object' || Array.isArray(input.podTemplate)) {
      return { ok: false, error: 'podTemplate must be a JSON object', path: '/podTemplate' };
    }
    return { ok: true, raw: input.podTemplate };
  }
  if (typeof input.podTemplatePath === 'string' && input.podTemplatePath.length > 0) {
    const abs = isAbsolute(input.podTemplatePath)
      ? input.podTemplatePath
      : resolve(process.cwd(), input.podTemplatePath);
    if (!existsSync(abs)) {
      return { ok: false, error: `pod template file not found: ${abs}`, path: '/podTemplatePath' };
    }
    try {
      const raw = JSON.parse(readFileSync(abs, 'utf-8'));
      return { ok: true, raw };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `failed to parse pod template JSON: ${msg}`, path: '/podTemplatePath' };
    }
  }
  return {
    ok: false,
    error: 'either podTemplate (object) or podTemplatePath (string) must be provided',
    path: '/',
  };
}

export const businessPodTools: MCPTool[] = [
  {
    name: 'business_pod_validate',
    description: 'ADR-164 Phase 2 — Validate a business-pod template JSON against the schema in ADR-164 §3.3 (name, agents[], allowedMcpTools, bench, piiPolicy, budgets, cronSchedule, auditReadView, reservationExpiryMs bounded by ADR-164.1 §3.2). Use when a /loop driver or CI workflow needs to pre-flight a pod template before pod-tick.mjs reaches it — surfacing validation as JSON keeps the optional-dep degraded path clean. Hand-parsing the JSON in the caller is wrong because it skips the JSON-pointer error path and the reservationExpiryMs [5000, 300000] ms bound check that ADR-164.1 mandates. Pair with business_pod_validate -> pod-tick.mjs in the sales-pod smoke contract.',
    category: 'business-pods',
    tags: ['business-pods', 'pod-template', 'validation', 'adr-164', 'adr-164.1'],
    inputSchema: {
      type: 'object',
      properties: {
        podTemplate: {
          type: 'object',
          description: 'The pod template object to validate. Must conform to the PodTemplate interface from ADR-164 §3.3.',
        },
      },
      required: ['podTemplate'],
    },
    handler: async (input) => {
      if (typeof input.podTemplate !== 'object' || input.podTemplate === null) {
        return {
          success: false,
          valid: false,
          error: 'podTemplate must be a JSON object',
          path: '/',
        };
      }
      try {
        const template = validatePodTemplate(input.podTemplate);
        // Lightweight agent-type sanity check — surface unknown types as a
        // warning rather than a hard failure so operators can prototype with
        // not-yet-registered roles. pod-tick.mjs enforces the hard check.
        const unknownAgents = template.agents
          .map((a) => a.agentType)
          .filter((t) => !(KNOWN_AGENT_TYPES as readonly string[]).includes(t));
        return {
          success: true,
          valid: true,
          template,
          warnings: unknownAgents.length > 0
            ? [`unknown agent types (pod-tick.mjs will reject): ${unknownAgents.join(', ')}`]
            : [],
        };
      } catch (err) {
        if (err instanceof PodTemplateValidationError) {
          return {
            success: false,
            valid: false,
            error: err.message,
            path: err.path,
          };
        }
        throw err;
      }
    },
  },
  {
    name: 'business_pod_route_backend',
    description: 'ADR-164 Phase 3 — Compute the domain-affinity routing decision for a business pod per ADR-164 §3.4 and return {backend, reason}. The three backends are local-stdio (preferLocalExecution=true), cloud-managed (preferLocalExecution=false AND budgetUsdMonthly >= 50), and remote-peer (everything else — small-budget non-local pods route through a federation peer node). Use when a /loop driver, @metaharness/router policy hook, or operator CLI needs the structural routing pick BEFORE the cost-optimal KRR step — surfacing this as an MCP tool keeps the rule auditable from the pod template alone and lets non-TS callers reach it. Re-implementing the rule in the caller is wrong because it forks the §3.4 source-of-truth and skips the {success,valid,error,path} envelope shape callers already rely on from business_pod_validate. Pair with business_pod_validate when pre-flighting a template, since this tool also runs full schema validation and degrades to the same error shape on malformed input. Threshold lives in CLOUD_BUDGET_THRESHOLD_USD in domain-affinity-policy.ts — keep that constant and this description aligned.',
    category: 'business-pods',
    tags: ['business-pods', 'pod-template', 'routing', 'domain-affinity', 'adr-164'],
    inputSchema: {
      type: 'object',
      properties: {
        podTemplate: {
          type: 'object',
          description: 'In-memory pod template object. One of podTemplate or podTemplatePath is required.',
        },
        podTemplatePath: {
          type: 'string',
          description: 'Absolute or cwd-relative path to a pod template JSON file. One of podTemplate or podTemplatePath is required.',
        },
      },
    },
    handler: async (input) => {
      const loaded = loadTemplate(input);
      if (!loaded.ok) {
        return {
          success: false,
          valid: false,
          error: loaded.error,
          path: loaded.path,
        };
      }

      let template;
      try {
        template = validatePodTemplate(loaded.raw);
      } catch (err) {
        if (err instanceof PodTemplateValidationError) {
          return {
            success: false,
            valid: false,
            error: err.message,
            path: err.path,
          };
        }
        throw err;
      }

      const decision: BackendDecision = selectAgentBackend(template);
      return {
        success: true,
        valid: true,
        backend: decision.backend,
        reason: decision.reason,
        pod: {
          name: template.name,
          preferLocalExecution: template.preferLocalExecution,
          budgetUsdMonthly: template.budgetUsdMonthly,
        },
      };
    },
  },
];
