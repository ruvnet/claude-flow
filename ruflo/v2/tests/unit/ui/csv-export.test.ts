/**
 * Unit tests for CSV export functionality
 */

import { describe, it, expect } from '@jest/globals';

// Extract the jsonToCSV logic for testing
function jsonToCSV(json: any): string {
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
}

describe('CSV Export Functionality', () => {
  it('should align headers with values in correct order', () => {
    const data = {
      name: 'Agent A',
      status: 'active',
      score: 95
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    expect(lines).toHaveLength(2);
    
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    
    expect(headers).toEqual(['name', 'status', 'score']);
    expect(values).toEqual(['Agent A', 'active', '95']);
    
    // Verify alignment - each header should correspond to its value
    headers.forEach((header, index) => {
      const expectedValue = String(data[header as keyof typeof data]);
      expect(values[index]).toBe(expectedValue);
    });
  });

  it('should handle nested objects with dot notation', () => {
    const data = {
      agent: {
        id: '123',
        type: 'coder'
      },
      metrics: {
        cpu: 45.5,
        memory: 256
      }
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    
    // Check flattened headers
    expect(headers).toContain('agent.id');
    expect(headers).toContain('agent.type');
    expect(headers).toContain('metrics.cpu');
    expect(headers).toContain('metrics.memory');
    
    // Verify values match their headers
    const idIndex = headers.indexOf('agent.id');
    const typeIndex = headers.indexOf('agent.type');
    const cpuIndex = headers.indexOf('metrics.cpu');
    const memIndex = headers.indexOf('metrics.memory');
    
    expect(values[idIndex]).toBe('123');
    expect(values[typeIndex]).toBe('coder');
    expect(values[cpuIndex]).toBe('45.5');
    expect(values[memIndex]).toBe('256');
  });

  it('should handle null and undefined values as empty strings', () => {
    const data = {
      id: 'test-1',
      name: null,
      value: undefined,
      status: 'active',
      count: 0
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    
    const nameIndex = headers.indexOf('name');
    const valueIndex = headers.indexOf('value');
    const countIndex = headers.indexOf('count');
    
    expect(values[nameIndex]).toBe('');  // null becomes empty
    expect(values[valueIndex]).toBe(''); // undefined becomes empty
    expect(values[countIndex]).toBe('0'); // 0 should remain as '0'
  });

  it('should maintain value alignment regardless of key order', () => {
    const data = {
      z_last: 'end',
      a_first: 'start',
      m_middle: 'center'
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    const headers = lines[0].split(',');
    const values = lines[1].split(',');
    
    // Each value must align with its header
    headers.forEach((header, index) => {
      expect(values[index]).toBe(data[header as keyof typeof data]);
    });
  });

  it('should handle arrays by converting to JSON strings', () => {
    const data = {
      id: 'array-test',
      tags: ['tag1', 'tag2', 'tag3'],
      numbers: [1, 2, 3],
      empty: []
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    // Test that the CSV structure is correct
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('id,tags,numbers,empty'); // headers
    
    // Test the actual CSV output contains the expected values
    expect(lines[1]).toContain('array-test');
    expect(lines[1]).toContain('"[""tag1"",""tag2"",""tag3""]"'); // Escaped JSON array
    expect(lines[1]).toContain('"[1,2,3]"'); // Numbers array (quoted due to commas)
    expect(lines[1]).toContain('[]'); // Empty array
    
    // Test the full output matches expected pattern
    expect(lines[1]).toBe('array-test,"[""tag1"",""tag2"",""tag3""]","[1,2,3]",[]');
  });

  it('should handle deeply nested structures', () => {
    const data = {
      level1: {
        level2: {
          level3: {
            value: 'deep'
          }
        }
      }
    };

    const csv = jsonToCSV(data);
    const lines = csv.split('\n');
    
    expect(lines[0]).toBe('level1.level2.level3.value');
    expect(lines[1]).toBe('deep');
  });
});