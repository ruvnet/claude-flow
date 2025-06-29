#!/usr/bin/env python3
"""
Test script for AI Code Quality Agent
Validates the agent setup and basic functionality
"""

import os
import sys
import json
import subprocess
from pathlib import Path

def test_dependencies():
    """Test if required dependencies are available"""
    print("🔍 Testing dependencies...")
    
    try:
        import requests
        print("✅ requests module available")
    except ImportError:
        print("❌ requests module missing - run: pip install requests")
        return False
    
    # Test npm availability
    try:
        result = subprocess.run(['npm', '--version'], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ npm available (version: {result.stdout.strip()})")
        else:
            print("❌ npm not available")
            return False
    except FileNotFoundError:
        print("❌ npm not found in PATH")
        return False
    
    return True

def test_configuration():
    """Test if configuration files are valid"""
    print("\n📋 Testing configuration...")
    
    config_path = Path(__file__).parent / "ai-agent-config.json"
    if not config_path.exists():
        print("❌ ai-agent-config.json not found")
        return False
    
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
        print("✅ Configuration file is valid JSON")
        
        # Check required sections
        required_sections = ['analysis_rules', 'ai_analysis', 'reporting', 'thresholds']
        for section in required_sections:
            if section in config:
                print(f"✅ {section} section found")
            else:
                print(f"❌ {section} section missing")
                return False
                
    except json.JSONDecodeError as e:
        print(f"❌ Configuration file has invalid JSON: {e}")
        return False
    
    return True

def test_environment():
    """Test environment variables and setup"""
    print("\n🌍 Testing environment...")
    
    # Check for OpenAI API key
    if os.environ.get('OPENAI_API_KEY'):
        print("✅ OPENAI_API_KEY is set")
    else:
        print("⚠️ OPENAI_API_KEY not set (optional for testing)")
    
    # Check for GitHub token
    if os.environ.get('GITHUB_TOKEN'):
        print("✅ GITHUB_TOKEN is set")
    else:
        print("⚠️ GITHUB_TOKEN not set (optional for testing)")
    
    # Check if we're in a git repository
    try:
        result = subprocess.run(['git', 'rev-parse', '--git-dir'], capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ Git repository detected")
        else:
            print("❌ Not in a git repository")
            return False
    except FileNotFoundError:
        print("❌ Git not available")
        return False
    
    return True

def test_npm_scripts():
    """Test if required npm scripts are available"""
    print("\n📦 Testing npm scripts...")
    
    try:
        # Check if package.json exists
        package_json_path = Path.cwd() / "package.json"
        if not package_json_path.exists():
            print("❌ package.json not found")
            return False
        
        with open(package_json_path, 'r') as f:
            package_data = json.load(f)
        
        scripts = package_data.get('scripts', {})
        required_scripts = ['check:strict', 'check-deps:json']
        
        for script in required_scripts:
            if script in scripts:
                print(f"✅ npm script '{script}' found")
            else:
                print(f"⚠️ npm script '{script}' not found (may affect analysis)")
        
    except Exception as e:
        print(f"❌ Error checking npm scripts: {e}")
        return False
    
    return True

def test_agent_execution():
    """Test basic agent execution without API calls"""
    print("\n🤖 Testing agent execution...")
    
    agent_path = Path(__file__).parent / "ai-code-quality-agent.py"
    if not agent_path.exists():
        print("❌ ai-code-quality-agent.py not found")
        return False
    
    print("✅ AI agent script found")
    
    # Test if script is executable
    if os.access(agent_path, os.X_OK):
        print("✅ AI agent script is executable")
    else:
        print("⚠️ AI agent script is not executable (will be fixed by GitHub Actions)")
    
    return True

def test_github_workflow():
    """Test if GitHub workflow file is properly configured"""
    print("\n⚙️ Testing GitHub workflow...")
    
    workflow_path = Path.cwd() / ".github" / "workflows" / "ai-code-quality-agent.yml"
    if not workflow_path.exists():
        print("❌ GitHub workflow file not found")
        return False
    
    print("✅ GitHub workflow file found")
    
    # Basic validation of workflow file
    try:
        with open(workflow_path, 'r') as f:
            content = f.read()
        
        required_elements = [
            'ai-code-quality-agent.py',
            'OPENAI_API_KEY',
            'GITHUB_TOKEN',
            'pull_request',
            'schedule'
        ]
        
        for element in required_elements:
            if element in content:
                print(f"✅ Workflow contains '{element}'")
            else:
                print(f"❌ Workflow missing '{element}'")
                return False
                
    except Exception as e:
        print(f"❌ Error reading workflow file: {e}")
        return False
    
    return True

def main():
    """Run all tests"""
    print("🧪 AI Code Quality Agent - Setup Validation")
    print("=" * 50)
    
    tests = [
        ("Dependencies", test_dependencies),
        ("Configuration", test_configuration),
        ("Environment", test_environment),
        ("NPM Scripts", test_npm_scripts),
        ("Agent Execution", test_agent_execution),
        ("GitHub Workflow", test_github_workflow)
    ]
    
    passed = 0
    total = len(tests)
    
    for test_name, test_func in tests:
        try:
            if test_func():
                passed += 1
            print()  # Add spacing between tests
        except Exception as e:
            print(f"❌ {test_name} test failed with error: {e}")
            print()
    
    print("=" * 50)
    print(f"📊 Test Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All tests passed! AI Code Quality Agent is ready to use.")
        print("\n🚀 Next steps:")
        print("1. Add OPENAI_API_KEY to GitHub repository secrets")
        print("2. Create a pull request to test the agent")
        print("3. Check the Actions tab for agent execution")
        return 0
    else:
        print("⚠️ Some tests failed. Please review the issues above.")
        print("\n🔧 Common fixes:")
        print("- Install missing dependencies: pip install -r scripts/requirements.txt")
        print("- Ensure you're in the repository root directory")
        print("- Check that all required files are present")
        return 1

if __name__ == "__main__":
    sys.exit(main())
