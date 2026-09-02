---
name: aidefence-scan
version: 1.0.0
description: Scan inputs for AI manipulation attempts using AIMDS threat detection
author: rUv
tags: [security, threat-detection, prompt-injection, aidefence]

# Skill metadata
invocation:
  - /aidefence
  - /defend
  - /threat-scan

# Dependencies
requires:
  - "@claude-flow/aidefence"
---

# AIDefence Scan Skill

Scan user inputs, agent outputs, and code for AI manipulation attempts including prompt injection, jailbreak attempts, and PII exposure.

## Commands

### `/aidefence scan <text>`
Scan text for threats.

### `/aidefence analyze <file>`
Analyze a file for security issues.

### `/aidefence status`
Show detection statistics and learned patterns.

---

## Execution Instructions

When this skill is invoked, execute the following:

### Step 1: Initialize AIDefence

```typescript
import { createAIDefence } from '@claude-flow/aidefence';

const aidefence = createAIDefence({ enableLearning: true });
```

### Step 2: Based on Command

**For `/aidefence scan <text>` or `/defend <text>`:**

1. Extract the text to scan from the user's message
2. Run threat detection:

```typescript
const result = await aidefence.detect(userInput);

if (!result.safe) {
  // Report threats found
  console.log(`⚠️ ${result.threats.length} threat(s) detected:`);
  for (const threat of result.threats) {
    console.log(`  - [${threat.severity.toUpperCase()}] ${threat.type}: ${threat.description}`);
    console.log(`    Confidence: ${(threat.confidence * 100).toFixed(1)}%`);
  }
} else {
  console.log('✅ No threats detected');
}

if (result.piiFound) {
  console.log('⚠️ PII detected in input (emails, SSNs, API keys, etc.)');
}

console.log(`Detection time: ${result.detectionTimeMs.toFixed(2)}ms`);
```

3. If threats are critical, suggest mitigations:

```typescript
for (const threat of result.threats.filter(t => t.severity === 'critical')) {
  const mitigation = await aidefence.getBestMitigation(threat.type);
  if (mitigation) {
    console.log(`Recommended mitigation for ${threat.type}: ${mitigation.strategy}`);
    console.log(`  Effectiveness: ${(mitigation.effectiveness * 100).toFixed(1)}%`);
  }
}
```

**For `/aidefence analyze <file>`:**

1. Read the file content using the Read tool
2. Scan the content for threats
3. Report findings with line numbers if possible

**For `/aidefence status`:**

```typescript
const stats = await aidefence.getStats();
console.log('📊 AIDefence Statistics:');
console.log(`  Detections: ${stats.detectionCount}`);
console.log(`  Avg detection time: ${stats.avgDetectionTimeMs.toFixed(2)}ms`);
console.log(`  Learned patterns: ${stats.learnedPatterns}`);
console.log(`  Mitigation strategies: ${stats.mitigationStrategies}`);
console.log(`  Avg mitigation effectiveness: ${(stats.avgMitigationEffectiveness * 100).toFixed(1)}%`);
```

### Step 3: Learn from Feedback

If the user provides feedback on detection accuracy:

```typescript
await aidefence.learnFromDetection(input, result, {
  wasAccurate: userSaysAccurate,
  userVerdict: userFeedback
});
```

## Example Outputs

### Threat Detected
```
⚠️ 2 threat(s) detected:
  - [CRITICAL] jailbreak: DAN jailbreak attempt
    Confidence: 98.0%
  - [HIGH] role_switching: Attempt to change AI identity
    Confidence: 85.0%

Recommended mitigation for jailbreak: block
  Effectiveness: 95.2%

Detection time: 0.08ms
```

### Safe Input
```
✅ No threats detected
Detection time: 0.05ms
```

### PII Warning
```
✅ No manipulation threats detected
⚠️ PII detected in input (emails, SSNs, API keys, etc.)
Detection time: 0.06ms
```

## Integration Notes

- This skill uses the embedded `@claude-flow/aidefence` package
- No external server required
- Learning is enabled by default for pattern improvement
- Detection targets: <10ms (actual: ~0.06ms)
