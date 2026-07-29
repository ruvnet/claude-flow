import { bench, describe } from 'vitest';
import {
  buildCapabilityBrain,
  CAPABILITY_DOMAINS,
  recommendCapabilities,
} from '../src/mcp-tools/capability-brain.js';

const prefixes = CAPABILITY_DOMAINS
  .filter((domain) => domain.id !== 'runtime-services')
  .flatMap((domain) => domain.prefixes)
  .filter(Boolean);

const maximumRegistry = Array.from({ length: 353 }, (_, index) => ({
  name: `${prefixes[index % prefixes.length]}benchmark-${String(index).padStart(3, '0')}`,
  description: `Synthetic maximum-registry tool ${index}`,
  category: 'benchmark',
}));

const brain = buildCapabilityBrain(maximumRegistry);

describe('capability brain maximum live registry', () => {
  bench('build 353-tool capability brain', () => {
    buildCapabilityBrain(maximumRegistry);
  });

  bench('recommend from 353-tool capability brain', () => {
    recommendCapabilities(
      brain,
      'Implement secure claim federation with concurrent agents, tests, benchmarks, and release validation',
    );
  });
});
