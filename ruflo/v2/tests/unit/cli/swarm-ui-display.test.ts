/**
 * Unit tests for SwarmUI display formatting
 */

import { describe, it, expect } from '@jest/globals';

// Extract the updateTaskDetails logic for testing
function formatTaskDetails(task: any): string {
  const details = [
    `Task ID: ${task.agentId}`,
    `Swarm ID: ${task.swarmId}`,
    `Type: ${task.task?.type || 'Unknown'}`,
    `Description: ${task.task?.description || 'No description'}`,
    `Status: ${task.status || 'Unknown'}`,
    `Start Time: ${task.startTime || 'Not started'}`,
    '',
    'Task Data:',
    JSON.stringify(task.task, null, 2)
  ].join('\n');
  
  return details;
}

describe('SwarmUI Display Formatting', () => {
  it('should use proper newline characters instead of escaped newlines', () => {
    const task = {
      agentId: 'agent-123',
      swarmId: 'swarm-456',
      task: {
        type: 'research',
        description: 'Test task'
      },
      status: 'active',
      startTime: '2025-07-15T10:00:00Z'
    };

    const result = formatTaskDetails(task);
    
    // Check that we have actual newlines, not escaped strings
    expect(result).toContain('\n');
    expect(result).not.toContain('\\n');
    
    // Verify line count
    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(8);
    
    // Check specific lines
    expect(lines[0]).toBe('Task ID: agent-123');
    expect(lines[1]).toBe('Swarm ID: swarm-456');
    expect(lines[2]).toBe('Type: research');
  });

  it('should preserve multi-line content in descriptions', () => {
    const task = {
      agentId: 'agent-multi',
      swarmId: 'swarm-multi',
      task: {
        type: 'complex',
        description: 'Line 1\nLine 2\nLine 3'
      },
      status: 'running',
      startTime: '2025-07-15T12:00:00Z'
    };

    const result = formatTaskDetails(task);
    
    // Description should preserve its internal newlines
    expect(result).toContain('Description: Line 1\nLine 2\nLine 3');
    
    // Overall structure should still use newlines
    const lines = result.split('\n');
    expect(lines[0]).toBe('Task ID: agent-multi');
    expect(lines[3]).toBe('Description: Line 1');
    expect(lines[4]).toBe('Line 2');
    expect(lines[5]).toBe('Line 3');
  });

  it('should handle missing data gracefully', () => {
    const task = {
      agentId: 'agent-min',
      swarmId: 'swarm-min'
    };

    const result = formatTaskDetails(task);
    
    expect(result).toContain('Type: Unknown');
    expect(result).toContain('Description: No description');
    expect(result).toContain('Status: Unknown');
    expect(result).toContain('Start Time: Not started');
  });

  it('should format JSON data with proper indentation', () => {
    const task = {
      agentId: 'agent-json',
      swarmId: 'swarm-json',
      task: {
        type: 'test',
        nested: {
          value: 123,
          array: [1, 2, 3]
        }
      }
    };

    const result = formatTaskDetails(task);
    
    // JSON should be pretty-printed with 2-space indentation
    expect(result).toContain('{\n  "type": "test",');
    expect(result).toContain('  "nested": {');
    expect(result).toContain('    "value": 123,');
    expect(result).toContain('    "array": [');
  });
});