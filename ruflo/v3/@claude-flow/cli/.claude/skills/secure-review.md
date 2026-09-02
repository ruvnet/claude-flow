---
name: secure-review
version: 1.0.0
description: Security-focused code review with AI manipulation detection
author: rUv
tags: [security, code-review, aidefence]

invocation:
  - /secure-review
  - /security-review

requires:
  - "@claude-flow/aidefence"
---

# Secure Review Skill

Perform security-focused code reviews that include AI manipulation detection, credential scanning, and security best practice validation.

## Commands

### `/secure-review <file-or-directory>`
Review code for security issues including:
- Hardcoded credentials
- Prompt injection vulnerabilities
- Unsafe input handling
- Security anti-patterns

### `/secure-review --quick <file>`
Quick security scan without detailed analysis.

### `/secure-review --fix <file>`
Review and suggest fixes for security issues.

---

## Execution Instructions

When `/secure-review` is invoked:

### Step 1: Initialize Security Tools

```typescript
import { createAIDefence } from '@claude-flow/aidefence';

const aidefence = createAIDefence({ enableLearning: true });
```

### Step 2: Read and Analyze Files

For each file to review:

1. **Read the file** using the Read tool
2. **Scan for PII/Credentials**:
```typescript
const piiResult = aidefence.hasPII(fileContent);
if (piiResult) {
  findings.push({
    type: 'pii',
    severity: 'high',
    message: 'Potential credentials or PII detected',
    file: filePath
  });
}
```

3. **Check for dangerous patterns**:
```typescript
const dangerousPatterns = [
  { pattern: /eval\s*\(/, message: 'Unsafe eval() usage', severity: 'critical' },
  { pattern: /innerHTML\s*=/, message: 'Potential XSS via innerHTML', severity: 'high' },
  { pattern: /shell:\s*true/, message: 'Shell injection risk', severity: 'critical' },
  { pattern: /dangerouslySetInnerHTML/, message: 'Dangerous HTML injection', severity: 'high' },
  { pattern: /password.*=.*['"][^'"]+['"]/, message: 'Hardcoded password', severity: 'critical' },
];

for (const { pattern, message, severity } of dangerousPatterns) {
  const match = fileContent.match(pattern);
  if (match) {
    findings.push({ type: 'security', severity, message, file: filePath, line: getLineNumber(match) });
  }
}
```

4. **Scan for prompt injection in AI code**:
```typescript
// If file contains AI/LLM related code
if (/openai|anthropic|llm|prompt|chat/i.test(fileContent)) {
  // Check for unsafe prompt construction
  const unsafePromptPatterns = [
    /\$\{.*user.*\}/i,  // Template literal with user input
    /\+ .*input/i,      // String concatenation with input
    /prompt.*=.*request/i, // Direct request to prompt
  ];

  for (const pattern of unsafePromptPatterns) {
    if (pattern.test(fileContent)) {
      findings.push({
        type: 'prompt_injection_risk',
        severity: 'high',
        message: 'Potential prompt injection vulnerability - user input directly in prompt',
        file: filePath
      });
    }
  }
}
```

### Step 3: Generate Report

```markdown
## Security Review Report

### Summary
- Files reviewed: X
- Critical issues: X
- High severity: X
- Medium severity: X
- Low severity: X

### Findings

#### Critical
1. **[file.ts:42]** Hardcoded API key detected
   - **Risk**: Credential exposure
   - **Fix**: Move to environment variable

#### High
1. **[api.ts:108]** User input directly concatenated to prompt
   - **Risk**: Prompt injection vulnerability
   - **Fix**: Sanitize and validate user input before including in prompts

### Recommendations
1. Enable input validation at all API boundaries
2. Use environment variables for all credentials
3. Implement prompt injection defenses for AI code
```

### Step 4: Learn from Review

```typescript
// Store review patterns for learning
for (const finding of findings) {
  await aidefence.learnFromDetection(
    finding.context,
    { safe: false, threats: [{ type: finding.type, severity: finding.severity }] }
  );
}
```

## Example Output

```
🔍 Security Review: src/api/

Scanning 12 files...

❌ CRITICAL: src/api/config.ts:15
   Hardcoded API key: sk-ant-api03...
   → Move to .env file and use process.env.ANTHROPIC_API_KEY

⚠️ HIGH: src/api/chat.ts:42
   User input directly in prompt template
   → Sanitize input: const sanitized = sanitizeForPrompt(userInput)

⚠️ HIGH: src/api/chat.ts:67
   No input length validation
   → Add: if (input.length > MAX_INPUT_LENGTH) throw new Error('...')

ℹ️ MEDIUM: src/api/utils.ts:23
   Using eval() for JSON parsing
   → Use JSON.parse() instead

📊 Summary: 1 critical, 2 high, 1 medium issues found
```

## Integration Notes

- Works with `reviewer` agent for comprehensive code reviews
- Findings are stored in memory for pattern learning
- Can be triggered automatically via pre-commit hooks
