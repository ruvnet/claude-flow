# Claude Optimized Template

This directory contains the optimized Claude Code template with SPARC methodology support and batch tools integration.

## Overview

The optimized template provides:
- **Reduced token usage** through optimized prompts
- **Improved performance** with batch operations
- **Complete SPARC methodology** support
- **Comprehensive test suite** for validation
- **Claude Flow integration** for orchestration

## Structure

```
claude-optimized/
├── manifest.json          # File manifest and metadata
├── VERSION               # Current version (1.0.0)
├── CHANGELOG.md          # Version history
├── README.md             # This file
└── .claude/              # Template files (created during init)
    ├── commands/         # Slash commands
    │   ├── sparc/       # SPARC mode commands
    │   └── ...          # Claude Flow commands
    ├── tests/           # Test suite
    │   ├── unit/        # Unit tests
    │   ├── integration/ # Integration tests
    │   ├── performance/ # Performance tests
    │   ├── error-handling/ # Error tests
    │   └── e2e/         # End-to-end tests
    ├── logs/            # Conversation logs (empty)
    └── *.md             # Documentation files
```

## Installation

The template is automatically installed when initializing a new Claude Flow project. To manually install:

1. Copy all files listed in `manifest.json` to your project's `.claude` directory
2. Create the directory structure as specified
3. Ensure proper file permissions
4. Optionally run the test harness to verify installation

## Files Included

### Documentation
- `BATCHTOOLS_GUIDE.md` - Comprehensive batch tools guide
- `BATCHTOOLS_BEST_PRACTICES.md` - Best practices and examples
- `MIGRATION_GUIDE.md` - Migration guide for existing projects
- `PERFORMANCE_BENCHMARKS.md` - Performance comparison data

### Commands
- Main commands for Claude Flow integration
- 15 SPARC methodology mode commands
- Each command is optimized for minimal token usage

### Test Suite
- Unit tests for core functionality
- Integration tests for each SPARC mode
- Performance benchmarks
- Error handling and rollback tests
- End-to-end workflow tests

## Version Management

- Version is tracked in `VERSION` file
- Changes documented in `CHANGELOG.md`
- Semantic versioning (MAJOR.MINOR.PATCH)

## Manifest System

The `manifest.json` file contains:
- Complete file listing with descriptions
- Directory structure specification
- Installation instructions
- Maintenance procedures
- Category organization

## Usage

After installation, the commands are available in Claude Code:
- Type `/` to see all available commands
- Use `/sparc` for SPARC methodology
- Use `/claude-flow-*` for Claude Flow features

## Performance Improvements

The optimized templates provide:
- **50-70% reduction** in token usage
- **3-5x faster** execution with batch operations
- **Parallel processing** for independent operations
- **Smart caching** for repeated operations

## Maintenance

To update the templates:
1. Modify source files in `.claude` directory
2. Run optimization if needed
3. Update `manifest.json`
4. Increment version in `VERSION`
5. Update `CHANGELOG.md`
6. Test installation process

## Requirements

- Claude Code CLI installed
- Node.js for test execution
- Read/write permissions in project directory

## Support

For issues or questions:
- Check the documentation files
- Run the test suite for validation
- Refer to Claude Flow documentation