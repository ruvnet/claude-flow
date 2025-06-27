/// <reference types="jest" />

/**
 * Unit tests for Logger
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  spy,
  stub,
  assertSpyCalls,
} from '../../test.utils.js';
import { Logger, LogLevel } from '../../../src/core/logger.js';
import { LoggingConfig } from '../../../src/utils/types.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';
import { captureConsole, createTestFile } from '../../test.utils.js';

describe('Logger', () => {
  let logger: Logger;
  let consoleCapture: ReturnType<typeof captureConsole>;
  let tempLogFile: string;

  beforeEach(async () => {
    setupTestEnv();
    consoleCapture = captureConsole();
    tempLogFile = await createTestFile('test.log', '');
    
    // Reset singleton
    (Logger as any).instance = undefined;
  });

  afterEach(async () => {
    consoleCapture.restore();
    try {
      // Close any open file handles
      const instance = (Logger as any).instance;
      if (instance?.fileHandle) {
        await instance.fileHandle.close();
      }
    } catch {}
    await cleanupTestEnv();
  });

  describe('initialization', () => {
    it('should be a singleton', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'json',
        destination: 'console',
      };
      
      const logger1 = Logger.getInstance(config);
      const logger2 = Logger.getInstance();
      
      expect(logger1).toBe( logger2);
    });

    it('should throw if no config provided on first getInstance', () => {
      (Logger as any).instance = undefined;
      
      let error: Error | undefined;
      try {
        Logger.getInstance();
      } catch (e) {
        error = e as Error;
      }
      
      expect(error);
      expect(error!.message).toBe( 'Logger configuration required for initialization');
    });

    it('should configure logging level', () => {
      const config: LoggingConfig = {
        level: 'error',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      
      // Debug and info should not log
      logger.debug('debug message');
      logger.info('info message');
      
      // Error should log
      logger.error('error message');
      
      const output = consoleCapture.getOutput();
      const errors = consoleCapture.getErrors();
      
      expect(output.length).toBe( 0);
      expect(errors.length).toBe( 1);
    });
  });

  describe('logging levels', () => {
    beforeEach(() => {
      const config: LoggingConfig = {
        level: 'debug',
        format: 'text',
        destination: 'console',
      };
      logger = Logger.getInstance(config);
    });

    it('should log debug messages', () => {
      logger.debug('debug message', { data: 'test' });
      
      const output = consoleCapture.getOutput();
      expect(output.find(o => o.includes('DEBUG') && o.includes('debug message')));
    });

    it('should log info messages', () => {
      logger.info('info message', { data: 'test' });
      
      const output = consoleCapture.getOutput();
      expect(output.find(o => o.includes('INFO') && o.includes('info message')));
    });

    it('should log warn messages', () => {
      logger.warn('warn message', { data: 'test' });
      
      const output = consoleCapture.getOutput();
      expect(output.find(o => o.includes('WARN') && o.includes('warn message')));
    });

    it('should log error messages', () => {
      const error = new Error('test error');
      logger.error('error message', error);
      
      const errors = consoleCapture.getErrors();
      expect(errors.find(e => e.includes('ERROR') && e.includes('error message')));
    });

    it('should respect log level hierarchy', () => {
      // Force reset singleton to ensure clean state
      (Logger as any).instance = undefined;
      
      const config: LoggingConfig = {
        level: 'warn',
        format: 'text',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      
      // Clear any previous captures
      consoleCapture.getOutput();
      consoleCapture.getErrors();
      
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
      
      const output = consoleCapture.getOutput();
      const errors = consoleCapture.getErrors();
      const allLogs = [...output, ...errors];
      
      expect(allLogs.filter(l => l.includes('debug')).length).toBe( 0);
      expect(allLogs.filter(l => l.includes('info')).length).toBe( 0);
      expect(allLogs.filter(l => l.includes('warn')).length).toBe( 1);
      expect(allLogs.filter(l => l.includes('error')).length).toBe( 1);
    });
  });

  describe('formatting', () => {
    it('should format logs as JSON', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      logger.info('test message', { key: 'value' });
      
      const output = consoleCapture.getOutput();
      const log = JSON.parse(output[0]);
      
      expect(log.level).toBe( 'INFO');
      expect(log.message).toBe( 'test message');
      expect(log.data).toEqual({ key: 'value' });
      expect(log.timestamp);
    });

    it('should format logs as text', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      logger.info('test message', { key: 'value' });
      
      const output = consoleCapture.getOutput();
      expect(output[0].match(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/));
      expect(output[0].includes('INFO'));
      expect(output[0].includes('test message'));
      expect(output[0].includes('{"key":"value"}'));
    });

    it('should format errors properly in text mode', () => {
      const config: LoggingConfig = {
        level: 'error',
        format: 'text',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      const error = new Error('test error');
      error.stack = 'Error: test error\n    at test.ts:123';
      
      logger.error('error occurred', error);
      
      const errors = consoleCapture.getErrors();
      expect(errors[0].includes('Error: test error'));
      expect(errors[0].includes('Stack:'));
    });

    it('should format errors properly in JSON mode', () => {
      const config: LoggingConfig = {
        level: 'error',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      const error = new Error('test error');
      
      logger.error('error occurred', error);
      
      const errors = consoleCapture.getErrors();
      const log = JSON.parse(errors[0]);
      
      expect(log.error);
      expect(log.error.name).toBe( 'Error');
      expect(log.error.message).toBe( 'test error');
      expect(log.error.stack);
    });
  });

  describe('destinations', () => {
    it('should log to console only', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      logger.info('console log');
      
      const output = consoleCapture.getOutput();
      expect(output.length).toBe( 1);
    });

    it('should log to file only', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'file',
        filePath: tempLogFile,
      };
      
      logger = Logger.getInstance(config);
      logger.info('file log');
      
      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const content = fs.readFileSync(tempLogFile, "utf8");
      expect(content.includes('file log'));
      
      // Should not log to console
      const output = consoleCapture.getOutput();
      expect(output.length).toBe( 0);
    });

    it('should log to both console and file', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'both',
        filePath: tempLogFile,
      };
      
      logger = Logger.getInstance(config);
      logger.info('both log');
      
      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check console
      const output = consoleCapture.getOutput();
      expect(output.length).toBe( 1);
      expect(output[0].includes('both log'));
      
      // Check file
      const content = fs.readFileSync(tempLogFile, "utf8");
      expect(content.includes('both log'));
    });

    it('should throw if file destination without filePath', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'file',
      };
      
      let error: Error | undefined;
      try {
        logger = Logger.getInstance(config);
      } catch (e) {
        error = e as Error;
      }
      
      expect(error);
      expect(error!.message).toBe( 'File path required for file logging');
    });
  });

  describe('file rotation', () => {
    it('should rotate log file when size limit reached', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'file',
        filePath: tempLogFile,
        maxFileSize: 100, // Very small for testing
        maxFiles: 3,
      };
      
      logger = Logger.getInstance(config);
      
      // Write enough logs to trigger rotation
      for (let i = 0; i < 10; i++) {
        logger.info('This is a long log message to fill up the file quickly');
      }
      
      // Wait for file operations to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Check if rotation occurred
      const dir = tempLogFile.substring(0, tempLogFile.lastIndexOf('/'));
      const files: string[] = [];
      
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.includes('test.log')) {
          files.push(entry.name);
        }
      }
      
      // Should have rotated file
      expect(files.length > 1).toBe( true);
    });
  });

  describe('configuration', () => {
    it('should update configuration', async () => {
      const initialConfig: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'console',
      };
      
      logger = Logger.getInstance(initialConfig);
      logger.info('should appear');
      logger.debug('should not appear');
      
      // Update config
      await logger.configure({
        level: 'debug',
        format: 'json',
        destination: 'console',
      });
      
      logger.debug('should now appear');
      
      const output = consoleCapture.getOutput();
      expect(output.filter(o => o.includes('should appear')).length).toBe( 1);
      expect(output.filter(o => o.includes('should not appear')).length).toBe( 0);
      expect(output.filter(o => o.includes('should now appear')).length).toBe( 1);
    });

    it('should close file handle when changing destination', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'file',
        filePath: tempLogFile,
      };
      
      logger = Logger.getInstance(config);
      
      // Write something to ensure file handle is created
      logger.info('test log');
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Now spy on the file handle
      const fileHandle = logger['fileHandle'];
      expect(fileHandle);
      const fileHandleSpy = jest.spyOn(fileHandle, 'close');
      
      await logger.configure({
        level: 'info',
        format: 'text',
        destination: 'console',
      });
      
      expect(fileHandleSpy).toBe( 1);
    });
  });

  describe('context', () => {
    it('should create child logger with context', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      const childLogger = logger.child({ component: 'test-component' });
      
      childLogger.info('child log');
      
      const output = consoleCapture.getOutput();
      const log = JSON.parse(output[0]);
      
      expect(log.context.component).toBe( 'test-component');
    });

    it('should merge child context with parent context', () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      const child1 = logger.child({ service: 'api' });
      const child2 = child1.child({ component: 'auth' });
      
      child2.info('nested log');
      
      const output = consoleCapture.getOutput();
      const log = JSON.parse(output[0]);
      
      expect(log.context.service).toBe( 'api');
      expect(log.context.component).toBe( 'auth');
    });
  });

  describe('error handling', () => {
    it('should handle file write errors gracefully', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'text',
        destination: 'file',
        filePath: '/invalid/path/test.log',
      };
      
      // Capture console.error
      const originalError = console.error;
      const errorSpy = jest.spyOn();
      console.error = errorSpy;
      
      try {
        logger = Logger.getInstance(config);
        logger.info('test log');
        
        // Wait for async write
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Should log error to console
        expect(errorSpy).toBe( 1);
        expect(errorSpy.calls[0].args[0]).toBe( 'Failed to write to log file:');
      } finally {
        console.error = originalError;
      }
    });

    it('should handle non-Error objects in error logging', () => {
      const config: LoggingConfig = {
        level: 'error',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      logger.error('error occurred', { custom: 'error object' });
      
      const errors = consoleCapture.getErrors();
      const log = JSON.parse(errors[0]);
      
      expect(log.error).toEqual({ custom: 'error object' });
    });
  });

  describe('performance', () => {
    it('should handle high volume logging', async () => {
      const config: LoggingConfig = {
        level: 'info',
        format: 'json',
        destination: 'console',
      };
      
      logger = Logger.getInstance(config);
      
      const start = Date.now();
      const count = 1000;
      
      for (let i = 0; i < count; i++) {
        logger.info(`Log message ${i}`, { index: i });
      }
      
      const duration = Date.now() - start;
      
      // Should complete quickly (< 1 second for 1000 logs)
      expect(duration < 1000).toBe( true);
      
      const output = consoleCapture.getOutput();
      expect(output.length).toBe( count);
    });
  });
});
