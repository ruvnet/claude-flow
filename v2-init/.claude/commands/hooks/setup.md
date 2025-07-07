# Hook Setup Guide

## Overview
Step-by-step guide to setting up and configuring Claude Flow hooks.

## Installation

### 1. Initialize Hooks
```bash
claude-flow hooks init
```

### 2. Configure Settings
Edit `.claude/settings.json`:
```json
{
  "hooks": {
    "enabled": true,
    "pre-edit": {
      "commands": [
        "npx ruv-swarm hook pre-edit --file {file}"
      ]
    },
    "post-task": {
      "commands": [
        "npx ruv-swarm hook post-task --task-id {taskId}"
      ]
    }
  }
}
```

### 3. Test Hooks
```bash
claude-flow hooks test
```

## Custom Hooks

### Creating Custom Hooks
1. Create hook script in `.claude/hooks/`
2. Register in settings.json
3. Test with `claude-flow hooks test [name]`

### Example Custom Hook
```javascript
// .claude/hooks/my-hook.js
module.exports = async (context) => {
  console.log('Hook triggered:', context);
  // Your custom logic here
};
```

## Best Practices
- Keep hooks lightweight
- Handle errors gracefully
- Log important events
- Use async/await for async operations
- Test thoroughly before production use
