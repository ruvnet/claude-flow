# Background Commands in Claude Code

## Overview

Claude Code supports running shell commands in the background through multiple methods:

1. **Keyboard Shortcut**: Press `Ctrl+B` when Claude suggests a command to run it in the background (or `Ctrl+B Ctrl+B` in tmux)
2. **Programmatic Execution**: Use the `run_in_background` parameter in the Bash tool
3. **Prompt Instructions**: Request background execution directly in your prompts to Claude
4. **Interactive Management**: Use `/bashes` command to view and manage all background shells

This feature allows you to execute long-running processes without blocking your workflow, enabling continuous development while monitoring servers, builds, or other processes. Background tasks run in separate shells with unique IDs, allowing you to monitor output, check status, and terminate them as needed.

## Quick Reference

| Action | Method | Example |
|--------|--------|---------|
| **Start background task** | Ctrl+B or prompt | `"Run npm run dev in background"` |
| **List all tasks** | /bashes command | `/bashes` (interactive mode) |
| **Check specific task** | Prompt | `"Check status of bash_1"` |
| **View task output** | Prompt | `"Show output from bash_1"` |
| **Kill specific task** | Prompt or /bashes | `"Kill bash_1"` or press 'k' in /bashes |
| **Kill all tasks** | Prompt | `"Kill all background tasks"` |

### Common Shell IDs
- Background tasks are assigned IDs like `bash_1`, `bash_2`, `bash_3`, etc.
- IDs are sequential and unique per session
- IDs persist until the shell is killed or completes

### Quick Start

**Interactive (Keyboard)**:
When Claude presents a command, press `Ctrl+B` to run it in the background instead of the default foreground execution.

**Programmatic (Tool Parameter)**:
```javascript
{
  "tool": "Bash",
  "command": "npm run dev",
  "run_in_background": true  // This parameter triggers background execution
}
```

**Via Prompt**:
Simply tell Claude: "Start the dev server in the background" and Claude will automatically use the `run_in_background` parameter.

## Key Components

### 1. **Bash Tool with Background Support**
The standard Bash tool accepts a `run_in_background` parameter that spawns commands in a separate background shell.

#### Tool Parameters
```javascript
{
  "tool": "Bash",
  "command": "npm run dev",           // Required: Command to execute
  "run_in_background": true,          // Optional: Run in background
  "description": "Start dev server",  // Optional: Description
  "timeout": 60000                    // Optional: Timeout in ms (max 600000)
}
```

#### Example Usage in Claude
When interacting with Claude, you can request background execution like this:
```
User: "Start the development server"
Claude: I'll start the development server in the background so we can continue working.

[Claude uses Bash tool with run_in_background: true]
Command: npm run dev
Result: Command running in background with ID: bash_1
```

### 2. **BashOutput Tool**
Retrieves output from running or completed background shells. Each call returns only NEW output since the last check.

#### Tool Parameters
```javascript
{
  "tool": "BashOutput",
  "bash_id": "bash_1",               // Required: ID from background task
  "filter": "error|warning"          // Optional: Regex to filter output
}
```

#### Response Format
```xml
<status>running|completed|killed</status>
<exit_code>0</exit_code>  <!-- Only if completed -->
<stdout>
  [New output since last check]
</stdout>
<stderr>
  [Any error output]
</stderr>
<timestamp>2025-08-11T22:05:20.964Z</timestamp>
```

#### Example Usage
```
User: "Check if the server started successfully"
Claude: Let me check the output of the development server.

[Claude uses BashOutput tool]
bash_id: bash_1
Result:
<status>running</status>
<stdout>
  > my-app@1.0.0 dev
  > vite

  VITE v5.0.0  ready in 532 ms
  ➜  Local:   http://localhost:5173/
</stdout>

The server is running successfully at http://localhost:5173/
```

### 3. **KillBash Tool**
Terminates background shells by ID. Attempts graceful shutdown first.

#### Tool Parameters
```javascript
{
  "tool": "KillBash",
  "shell_id": "bash_1"               // Required: ID of background task to kill
}
```

#### Response Format
```json
{
  "success": true,
  "message": "Successfully killed shell: bash_1 (npm run dev)",
  "shell_id": "bash_1"
}
```

#### Example Usage
```
User: "Stop the dev server"
Claude: I'll stop the development server running in the background.

[Claude uses KillBash tool]
shell_id: bash_1
Result: Successfully killed shell: bash_1

The development server has been stopped.
```

## Interactive Commands and Shortcuts

### The /bashes Command

Claude Code includes a built-in command for managing background shells interactively:

```bash
/bashes
```

This command opens an interactive menu that displays:
- **All background shells** (running and completed)
- **Shell IDs** for reference (e.g., bash_1, bash_2)
- **Commands** that were executed
- **Status** (running, completed, killed)
- **Runtime** and exit codes

**Usage Example:**
```
> /bashes

Background Bash Shells
Select a shell to view details

1. npm run dev (running)
2. docker-compose up (running)  
3. npm test (completed)

↑/↓ to select · Enter to view · k to kill · Esc to close
```

When you select a shell and press Enter, you see:
- Last 10 lines of STDOUT
- Any STDERR output
- Runtime information
- Exit code (if completed)

### Using Ctrl+B for Background Execution

When Claude presents a command for execution, you have two options:
- **Enter/Return**: Execute in foreground (default)
- **Ctrl+B**: Execute in background

#### How It Works
1. Claude suggests a command: `npm run dev`
2. You see the prompt: "Press Enter to run or Ctrl+B for background"
3. Press `Ctrl+B` to run in background
4. Command starts with a unique ID (e.g., `bash_1`)
5. You can continue working while it runs

### Programmatic Invocation of Background Mode

The Ctrl+B functionality can be triggered programmatically by:

#### 1. Direct Tool Parameter
```javascript
// This is what happens when you press Ctrl+B
{
  "tool": "Bash",
  "command": "npm run dev",
  "run_in_background": true  // Ctrl+B sets this to true
}
```

#### 2. Claude-Flow Automation
```javascript
// Automated background detection
function handleCommand(command) {
  const shouldBackground = detectLongRunning(command);
  
  return {
    tool: "Bash",
    command: command,
    run_in_background: shouldBackground  // Simulates Ctrl+B
  };
}
```

#### 3. Hook System Integration
```bash
# Pre-command hook that simulates Ctrl+B for certain commands
npx claude-flow hooks pre-command \
  --auto-background "npm run dev" \
  --auto-background "docker-compose up"
```

### Terminal Compatibility

- **Standard Terminals**: `Ctrl+B` triggers background execution
- **Tmux Sessions**: `Ctrl+B Ctrl+B` (double tap) since Ctrl+B is tmux prefix
- **VS Code Terminal**: `Ctrl+B` works normally
- **SSH Sessions**: `Ctrl+B` passes through to Claude Code

## Practical Examples with Claude Code Tools

### Real-World Example: Starting a Development Server

Here's an actual example of starting and verifying a background server:

```bash
# Start Python HTTP server in background
User: "Start a dev server in the background"

Claude: [Uses Bash tool with run_in_background: true]
Command: python3 -m http.server 8080
Result: Command running in background with ID: bash_3

# Verify it's running
Claude: [Uses BashOutput tool]
bash_id: bash_3
Result:
<status>running</status>
<stderr>
127.0.0.1 - - [11/Aug/2025 22:18:58] "HEAD / HTTP/1.1" 200 -
127.0.0.1 - - [11/Aug/2025 22:19:37] "GET / HTTP/1.1" 200 -
</stderr>

# Test the server
Claude: [Uses Bash tool]
Command: curl http://localhost:8080
Result: <!DOCTYPE HTML><html>... (server is responding)
```

### Complete Development Workflow Example

#### Step 1: Starting Multiple Background Services
```
User: "Set up the full development environment with frontend, backend, and database"

Claude: I'll start all the development services in the background.

[Bash tool call 1]
command: docker-compose up postgres redis
run_in_background: true
→ Result: Command running in background with ID: bash_1

[Bash tool call 2] 
command: npm run api
run_in_background: true
→ Result: Command running in background with ID: bash_2

[Bash tool call 3]
command: npm run dev
run_in_background: true  
→ Result: Command running in background with ID: bash_3

All services are starting in the background. Let me check their status.
```

#### Step 2: Monitoring Service Health
```
[BashOutput tool call for bash_1]
bash_id: bash_1
→ Result:
<status>running</status>
<stdout>
  postgres_1  | database system is ready to accept connections
  redis_1     | Ready to accept connections
</stdout>

[BashOutput tool call for bash_2]
bash_id: bash_2
→ Result:
<status>running</status>
<stdout>
  API server listening on port 4000
  Connected to database
</stdout>

[BashOutput tool call for bash_3]
bash_id: bash_3
→ Result:
<status>running</status>
<stdout>
  VITE v5.0.0  ready in 532 ms
  ➜  Local:   http://localhost:5173/
</stdout>

All services are running successfully:
- Database and Redis: Ready
- API Server: http://localhost:4000
- Frontend: http://localhost:5173
```

#### Step 3: Continuous Monitoring During Development
```
User: "I'm getting an error when I click the login button"

Claude: Let me monitor the API server logs while you reproduce the issue.

[BashOutput tool call with filter]
bash_id: bash_2
filter: "error|Error|ERROR|failed"
→ Result:
<status>running</status>
<stdout>
  ERROR: Authentication failed - Invalid token format
  Error at AuthMiddleware.verify (src/middleware/auth.js:45)
</stdout>

I found the error! The authentication is failing due to an invalid token format at line 45 in the auth middleware.
```

#### Step 4: Cleanup
```
User: "I'm done for the day, please stop all services"

Claude: I'll stop all the running services.

[KillBash tool call 1]
shell_id: bash_3
→ Result: Successfully killed shell: bash_3 (npm run dev)

[KillBash tool call 2]
shell_id: bash_2
→ Result: Successfully killed shell: bash_2 (npm run api)

[KillBash tool call 3]
shell_id: bash_1
→ Result: Successfully killed shell: bash_1 (docker-compose up -d postgres redis)

All services have been stopped successfully.
```

### Real-Time Log Monitoring Example

```
User: "Monitor the application logs for any errors while I test the checkout flow"

Claude: I'll start monitoring your application logs in the background and filter for errors.

[Bash tool call]
command: tail -f /var/log/app.log
run_in_background: true
→ Result: Command running in background with ID: bash_4

Now I'll monitor for errors while you test. Let me know when you start.

User: "Starting the checkout test now"

[BashOutput tool call - First check]
bash_id: bash_4
filter: "error|exception|failed|Error|Exception"
→ Result:
<status>running</status>
<stdout>
  [2025-08-11 22:10:15] ERROR: Payment validation failed: Card expired
  [2025-08-11 22:10:15] Exception: PaymentException at checkout.js:234
</stdout>

I detected a payment error - the card appears to be expired. The exception occurred at checkout.js line 234.

[BashOutput tool call - Second check]
bash_id: bash_4
filter: "error|exception|failed|Error|Exception"
→ Result:
<status>running</status>
<stdout>
  [2025-08-11 22:10:45] ERROR: Inventory check failed for SKU-12345
  [2025-08-11 22:10:45] Error: Insufficient stock (requested: 5, available: 2)
</stdout>

Another error: Insufficient inventory for SKU-12345. Only 2 items available but 5 were requested.
```

### Build Process Management Example

```
User: "Run the production build but continue working on documentation"

Claude: I'll run the production build in the background so you can continue working.

[Bash tool call]
command: npm run build:production
run_in_background: true
→ Result: Command running in background with ID: bash_5

The production build is running in the background. You can continue with your documentation work.

[5 minutes later...]

Let me check the build progress:

[BashOutput tool call]
bash_id: bash_5
→ Result:
<status>completed</status>
<exit_code>0</exit_code>
<stdout>
  > build:production
  > webpack --mode production
  
  assets by status 1.2 MiB [cached] 12 assets
  ./src/index.js 523 KiB [built]
  webpack compiled successfully in 4523 ms
  Build completed successfully!
</stdout>

Great news! The production build completed successfully. The bundled assets are ready.
```

### Debugging with Background Processes

```
User: "The app is running slowly, can you investigate?"

Claude: I'll start monitoring system resources and application performance in the background.

[Bash tool call 1 - System monitoring]
command: top -b -d 2 | head -20
run_in_background: true
→ Result: Command running in background with ID: bash_6

[Bash tool call 2 - Application metrics]
command: npm run metrics:watch
run_in_background: true
→ Result: Command running in background with ID: bash_7

[After a moment, checking both]

[BashOutput tool call for bash_6]
bash_id: bash_6
→ Result:
<status>running</status>
<stdout>
  CPU: 87% - node (PID 12345)
  Memory: 2.3GB / 4GB
  Load average: 3.45, 2.89, 2.10
</stdout>

[BashOutput tool call for bash_7]
bash_id: bash_7
filter: "slow|timeout|bottleneck"
→ Result:
<status>running</status>
<stdout>
  SLOW QUERY: SELECT * FROM orders (2.3s)
  BOTTLENECK: Database connection pool exhausted
  TIMEOUT: Redis connection timeout after 5000ms
</stdout>

I found the issues:
1. High CPU usage (87%) from the Node process
2. Slow database query taking 2.3 seconds
3. Database connection pool is exhausted
4. Redis connection timeouts

The main bottleneck appears to be database-related.
```

## Common Use Cases and Commands

### Development Servers

#### Node.js/NPM
```bash
# Vite/React/Vue development servers
npm run dev              # run_in_background: true
npm run serve           # run_in_background: true
yarn dev                # run_in_background: true
pnpm dev                # run_in_background: true

# Watch modes
npm run watch           # run_in_background: true
npm run build:watch     # run_in_background: true
```

#### Python
```bash
# Django development server
python manage.py runserver              # run_in_background: true
python manage.py runserver 0.0.0.0:8000 # run_in_background: true

# Flask development server
flask run                               # run_in_background: true
flask run --host=0.0.0.0 --port=5000   # run_in_background: true

# FastAPI with uvicorn
uvicorn main:app --reload              # run_in_background: true
uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # run_in_background: true

# Simple HTTP server
python3 -m http.server 8080            # run_in_background: true
python -m SimpleHTTPServer 8000        # run_in_background: true (Python 2)
```

#### Docker Services
```bash
# Docker compose
docker-compose up                      # run_in_background: true
docker-compose up postgres redis       # run_in_background: true
docker-compose up -d                   # Already daemonized, but can still use background

# Individual containers
docker run -p 5432:5432 postgres      # run_in_background: true
docker run -p 6379:6379 redis         # run_in_background: true
```

#### Other Languages
```bash
# Ruby on Rails
rails server                           # run_in_background: true
bundle exec rails s                    # run_in_background: true

# PHP built-in server
php -S localhost:8000                  # run_in_background: true
php artisan serve                      # run_in_background: true (Laravel)

# Go
go run main.go                         # run_in_background: true
air                                    # run_in_background: true (hot reload)

# Rust
cargo run                              # run_in_background: true
cargo watch -x run                     # run_in_background: true
```

### Watch Processes
```bash
# Webpack watch mode
webpack --watch  # run_in_background: true

# TypeScript compiler watch
tsc --watch  # run_in_background: true

# Nodemon for auto-restart
nodemon server.js  # run_in_background: true
```

### Log Monitoring
```bash
# Tail application logs
tail -f /var/log/app.log  # run_in_background: true

# Journal logs
journalctl -f -u myservice  # run_in_background: true
```

### Build Processes
```bash
# Long-running builds
npm run build:production  # run_in_background: true

# Docker image builds
docker build -t myapp .  # run_in_background: true
```

## Integration with Claude-Flow

### Automatic Background Detection

Claude-Flow can be enhanced to automatically detect and run certain commands in the background:

#### Pattern-Based Detection
Commands matching these patterns could automatically use background execution:
- `npm run dev`, `yarn start`, `pnpm dev`
- `python manage.py runserver`, `flask run`, `uvicorn`
- `docker-compose up`, `docker run`
- `webpack --watch`, `parcel watch`
- Any command with `--watch` or `-w` flags

#### Configuration
Add to `.claude/settings.json`:
```json
{
  "autoBackground": {
    "enabled": true,
    "patterns": [
      "npm run dev",
      "yarn start",
      "docker-compose up",
      "*--watch*",
      "tail -f *"
    ],
    "excludePatterns": [
      "npm test",
      "npm run build"
    ]
  }
}
```

## Automatic Background Execution in Prompts

### Direct Prompt Instructions

You can instruct Claude to use background execution directly in your prompts:

#### Example Prompts
```markdown
# Explicit background instruction
"Start the development server in the background using run_in_background parameter"

# Implicit background request
"Launch the dev server and continue working on the API endpoints"
(Claude will recognize the need for background execution)

# Multiple background tasks
"Set up the full development environment:
- Start the frontend dev server in background
- Run the API server in background  
- Launch the database container in background
Then start implementing the user authentication"
```

### System Prompts for Agents

Configure agents to automatically use background execution:

```markdown
## Agent System Prompt Example
You are a development assistant. When executing commands:
1. ALWAYS run development servers with run_in_background: true
2. ALWAYS run watch processes in the background
3. For any command that includes 'dev', 'watch', 'serve', or 'monitor', use background execution
4. Monitor background tasks and report issues
5. Clean up background tasks when switching contexts

Special handling:
- npm run dev → always background
- docker-compose up → always background  
- build commands → foreground unless they exceed 30 seconds
- test commands → always foreground for immediate feedback
```

### CLAUDE.md Configuration

Add to your project's `CLAUDE.md` file to ensure automatic background execution:

```markdown
# Project Development Guidelines

## Command Execution Rules

### Always Run in Background:
- `npm run dev` - Frontend development server
- `npm run api` - API development server  
- `docker-compose up` - Local services
- `npm run watch` - File watcher
- Any command with --watch flag

### Background Monitoring:
After starting background tasks, periodically check their status using BashOutput.
Alert if any background task fails or stops unexpectedly.

### Example Workflow:
1. Start dev server in background: npm run dev (use run_in_background: true)
2. Monitor output: Check with BashOutput every 30 seconds
3. Continue with other tasks while server runs
4. Clean up: Use KillBash when done
```

### Prompt Templates

#### Development Setup Template
```markdown
Set up the development environment:
1. Run 'npm install' (foreground)
2. Start 'npm run dev' with run_in_background: true
3. Start 'npm run api' with run_in_background: true  
4. Monitor both background tasks for successful startup
5. Once confirmed running, proceed with [MAIN TASK]
```

#### Debugging Template
```markdown
Debug the application issue:
1. Start the app in background with verbose logging: 
   DEBUG=* npm run dev (use run_in_background: true)
2. Monitor the output using BashOutput with filter for "error|warning"
3. Reproduce the issue while monitoring logs
4. Analyze the filtered output for problems
```

### Agent-Specific Background Strategies

#### DevOps Agent
```javascript
// Agent configuration
{
  "name": "DevOps Agent",
  "autoBackground": {
    "rules": [
      { "pattern": "docker*", "background": true },
      { "pattern": "*compose*", "background": true },
      { "pattern": "kubectl logs -f", "background": true },
      { "pattern": "terraform apply", "background": false },
      { "pattern": "*--watch*", "background": true }
    ]
  }
}
```

#### QA Testing Agent
```javascript
{
  "name": "QA Agent",
  "autoBackground": {
    "rules": [
      { "pattern": "cypress open", "background": true },
      { "pattern": "jest --watch", "background": true },
      { "pattern": "npm test", "background": false },
      { "pattern": "playwright test", "background": false }
    ]
  }
}
```

### Swarm Coordination

When using Claude-Flow's hive-mind system:

```bash
# Spawn specialized background monitor agent
npx claude-flow hive-mind spawn "background-monitor" \
  --role "Monitor and manage all background processes" \
  --instructions "
    1. Track all background tasks
    2. Alert on failures
    3. Restart crashed services
    4. Report resource usage
    5. Use run_in_background for all monitoring commands
  "

# Main development agent with background awareness
npx claude-flow hive-mind spawn "full-stack-dev" \
  --role "Develop features while services run in background" \
  --instructions "
    Start all development servers in background:
    - Frontend: npm run dev (background)
    - Backend: npm run api (background)
    - Database: docker-compose up db (background)
    Then focus on feature implementation
  "
```

### Workflow Automation

Create automated workflows that leverage background execution:

```yaml
# .claude/workflows/dev-setup.yaml
name: Development Setup
steps:
  - name: Install Dependencies
    command: npm install
    background: false
    
  - name: Start Frontend
    command: npm run dev
    background: true
    monitor: true
    
  - name: Start Backend
    command: npm run api  
    background: true
    monitor: true
    
  - name: Start Database
    command: docker-compose up db
    background: true
    monitor: true
    
  - name: Wait for Services
    command: npx wait-on http://localhost:3000 http://localhost:4000
    background: false
    
  - name: Run Migrations
    command: npm run migrate
    background: false
    depends_on: [Start Database]
```

### Smart Command Wrapper

Create a command wrapper that automatically determines background execution:

```javascript
// .claude/scripts/smart-exec.js
const BACKGROUND_PATTERNS = [
  /^npm run (dev|watch|serve)/,
  /^yarn (dev|watch|start)/,
  /^pnpm (dev|watch|serve)/,
  /docker-compose up/,
  /--watch/,
  /webpack.*watch/,
  /nodemon/,
  /^ng serve/,
  /^vue-cli-service serve/,
  /^next dev/,
  /^nuxt dev/,
  /python.*runserver/,
  /flask run/,
  /uvicorn.*--reload/,
  /tail -f/,
  /journalctl.*-f/
];

function shouldRunInBackground(command) {
  return BACKGROUND_PATTERNS.some(pattern => pattern.test(command));
}

// Export for Claude-Flow integration
module.exports = { shouldRunInBackground };
```

### Context-Aware Background Decisions

Teach Claude to make intelligent background decisions:

```markdown
## Intelligent Background Execution Rules

### Analyze Command Intent:
1. **Development/Watch Commands** → Always background
   - Contains: dev, watch, serve, monitor
   - Purpose: Long-running observation

2. **Build Commands** → Conditional
   - If estimated >30 seconds → background
   - If <30 seconds → foreground

3. **Test Commands** → Usually foreground
   - Exception: --watch mode → background
   - CI/CD tests → foreground for immediate results

4. **Data Processing** → Analyze scope
   - Large datasets → background
   - Quick queries → foreground

### Multi-Step Workflows:
When executing multiple related commands:
1. Preparation steps (install, build) → foreground
2. Services (servers, databases) → background
3. Monitoring (logs, metrics) → background
4. Actions (migrations, seeds) → foreground
5. Cleanup → foreground

### Example Decision Tree:
```
Is it a server/service? → YES → Background
Is it watching files? → YES → Background  
Will it block further work? → YES → Background
Do I need immediate output? → NO → Background
Is it a one-time command? → YES → Foreground
Default → Foreground
```
```

### Hook System Integration

#### Pre-Command Hook
```bash
npx claude-flow hooks pre-command \
  --analyze-for-background \
  --auto-background-threshold 30
```

#### Background Monitor Hook
```bash
npx claude-flow hooks background-monitor \
  --check-interval 10 \
  --alert-on-failure
```

### MCP Tool Extensions

Potential new MCP tools for Claude-Flow:

1. **background_spawn**
   - Intelligently spawns commands in background
   - Manages resource allocation
   - Tracks process lifecycle

2. **background_monitor**
   - Real-time monitoring dashboard
   - Resource usage tracking
   - Automatic restart on failure

3. **background_orchestrate**
   - Manages multiple background processes
   - Dependencies between processes
   - Graceful shutdown sequences

## Managing Background Tasks

### Checking Task Status

#### Using /bashes Command
```bash
# Interactive mode - see all background shells
/bashes

# Output shows:
# - Shell ID (bash_1, bash_2, etc.)
# - Command that was run
# - Status (running/completed/killed)
# - Runtime and exit codes
```

#### Programmatic Status Checks
```bash
# Ask Claude to check specific shell
"Check the status of bash_3"

# Ask for all background tasks
"Show me all running background tasks"

# Get detailed output from specific shell
"Show me the output from bash_3"
```

### Monitoring Output

#### Real-time Monitoring Pattern
```bash
# Start a task
"Run npm run dev in background"
→ Returns: bash_1

# Check output periodically
"Check bash_1 output"
→ Shows new output since last check

# Filter for errors
"Check bash_1 for any errors"
→ Claude uses filter parameter in BashOutput
```

#### Output Management
```bash
# BashOutput only returns NEW output since last check
# This prevents overwhelming output from long-running tasks

# Example workflow:
1. Start server → bash_1
2. First check → Shows startup logs
3. Second check → Shows only new requests
4. Third check → Shows only newest activity
```

### Killing Background Tasks

#### Methods to Kill Tasks
```bash
# Method 1: Using /bashes interactive menu
/bashes
→ Select shell with arrow keys
→ Press 'k' to kill

# Method 2: Direct request to Claude
"Kill bash_3"
"Stop the npm dev server"
"Kill all background tasks"

# Method 3: Specific pattern matching
"Kill the task running on port 8080"
"Stop all docker containers running in background"
```

## Best Practices

### 1. **Shell ID Management**
```bash
# Always capture the shell ID when starting background tasks
"Start the server in background and tell me the shell ID"
→ "Command running in background with ID: bash_1"

# Keep track of what each ID is running
bash_1: npm run dev (frontend)
bash_2: npm run api (backend)
bash_3: docker-compose up (database)
```

### 2. **Resource Management**
- Monitor CPU and memory usage of background tasks
- Set timeouts for long-running processes
- Limit the number of concurrent background tasks
- Kill idle or stuck processes

### 3. **Error Handling**
```bash
# Regular status checks
"Check if bash_1 is still running"

# Monitor for errors
"Check bash_1 output for errors or warnings"

# Automatic restart pattern
"If bash_1 has stopped, restart npm run dev in background"
```

### 4. **Session Cleanup**
```bash
# Before ending session
"Kill all background tasks"

# Or selectively
"Kill bash_1 and bash_2 but keep bash_3 running"

# Verify cleanup
/bashes  # Should show no running tasks
```

### 5. **Output Management**
- Use filters to find specific patterns
- Check output periodically, not continuously
- Clear completed tasks from /bashes view
- Use structured logging when possible

## Advanced Features

### Session Persistence

Background tasks **automatically persist** across Claude Code sessions. No special commands needed!

```bash
# Start tasks in one session
claude
> Run npm run dev in background  # → bash_1
> Run docker-compose up in background  # → bash_2
> Exit

# Resume later - tasks still running!
claude --continue
> Check bash_1 output  # Dev server still running
> Check bash_2 status  # Docker still up
```

**Key Features:**
- Background processes keep running after you exit Claude
- Shell IDs (bash_1, bash_2, etc.) are preserved
- Output positions tracked for incremental reading
- Use `--continue` or `--resume` to reconnect

For complete details, see [Session Persistence Guide](./session-persistence.md).

### Task Orchestration
Coordinate multiple background tasks:
```bash
# Start development environment
npx claude-flow orchestrate dev-env \
  --background "npm run dev" \
  --background "npm run api" \
  --background "docker-compose up db" \
  --wait-healthy
```

### Intelligent Monitoring
```bash
# Smart monitoring with alerts
npx claude-flow monitor \
  --background-tasks \
  --alert-on "error|failed|exception" \
  --restart-on-failure
```

## Troubleshooting

### Common Issues

1. **Task not starting in background**
   - Verify `run_in_background: true` is set
   - Check for shell compatibility
   - Ensure command doesn't require interactive input

2. **Cannot retrieve output**
   - Verify correct bash_id
   - Check if task is still running
   - Look for buffering issues (use unbuffered output)

3. **Task won't terminate**
   - Use force kill if graceful shutdown fails
   - Check for child processes
   - Verify signal handling in application

### Debug Commands

#### Interactive Shell Management

**The `/bashes` command** provides an interactive interface for managing background shells:

```bash
# In Claude Code interactive mode, type:
/bashes

# This opens an interactive menu showing:
# - All running and completed background shells
# - Shell IDs, commands, and status
# - Runtime information and exit codes
```

**Interactive Controls:**
- **↑/↓**: Navigate between shells
- **Enter**: View detailed output for selected shell
- **k**: Kill the selected running shell
- **Esc**: Exit the menu

#### Programmatic Management

For programmatic control, use Claude Code's tool system:

```bash
# Check output of a specific background task
# Use the BashOutput tool with the bash_id

# Kill a specific background task  
# Use the KillBash tool with the shell_id

# Monitor background tasks
# Use the BashOutput tool periodically to check status
```

**Note:** The `/bashes` command is only available in interactive mode. For scripts and automation, use the BashOutput and KillBash tools through Claude's tool system.

## Performance Considerations

### Memory Usage
- Background tasks consume memory independently
- Monitor total system memory usage
- Implement memory limits per task

### CPU Usage
- Background tasks run concurrently
- May impact main Claude Code performance
- Consider nice levels for low-priority tasks

### I/O Considerations
- Background tasks share disk I/O
- Network bandwidth may be impacted
- Consider rate limiting for resource-intensive tasks

## Future Enhancements

### Planned Features
1. **Auto-detection of long-running commands**
2. **Smart resource allocation**
3. **Background task templates**
4. **Cross-session task migration**
5. **Distributed background execution**

### Community Requests
- Visual task manager UI
- Task dependency graphs
- Automatic restart policies
- Integration with container orchestration
- Background task marketplace

## Related Documentation

- [Claude Code Bash Tool Documentation](./bash-tool.md)
- [Claude-Flow Hooks System](./hooks-system.md)
- [MCP Tools Reference](./mcp-tools.md)
- [Session Management](./session-management.md)

## Examples Repository

Find more examples at: [claude-flow-examples/background-tasks](https://github.com/ruvnet/claude-flow-examples/tree/main/background-tasks)

---

*Last updated: August 2025*
*Claude-Flow Version: 2.0.0-alpha*