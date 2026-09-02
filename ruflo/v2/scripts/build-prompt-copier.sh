#!/bin/bash

# Build script for prompt copier CLI
set -e

echo "Building prompt copier CLI..."

# Ensure bin directory exists
mkdir -p bin

# Check if Deno is available
if ! command -v deno &> /dev/null; then
    echo "Error: Deno is required but not installed"
    echo "Please install Deno: https://deno.land/manual/getting_started/installation"
    exit 1
fi

# Compile the prompt CLI
echo "Compiling prompt-copier..."
PATH="/home/codespace/.deno/bin:$PATH" deno compile \
    --allow-all \
    --no-check \
    --output=bin/prompt-copier \
    src/swarm/prompt-cli.ts

# Make executable
chmod +x bin/prompt-copier

echo "✅ prompt-copier CLI built successfully"
echo "Usage: ./bin/prompt-copier --help"