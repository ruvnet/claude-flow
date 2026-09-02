#!/bin/bash

# Run the Hive Mind schema test for issue #403
echo "Running Hive Mind Database Schema Test (Issue #403)..."
echo "=================================================="
echo ""

# Run the specific test file
npx jest tests/integration/hive-mind-schema.test.js --verbose

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Test passed! The schema fix for issue #403 is working correctly."
else
    echo ""
    echo "❌ Test failed! The schema issue may not be fully resolved."
    exit 1
fi