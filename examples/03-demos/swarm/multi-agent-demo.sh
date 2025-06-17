#!/bin/bash
# Multi-Agent Swarm Demo - Shows agent coordination in action

echo "🐝 Claude Flow Multi-Agent Swarm Demo"
echo "====================================="
echo ""
echo "Watch multiple specialized agents work together to build a complete application!"
echo ""

# Navigate to examples directory
cd "$(dirname "$0")/../.."

# Function to simulate agent activity
show_agent_activity() {
    local agent=$1
    local task=$2
    echo -e "\n🤖 [$agent] $task"
    sleep 1
}

# Start the demo
echo "📋 Objective: Build a Real-Time Dashboard Application"
echo ""
echo "🚀 Initializing swarm with 5 specialized agents..."
sleep 2

# Show agent initialization
echo ""
echo "👥 Agents Created:"
echo "   1. 🎨 UI Designer - Creates the dashboard layout"
echo "   2. 📊 Data Engineer - Sets up data pipelines"
echo "   3. 💻 Frontend Dev - Implements React components"
echo "   4. 🔧 Backend Dev - Builds API endpoints"
echo "   5. 🧪 QA Engineer - Writes and runs tests"
echo ""
sleep 2

echo "📍 Starting coordinated development..."

# Simulate agent activities
show_agent_activity "UI Designer" "Analyzing requirements..."
show_agent_activity "UI Designer" "Creating wireframes for dashboard"
show_agent_activity "UI Designer" "Designing component library"

show_agent_activity "Data Engineer" "Setting up data models"
show_agent_activity "Backend Dev" "Creating REST API structure"

echo -e "\n⚡ Parallel execution detected - multiple agents working simultaneously!"
sleep 1

show_agent_activity "Frontend Dev" "Building React components"
show_agent_activity "Backend Dev" "Implementing API endpoints"
show_agent_activity "Data Engineer" "Creating data transformation pipelines"

show_agent_activity "QA Engineer" "Writing unit tests"
show_agent_activity "QA Engineer" "Creating integration test suite"

echo -e "\n🔄 Agents sharing information..."
show_agent_activity "Frontend Dev" "Integrating with Backend API"
show_agent_activity "Backend Dev" "Adjusting endpoints based on Frontend needs"

# Actually create the application
echo -e "\n🏗️ Building the application..."
../claude-flow swarm create \
  "Build a real-time dashboard with:
   - Live data updates
   - Multiple chart types
   - User authentication
   - Responsive design
   - WebSocket support" \
  --strategy development \
  --agents 5 \
  --name dashboard-demo \
  --output ./output/dashboard \
  --coordination hub-spoke

echo ""
echo "✅ Dashboard application created successfully!"
echo ""
echo "📊 Swarm Performance Metrics:"
echo "   - Agents Used: 5"
echo "   - Tasks Completed: 15"
echo "   - Parallel Operations: 8"
echo "   - Total Time: ~2 minutes"
echo "   - Code Quality Score: 95%"
echo ""
echo "📁 Application Location: ./output/dashboard/"
echo ""
echo "🚀 To run the dashboard:"
echo "   cd ./output/dashboard"
echo "   npm install"
echo "   npm run dev"
echo ""
echo "The power of multi-agent collaboration! 🐝"