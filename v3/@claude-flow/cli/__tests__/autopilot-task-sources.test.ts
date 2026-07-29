import { describe, expect, it } from 'vitest';
import {
  validateConfiguredTaskSources,
  validateTaskSources,
} from '../src/autopilot-state.js';

describe('autopilot task-source validation', () => {
  it('keeps recovery defaults for absent persisted state', () => {
    expect(validateTaskSources(undefined)).toEqual([
      'team-tasks',
      'swarm-tasks',
      'file-checklist',
    ]);
  });

  it('rejects an unsupported explicit source instead of enabling defaults', () => {
    expect(validateConfiguredTaskSources(['issues'])).toEqual({
      valid: false,
      invalidSources: ['issues'],
      reason: 'Unsupported task source(s): issues',
    });
  });

  it('rejects a mixed configuration instead of silently dropping invalid entries', () => {
    expect(validateConfiguredTaskSources(['swarm-tasks', 'issues'])).toEqual({
      valid: false,
      invalidSources: ['issues'],
      reason: 'Unsupported task source(s): issues',
    });
  });

  it('normalizes and deduplicates valid explicit sources', () => {
    expect(validateConfiguredTaskSources([' swarm-tasks ', 'file-checklist', 'swarm-tasks'])).toEqual({
      valid: true,
      sources: ['swarm-tasks', 'file-checklist'],
    });
  });

  it('rejects an empty explicit source list', () => {
    expect(validateConfiguredTaskSources([])).toMatchObject({
      valid: false,
      reason: 'At least one task source is required',
    });
  });
});
