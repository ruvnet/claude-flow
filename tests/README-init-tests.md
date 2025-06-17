# Init Command Test Suite

This directory contains comprehensive tests for the `claude-flow init` command, covering all aspects of project initialization including basic setup, SPARC integration, error handling, and performance validation.

## Test Structure

### Unit Tests (`tests/unit/cli/commands/init/`)

#### `init-command.test.ts`
Core functionality tests for the init command:
- Basic initialization with no flags
- Minimal mode initialization (`--minimal`)
- SPARC mode initialization (`--sparc`)
- Force flag behavior (`--force`)
- Help display
- Flag combinations
- Error scenarios

#### `templates.test.ts`
Template generation and content validation:
- CLAUDE.md template variations (full, minimal, SPARC)
- memory-bank.md template generation
- coordination.md template generation
- README file templates
- Template consistency validation
- SPARC-specific content validation

#### `sparc-structure.test.ts`
SPARC development environment setup:
- .roo directory structure creation
- .roomodes configuration file generation
- Workflow template creation
- Claude commands integration
- Error handling for SPARC setup
- Existing file preservation

#### `validation.test.ts`
File integrity and configuration correctness:
- JSON file validation (syntax and structure)
- Markdown file formatting validation
- Directory structure verification
- Content consistency across files
- Configuration correctness
- Cross-file reference validation

#### `rollback.test.ts`
Error handling and rollback functionality:
- Partial failure scenarios
- Permission error handling
- Concurrent access conflicts
- Recovery mechanisms with `--force`
- Cleanup validation
- Interrupted initialization handling

### Integration Tests (`tests/integration/cli/init/`)

#### `full-init-flow.test.ts`
Complete initialization flow testing:
- Empty project initialization
- Existing file handling
- Force overwrite scenarios
- Working directory handling
- Executable creation and validation
- Real CLI command execution

#### `selective-modes.test.ts`
Mode-specific initialization testing:
- Standard vs minimal mode differences
- SPARC vs non-SPARC initialization
- Progressive initialization (minimal → full → SPARC)
- Mixed flag combinations
- Mode-specific file validation

#### `e2e-workflow.test.ts`
End-to-end workflow and real-world scenarios:
- New project from scratch
- Existing Node.js project integration
- Git repository compatibility
- Large project handling
- User experience validation
- Help and error message quality

### Performance Tests (`tests/performance/cli/init/`)

#### `init-performance.test.ts`
Performance and resource usage validation:
- Basic initialization timing
- SPARC initialization performance
- Concurrent initialization efficiency
- Large project initialization
- Memory usage monitoring
- File I/O performance
- Directory creation efficiency

## Test Scenarios Covered

### Basic Functionality
- ✅ Empty directory initialization
- ✅ Existing file detection and warnings
- ✅ Force overwrite behavior
- ✅ Help message display
- ✅ Flag parsing and validation

### File Operations
- ✅ Directory structure creation
- ✅ Template file generation
- ✅ Executable wrapper creation
- ✅ JSON configuration files
- ✅ Markdown documentation files

### SPARC Integration
- ✅ External create-sparc execution
- ✅ Fallback to manual creation
- ✅ .roomodes configuration
- ✅ Workflow template generation
- ✅ Claude slash commands creation

### Error Handling
- ✅ Permission errors
- ✅ File conflicts
- ✅ Directory creation failures
- ✅ Partial initialization states
- ✅ External command failures
- ✅ Concurrent access conflicts

### Real-World Scenarios
- ✅ Node.js project integration
- ✅ Git repository compatibility
- ✅ Large project structures
- ✅ Nested directory handling
- ✅ Cross-platform compatibility

### Performance Validation
- ✅ Timing constraints (< 10s basic, < 30s SPARC)
- ✅ Memory usage limits (< 50MB increase)
- ✅ Concurrent execution efficiency
- ✅ File I/O optimization
- ✅ Large project scalability

## Running the Tests

### Quick Start
```bash
# Run all init command tests
./scripts/test-init-command.ts

# Run with verbose output
./scripts/test-init-command.ts --verbose

# Run with coverage report
./scripts/test-init-command.ts --coverage
```

### Test Categories
```bash
# Run only unit tests
./scripts/test-init-command.ts --unit

# Run only integration tests
./scripts/test-init-command.ts --integration

# Run only performance tests
./scripts/test-init-command.ts --performance
```

### Specific Test Suites
```bash
# List available test suites
./scripts/test-init-command.ts --list

# Run specific test suite
./scripts/test-init-command.ts --suite templates
./scripts/test-init-command.ts --suite sparc-structure
./scripts/test-init-command.ts --suite validation
```

### Development Options
```bash
# Stop on first failure
./scripts/test-init-command.ts --fail-fast

# Run specific suite with verbose output
./scripts/test-init-command.ts --suite init-command --verbose
```

### Using Deno Test Directly
```bash
# Run specific test file
deno test --allow-all tests/unit/cli/commands/init/init-command.test.ts

# Run with coverage
deno test --allow-all --coverage=coverage tests/unit/cli/commands/init/

# Generate HTML coverage report
deno coverage coverage --html
```

## Test Data and Fixtures

### Temporary Directories
All tests use temporary directories created with `Deno.makeTempDir()` to ensure:
- Test isolation
- No interference with existing files
- Automatic cleanup
- Cross-platform compatibility

### Mock Data
Tests create realistic project structures including:
- Node.js projects with package.json
- Git repositories with commits
- Large directory structures
- Various file types and permissions

### Environment Variables
Tests handle various environment scenarios:
- Different working directories
- Limited PATH environments
- Permission restrictions
- Concurrent execution

## Test Coverage Goals

### Code Coverage
- **Target: 90%+ line coverage** for init command modules
- **Target: 85%+ branch coverage** for error handling paths
- **Target: 100% function coverage** for public APIs

### Scenario Coverage
- ✅ All command-line flag combinations
- ✅ All error conditions and edge cases
- ✅ All file system permission scenarios
- ✅ All supported project types
- ✅ All performance requirements

### Platform Coverage
- ✅ Linux/Unix systems
- ✅ Windows compatibility
- ✅ macOS compatibility
- ✅ Permission model differences

## Adding New Tests

### Unit Test Guidelines
1. Focus on single responsibility
2. Use descriptive test names
3. Test both success and failure paths
4. Validate all outputs and side effects
5. Use temporary directories for file operations

### Integration Test Guidelines
1. Test realistic user workflows
2. Validate end-to-end functionality
3. Include performance assertions
4. Test cross-component interactions
5. Verify user experience quality

### Performance Test Guidelines
1. Set realistic timing constraints
2. Monitor memory usage
3. Test scalability scenarios
4. Validate resource cleanup
5. Include concurrent execution tests

### Example Test Structure
```typescript
describe("Feature Name Tests", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = Deno.cwd();
    testDir = await Deno.makeTempDir({ prefix: "test_prefix_" });
    Deno.env.set("PWD", testDir);
    Deno.chdir(testDir);
  });

  afterEach(async () => {
    Deno.chdir(originalCwd);
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Success scenarios", () => {
    it("should handle normal case", async () => {
      // Test implementation
    });
  });

  describe("Error scenarios", () => {
    it("should handle error case gracefully", async () => {
      // Test implementation
    });
  });
});
```

## Continuous Integration

### CI Pipeline Integration
The test suite is designed to integrate with CI/CD pipelines:
- Parallel test execution support
- JUnit XML output (via --reporter)
- Coverage reporting
- Fail-fast options for quick feedback

### Test Environment Requirements
- Deno runtime with --allow-all permissions
- Git available for repository tests
- Sufficient disk space for temporary directories
- File system permission support

### Performance Monitoring
Tests include timing assertions to catch performance regressions:
- Basic init: < 10 seconds
- SPARC init: < 30 seconds
- Large project init: < 15 seconds
- Memory usage: < 50MB increase

## Troubleshooting

### Common Issues

#### Permission Errors
```bash
# Ensure test runner has proper permissions
chmod +x ./scripts/test-init-command.ts

# Run with all permissions for Deno
deno run --allow-all scripts/test-init-command.ts
```

#### Temporary Directory Cleanup
```bash
# Manual cleanup if tests fail to clean up
find /tmp -name "claude_flow_*_test_*" -type d -exec rm -rf {} +
```

#### Git Configuration for Tests
```bash
# Set git config for CI environments
git config --global user.email "test@example.com"
git config --global user.name "Test User"
```

### Debug Mode
```bash
# Run with maximum verbosity
./scripts/test-init-command.ts --verbose --fail-fast --suite init-command
```

## Contributing

When adding new init command features:

1. **Add unit tests** for core functionality
2. **Add integration tests** for user workflows  
3. **Add performance tests** if impacting speed/memory
4. **Update validation tests** for new file formats
5. **Add rollback tests** for error scenarios
6. **Update this README** with new test coverage

### Test Review Checklist
- [ ] Tests are isolated and don't interfere with each other
- [ ] All temporary files and directories are cleaned up
- [ ] Error cases are thoroughly tested
- [ ] Performance requirements are validated
- [ ] Cross-platform compatibility is considered
- [ ] User experience scenarios are covered