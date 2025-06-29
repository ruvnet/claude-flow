# 🤖 AI Code Quality Agent

An intelligent GitHub Actions agent that automatically analyzes code quality, security vulnerabilities, and architectural issues using AI-powered analysis.

## 🎯 Features

### 🧠 AI-Powered Analysis
- **OpenAI Codex-Mini Integration**: Efficient code analysis using specialized code models
- **Contextual Understanding**: Analyzes code in context of your project architecture
- **Smart Suggestions**: Provides actionable recommendations for improvements

### 🔍 Comprehensive Code Analysis
- **TypeScript Strict Mode Compliance**: Enforces zero-error policy
- **Security Vulnerability Detection**: Identifies potential security risks
- **Code Quality Assessment**: Detects code smells and maintainability issues
- **Architectural Review**: Analyzes design patterns and coupling

### 🚀 Automated Workflows
- **PR Analysis**: Automatic analysis on pull requests
- **Continuous Monitoring**: Daily scheduled scans
- **Issue Creation**: Auto-creates GitHub issues for critical problems
- **PR Comments**: Posts detailed analysis reports as PR comments

## 🛠️ Setup Instructions

### 1. Configure GitHub Secrets

Add these secrets to your GitHub repository:

```bash
# Required for AI analysis
OPENAI_API_KEY=your_openai_api_key_here

# Required for GitHub integration (usually auto-provided)
GITHUB_TOKEN=your_github_token_here

# Optional: For Slack notifications
SLACK_WEBHOOK=your_slack_webhook_url_here
```

### 2. Repository Setup

The agent is already configured and ready to use! The workflow will automatically:

- ✅ Run on every PR to `main` and `develop` branches
- ✅ Run daily at 3 AM UTC for proactive monitoring
- ✅ Can be manually triggered with different analysis depths

### 3. Manual Execution

You can also run the agent locally:

```bash
# Install dependencies
pip install -r scripts/requirements.txt

# Set environment variables
export OPENAI_API_KEY="your_key_here"
export GITHUB_TOKEN="your_token_here"

# Run the agent
python scripts/ai-code-quality-agent.py
```

## 📊 Analysis Types

### 🔒 Security Analysis
- Hardcoded secrets detection
- Unsafe pattern identification (eval, innerHTML, etc.)
- Dependency vulnerability scanning
- XSS and injection vulnerability detection

### 📈 Code Quality Analysis
- TypeScript strict mode compliance
- Code complexity analysis
- Duplicate code detection
- Function length and nesting analysis
- Type safety assessment

### 🏗️ Architectural Analysis
- Design pattern compliance
- Circular dependency detection
- Module coupling analysis
- SOLID principles adherence

### 🎯 Claude-Flow Specific Checks
- SPARC methodology compliance
- Agent orchestration patterns
- MCP integration validation
- Swarm coordination analysis

## 📋 Report Examples

### ✅ Successful Analysis
```markdown
# 🤖 AI Code Quality Analysis Report

**Generated:** 2024-01-15T10:30:00Z
**Analyzed Files:** 15

## 📊 Summary
✅ **TypeScript Strict Mode:** PASSED
✅ **Security Audit:** No vulnerabilities found
🔍 **Code Quality Issues:** 3 medium, 1 low

## 💡 AI Suggestions
- Consider extracting complex logic in `src/agents/coordinator.ts` into smaller functions
- Add input validation to `src/api/handlers.ts` for better security
- Use more specific types instead of `any` in `src/types/common.ts`
```

### ❌ Issues Found
```markdown
# 🤖 AI Code Quality Analysis Report

❌ **TypeScript Strict Mode:** FAILED (5 errors)
🔒 **Security Vulnerabilities:** 2 found (1 high severity)

## 📋 Critical Issues
🔴 **Security** (high): Use of eval() detected - potential security risk
  - File: `src/utils/dynamic-loader.ts`
🟡 **Quality** (medium): Excessive use of "any" type - consider proper typing
  - File: `src/types/legacy.ts`
```

## ⚙️ Configuration

The agent behavior can be customized via `scripts/ai-agent-config.json`:

```json
{
  "analysis_rules": {
    "typescript_strict_mode": {
      "enabled": true,
      "fail_on_errors": true,
      "max_errors": 0
    },
    "security_patterns": {
      "enabled": true,
      "patterns": [...]
    }
  },
  "thresholds": {
    "critical_issues": {
      "max_high_severity": 0,
      "max_medium_severity": 5
    }
  }
}
```

## 🔄 Workflow Triggers

### Automatic Triggers
- **Pull Requests**: Analyzes changed files in PRs
- **Push to Main**: Full repository analysis
- **Daily Schedule**: Proactive monitoring at 3 AM UTC

### Manual Triggers
```bash
# Trigger via GitHub Actions UI
# Go to Actions → AI Code Quality Agent → Run workflow
# Choose analysis depth: quick/full/deep
```

## 📈 Integration Benefits

### For Developers
- **Early Issue Detection**: Catch problems before they reach production
- **Learning Tool**: AI suggestions help improve coding practices
- **Consistent Standards**: Enforces project-wide quality standards

### For Teams
- **Automated Reviews**: Reduces manual code review overhead
- **Quality Metrics**: Track code quality trends over time
- **Security Assurance**: Continuous security monitoring

### For Claude-Flow Project
- **Architecture Compliance**: Ensures adherence to established patterns
- **Agent Quality**: Validates AI agent implementations
- **Coordination Integrity**: Monitors multi-agent orchestration

## 🚨 Troubleshooting

### Common Issues

**Agent fails with "No OpenAI API key"**
```bash
# Solution: Add OPENAI_API_KEY to GitHub secrets
# Go to Settings → Secrets and variables → Actions
```

**TypeScript errors not detected**
```bash
# Solution: Ensure npm scripts are properly configured
npm run check:strict  # Should be available
```

**PR comments not posting**
```bash
# Solution: Check GitHub token permissions
# Ensure GITHUB_TOKEN has write access to pull-requests
```

## 🔮 Future Enhancements

- **Custom Rule Engine**: Define project-specific analysis rules
- **ML Model Training**: Train custom models on your codebase
- **Integration Expansion**: Slack, Teams, Discord notifications
- **Performance Monitoring**: Track analysis performance over time
- **Advanced Metrics**: Code complexity trends, technical debt tracking

## 📞 Support

For issues or questions about the AI Code Quality Agent:

1. **Check the workflow logs** in GitHub Actions
2. **Review the configuration** in `scripts/ai-agent-config.json`
3. **Create an issue** with the `ai-agent` label
4. **Manual testing** using the local execution instructions

---

*🤖 This agent is designed specifically for the Claude-Flow project and its unique architectural patterns.*
