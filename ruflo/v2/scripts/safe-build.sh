#!/bin/bash
# Safe build script that preserves the existing binary

echo "🔨 Safe Build Script for Claude Flow"
echo "===================================="

# Create bin directory if it doesn't exist
mkdir -p bin

# Backup existing binary if it exists
if [ -f "bin/claude-flow" ]; then
    echo "📦 Backing up existing binary..."
    cp bin/claude-flow bin/claude-flow.backup
fi

# Set Deno path
export PATH="/home/codespace/.deno/bin:$PATH"

# Build to a temporary file first
echo "🏗️  Building Claude Flow..."
if deno compile --allow-all --no-check --output=bin/claude-flow.tmp src/cli/main.ts 2>/dev/null; then
    echo "✅ Build successful!"
    
    # Remove old binary and move new one
    if [ -f "bin/claude-flow.tmp" ]; then
        mv -f bin/claude-flow.tmp bin/claude-flow
        chmod +x bin/claude-flow
        echo "✅ Binary updated successfully!"
        
        # Remove backup since build was successful
        rm -f bin/claude-flow.backup
    fi
else
    echo "❌ Build failed!"
    
    # Restore backup if build failed
    if [ -f "bin/claude-flow.backup" ]; then
        echo "🔄 Restoring backup..."
        mv bin/claude-flow.backup bin/claude-flow
        echo "✅ Backup restored!"
    fi
    
    exit 1
fi

# Build prompt copier CLI
echo "🏗️  Building Prompt Copier CLI..."
if deno compile --allow-all --no-check --output=bin/prompt-copier.tmp src/swarm/prompt-cli.ts 2>/dev/null; then
    echo "✅ Prompt copier build successful!"
    
    if [ -f "bin/prompt-copier.tmp" ]; then
        mv -f bin/prompt-copier.tmp bin/prompt-copier
        chmod +x bin/prompt-copier
        echo "✅ Prompt copier binary updated successfully!"
    fi
else
    echo "⚠️  Prompt copier build failed - continuing without it"
fi

echo ""
echo "✅ Build complete!"
echo "   Claude Flow binary: bin/claude-flow"
echo "   Prompt Copier binary: bin/prompt-copier"