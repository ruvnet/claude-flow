#!/bin/bash

# 🔑 OpenAI API Key Setup Script
# Helps configure the OpenAI API key for local testing

echo "🔑 OpenAI API Key Setup for AI Code Quality Agent"
echo "================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Check if OpenAI API key is already set
if [ -n "$OPENAI_API_KEY" ]; then
    print_status "OpenAI API key is already set in environment"
    echo "Current key: ${OPENAI_API_KEY:0:8}..."
    
    # Test the key
    print_info "Testing API key..."
    python3 -c "
import os
import requests

api_key = os.environ.get('OPENAI_API_KEY')
if api_key:
    try:
        response = requests.get(
            'https://api.openai.com/v1/models',
            headers={'Authorization': f'Bearer {api_key}'},
            timeout=10
        )
        if response.status_code == 200:
            models = response.json()
            print('✅ API key is valid!')
            available_models = [m['id'] for m in models['data'] if 'gpt' in m['id'] or 'codex' in m['id']]
            print(f'Available models: {available_models[:5]}...')
        else:
            print(f'❌ API key test failed: {response.status_code}')
    except Exception as e:
        print(f'❌ API key test error: {e}')
else:
    print('❌ No API key found')
"
else
    print_warning "OpenAI API key not found in environment"
    echo ""
    echo "📋 To set up your OpenAI API key:"
    echo ""
    echo "1. 🌐 Get your API key from: https://platform.openai.com/api-keys"
    echo ""
    echo "2. 🔧 Set it in your environment:"
    echo "   For current session:"
    echo "   export OPENAI_API_KEY='your-api-key-here'"
    echo ""
    echo "   For permanent setup (add to ~/.bashrc or ~/.zshrc):"
    echo "   echo 'export OPENAI_API_KEY=\"your-api-key-here\"' >> ~/.bashrc"
    echo "   source ~/.bashrc"
    echo ""
    echo "3. 🧪 Test the agent:"
    echo "   python3 scripts/ai-code-quality-agent.py"
    echo ""
    
    # Offer to set it interactively
    read -p "Would you like to set the API key now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        read -p "Enter your OpenAI API key: " -s api_key
        echo ""
        
        if [ -n "$api_key" ]; then
            export OPENAI_API_KEY="$api_key"
            print_status "API key set for current session"
            
            # Test the key
            print_info "Testing API key..."
            python3 -c "
import os
import requests

api_key = os.environ.get('OPENAI_API_KEY')
try:
    response = requests.get(
        'https://api.openai.com/v1/models',
        headers={'Authorization': f'Bearer {api_key}'},
        timeout=10
    )
    if response.status_code == 200:
        print('✅ API key is valid!')
    else:
        print(f'❌ API key test failed: {response.status_code}')
        print('Please check your API key and try again.')
except Exception as e:
    print(f'❌ API key test error: {e}')
"
            
            echo ""
            print_info "To make this permanent, add this to your shell profile:"
            echo "echo 'export OPENAI_API_KEY=\"$api_key\"' >> ~/.bashrc"
            echo "source ~/.bashrc"
        else
            print_error "No API key entered"
        fi
    fi
fi

echo ""
echo "🚀 Next Steps:"
echo "1. Run the AI agent: python3 scripts/ai-code-quality-agent.py"
echo "2. Check GitHub secrets for automated workflows"
echo "3. Create a PR to test the full workflow"
echo ""

# Check GitHub repository secrets setup
print_info "Checking GitHub repository setup..."

if command -v gh &> /dev/null; then
    print_status "GitHub CLI is available"
    
    # Check if we're in a GitHub repository
    if gh repo view &> /dev/null; then
        print_status "Repository detected"
        
        # Check secrets (this might require authentication)
        echo ""
        print_info "To check/set GitHub repository secrets:"
        echo "gh secret list"
        echo "gh secret set OPENAI_API_KEY"
        
    else
        print_warning "Not in a GitHub repository or not authenticated"
    fi
else
    print_warning "GitHub CLI not available"
    echo "Install with: curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"
fi

echo ""
echo "📖 For more help, see: scripts/AI_AGENT_README.md"
