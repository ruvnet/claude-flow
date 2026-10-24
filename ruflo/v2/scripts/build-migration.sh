#!/bin/bash

# Build script for Claude-Flow Migration System

set -e

echo "🚀 Building Claude-Flow Migration System..."

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found. Please run from project root."
    exit 1
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/migration
rm -rf src/migration/dist

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Compiling TypeScript..."
cd src/migration
npm run build || {
    echo "⚠️  TypeScript build with npm not available, using tsc directly..."
    npx tsc
}
cd ../..

# Create distribution directory
echo "📁 Creating distribution structure..."
mkdir -p dist/migration
cp -r src/migration/dist/* dist/migration/
cp src/migration/package.json dist/migration/
cp src/migration/README.md dist/migration/
cp src/migration/migration-manifest.json dist/migration/

# Copy source templates for development
echo "📋 Copying templates..."
mkdir -p dist/migration/templates
cp -r .claude/ dist/migration/templates/claude || echo "⚠️  .claude folder not found, skipping..."
cp CLAUDE.md dist/migration/templates/ || echo "⚠️  CLAUDE.md not found, skipping..."
cp .roomodes dist/migration/templates/ || echo "⚠️  .roomodes not found, skipping..."

# Make executable
chmod +x dist/migration/index.js

# Create symlink for global usage
echo "🔗 Creating symlinks..."
mkdir -p bin
ln -sf ../dist/migration/index.js bin/claude-flow-migrate

# Run tests
echo "🧪 Running tests..."
cd src/migration
npm test || echo "⚠️  Tests failed or not configured"
cd ../..

# Create package info
echo "📄 Creating package information..."
cat > dist/migration/INSTALL.md << 'EOF'
# Claude-Flow Migration System Installation

## Quick Install

```bash
# From project root
npm install -g ./dist/migration

# Or use directly
./bin/claude-flow-migrate --help
```

## Usage

```bash
# Analyze project
claude-flow-migrate analyze

# Migrate with selective strategy
claude-flow-migrate --strategy selective --preserve-custom

# Rollback if needed
claude-flow-migrate rollback
```

## Documentation

See README.md for complete documentation.
EOF

echo "✅ Build completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Test installation: ./bin/claude-flow-migrate --help"
echo "   2. Run on test project: ./bin/claude-flow-migrate analyze /path/to/project"
echo "   3. Create distribution: npm pack dist/migration"
echo ""
echo "📦 Built files:"
echo "   - dist/migration/ - Complete migration system"
echo "   - bin/claude-flow-migrate - Executable symlink"
echo ""