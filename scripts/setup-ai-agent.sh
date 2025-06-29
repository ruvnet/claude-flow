#!/bin/bash

# 🤖 AI Code Quality Agent Setup Script
# Automated setup for the AI-powered code analysis system

set -e

echo "🤖 AI Code Quality Agent Setup"
echo "================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠️${NC} $1"
}

print_error() {
    echo -e "${RED}❌${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ️${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the repository root."
    exit 1
fi

print_status "Repository root detected"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    print_error "Python 3 is required but not installed."
    exit 1
fi

print_status "Python 3 is available"

# Check if pip is available
if ! command -v pip3 &> /dev/null && ! command -v pip &> /dev/null; then
    print_error "pip is required but not installed."
    exit 1
fi

print_status "pip is available"

# Install Python dependencies
print_info "Installing Python dependencies..."
if command -v pip3 &> /dev/null; then
    pip3 install -r scripts/requirements.txt
else
    pip install -r scripts/requirements.txt
fi

print_status "Python dependencies installed"

# Make scripts executable
print_info "Making scripts executable..."
chmod +x scripts/ai-code-quality-agent.py
chmod +x scripts/test-ai-agent.py
chmod +x scripts/setup-ai-agent.sh

print_status "Scripts are now executable"

# Check npm dependencies
print_info "Checking npm dependencies..."
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing npm dependencies..."
    npm install
fi

print_status "npm dependencies are ready"

# Run validation tests
print_info "Running validation tests..."
python3 scripts/test-ai-agent.py

# Check if GitHub workflow exists
if [ -f ".github/workflows/ai-code-quality-agent.yml" ]; then
    print_status "GitHub workflow is configured"
else
    print_error "GitHub workflow file not found"
    exit 1
fi

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "📋 Next Steps:"
echo ""
echo "1. 🔑 Add GitHub Secrets:"
echo "   Go to: Settings → Secrets and variables → Actions"
echo "   Add: OPENAI_API_KEY (required for AI analysis)"
echo ""
echo "2. 🧪 Test the Agent:"
echo "   Create a pull request to trigger automatic analysis"
echo "   Or manually run: python3 scripts/ai-code-quality-agent.py"
echo ""
echo "3. 📊 Monitor Results:"
echo "   Check the Actions tab for workflow execution"
echo "   Review PR comments for analysis reports"
echo ""
echo "4. ⚙️ Customize Configuration:"
echo "   Edit: scripts/ai-agent-config.json"
echo "   Adjust analysis rules and thresholds"
echo ""
echo "📖 Documentation:"
echo "   Read: scripts/AI_AGENT_README.md for detailed usage"
echo ""
echo "🚀 The AI Code Quality Agent is now ready!"
echo "   It will automatically analyze:"
echo "   • Pull requests to main/develop branches"
echo "   • Daily scheduled scans at 3 AM UTC"
echo "   • Manual workflow triggers"
echo ""

# Check if OpenAI API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    print_warning "OPENAI_API_KEY environment variable not set"
    echo "   Set it locally for testing: export OPENAI_API_KEY='your-key-here'"
    echo "   Add it to GitHub Secrets for automated workflows"
else
    print_status "OPENAI_API_KEY is configured"
fi

echo ""
echo "🔗 Useful Commands:"
echo "   Test agent:     python3 scripts/test-ai-agent.py"
echo "   Run analysis:   python3 scripts/ai-code-quality-agent.py"
echo "   View config:    cat scripts/ai-agent-config.json"
echo "   Check workflow: cat .github/workflows/ai-code-quality-agent.yml"
echo ""
