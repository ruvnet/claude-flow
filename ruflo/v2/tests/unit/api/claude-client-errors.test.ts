/**
 * Tests for Claude API enhanced error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { ClaudeAPIClient } from '../../../src/api/claude-client.js';
import { 
  ClaudeInternalServerError,
  ClaudeServiceUnavailableError,
  ClaudeRateLimitError,
  ClaudeTimeoutError,
  ClaudeNetworkError,
  ClaudeAuthenticationError,
  getUserFriendlyError,
} from '../../../src/api/claude-api-errors.js';
import { createMockLogger } from '../../test.utils.js';
import { ConfigManager } from '../../../src/config/config-manager.js';

// Mock fetch
global.fetch = vi.fn();

describe('Claude API Enhanced Error Handling', () => {
  let client: ClaudeAPIClient;
  let mockLogger: any;
  let mockConfigManager: any;
  const mockFetch = global.fetch as Mock;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockConfigManager = {
      get: vi.fn().mockReturnValue(null),
    };
    
    // Set up client with API key
    process.env.ANTHROPIC_API_KEY = 'test-api-key';
    
    client = new ClaudeAPIClient(mockLogger, mockConfigManager as any, {
      retryAttempts: 3,
      retryDelay: 100,
      retryJitter: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    if (client) {
      client.destroy();
    }
  });

  describe('500 Internal Server Error Handling', () => {
    it('should retry on 500 error and eventually fail', async () => {
      mockFetch.mockRejectedValue({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ 
          error: { message: 'Internal server error' } 
        }),
      });

      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ 
          error: { message: 'Internal server error' } 
        }),
      }));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeInternalServerError);

      // Should have retried 3 times
      expect(mockFetch).toHaveBeenCalledTimes(3);
      
      // Check retry delays were applied
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Claude API request failed (attempt 1/3)'),
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Claude API request failed (attempt 2/3)'),
        expect.any(Object)
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Claude API request failed (attempt 3/3)'),
        expect.any(Object)
      );
    });

    it('should succeed after retry on 500 error', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
            text: async () => JSON.stringify({ 
              error: { message: 'Internal server error' } 
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello!' }],
            model: 'claude-3-sonnet-20240229',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        });
      });

      const response = await client.sendMessage([{ role: 'user', content: 'Hello' }]);
      
      expect(response).toBeDefined();
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Claude API response received',
        expect.any(Object)
      );
    });
  });

  describe('503 Service Unavailable Handling', () => {
    it('should retry on 503 error', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ 
          error: { message: 'Service temporarily unavailable' } 
        }),
      }));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeServiceUnavailableError);

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('429 Rate Limit Handling', () => {
    it('should retry with retry-after header', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ 
          error: { 
            message: 'Rate limit exceeded',
            retry_after: 2, // 2 seconds
          } 
        }),
      }));

      const startTime = Date.now();
      
      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeRateLimitError);

      // Should respect retry-after header (but only for first retry)
      const elapsedTime = Date.now() - startTime;
      expect(elapsedTime).toBeGreaterThanOrEqual(2000); // At least 2 seconds
    });
  });

  describe('Timeout Handling', () => {
    it('should handle request timeout', async () => {
      mockFetch.mockImplementation(() => new Promise((resolve, reject) => {
        setTimeout(() => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        }, 100);
      }));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }], {
          // This would normally be handled by AbortController
        })
      ).rejects.toThrow(ClaudeTimeoutError);
    });
  });

  describe('Network Error Handling', () => {
    it('should handle network connection errors', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed'));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeNetworkError);
    });

    it('should handle ECONNREFUSED errors', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeNetworkError);
    });
  });

  describe('Authentication Error Handling', () => {
    it('should not retry on 401 authentication error', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ 
          error: { message: 'Invalid API key' } 
        }),
      }));

      await expect(
        client.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow(ClaudeAuthenticationError);

      // Should not retry authentication errors
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('User-Friendly Error Messages', () => {
    it('should provide helpful suggestions for 500 errors', () => {
      const error = new ClaudeInternalServerError('Server error');
      const errorInfo = getUserFriendlyError(error);
      
      expect(errorInfo.title).toBe('Claude API Service Error');
      expect(errorInfo.suggestions).toContain('Wait a few minutes and try again');
      expect(errorInfo.retryable).toBe(true);
    });

    it('should provide helpful suggestions for rate limit errors', () => {
      const error = new ClaudeRateLimitError('Rate limit exceeded');
      const errorInfo = getUserFriendlyError(error);
      
      expect(errorInfo.title).toBe('Rate Limit Exceeded');
      expect(errorInfo.suggestions).toContain('Implement request throttling');
      expect(errorInfo.retryable).toBe(true);
    });

    it('should provide helpful suggestions for network errors', () => {
      const error = new ClaudeNetworkError('Connection failed');
      const errorInfo = getUserFriendlyError(error);
      
      expect(errorInfo.title).toBe('Network Connection Error');
      expect(errorInfo.suggestions).toContain('Check your internet connection');
      expect(errorInfo.retryable).toBe(true);
    });
  });

  describe('Health Check', () => {
    it('should perform health check successfully', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      }));

      const result = await client.performHealthCheck();
      
      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();
    });

    it('should handle health check failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.performHealthCheck();
      
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Network error');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Claude API health check failed',
        expect.any(Object)
      );
    });

    it('should treat 429 as healthy in health check', async () => {
      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ 
          error: { message: 'Rate limit exceeded' } 
        }),
      }));

      const result = await client.performHealthCheck();
      
      expect(result.healthy).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Exponential Backoff', () => {
    it('should apply exponential backoff with jitter', async () => {
      const clientWithJitter = new ClaudeAPIClient(mockLogger, mockConfigManager as any, {
        retryAttempts: 3,
        retryDelay: 100,
        retryJitter: true,
      });

      mockFetch.mockImplementation(() => Promise.resolve({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ 
          error: { message: 'Internal server error' } 
        }),
      }));

      const startTime = Date.now();
      
      await expect(
        clientWithJitter.sendMessage([{ role: 'user', content: 'Hello' }])
      ).rejects.toThrow();

      const elapsedTime = Date.now() - startTime;
      
      // With exponential backoff: 100ms + 200ms = 300ms minimum
      // With jitter, could be up to 30% more
      expect(elapsedTime).toBeGreaterThanOrEqual(300);
      expect(elapsedTime).toBeLessThan(600); // Reasonable upper bound
      
      clientWithJitter.destroy();
    });
  });
});