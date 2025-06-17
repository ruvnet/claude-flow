# Claude Flow Examples

This directory contains examples demonstrating various features and capabilities of the Claude Flow system, organized by category.

## Directory Structure

```
examples/
├── 01-configurations/        # System and workflow configuration examples
├── 02-workflows/            # Multi-agent workflow definitions
├── 03-demos/               # Live demonstration scripts
├── 04-testing/             # Testing and validation examples
├── 05-swarm-apps/          # Applications created by the swarm system
├── 06-tutorials/           # Step-by-step guides and tutorials
└── README.md               # This file
```

## Quick Start

1. **New to Claude Flow?** Start with `01-configurations/basic-config.json`
2. **Want to see it in action?** Run `03-demos/quick-demo.sh`
3. **Building an app?** Check `05-swarm-apps/` for complete examples
4. **Testing your setup?** Use `04-testing/test-swarm-cli.sh`

## Categories

### 01. Configurations
System and workflow configuration files showing how to set up Claude Flow for different use cases.

### 02. Workflows
Multi-agent workflow definitions demonstrating parallel execution, task dependencies, and agent coordination.

### 03. Demos
Shell scripts that demonstrate the swarm system creating various types of applications.

### 04. Testing
Scripts for testing Claude Flow features, SPARC modes, and system functionality.

### 05. Swarm Apps
Complete applications created by the swarm system, including source code, tests, and documentation.

### 06. Tutorials
Step-by-step guides for common tasks and advanced features.

## Running Examples

Most shell script examples can be run directly:
```bash
cd examples/03-demos
./quick-demo.sh
```

For configuration examples, use them with Claude Flow commands:
```bash
cd examples
../claude-flow swarm create "Your task description" --config ./01-configurations/basic/simple-config.json
```

Or from the project root:
```bash
./claude-flow swarm create "Your task description" --config ./examples/01-configurations/basic/simple-config.json
```

## Contributing

When adding new examples:
1. Place them in the appropriate category folder
2. Include clear comments and documentation
3. Test the example thoroughly
4. Update this README if adding new categories