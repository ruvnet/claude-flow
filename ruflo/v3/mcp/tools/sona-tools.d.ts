/**
 * V3 MCP SONA Tools
 *
 * MCP tools for Self-Optimizing Neural Architecture (SONA) integration:
 * - sona/trajectory/begin - Start trajectory tracking
 * - sona/trajectory/step - Record step
 * - sona/trajectory/context - Add context
 * - sona/trajectory/end - Complete and trigger learning
 * - sona/trajectory/list - List trajectories
 * - sona/pattern/find - Find similar patterns via HNSW
 * - sona/lora/apply-micro - Apply micro-LoRA adaptation (~0.05ms)
 * - sona/lora/apply-base - Apply base-layer LoRA
 * - sona/force-learn - Force immediate learning cycle
 * - sona/stats - Get SONA statistics
 * - sona/profile/get - Get profile configuration
 * - sona/profile/list - List all profiles
 * - sona/enabled - Enable/disable SONA
 * - sona/benchmark - Performance benchmark
 *
 * Performance Targets:
 * - Micro-LoRA: <0.05ms latency
 * - Pattern Search: 150x-12,500x faster via HNSW
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-001: agentic-flow@alpha compatibility
 */
import { MCPTool } from '../types.js';
export declare const sonaTools: MCPTool[];
export default sonaTools;
//# sourceMappingURL=sona-tools.d.ts.map