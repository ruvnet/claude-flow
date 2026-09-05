/**
 * Discriminative routing-pattern learner (#2839).
 *
 * Outcomes are labelled by the agent that actually completed the task. The
 * previous implementation collapsed every successful task for an agent into
 * one insertion-ordered Set and kept the first 50 words forever. This module
 * ranks terms by within-agent support, cross-agent rarity, outcome quality,
 * and discriminative share. Generic terms therefore lose to stable,
 * agent-specific evidence, and later outcomes can replace earlier noise.
 */

export interface LearnedRoutingOutcome {
  task: string;
  agent: string;
  success: boolean;
  quality: number;
  keywords: string[];
  timestamp: string;
}

export interface LearnedRoutingPattern {
  keywords: string[];
  agents: string[];
  source: 'learned';
  support: number;
  reliability: number;
}

export interface LearnedRoutingOptions {
  maxKeywords?: number;
  minAgentOutcomes?: number;
  minKeywordSupport?: number;
  minOutcomeQuality?: number;
  minDiscriminativeShare?: number;
}

interface KeywordEvidence {
  support: number;
  qualityTotal: number;
}

const finiteUnit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function buildLearnedRoutingPatterns(
  outcomes: LearnedRoutingOutcome[],
  options: LearnedRoutingOptions = {},
): Record<string, LearnedRoutingPattern> {
  const maxKeywords = Math.max(1, Math.min(options.maxKeywords ?? 50, 100));
  const minAgentOutcomes = Math.max(1, options.minAgentOutcomes ?? 2);
  const minKeywordSupport = Math.max(1, options.minKeywordSupport ?? 2);
  const minOutcomeQuality = finiteUnit(options.minOutcomeQuality ?? 0.65);
  const minDiscriminativeShare = finiteUnit(options.minDiscriminativeShare ?? 0.6);

  const accepted = outcomes.filter((outcome) =>
    outcome.success
    && typeof outcome.agent === 'string'
    && outcome.agent.length > 0
    && finiteUnit(outcome.quality) >= minOutcomeQuality
    && Array.isArray(outcome.keywords)
    && outcome.keywords.length > 0
  );
  const agents = [...new Set(accepted.map((outcome) => outcome.agent))].sort();
  if (agents.length === 0) return {};

  const agentOutcomes = new Map<string, LearnedRoutingOutcome[]>();
  const evidence = new Map<string, Map<string, KeywordEvidence>>();
  const globalSupport = new Map<string, number>();
  const agentDocumentFrequency = new Map<string, number>();

  for (const agent of agents) {
    const rows = accepted.filter((outcome) => outcome.agent === agent);
    agentOutcomes.set(agent, rows);
    const perKeyword = new Map<string, KeywordEvidence>();
    for (const row of rows) {
      const unique = new Set(row.keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean));
      for (const keyword of unique) {
        const current = perKeyword.get(keyword) ?? { support: 0, qualityTotal: 0 };
        current.support++;
        current.qualityTotal += finiteUnit(row.quality);
        perKeyword.set(keyword, current);
        globalSupport.set(keyword, (globalSupport.get(keyword) ?? 0) + 1);
      }
    }
    evidence.set(agent, perKeyword);
    for (const keyword of perKeyword.keys()) {
      agentDocumentFrequency.set(keyword, (agentDocumentFrequency.get(keyword) ?? 0) + 1);
    }
  }

  const patterns: Record<string, LearnedRoutingPattern> = {};
  for (const agent of agents) {
    const rows = agentOutcomes.get(agent) ?? [];
    if (rows.length < minAgentOutcomes) continue;
    const ranked = [...(evidence.get(agent) ?? new Map()).entries()]
      .filter(([, item]) => item.support >= minKeywordSupport)
      .map(([keyword, item]) => {
        const totalSupport = globalSupport.get(keyword) ?? item.support;
        const discriminativeShare = item.support / Math.max(1, totalSupport);
        const documentFrequency = agentDocumentFrequency.get(keyword) ?? 1;
        const idf = Math.log(1 + agents.length / documentFrequency);
        const withinAgentSupport = item.support / rows.length;
        const meanQuality = item.qualityTotal / item.support;
        return {
          keyword,
          discriminativeShare,
          score: withinAgentSupport * meanQuality * idf * discriminativeShare,
        };
      })
      .filter((item) => item.discriminativeShare >= minDiscriminativeShare)
      .sort((a, b) => b.score - a.score || a.keyword.localeCompare(b.keyword))
      .slice(0, maxKeywords);
    if (ranked.length === 0) continue;
    patterns[`learned-${agent}`] = {
      keywords: ranked.map((item) => item.keyword),
      agents: [agent],
      source: 'learned',
      support: rows.length,
      reliability: rows.reduce((sum, row) => sum + finiteUnit(row.quality), 0) / rows.length,
    };
  }
  return patterns;
}
