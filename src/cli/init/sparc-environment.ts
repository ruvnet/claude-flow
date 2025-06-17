// init/sparc-environment.ts - SPARC development environment setup
export async function createSparcEnvironment(): Promise<void> {
  const fs = await import('fs/promises');
  
  // Create .roomodes file with 17 pre-configured modes
  const roomodes = createRoomodes();
  await fs.writeFile('.roomodes', JSON.stringify(roomodes, null, 2));
  console.log('  ✅ Created .roomodes file with 17 pre-configured modes');
  
  // Create comprehensive CLAUDE.md with batch tools integration
  const claudeMd = createClaudeMd();
  await fs.writeFile('CLAUDE.md', claudeMd);
  console.log('  ✅ Created CLAUDE.md with batch tools and swarm orchestration');
  
  console.log('  ✅ SPARC environment configured with batch tools integration');
}

function createRoomodes() {
  return {
    "orchestrator": {
      "description": "Multi-agent task orchestration and coordination",
      "prompt": "SPARC: orchestrator\\nYou are an AI orchestrator coordinating multiple specialized agents to complete complex tasks efficiently using TodoWrite, TodoRead, Task, and Memory tools.",
      "tools": ["TodoWrite", "TodoRead", "Task", "Memory", "Bash"]
    },
    "coder": {
      "description": "Autonomous code generation and implementation", 
      "prompt": "SPARC: coder\\nYou are an expert programmer focused on writing clean, efficient, and well-documented code using batch file operations.",
      "tools": ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "TodoWrite"]
    },
    "researcher": {
      "description": "Deep research and comprehensive analysis",
      "prompt": "SPARC: researcher\\nYou are a research specialist focused on gathering comprehensive information using parallel WebSearch/WebFetch and Memory coordination.",
      "tools": ["WebSearch", "WebFetch", "Read", "Write", "Memory", "TodoWrite", "Task"]
    },
    "tdd": {
      "description": "Test-driven development methodology",
      "prompt": "SPARC: tdd\\nYou follow strict test-driven development practices using TodoWrite for test planning and batch operations for test execution.",
      "tools": ["Read", "Write", "Edit", "Bash", "TodoWrite", "Task"]
    },
    "architect": {
      "description": "System design and architecture planning",
      "prompt": "SPARC: architect\\nYou are a software architect focused on designing scalable, maintainable system architectures using Memory for design coordination.",
      "tools": ["Read", "Write", "Glob", "Memory", "TodoWrite", "Task"]
    },
    "reviewer": {
      "description": "Code review and quality optimization",
      "prompt": "SPARC: reviewer\\nYou are a code reviewer focused on improving code quality using batch file analysis and systematic review processes.",
      "tools": ["Read", "Edit", "Grep", "Bash", "TodoWrite", "Memory"]
    },
    "debugger": {
      "description": "Debug and fix issues systematically",
      "prompt": "SPARC: debugger\\nYou are a debugging specialist using TodoWrite for systematic debugging and Memory for tracking issue patterns.",
      "tools": ["Read", "Edit", "Bash", "Grep", "TodoWrite", "Memory"]
    },
    "tester": {
      "description": "Comprehensive testing and validation",
      "prompt": "SPARC: tester\\nYou are a testing specialist using TodoWrite for test planning and parallel execution for comprehensive coverage.",
      "tools": ["Read", "Write", "Edit", "Bash", "TodoWrite", "Task"]
    },
    "analyzer": {
      "description": "Code and data analysis specialist",
      "prompt": "SPARC: analyzer\\nYou are an analysis specialist using batch operations for efficient data processing and Memory for insight coordination.",
      "tools": ["Read", "Grep", "Bash", "Write", "Memory", "TodoWrite", "Task"]
    },
    "optimizer": {
      "description": "Performance optimization specialist",
      "prompt": "SPARC: optimizer\\nYou are a performance optimization specialist using systematic analysis and TodoWrite for optimization planning.",
      "tools": ["Read", "Edit", "Bash", "Grep", "TodoWrite", "Memory"]
    },
    "documenter": {
      "description": "Documentation generation and maintenance",
      "prompt": "SPARC: documenter\\nYou are a documentation specialist using batch file operations and Memory for comprehensive documentation coordination.",
      "tools": ["Read", "Write", "Glob", "Memory", "TodoWrite"]
    },
    "designer": {
      "description": "UI/UX design and user experience",
      "prompt": "SPARC: designer\\nYou are a UI/UX designer using Memory for design coordination and TodoWrite for design process management.",
      "tools": ["Read", "Write", "Edit", "Memory", "TodoWrite"]
    },
    "innovator": {
      "description": "Creative problem solving and innovation",
      "prompt": "SPARC: innovator\\nYou are an innovation specialist using WebSearch for inspiration and Memory for idea coordination across sessions.",
      "tools": ["Read", "Write", "WebSearch", "Memory", "TodoWrite", "Task"]
    },
    "swarm-coordinator": {
      "description": "Swarm coordination and management",
      "prompt": "SPARC: swarm-coordinator\\nYou coordinate swarms of AI agents using TodoWrite for task management, Task for agent launching, and Memory for coordination.",
      "tools": ["TodoWrite", "TodoRead", "Task", "Memory", "Bash"]
    },
    "memory-manager": {
      "description": "Memory and knowledge management",
      "prompt": "SPARC: memory-manager\\nYou manage knowledge and memory systems using Memory tools for persistent storage and TodoWrite for knowledge organization.",
      "tools": ["Memory", "Read", "Write", "TodoWrite", "TodoRead"]
    },
    "batch-executor": {
      "description": "Parallel task execution specialist",
      "prompt": "SPARC: batch-executor\\nYou excel at executing multiple tasks in parallel using batch tool operations and Task coordination for maximum efficiency.",
      "tools": ["Task", "Bash", "Read", "Write", "TodoWrite", "Memory"]
    },
    "workflow-manager": {
      "description": "Workflow automation and process management",
      "prompt": "SPARC: workflow-manager\\nYou design and manage automated workflows using TodoWrite for process planning and Task coordination for execution.",
      "tools": ["TodoWrite", "TodoRead", "Task", "Bash", "Memory"]
    }
  };
}

function createClaudeMd(): string {
  return `# Claude Code Configuration for Your Project

## 🎯 Purpose of This Configuration
This CLAUDE.md file configures Claude Code to help you BUILD YOUR OWN APPLICATIONS using the claude-flow orchestration system. Claude-flow is a tool to help you develop software - it is NOT the project you should be modifying.

**IMPORTANT**: 
- Use claude-flow commands to BUILD YOUR APPLICATION
- DO NOT modify the claude-flow system itself
- Focus on YOUR PROJECT'S code, not the orchestration tool

## 📁 Project Structure
When building your application, organize your code in:
- \`src/\`: Your application source code
- \`tests/\`: Your application tests
- \`docs/\`: Your project documentation
- \`config/\`: Your application configuration

## 🛠️ Your Project's Build Commands
Configure these for YOUR application (not claude-flow):
- \`npm run build\`: Build YOUR project
- \`npm run test\`: Run YOUR project's test suite
- \`npm run lint\`: Run linting on YOUR code
- \`npm run typecheck\`: Type check YOUR TypeScript code
- \`npm start\`: Start YOUR application

## 🚀 Using Claude-Flow to Build Your Application

Claude-flow provides powerful AI orchestration tools to accelerate YOUR application development. Use these commands to build YOUR project:

### 🎮 Getting Started with Your Project
- \`./claude-flow start --ui\`: Start the AI orchestration system to help build YOUR app
- \`./claude-flow sparc "Build a [YOUR APP TYPE] application"\`: Start building YOUR application
- \`./claude-flow swarm "Create [YOUR FEATURE]"\`: Use multiple AI agents to build complex features
- \`./claude-flow status\`: Check the status of YOUR development tasks

### 🤖 AI Agents to Build Your Application
- \`./claude-flow agent spawn coder\`: Create a coding agent for YOUR project
- \`./claude-flow agent spawn researcher\`: Research best practices for YOUR features
- \`./claude-flow agent spawn tester\`: Create tests for YOUR application
- \`./claude-flow agent list\`: See agents working on YOUR project

### 📋 Managing Your Development Tasks
- \`./claude-flow task create feature "Add user authentication to my app"\`: Create development tasks
- \`./claude-flow task list\`: View YOUR project's task queue
- \`./claude-flow workflow my-app-workflow.json\`: Automate YOUR development workflow

### 🧠 Project Knowledge Management
- \`./claude-flow memory store "my_app_architecture" "REST API with React frontend"\`: Store YOUR project decisions
- \`./claude-flow memory get "my_app_requirements"\`: Retrieve YOUR project information
- \`./claude-flow memory list\`: See all stored knowledge about YOUR project
- \`./claude-flow memory export my-project-knowledge.json\`: Export YOUR project knowledge

### 🎯 SPARC Modes for Building Your Application
- \`./claude-flow sparc "Create a todo list app with React"\`: Start building YOUR app
- \`./claude-flow sparc run coder "Implement user login for my app"\`: Code YOUR features
- \`./claude-flow sparc tdd "Shopping cart functionality"\`: Build YOUR features test-first
- \`./claude-flow sparc run architect "Design my app's database schema"\`: Design YOUR architecture

**Available SPARC modes for YOUR project:**
- **coder**: Write code for YOUR application
- **architect**: Design YOUR system architecture
- **tdd**: Test-driven development for YOUR features
- **researcher**: Research solutions for YOUR requirements
- **reviewer**: Review YOUR code quality
- **debugger**: Debug issues in YOUR application
- **tester**: Test YOUR application thoroughly
- **documenter**: Document YOUR project

### 🐝 Swarm Mode: Multiple AI Agents for Your Project
\`./claude-flow swarm "Build a complete e-commerce website" --strategy development --parallel\`

Options for YOUR project:
- \`--strategy development\`: Build YOUR application features
- \`--strategy testing\`: Comprehensive testing of YOUR app
- \`--strategy optimization\`: Optimize YOUR application performance
- \`--max-agents 8\`: Use up to 8 AI agents for YOUR project
- \`--parallel\`: Build multiple features simultaneously

## 💡 Example Workflows for Your Projects

### 🚀 Building a New Web Application
\`\`\`bash
# Example: Building a Task Management App
./claude-flow sparc "Create a task management web app with React and Node.js"

# Add authentication to YOUR app
./claude-flow sparc run coder "Add user authentication with JWT tokens to my task app"

# Create tests for YOUR features
./claude-flow sparc tdd "Task creation and assignment features"

# Use multiple agents to build faster
./claude-flow swarm "Build complete task management system" --strategy development --parallel
\`\`\`

### 🔍 Research Phase for Your Project
\`\`\`bash
# Research best practices for YOUR app type
./claude-flow sparc run researcher "Research best practices for building SaaS applications"

# Store YOUR project's technical decisions
./claude-flow memory store "tech_stack" "React, Node.js, PostgreSQL, Redis"
./claude-flow memory store "auth_strategy" "JWT with refresh tokens"

# Analyze similar applications
./claude-flow sparc run analyzer "Analyze successful task management apps for feature ideas"
\`\`\`

### 🏗️ Development Workflow for Your Application
\`\`\`bash
# Design YOUR application architecture
./claude-flow sparc run architect "Design microservices architecture for my e-commerce platform"

# Implement YOUR features with TDD
./claude-flow sparc tdd "Shopping cart with discount calculation"

# Multiple agents working on YOUR project
./claude-flow swarm "Build user dashboard with analytics" --strategy development --max-agents 5

# Review and optimize YOUR code
./claude-flow sparc run reviewer "Review authentication implementation for security"
\`\`\`

### 🔧 Testing and Debugging Your Application
\`\`\`bash
# Comprehensive testing for YOUR app
./claude-flow sparc run tester "Create comprehensive test suite for my API endpoints"

# Debug issues in YOUR application
./claude-flow sparc run debugger "Debug why user login is failing in production"

# Performance optimization for YOUR app
./claude-flow sparc run optimizer "Optimize database queries in my application"

# Security review for YOUR project
./claude-flow sparc run reviewer "Security audit of my payment processing system"
\`\`\`

### 📚 Documentation for Your Project
\`\`\`bash
# Generate documentation for YOUR API
./claude-flow sparc run documenter "Create API documentation for my REST endpoints"

# Document YOUR project architecture
./claude-flow sparc run documenter "Document the system architecture and design decisions"

# Create user guides for YOUR application
./claude-flow sparc run documenter "Write user guide for the admin dashboard"
\`\`\`

## 🎨 Building Your Application Step by Step

### 📐 Planning Your Application
Store YOUR project decisions and requirements:

\`\`\`bash
# Define YOUR application requirements
./claude-flow memory store "app_type" "SaaS project management tool"
./claude-flow memory store "target_users" "Small to medium development teams"
./claude-flow memory store "core_features" "Task tracking, team collaboration, time tracking, reporting"

# Design YOUR architecture based on requirements
./claude-flow sparc run architect "Design scalable SaaS architecture for project management tool"

# Research best practices for YOUR app type
./claude-flow sparc run researcher "Research best practices for multi-tenant SaaS applications"
\`\`\`

### 🏗️ Building Your Application Features
Implement YOUR application step by step:

\`\`\`bash
# Phase 1: Core functionality
./claude-flow sparc tdd "User registration and team creation"
./claude-flow sparc run coder "Implement project and task management features"

# Phase 2: Advanced features
./claude-flow swarm "Build real-time collaboration features" --strategy development --parallel
./claude-flow sparc run coder "Add time tracking and reporting dashboard"

# Phase 3: Polish and optimize
./claude-flow sparc run optimizer "Optimize performance for 1000+ concurrent users"
./claude-flow sparc run designer "Improve UI/UX for mobile responsiveness"
\`\`\`

### 🚀 Deploying Your Application
Prepare YOUR application for production:

\`\`\`bash
# Final testing and security review
./claude-flow sparc run tester "Complete end-to-end testing suite"
./claude-flow sparc run reviewer "Final security audit before launch"

# Documentation for YOUR users
./claude-flow sparc run documenter "Create user documentation and API guides"

# Performance optimization
./claude-flow sparc run optimizer "Optimize for production deployment"
\`\`\`

## 🛠️ How Claude Code Helps Build YOUR Application

### 🤖 AI-Powered Development Assistance
When you use claude-flow commands, Claude Code will help you:
- **Write code** for YOUR application (not for claude-flow itself)
- **Design architecture** for YOUR project requirements
- **Create tests** for YOUR features
- **Debug issues** in YOUR code
- **Optimize performance** of YOUR application
- **Document** YOUR project

### 📋 Task Management for YOUR Project
Claude Code uses TodoWrite and TodoRead to manage YOUR development tasks:

\`\`\`javascript
// Example: Claude Code will create tasks for YOUR application development
TodoWrite([
  {
    id: "create_user_model",
    content: "Create User model for YOUR application",
    status: "pending",
    priority: "high"
  },
  {
    id: "implement_auth", 
    content: "Implement authentication for YOUR app",
    status: "pending",
    priority: "high"
  },
  {
    id: "add_user_dashboard",
    content: "Create user dashboard for YOUR application",
    status: "pending",
    priority: "medium"
  },
  {
    id: "write_tests",
    content: "Write tests for YOUR new features",
    status: "pending",
    priority: "high"
  }
]);
\`\`\`

## 🎯 SPARC Modes: Specialized AI Assistants for Your Project

Each SPARC mode is a specialized AI assistant that helps with different aspects of YOUR application development:

### 👨‍💻 Development Modes
- **coder**: Writes code for YOUR application features
- **architect**: Designs YOUR system architecture and database schemas
- **tdd**: Helps you build YOUR features with test-driven development
- **designer**: Creates UI/UX designs for YOUR application

### 🔍 Analysis & Research Modes
- **researcher**: Researches best practices for YOUR project needs
- **analyzer**: Analyzes YOUR code for improvements
- **optimizer**: Optimizes YOUR application's performance
- **reviewer**: Reviews YOUR code for quality and security

### 🛠️ Support Modes
- **debugger**: Helps debug issues in YOUR application
- **tester**: Creates comprehensive tests for YOUR features
- **documenter**: Writes documentation for YOUR project
- **innovator**: Suggests innovative features for YOUR application

## 🐝 Swarm Mode: Multiple AI Agents for Complex Features

Use swarm mode when building complex features that benefit from multiple specialized agents:

\`\`\`bash
# Example: Building a complete e-commerce platform
./claude-flow swarm "Build complete e-commerce platform with payment integration" \\
  --strategy development --parallel --max-agents 8

# Example: Adding real-time features to YOUR app
./claude-flow swarm "Add real-time chat and notifications to my app" \\
  --strategy development --parallel --max-agents 5

# Example: Comprehensive testing of YOUR application
./claude-flow swarm "Create comprehensive test suite for my API" \\
  --strategy testing --parallel --max-agents 6
\`\`\`

## 💻 Code Style for YOUR Project

When Claude Code writes code for YOUR application, it will follow these best practices:
- Modern ES6+ JavaScript/TypeScript
- Clean, readable code with proper naming
- Comprehensive error handling
- Security best practices
- Performance optimization
- Proper documentation

## 🚨 Important Reminders

### ✅ DO Use Claude-Flow For:
- Building YOUR new application
- Adding features to YOUR project
- Writing tests for YOUR code
- Debugging YOUR application
- Optimizing YOUR performance
- Documenting YOUR project

### ❌ DON'T Use Claude-Flow For:
- Modifying the claude-flow system itself
- Changing how claude-flow works internally
- Updating claude-flow commands or features
- Fixing claude-flow bugs (report them on GitHub instead)

## 🎉 Get Started Building YOUR Application!

Remember: Claude-flow is a TOOL to help you build YOUR application faster and better. Focus on describing what YOU want to build, and let the AI agents help you create it.

**Example first command for a new project:**
\`\`\`bash
./claude-flow sparc "Create a [YOUR APP TYPE] application with [YOUR MAIN FEATURES]"
\`\`\`

Happy coding! 🚀
`;
}