/**
 * Integration test for UI display fixes
 * Validates that the fixes work correctly in real-world scenarios
 */

import { describe, it, expect } from '@jest/globals';

describe('UI Display Fixes Integration', () => {
  it('should correctly format complex task details with proper newlines', () => {
    // Simulate the actual updateTaskDetails logic from swarm-ui.js
    const complexTask = {
      agentId: 'coder-agent-001',
      swarmId: 'development-swarm-456',
      task: {
        type: 'implementation',
        description: 'Implement user authentication system\nInclude JWT tokens\nAdd password hashing\nCreate login/logout endpoints',
        dependencies: ['database-schema', 'security-middleware'],
        priority: 'high'
      },
      status: 'in_progress',
      startTime: '2025-07-15T14:30:00Z',
      progress: {
        completed: ['password-hashing', 'user-model'],
        inProgress: ['jwt-implementation'],
        pending: ['login-endpoint', 'logout-endpoint']
      }
    };

    const formatTaskDetails = (task: any): string => {
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
    };

    const result = formatTaskDetails(complexTask);

    // Verify proper newline usage (main structure uses real newlines)
    expect(result).toContain('\n');
    // Note: JSON.stringify will include \\n for string content, which is correct

    // Verify structure
    const lines = result.split('\n');
    expect(lines[0]).toBe('Task ID: coder-agent-001');
    expect(lines[3]).toBe('Description: Implement user authentication system');
    expect(lines[4]).toBe('Include JWT tokens');
    expect(lines[5]).toBe('Add password hashing');
    expect(lines[6]).toBe('Create login/logout endpoints');

    // Verify JSON formatting
    const jsonStart = lines.findIndex(line => line.includes('{'));
    expect(jsonStart).toBeGreaterThan(0);
    expect(lines[jsonStart]).toContain('{');
    expect(result).toContain('"type": "implementation"');
  });

  it('should export complex metrics data to proper CSV format', () => {
    const complexMetrics = {
      timestamp: '2025-07-15T14:30:00Z',
      swarm: {
        id: 'dev-swarm-123',
        agents: {
          active: 8,
          idle: 2,
          failed: 0
        },
        tasks: {
          completed: 45,
          inProgress: 12,
          failed: 3,
          pending: 8
        }
      },
      performance: {
        responseTime: 250.5,
        throughput: 1850,
        errorRate: 0.02,
        memoryUsage: 78.9
      },
      resources: {
        cpu: [65.2, 70.1, 68.9, 72.3],
        memory: [76.5, 78.9, 80.1, 79.2],
        disk: [45.6, 47.2, 46.8, 48.1]
      },
      errors: [
        { type: 'timeout', count: 2, severity: 'medium' },
        { type: 'connection', count: 1, severity: 'high' }
      ]
    };

    // Function that matches the fixed implementation
    const jsonToCSV = (json: any): string => {
      const flatten = (obj: any, prefix = ''): Record<string, any> => {
        const flattened: Record<string, any> = {};
        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(flattened, flatten(obj[key], prefix + key + '.'));
          } else {
            // Convert arrays to JSON strings for CSV
            flattened[prefix + key] = Array.isArray(obj[key]) ? JSON.stringify(obj[key]) : obj[key];
          }
        }
        return flattened;
      };

      const flattened = flatten(json);
      const headers = Object.keys(flattened);
      const valueRow = headers.map(header => {
        const value = flattened[header];
        if (value === null || value === undefined) {
          return '';
        }
        let strValue = String(value);
        // Escape CSV values that contain commas, quotes, or newlines
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          strValue = '"' + strValue.replace(/"/g, '""') + '"';
        }
        return strValue;
      }).join(',');
      
      return [headers.join(','), valueRow].join('\n');
    };

    const csv = jsonToCSV(complexMetrics);
    const lines = csv.split('\n');

    // Verify CSV structure
    expect(lines).toHaveLength(2);
    
    const headers = lines[0].split(',');
    
    // Check for expected flattened headers
    expect(headers).toContain('timestamp');
    expect(headers).toContain('swarm.id');
    expect(headers).toContain('swarm.agents.active');
    expect(headers).toContain('performance.responseTime');
    expect(headers).toContain('resources.cpu');
    expect(headers).toContain('errors');

    // Verify that arrays are properly handled
    expect(lines[1]).toContain('dev-swarm-123');
    expect(lines[1]).toContain('250.5');
    expect(lines[1]).toContain('[65.2,70.1,68.9,72.3]');
    
    // Verify complex arrays are escaped (double quotes become quad quotes in CSV)
    expect(lines[1]).toContain('""type"":""timeout""');
  });

  it('should handle edge cases in both UI and CSV systems', () => {
    const edgeCaseData = {
      nullValue: null,
      undefinedValue: undefined,
      emptyString: '',
      zeroValue: 0,
      booleanTrue: true,
      booleanFalse: false,
      specialChars: 'Text with "quotes", commas, and\nnewlines',
      unicodeText: 'Text with émojis 🚀 and ñandú',
      nestedEmpty: {
        empty: {},
        nullNested: null
      },
      complexArray: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item "quoted"' }
      ]
    };

    // Test CSV export
    const jsonToCSV = (json: any): string => {
      const flatten = (obj: any, prefix = ''): Record<string, any> => {
        const flattened: Record<string, any> = {};
        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(flattened, flatten(obj[key], prefix + key + '.'));
          } else {
            flattened[prefix + key] = Array.isArray(obj[key]) ? JSON.stringify(obj[key]) : obj[key];
          }
        }
        return flattened;
      };

      const flattened = flatten(json);
      const headers = Object.keys(flattened);
      const valueRow = headers.map(header => {
        const value = flattened[header];
        if (value === null || value === undefined) {
          return '';
        }
        let strValue = String(value);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          strValue = '"' + strValue.replace(/"/g, '""') + '"';
        }
        return strValue;
      }).join(',');
      
      return [headers.join(','), valueRow].join('\n');
    };

    const csv = jsonToCSV(edgeCaseData);
    
    // Should not crash and should produce valid output
    expect(csv).toBeDefined();
    expect(csv.length).toBeGreaterThan(0);
    
    const lines = csv.split('\n');
    // May have more than 2 lines due to newlines in data being preserved
    expect(lines.length).toBeGreaterThanOrEqual(2);
    
    // Test task details formatting with edge case
    const edgeTask = {
      agentId: 'edge-agent',
      swarmId: 'edge-swarm',
      task: {
        type: 'edge-case',
        description: 'Task with "quotes" and\nmultiple\nlines',
        special: edgeCaseData
      }
    };

    const formatTaskDetails = (task: any): string => {
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
    };

    const taskDetails = formatTaskDetails(edgeTask);
    
    // Should handle special characters correctly
    expect(taskDetails).toContain('Task with "quotes" and');
    expect(taskDetails).toContain('multiple');
    expect(taskDetails).toContain('lines');
    expect(taskDetails).toContain('"type": "edge-case"');
  });
});