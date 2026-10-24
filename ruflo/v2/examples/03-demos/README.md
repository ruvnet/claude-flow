# Demo Scripts

Interactive demonstrations showing Claude Flow creating various applications through the swarm system.

## Directory Structure

```
03-demos/
├── quick/          # Fast demos (< 2 minutes)
├── interactive/    # User-interactive demos
├── swarm/          # Multi-agent swarm demos
├── api-creation/   # API-specific demos
├── create-swarm-sample.sh    # Original note app demo
├── demo-swarm-app.sh         # Original weather app demo
├── rest-api-demo.sh          # Original REST API demo
└── swarm-showcase.sh         # Original task manager demo
```

## Demo Categories

### Quick Demos (`quick/`)
- **quick-api-demo.sh**: Create a TODO API in under 2 minutes
  ```bash
  cd examples/03-demos/quick
  ./quick-api-demo.sh
  ```

### Interactive Demos (`interactive/`)
- **chat-bot-demo.sh**: Build a customized chat bot with user input
  ```bash
  cd examples/03-demos/interactive
  ./chat-bot-demo.sh
  ```

### Swarm Demos (`swarm/`)
- **multi-agent-demo.sh**: Watch 5 agents build a real-time dashboard
  ```bash
  cd examples/03-demos/swarm
  ./multi-agent-demo.sh
  ```

## Original Demos

### create-swarm-sample.sh
**Creates a note-taking CLI application** (929 lines)
- Full CRUD operations for notes
- Categories and search functionality
- Complete test suite

### demo-swarm-app.sh
**Weather CLI application demo** (407 lines)
- Simulates swarm creating a weather app
- Shows agent coordination
- Creates working application

### rest-api-demo.sh
**REST API creation demo** (342 lines)
- Express.js API with CRUD endpoints
- Database integration
- API documentation

### swarm-showcase.sh
**Task manager application** (407 lines)
- Complete feature showcase
- Priority management
- Export/import functionality

## Running Demos

All demos are executable shell scripts:

```bash
# Basic execution
./create-swarm-sample.sh

# See what's created
./demo-swarm-app.sh && ls -la output/

# Watch the process
./rest-api-demo.sh --verbose
```

## What Demos Show

1. **Swarm Initialization**
   - Creating swarm with objective
   - Agent assignment
   - Task decomposition

2. **Agent Coordination**
   - Parallel task execution
   - Information sharing
   - Quality verification

3. **Code Generation**
   - Main application code
   - Test suites
   - Documentation
   - Configuration files

4. **Output Structure**
   - Professional file organization
   - Complete package setup
   - Ready-to-run applications

## Demo Features

- **Live Progress**: Watch agents work in real-time
- **Quality Output**: Production-ready code
- **Best Practices**: Follows coding standards
- **Complete Apps**: Not just snippets, full applications