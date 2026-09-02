#!/bin/bash
# Test real execution of claude-flow commands

echo "Testing real claude-flow execution..."
echo "===================================="

# Create a test directory
TEST_DIR="./hello-bench-test"
mkdir -p "$TEST_DIR"

# Create a simple hello world file using echo
echo "Creating hello world in $TEST_DIR..."
cat > "$TEST_DIR/hello.js" << 'EOF'
// Hello World function
function helloWorld() {
    console.log("Hello, World!");
}

// Export for use in other modules
module.exports = { helloWorld };

// Run if called directly
if (require.main === module) {
    helloWorld();
}
EOF

echo "✅ Created hello.js"

# Test the hello world
echo ""
echo "Testing hello world..."
node "$TEST_DIR/hello.js"

echo ""
echo "File contents:"
ls -la "$TEST_DIR"

echo ""
echo "✅ Test complete!"