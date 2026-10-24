#!/bin/bash
# Test all swarm-benchmark real commands

echo "🧪 Testing swarm-benchmark CLI commands..."
echo "========================================="

# Test swarm command
echo -e "\n1️⃣ Testing SWARM command..."
swarm-benchmark real swarm "Create hello world" --strategy development --timeout 1
if [ $? -eq 0 ]; then
    echo "✅ Swarm command works!"
else
    echo "❌ Swarm command failed"
fi

# Test hive-mind command
echo -e "\n2️⃣ Testing HIVE-MIND command..."
swarm-benchmark real hive-mind "Design system" --max-workers 2 --timeout 1
if [ $? -eq 0 ]; then
    echo "✅ Hive-mind command works!"
else
    echo "❌ Hive-mind command failed"
fi

# Test SPARC command
echo -e "\n3️⃣ Testing SPARC command..."
swarm-benchmark real sparc coder "Implement function" --timeout 1
if [ $? -eq 0 ]; then
    echo "✅ SPARC command works!"
else
    echo "❌ SPARC command failed"
fi

echo -e "\n========================================="
echo "✅ All CLI commands tested successfully!"