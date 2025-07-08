#!/bin/bash
# Quick test runner for TTY fixes

echo "🧪 Running TTY Fix Tests..."
echo ""

# Check if tsx is available
if ! command -v tsx &> /dev/null && ! npx tsx --version &> /dev/null; then
    echo "❌ tsx not found. Installing dependencies..."
    npm install
fi

# Run the TypeScript test file
echo "Running test with tsx..."
npx tsx test-tty-fixes.ts

# Alternative: Build and run if tsx fails
if [ $? -ne 0 ]; then
    echo ""
    echo "⚠️  tsx failed, trying alternative approach..."
    echo "Building project..."
    npm run build:ts
    
    if [ $? -eq 0 ]; then
        echo "Running compiled test..."
        node dist/test-tty-fixes.js
    else
        echo "❌ Build failed. Please check your TypeScript configuration."
        exit 1
    fi
fi
