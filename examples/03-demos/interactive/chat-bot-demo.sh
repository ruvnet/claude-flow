#!/bin/bash
# Interactive Demo - Build a Chat Bot Application

set -e

echo "🤖 Claude Flow Chat Bot Demo"
echo "============================"
echo ""
echo "This demo will create an interactive chat bot application."
echo ""

# Function to show progress
show_progress() {
    echo -e "\n📍 $1"
    sleep 1
}

# Navigate to examples directory
cd "$(dirname "$0")/../.."

# Get user preferences
echo "Let's customize your chat bot!"
echo ""
read -p "What should the bot specialize in? (e.g., 'customer support', 'coding help', 'general chat'): " BOT_TYPE
BOT_TYPE=${BOT_TYPE:-"general chat"}

read -p "What personality should it have? (e.g., 'friendly', 'professional', 'humorous'): " PERSONALITY
PERSONALITY=${PERSONALITY:-"friendly"}

echo ""
show_progress "Creating your $PERSONALITY $BOT_TYPE bot..."

# Create the chat bot
../claude-flow swarm create \
  "Build an interactive chat bot for $BOT_TYPE with a $PERSONALITY personality. Include:
   - Command-line interface
   - Conversation history
   - Multiple response modes
   - Help system
   - Configuration options" \
  --strategy development \
  --name chat-bot-demo \
  --output ./output/chat-bot \
  --monitor

show_progress "Chat bot created successfully!"

# Display results
echo ""
echo "✅ Your chat bot is ready!"
echo ""
echo "📁 Location: ./output/chat-bot/"
echo ""
echo "🚀 To start chatting:"
echo "   cd ./output/chat-bot"
echo "   npm install"
echo "   npm start"
echo ""
echo "💬 Features:"
echo "   - Interactive CLI interface"
echo "   - Customized for: $BOT_TYPE"
echo "   - Personality: $PERSONALITY"
echo "   - Conversation history"
echo "   - Multiple response modes"
echo ""
echo "Enjoy your new chat bot! 🤖"