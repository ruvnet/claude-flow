/**
 * Business-pod MCP tools — ADR-164 Phase 2.
 *
 * Surfaces pod-template validation as an MCP tool so any caller (agent,
 * /loop driver, CI workflow) can pre-flight a pod JSON before passing it to
 * `pod-tick.mjs`. Schema lives in `business-pods/pod-schema.ts`; this file
 * is a thin MCP wrapper that returns structured success/error rather than
 * throwing across the JSON-RPC boundary.
 *
 * @module @claude-flow/cli/mcp-tools/business-pod
 */

import type { MCPTool } from './types.js';
import {
  validatePodTemplate,
  PodTemplateValidationError,
  KNOWN_AGENT_TYPES,
} from '../business-pods/pod-schema.js';

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
];
