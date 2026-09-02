#!/usr/bin/env node
/**
 * V3 Guidance CLI
 *
 * Command-line interface for hooks guidance system.
 * Outputs plain text or JSON that Claude Code hooks can consume.
 *
 * Usage:
 *   npx @claude-flow/hooks session-context
 *   npx @claude-flow/hooks user-prompt "Fix authentication bug"
 *   npx @claude-flow/hooks pre-edit "/path/to/file.ts"
 *   npx @claude-flow/hooks route "Implement caching layer"
 *
 * @module @claude-flow/hooks/cli/guidance-cli
 */

import { GuidanceProvider } from '../reasoningbank/guidance-provider.js';
import { reasoningBank } from '../reasoningbank/index.js';
import { swarmComm } from '../swarm/index.js';
import { readFileSync } from 'fs';

const provider = new GuidanceProvider(reasoningBank);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    await provider.initialize();

    switch (command) {
      case 'session-context':
      case 'session':
        console.log(await provider.generateSessionContext());
        process.exit(0);
        break;

      case 'user-prompt':
      case 'prompt':
        console.log(await provider.generatePromptContext(args[1] || ''));
        process.exit(0);
        break;

      case 'pre-edit':
        console.log(JSON.stringify(await provider.generatePreEditGuidance(args[1] || '')));
        process.exit(0);
        break;

      case 'post-edit': {
        let content: string | undefined;
        try {
          content = readFileSync(args[1], 'utf-8');
        } catch {
          // File might not exist yet
        }
        console.log(JSON.stringify(await provider.generatePostEditFeedback(args[1] || '', content)));
        process.exit(0);
        break;
      }

      case 'pre-command':
        console.log(JSON.stringify(await provider.generatePreCommandGuidance(args[1] || '')));
        process.exit(0);
        break;

      case 'route':
        console.log(await provider.generateRoutingGuidance(args[1] || ''));
        process.exit(0);
        break;

      case 'stop-check': {
        const result = await provider.generateStopCheck();
        if (!result.shouldStop) {
          console.error(result.reason);
          process.exit(2);
        }
        process.exit(0);
        break;
      }

      case 'store': {
        const strategy = args[1] || '';
        const domain = args[2] || 'general';
        const result = await reasoningBank.storePattern(strategy, domain);
        console.log(JSON.stringify(result));
        process.exit(0);
        break;
      }

      case 'search': {
        const query = args[1] || '';
        const k = parseInt(args[2] || '5');
        const results = await reasoningBank.searchPatterns(query, k);
        console.log(JSON.stringify({
          patterns: results.map(r => ({
            id: r.pattern.id,
            strategy: r.pattern.strategy,
            domain: r.pattern.domain,
            similarity: r.similarity,
            quality: r.pattern.quality,
          })),
        }));
        process.exit(0);
        break;
      }

      case 'consolidate': {
        const result = await reasoningBank.consolidate();
        console.log(JSON.stringify(result));
        process.exit(0);
        break;
      }

      case 'stats':
        console.log(JSON.stringify(reasoningBank.getStats()));
        process.exit(0);
        break;

      case 'export': {
        const exported = await reasoningBank.exportPatterns();
        console.log(JSON.stringify({
          shortTermCount: exported.shortTerm.length,
          longTermCount: exported.longTerm.length,
          patterns: [...exported.shortTerm, ...exported.longTerm].map(p => ({
            id: p.id,
            strategy: p.strategy,
            domain: p.domain,
            quality: p.quality,
          })),
        }));
        process.exit(0);
        break;
      }

      // ========================================
      // Swarm Communication Commands
      // ========================================

      case 'swarm-send': {
        const to = args[1] || '*';
        const content = args[2] || '';
        await swarmComm.initialize();
        const msg = await swarmComm.sendMessage(to, content, {
          type: args[3] as any || 'context',
          priority: args[4] as any || 'normal',
        });
        console.log(JSON.stringify(msg));
        process.exit(0);
        break;
      }

      case 'swarm-messages': {
        await swarmComm.initialize();
        const messages = swarmComm.getMessages({
          limit: parseInt(args[1] || '10'),
          type: args[2] as any,
        });
        console.log(JSON.stringify({
          count: messages.length,
          messages: messages.map(m => ({
            id: m.id,
            from: m.from,
            type: m.type,
            content: m.content.substring(0, 100),
            priority: m.priority,
            timestamp: new Date(m.timestamp).toISOString(),
          })),
        }));
        process.exit(0);
        break;
      }

      case 'swarm-broadcast': {
        const content = args[1] || '';
        await swarmComm.initialize();
        const msg = await swarmComm.broadcastContext(content);
        console.log(JSON.stringify({
          id: msg.id,
          to: msg.to,
          broadcast: true,
          timestamp: new Date(msg.timestamp).toISOString(),
        }));
        process.exit(0);
        break;
      }

      case 'swarm-pattern-broadcast': {
        const strategy = args[1] || '';
        const domain = args[2] || 'general';
        await swarmComm.initialize();

        // Store pattern first
        const stored = await reasoningBank.storePattern(strategy, domain);
        const patterns = await reasoningBank.searchPatterns(stored.id, 1);

        if (patterns.length > 0) {
          const broadcast = await swarmComm.broadcastPattern(patterns[0].pattern);
          console.log(JSON.stringify({
            broadcastId: broadcast.id,
            patternId: stored.id,
            strategy: patterns[0].pattern.strategy,
            domain: patterns[0].pattern.domain,
            recipients: broadcast.recipients.length,
          }));
        } else {
          console.log(JSON.stringify({ error: 'Pattern not found after storage' }));
        }
        process.exit(0);
        break;
      }

      case 'swarm-patterns': {
        await swarmComm.initialize();
        const broadcasts = swarmComm.getPatternBroadcasts({
          domain: args[1],
          minQuality: args[2] ? parseFloat(args[2]) : undefined,
        });
        console.log(JSON.stringify({
          count: broadcasts.length,
          broadcasts: broadcasts.map(b => ({
            id: b.id,
            source: b.sourceAgent,
            strategy: b.pattern.strategy,
            domain: b.pattern.domain,
            quality: b.pattern.quality,
            acknowledgments: b.acknowledgments.length,
          })),
        }));
        process.exit(0);
        break;
      }

      case 'swarm-import-pattern': {
        const broadcastId = args[1] || '';
        await swarmComm.initialize();
        const success = await swarmComm.importBroadcastPattern(broadcastId);
        console.log(JSON.stringify({ broadcastId, imported: success }));
        process.exit(success ? 0 : 1);
        break;
      }

      case 'swarm-consensus': {
        const question = args[1] || '';
        const optionsStr = args[2] || '';
        const timeout = args[3] ? parseInt(args[3]) : undefined;

        const options = optionsStr.split(',').map(o => o.trim()).filter(Boolean);
        if (options.length < 2) {
          console.error('Error: Consensus requires at least 2 options (comma-separated)');
          process.exit(1);
        }

        await swarmComm.initialize();
        const consensus = await swarmComm.initiateConsensus(question, options, timeout);
        console.log(JSON.stringify({
          consensusId: consensus.id,
          question: consensus.question,
          options: consensus.options,
          deadline: new Date(consensus.deadline).toISOString(),
          status: consensus.status,
        }));
        process.exit(0);
        break;
      }

      case 'swarm-vote': {
        const consensusId = args[1] || '';
        const vote = args[2] || '';
        await swarmComm.initialize();
        const success = swarmComm.voteConsensus(consensusId, vote);
        console.log(JSON.stringify({ consensusId, vote, accepted: success }));
        process.exit(success ? 0 : 1);
        break;
      }

      case 'swarm-consensus-status': {
        const consensusId = args[1] || '';
        await swarmComm.initialize();

        if (consensusId) {
          const consensus = swarmComm.getConsensus(consensusId);
          if (consensus) {
            console.log(swarmComm.generateConsensusGuidance(consensusId));
          } else {
            console.error(`Consensus ${consensusId} not found`);
            process.exit(1);
          }
        } else {
          const pending = swarmComm.getPendingConsensus();
          console.log(JSON.stringify({
            pendingCount: pending.length,
            requests: pending.map(r => ({
              id: r.id,
              question: r.question,
              votes: r.votes.size,
              deadline: new Date(r.deadline).toISOString(),
            })),
          }));
        }
        process.exit(0);
        break;
      }

      case 'swarm-handoff': {
        const toAgent = args[1] || '';
        const description = args[2] || '';
        const contextJson = args[3];

        let context = {
          filesModified: [] as string[],
          patternsUsed: [] as string[],
          decisions: [] as string[],
          blockers: [] as string[],
          nextSteps: [] as string[],
        };

        if (contextJson) {
          try {
            context = { ...context, ...JSON.parse(contextJson) };
          } catch {
            console.error('Error: Invalid context JSON');
            process.exit(1);
          }
        }

        await swarmComm.initialize();
        const handoff = await swarmComm.initiateHandoff(toAgent, description, context);
        console.log(JSON.stringify({
          handoffId: handoff.id,
          toAgent: handoff.toAgent,
          description: handoff.description,
          status: handoff.status,
        }));
        process.exit(0);
        break;
      }

      case 'swarm-accept-handoff': {
        const handoffId = args[1] || '';
        await swarmComm.initialize();
        const success = swarmComm.acceptHandoff(handoffId);

        if (success) {
          console.log(swarmComm.generateHandoffContext(handoffId));
        } else {
          console.error(`Failed to accept handoff ${handoffId}`);
        }
        process.exit(success ? 0 : 1);
        break;
      }

      case 'swarm-complete-handoff': {
        const handoffId = args[1] || '';
        const resultJson = args[2];

        let result: Record<string, unknown> | undefined;
        if (resultJson) {
          try {
            result = JSON.parse(resultJson);
          } catch {
            console.error('Error: Invalid result JSON');
            process.exit(1);
          }
        }

        await swarmComm.initialize();
        const success = swarmComm.completeHandoff(handoffId, result);
        console.log(JSON.stringify({ handoffId, completed: success }));
        process.exit(success ? 0 : 1);
        break;
      }

      case 'swarm-handoffs': {
        await swarmComm.initialize();
        const handoffs = swarmComm.getPendingHandoffs();
        console.log(JSON.stringify({
          pendingCount: handoffs.length,
          handoffs: handoffs.map(h => ({
            id: h.id,
            from: h.fromAgent,
            description: h.description,
            status: h.status,
            timestamp: new Date(h.timestamp).toISOString(),
          })),
        }));
        process.exit(0);
        break;
      }

      case 'swarm-agents': {
        await swarmComm.initialize();
        const agents = swarmComm.getAgents();
        console.log(JSON.stringify({
          count: agents.length,
          agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            status: a.status,
            patternsShared: a.patternsShared,
            handoffsReceived: a.handoffsReceived,
            handoffsCompleted: a.handoffsCompleted,
          })),
        }));
        process.exit(0);
        break;
      }

      case 'swarm-stats': {
        await swarmComm.initialize();
        const stats = swarmComm.getStats();
        console.log(JSON.stringify(stats, null, 2));
        process.exit(0);
        break;
      }

      case 'help':
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Use --help for usage information');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
@claude-flow/hooks - V3 Guidance System CLI

Usage: npx @claude-flow/hooks <command> [args]

Guidance Commands (for Claude hooks):
  session-context           Output project context for SessionStart hook
  user-prompt <prompt>      Analyze prompt and inject relevant guidance
  pre-edit <path>           Validate and guide before file edit
  post-edit <path>          Provide feedback after file edit
  pre-command <cmd>         Risk assessment for bash commands
  route <task>              Suggest optimal agent for task
  stop-check                Verify work complete before stopping

Pattern Management:
  store <strategy> [domain] Store a new pattern
  search <query> [k]        Search for similar patterns
  consolidate               Deduplicate and promote patterns
  stats                     Get learning statistics
  export                    Export all patterns

Swarm Communication:
  swarm-send <to> <content> [type] [priority]
                            Send message to agent (* for broadcast)
  swarm-messages [limit] [type]
                            Get messages for this agent
  swarm-broadcast <content> Broadcast context to all agents

Pattern Broadcasting:
  swarm-pattern-broadcast <strategy> [domain]
                            Store and broadcast a pattern to swarm
  swarm-patterns [domain] [minQuality]
                            List recent pattern broadcasts
  swarm-import-pattern <broadcastId>
                            Import a broadcast pattern locally

Consensus Guidance:
  swarm-consensus <question> <options> [timeout]
                            Initiate consensus (options: comma-separated)
  swarm-vote <consensusId> <vote>
                            Vote on a consensus request
  swarm-consensus-status [consensusId]
                            Get consensus status/guidance

Task Handoff:
  swarm-handoff <toAgent> <description> [contextJson]
                            Initiate task handoff to another agent
  swarm-accept-handoff <handoffId>
                            Accept a pending handoff
  swarm-complete-handoff <handoffId> [resultJson]
                            Mark handoff as completed
  swarm-handoffs            List pending handoffs

Swarm Status:
  swarm-agents              List registered agents
  swarm-stats               Get swarm communication statistics

Exit Codes:
  0 - Success (stdout added as context for Claude)
  2 - Block (stderr shown to Claude as reason)
  1 - Error

Examples:
  # Session start guidance
  npx @claude-flow/hooks session-context

  # User prompt analysis
  npx @claude-flow/hooks user-prompt "Fix authentication security vulnerability"

  # Pre-edit security check
  npx @claude-flow/hooks pre-edit "src/auth/login.ts"

  # Agent routing
  npx @claude-flow/hooks route "Implement HNSW vector search"

  # Store a learned pattern
  npx @claude-flow/hooks store "Use dependency injection for testability" architecture

  # Broadcast pattern to swarm
  npx @claude-flow/hooks swarm-pattern-broadcast "Use HNSW for 150x faster search" memory

  # Initiate consensus
  npx @claude-flow/hooks swarm-consensus "Which auth method?" "JWT,OAuth2,Session"

  # Hand off task
  npx @claude-flow/hooks swarm-handoff security-auditor "Review auth implementation"
`);
}

main().catch(console.error);
