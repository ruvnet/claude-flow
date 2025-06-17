import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PromptManager } from '../prompt-manager';
import { PromptConfigManager } from '../prompt-utils';

describe('Prompt Copying Integration Tests', () => {
  let tempDir: string;
  let testManager: PromptManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'integration-test-'));
    
    // Create test structure
    const sourceDir = path.join(tempDir, 'source');
    const destDir = path.join(tempDir, 'dest');
    
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(destDir, { recursive: true });
    
    // Create test files
    await createTestPromptStructure(sourceDir);
    
    // Initialize manager
    testManager = new PromptManager({
      basePath: tempDir,
      configPath: '.test-config.json',
      autoDiscovery: false
    });
    
    // Configure manager
    await testManager.updateConfig({
      sourceDirectories: ['source'],
      destinationDirectory: 'dest'
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function createTestPromptStructure(sourceDir: string) {
    const structure = {
      'sparc/architect.md': '# Architect\nSystem design expert.',
      'sparc/tdd.md': '# TDD\nTest-driven development.',
      'sparc/code.md': '# Code\nImplementation expert.',
      'templates/api.md': '# API Template\n{{endpoint}}',
      'rules/general.md': '# Rules\nGeneral guidelines.',
      'invalid.md': '', // Empty file for validation testing
      'large.md': 'Large content\n'.repeat(100)
    };

    for (const [filePath, content] of Object.entries(structure)) {
      const fullPath = path.join(sourceDir, filePath);
      const dir = path.dirname(fullPath);
      
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fullPath, content);
    }
  }

  test('should initialize and auto-discover prompt directories', async () => {
    const discoveryManager = new PromptManager({
      basePath: tempDir,
      autoDiscovery: true
    });

    await discoveryManager.initialize();
    
    const config = discoveryManager.getConfig();
    expect(config.sourceDirectories.length).toBeGreaterThan(0);
  });

  test('should copy prompts using different profiles', async () => {
    await testManager.initialize();
    
    // Test with safe profile
    const safeResult = await testManager.copyPrompts({
      conflictResolution: 'skip',
      parallel: false
    });
    
    expect(safeResult.success).toBe(true);
    expect(safeResult.copiedFiles).toBeGreaterThan(0);
    
    // Verify files exist
    const destFiles = await fs.readdir(path.join(tempDir, 'dest'), { recursive: true });
    expect(destFiles.length).toBeGreaterThan(0);
  });

  test('should validate prompts and generate reports', async () => {
    await testManager.initialize();
    
    // Copy files first
    await testManager.copyPrompts();
    
    // Validate prompts
    const validation = await testManager.validatePrompts();
    
    expect(validation.totalFiles).toBeGreaterThan(0);
    expect(validation.validFiles).toBeGreaterThan(0);
    expect(validation.invalidFiles).toBeGreaterThan(0); // Should find the empty file
    
    // Check that empty file is flagged as invalid
    const emptyFileIssue = validation.issues.find(issue => 
      issue.file.includes('invalid.md')
    );
    expect(emptyFileIssue).toBeDefined();
    expect(emptyFileIssue!.issues).toContain('File is empty');
  });

  test('should handle multiple sources', async () => {
    // Create second source
    const source2Dir = path.join(tempDir, 'source2');
    await fs.mkdir(source2Dir, { recursive: true });
    await fs.writeFile(path.join(source2Dir, 'extra.md'), '# Extra\nExtra prompt.');
    
    // Update config
    await testManager.updateConfig({
      sourceDirectories: ['source', 'source2']
    });
    
    await testManager.initialize();
    
    // Copy from multiple sources
    const results = await testManager.copyFromMultipleSources();
    
    expect(results.length).toBe(2);
    expect(results.every(r => r.success)).toBe(true);
    
    // Verify files from both sources
    const destFiles = await fs.readdir(path.join(tempDir, 'dest'), { recursive: true });
    expect(destFiles).toContain('extra.md');
  });

  test('should generate comprehensive system report', async () => {
    await testManager.initialize();
    await testManager.copyPrompts();
    
    const report = await testManager.generateReport();
    
    expect(report.configuration).toBeDefined();
    expect(report.sources).toBeDefined();
    expect(report.sources.length).toBeGreaterThan(0);
    
    // Check source analysis
    const sourceInfo = report.sources[0];
    expect(sourceInfo.exists).toBe(true);
    expect(sourceInfo.fileCount).toBeGreaterThan(0);
    expect(sourceInfo.totalSize).toBeGreaterThan(0);
  });

  test('should handle configuration persistence', async () => {
    const configManager = new PromptConfigManager(
      path.join(tempDir, '.test-config.json')
    );
    
    // Save custom config
    await configManager.saveConfig({
      destinationDirectory: './custom-dest',
      defaultOptions: {
        maxWorkers: 8,
        conflictResolution: 'merge'
      }
    });
    
    // Load config in new instance
    const newConfigManager = new PromptConfigManager(
      path.join(tempDir, '.test-config.json')
    );
    
    const config = await newConfigManager.loadConfig();
    
    expect(config.destinationDirectory).toBe('./custom-dest');
    expect(config.defaultOptions.maxWorkers).toBe(8);
    expect(config.defaultOptions.conflictResolution).toBe('merge');
  });

  test('should handle errors gracefully', async () => {
    // Test with invalid source directory
    await testManager.updateConfig({
      sourceDirectories: ['nonexistent']
    });
    
    await testManager.initialize();
    
    // Should not throw but return failed result
    const result = await testManager.copyPrompts();
    
    // The result should indicate failure or no files copied
    expect(result.copiedFiles).toBe(0);
  });

  test('should support incremental sync', async () => {
    await testManager.initialize();
    
    // Initial copy
    const firstResult = await testManager.copyPrompts();
    expect(firstResult.success).toBe(true);
    
    // Modify source file
    const sourceFile = path.join(tempDir, 'source', 'sparc', 'architect.md');
    await fs.writeFile(sourceFile, '# Modified Architect\nUpdated content.');
    
    // Sync should detect changes
    const syncResult = await testManager.syncPrompts({
      incrementalOnly: true,
      compareHashes: true
    });
    
    expect(syncResult.forward.success).toBe(true);
  });

  test('should respect include/exclude patterns', async () => {
    await testManager.initialize();
    
    // Copy only .md files from sparc directory
    const result = await testManager.copyPrompts({
      includePatterns: ['**/sparc/*.md'],
      excludePatterns: ['**/tdd.md']
    });
    
    expect(result.success).toBe(true);
    
    // Check that only architect.md and code.md were copied
    const sparcDir = path.join(tempDir, 'dest', 'sparc');
    const sparcFiles = await fs.readdir(sparcDir).catch(() => []);
    
    expect(sparcFiles).toContain('architect.md');
    expect(sparcFiles).toContain('code.md');
    expect(sparcFiles).not.toContain('tdd.md');
  });

  test('should handle concurrent operations', async () => {
    await testManager.initialize();
    
    // Start multiple copy operations
    const operations = [
      testManager.copyPrompts({ destination: path.join(tempDir, 'dest1') }),
      testManager.copyPrompts({ destination: path.join(tempDir, 'dest2') }),
      testManager.copyPrompts({ destination: path.join(tempDir, 'dest3') })
    ];
    
    const results = await Promise.all(operations);
    
    // All operations should succeed
    expect(results.every(r => r.success)).toBe(true);
    
    // Verify all destinations have files
    for (let i = 1; i <= 3; i++) {
      const destDir = path.join(tempDir, `dest${i}`);
      const files = await fs.readdir(destDir, { recursive: true });
      expect(files.length).toBeGreaterThan(0);
    }
  });
});