#!/bin/bash

# Claude Flow Examples - Quick Start Guide
# This script demonstrates the new organized example structure

echo "🚀 Claude Flow Examples - Quick Start"
echo "===================================="
echo ""

# Function to display section
show_section() {
    echo "📁 $1"
    echo "   $2"
    echo ""
}

# Display the new structure
show_section "01-configurations/" "System and workflow configuration files"
echo "   - development-config.json: Complete system configuration"
echo ""

show_section "02-workflows/" "Multi-agent workflow definitions"
echo "   - claude-workflow.json: 4-agent development workflow"
echo "   - research-workflow.json: AI research pipeline"
echo ""

show_section "03-demos/" "Live demonstration scripts"
echo "   - create-swarm-sample.sh: Note-taking app demo"
echo "   - demo-swarm-app.sh: Weather CLI demo"
echo "   - rest-api-demo.sh: REST API creation"
echo "   - swarm-showcase.sh: Task manager demo"
echo ""

show_section "04-testing/" "Testing and validation scripts"
echo "   - sparc-swarm-test.sh: SPARC TDD test suite"
echo "   - test-swarm-cli.sh: CLI functionality tests"
echo ""

show_section "05-swarm-apps/" "Complete apps created by swarm"
echo "   - swarm-created-app/: Task manager application"
echo "   - swarm-sample/: Note-taking application"
echo ""

show_section "06-tutorials/" "Guides and documentation"
echo "   - sparc-batchtool-orchestration.md: BatchTool guide"
echo ""

echo "🎯 Quick Commands:"
echo "=================="
echo ""
echo "# Run a demo:"
echo "cd examples/03-demos/quick && ./quick-api-demo.sh"
echo ""
echo "# Create from workflow template:"
echo "cd examples && ../claude-flow swarm create 'Build hello world app based on simple workflow' --output ./output/hello"
echo ""
echo "# Run tests:"
echo "cd examples/04-testing/unit && ./test-memory-system.sh"
echo ""
echo "# Create your first swarm:"
echo "cd examples && ../claude-flow swarm create 'Build a simple calculator'"
echo ""
echo "# Try SPARC TDD:"
echo "cd examples && ../claude-flow sparc tdd 'Create user login function'"
echo ""

echo "📚 For more information, see examples/README.md"