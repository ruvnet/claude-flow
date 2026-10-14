/** Bounded execution evidence for agent_health. Registry records are not processes. */
export interface AgentExecutionSample {
  at: string;
  success: boolean;
  durationMs: number;
}

export const AGENT_HEALTH_WINDOW = 20;

function validSamples(value: unknown): AgentExecutionSample[] {
  if (!Array.isArray(value)) return [];
  return value.filter((sample): sample is AgentExecutionSample =>
    sample !== null && typeof sample === 'object' &&
    typeof sample.at === 'string' && typeof sample.success === 'boolean' &&
    typeof sample.durationMs === 'number' && Number.isFinite(sample.durationMs) && sample.durationMs >= 0,
  ).slice(-AGENT_HEALTH_WINDOW);
}

export function appendAgentExecution(value: unknown, sample: AgentExecutionSample): AgentExecutionSample[] {
  return [...validSamples(value), sample].slice(-AGENT_HEALTH_WINDOW);
}

export function summarizeAgentExecutions(value: unknown) {
  const samples = validSamples(value);
  const sampleCount = samples.length;
  const successes = samples.filter(sample => sample.success).length;
  const failures = sampleCount - successes;
  const durations = samples.map(sample => sample.durationMs).sort((a, b) => a - b);
  const percentile = (p: number): number | null =>
    sampleCount ? durations[Math.ceil(p * sampleCount) - 1] : null;
  return {
    health: sampleCount ? successes / sampleCount : null,
    errorRate: sampleCount ? failures / sampleCount : null,
    sampleCount,
    successes,
    failures,
    latency: {
      avg: sampleCount ? durations.reduce((sum, duration) => sum + duration, 0) / sampleCount : null,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
  };
}
