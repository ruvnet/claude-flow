/**
 * Runtime Validation Test Suite
 * 
 * Validates functionality parity between Deno and Node.js runtimes
 * during the progressive migration process.
 * 
 * Phase 2 Runtime Migration - Issues #72, #79
 */

import { DenoCompat } from './deno-compatibility-layer.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';
import { spawn } from 'child_process';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: any;
}

interface PerformanceMetrics {
  memoryUsage: NodeJS.MemoryUsage;
  executionTime: number;
  cpuUsage?: NodeJS.CpuUsage;
}

class RuntimeValidationSuite {
  private testDir: string;
  private results: TestResult[] = [];
  
  constructor() {
    this.testDir = join(process.cwd(), 'phase2', 'runtime', 'test-temp');
  }
  
  /**
   * Run all validation tests
   */
  async runAllTests(): Promise<{ passed: number; failed: number; results: TestResult[] }> {
    console.log('🧪 Starting Runtime Validation Tests');
    console.log('=========================================');
    
    // Setup test environment
    await this.setupTestEnvironment();
    
    const tests = [
      this.testFileOperations.bind(this),
      this.testEnvironmentAccess.bind(this),
      this.testCommandExecution.bind(this),
      this.testSystemInfo.bind(this),
      this.testErrorHandling.bind(this),
      this.testSignalHandling.bind(this),
      this.testDirectoryOperations.bind(this),
      this.testStreamOperations.bind(this),
      this.testPerformanceComparison.bind(this)
    ];
    
    for (const test of tests) {
      await this.runTest(test);
    }
    
    // Cleanup test environment
    await this.cleanupTestEnvironment();
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`🔍 Total: ${this.results.length}`);
    
    if (failed > 0) {
      console.log('\n🚨 Failed Tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }
    
    return { passed, failed, results: [...this.results] };
  }
  
  /**
   * Test file operations compatibility
   */
  private async testFileOperations(): Promise<void> {
    const testFile = join(this.testDir, 'test-file.txt');
    const testContent = 'Hello, Runtime Migration!';
    
    // Test writeTextFile
    await DenoCompat.writeTextFile(testFile, testContent);
    
    // Test readTextFile
    const readContent = await DenoCompat.readTextFile(testFile);
    if (readContent !== testContent) {
      throw new Error(`Content mismatch: expected "${testContent}", got "${readContent}"`);
    }
    
    // Test stat
    const stats = await DenoCompat.stat(testFile);
    if (!stats.isFile) {
      throw new Error('File should be detected as file');
    }
    
    // Test append
    const appendContent = '\nAppended line';
    await DenoCompat.writeTextFile(testFile, appendContent, { append: true });
    const finalContent = await DenoCompat.readTextFile(testFile);
    
    if (!finalContent.includes(appendContent)) {
      throw new Error('Append operation failed');
    }
    
    // Test remove
    await DenoCompat.remove(testFile);
    
    try {
      await DenoCompat.stat(testFile);
      throw new Error('File should have been removed');
    } catch {
      // Expected - file should not exist
    }
  }
  
  /**
   * Test environment and process access
   */
  private async testEnvironmentAccess(): Promise<void> {
    // Test environment variables
    const testKey = 'CLAUDE_FLOW_TEST_VAR';
    const testValue = 'test-value-123';
    
    DenoCompat.env.set(testKey, testValue);
    
    if (DenoCompat.env.get(testKey) !== testValue) {
      throw new Error('Environment variable set/get failed');
    }
    
    if (!DenoCompat.env.has(testKey)) {
      throw new Error('Environment variable existence check failed');
    }
    
    const envObject = DenoCompat.env.toObject();
    if (envObject[testKey] !== testValue) {
      throw new Error('Environment toObject failed');
    }
    
    DenoCompat.env.delete(testKey);
    
    if (DenoCompat.env.has(testKey)) {
      throw new Error('Environment variable deletion failed');
    }
    
    // Test process info
    const cwd = DenoCompat.cwd();
    if (typeof cwd !== 'string' || cwd.length === 0) {
      throw new Error('Current working directory access failed');
    }
    
    const pid = DenoCompat.pid;
    if (typeof pid !== 'number' || pid <= 0) {
      throw new Error('Process ID access failed');
    }
    
    // Test args (this will be empty in test environment)
    const args = DenoCompat.args;
    if (!Array.isArray(args)) {
      throw new Error('Process arguments access failed');
    }
  }
  
  /**
   * Test command execution
   */
  private async testCommandExecution(): Promise<void> {
    // Test simple command
    const cmd = new DenoCompat.Command('echo', {
      args: ['Hello from DenoCompat']
    });
    
    const result = await cmd.output();
    
    if (!result.success) {
      throw new Error(`Command failed with code ${result.code}`);
    }
    
    const output = new TextDecoder().decode(result.stdout).trim();
    if (output !== 'Hello from DenoCompat') {
      throw new Error(`Unexpected output: ${output}`);
    }
    
    // Test command with error
    const failCmd = new DenoCompat.Command('false'); // Always returns exit code 1
    const failResult = await failCmd.output();
    
    if (failResult.success) {
      throw new Error('Command should have failed');
    }
    
    if (failResult.code !== 1) {
      throw new Error(`Expected exit code 1, got ${failResult.code}`);
    }
  }
  
  /**
   * Test system information access
   */
  private async testSystemInfo(): Promise<void> {
    // Test memory usage
    const memory = DenoCompat.memoryUsage();
    if (typeof memory.rss !== 'number' || memory.rss <= 0) {
      throw new Error('Memory usage RSS invalid');
    }
    
    if (typeof memory.heapUsed !== 'number' || memory.heapUsed <= 0) {
      throw new Error('Memory usage heapUsed invalid');
    }
    
    // Test build info
    const build = DenoCompat.build;
    if (typeof build.arch !== 'string' || build.arch.length === 0) {
      throw new Error('Build architecture invalid');
    }
    
    if (typeof build.os !== 'string' || build.os.length === 0) {
      throw new Error('Build OS invalid');
    }
    
    if (build.vendor !== 'nodejs') {
      throw new Error(`Expected vendor 'nodejs', got '${build.vendor}'`);
    }
    
    // Test stdin/stdout access
    if (!DenoCompat.stdin || typeof DenoCompat.stdin.read !== 'function') {
      throw new Error('Stdin access invalid');
    }
    
    if (!DenoCompat.stdout || typeof DenoCompat.stdout.write !== 'function') {
      throw new Error('Stdout access invalid');
    }
  }
  
  /**
   * Test error handling compatibility
   */
  private async testErrorHandling(): Promise<void> {
    // Test NotFound error
    try {
      await DenoCompat.readTextFile('/nonexistent/file.txt');
      throw new Error('Should have thrown NotFound error');
    } catch (error) {
      // Expected
    }
    
    // Test error types
    const notFoundError = new DenoCompat.errors.NotFound('Test error');
    if (notFoundError.name !== 'NotFound') {
      throw new Error('NotFound error name incorrect');
    }
    
    const permissionError = new DenoCompat.errors.PermissionDenied('Test error');
    if (permissionError.name !== 'PermissionDenied') {
      throw new Error('PermissionDenied error name incorrect');
    }
    
    const alreadyExistsError = new DenoCompat.errors.AlreadyExists('Test error');
    if (alreadyExistsError.name !== 'AlreadyExists') {
      throw new Error('AlreadyExists error name incorrect');
    }
  }
  
  /**
   * Test signal handling
   */
  private async testSignalHandling(): Promise<void> {
    let signalReceived = false;
    
    const handler = () => {
      signalReceived = true;
    };
    
    // Add signal listener
    DenoCompat.addSignalListener('SIGUSR1', handler);
    
    // Send signal to self
    process.kill(process.pid, 'SIGUSR1');
    
    // Wait a bit for signal to be processed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (!signalReceived) {
      throw new Error('Signal was not received');
    }
    
    // Remove signal listener
    DenoCompat.removeSignalListener('SIGUSR1', handler);
  }
  
  /**
   * Test directory operations
   */
  private async testDirectoryOperations(): Promise<void> {
    const testSubDir = join(this.testDir, 'subdir');
    
    // Test mkdir
    await DenoCompat.mkdir(testSubDir, { recursive: true });
    
    const stats = await DenoCompat.stat(testSubDir);
    if (!stats.isDirectory) {
      throw new Error('Directory should be detected as directory');
    }
    
    // Create test files in directory
    await DenoCompat.writeTextFile(join(testSubDir, 'file1.txt'), 'content1');
    await DenoCompat.writeTextFile(join(testSubDir, 'file2.txt'), 'content2');
    
    // Test readDir
    const entries: string[] = [];
    for await (const entry of DenoCompat.readDir(testSubDir)) {
      entries.push(entry.name);
    }
    
    if (!entries.includes('file1.txt') || !entries.includes('file2.txt')) {
      throw new Error('Directory reading failed');
    }
    
    // Test remove directory
    await DenoCompat.remove(testSubDir, { recursive: true });
    
    try {
      await DenoCompat.stat(testSubDir);
      throw new Error('Directory should have been removed');
    } catch {
      // Expected - directory should not exist
    }
  }
  
  /**
   * Test stream operations
   */
  private async testStreamOperations(): Promise<void> {
    // Basic stream access test
    if (!DenoCompat.stdin.readable) {
      throw new Error('Stdin should be readable');
    }
    
    if (!DenoCompat.stdout.writable) {
      throw new Error('Stdout should be writable');
    }
    
    // Test that streams are Node.js compatible
    if (typeof DenoCompat.stdin.on !== 'function') {
      throw new Error('Stdin should have event emitter interface');
    }
    
    if (typeof DenoCompat.stdout.write !== 'function') {
      throw new Error('Stdout should have write method');
    }
  }
  
  /**
   * Test performance comparison between APIs
   */
  private async testPerformanceComparison(): Promise<void> {
    const iterations = 100;
    const testFile = join(this.testDir, 'perf-test.txt');
    const testContent = 'Performance test content';
    
    // Test write performance
    const writeStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await DenoCompat.writeTextFile(`${testFile}.${i}`, testContent);
    }
    const writeEnd = performance.now();
    const writeTime = writeEnd - writeStart;
    
    // Test read performance
    const readStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      await DenoCompat.readTextFile(`${testFile}.${i}`);
    }
    const readEnd = performance.now();
    const readTime = readEnd - readStart;
    
    // Cleanup performance test files
    for (let i = 0; i < iterations; i++) {
      await DenoCompat.remove(`${testFile}.${i}`);
    }
    
    console.log(`  Performance metrics:`);
    console.log(`    Write ${iterations} files: ${writeTime.toFixed(2)}ms`);
    console.log(`    Read ${iterations} files: ${readTime.toFixed(2)}ms`);
    console.log(`    Avg write time: ${(writeTime / iterations).toFixed(2)}ms`);
    console.log(`    Avg read time: ${(readTime / iterations).toFixed(2)}ms`);
    
    // Performance should be reasonable (not more than 10ms per operation)
    if (writeTime / iterations > 10) {
      throw new Error('Write performance is too slow');
    }
    
    if (readTime / iterations > 10) {
      throw new Error('Read performance is too slow');
    }
  }
  
  /**
   * Run a single test and record result
   */
  private async runTest(testFn: () => Promise<void>): Promise<void> {
    const testName = testFn.name.replace('bound ', '');
    const start = performance.now();
    
    try {
      console.log(`🔍 Testing: ${testName}`);
      await testFn();
      const duration = performance.now() - start;
      
      this.results.push({
        name: testName,
        passed: true,
        duration
      });
      
      console.log(`  ✅ Passed (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const duration = performance.now() - start;
      
      this.results.push({
        name: testName,
        passed: false,
        duration,
        error: (error as Error).message
      });
      
      console.log(`  ❌ Failed: ${(error as Error).message}`);
    }
  }
  
  /**
   * Setup test environment
   */
  private async setupTestEnvironment(): Promise<void> {
    await fs.mkdir(this.testDir, { recursive: true });
  }
  
  /**
   * Cleanup test environment
   */
  private async cleanupTestEnvironment(): Promise<void> {
    try {
      await fs.rm(this.testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// CLI Interface
if (require.main === module) {
  async function main() {
    const suite = new RuntimeValidationSuite();
    
    try {
      const results = await suite.runAllTests();
      
      if (results.failed > 0) {
        console.log('\n⚠️ Some tests failed. Check compatibility layer implementation.');
        process.exit(1);
      } else {
        console.log('\n🎉 All tests passed! Runtime compatibility validated.');
        process.exit(0);
      }
    } catch (error) {
      console.error('\n💥 Test suite failed:', error);
      process.exit(1);
    }
  }
  
  main();
}

export { RuntimeValidationSuite, type TestResult, type PerformanceMetrics };