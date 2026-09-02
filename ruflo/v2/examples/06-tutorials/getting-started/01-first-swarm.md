# Your First Claude Flow Swarm

This tutorial will guide you through creating your first swarm and understanding how Claude Flow works.

## Prerequisites

- Claude Flow installed (`npm install -g claude-flow`)
- Basic command line knowledge
- Node.js 18+ installed

## Step 1: Understanding Swarms

A swarm is a coordinated group of AI agents working together to complete a task. Each agent has specific capabilities and roles.

## Step 2: Create a Simple Swarm

Let's create a basic "Hello World" application:

```bash
cd examples
../claude-flow swarm create "Build a hello world CLI application" \
  --name my-first-swarm \
  --output ./output/hello-world
```

### What happens:
1. Claude Flow creates a swarm coordinator
2. Assigns agents based on the task
3. Agents work together to build the application
4. Output is saved to the specified directory

## Step 3: Examine the Output

```bash
cd ./output/hello-world
ls -la
```

You should see:
- `index.js` - Main application file
- `package.json` - Node.js configuration
- `README.md` - Documentation
- `test.js` - Test file (if tests were requested)

## Step 4: Run Your Application

```bash
npm install  # Install any dependencies
npm start    # Run the application
```

## Step 5: Understanding Agent Roles

Check the swarm logs to see how agents collaborated:

```bash
cat ../../logs/swarm-*.log
```

You'll see agents like:
- **Analyzer**: Understood requirements
- **Developer**: Wrote the code
- **Documenter**: Created README
- **Tester**: Added tests

## Step 6: Customizing Your Swarm

Try with more specific requirements:

```bash
../claude-flow swarm create \
  "Build a CLI calculator that supports add, subtract, multiply, divide" \
  --agents 3 \
  --strategy development \
  --name calculator-swarm
```

### Parameters explained:
- `--agents 3`: Use 3 specialized agents
- `--strategy development`: Focus on code creation
- `--name`: Give your swarm a memorable name

## Next Steps

1. Try different strategies:
   - `research`: For gathering information
   - `analysis`: For code review
   - `testing`: For test creation
   - `optimization`: For performance improvements

2. Use configuration files:
   ```bash
   ../claude-flow swarm create "Your task" \
     --config ../01-configurations/basic/simple-config.json
   ```

3. Monitor swarm progress:
   ```bash
   ../claude-flow swarm create "Your task" --monitor
   ```

## Common Issues

**Problem**: Swarm takes too long
- **Solution**: Use `--timeout 60000` to set limits

**Problem**: Not enough detail in output
- **Solution**: Be more specific in your task description

**Problem**: Want different output structure
- **Solution**: Include structure requirements in your prompt

## Summary

You've learned to:
- ✅ Create a basic swarm
- ✅ Understand agent collaboration
- ✅ Customize swarm behavior
- ✅ Run generated applications

Continue to [Tutorial 2: Working with Workflows](./02-workflows-intro.md)