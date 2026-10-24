#!/bin/bash

echo "🔍 Domain Expert Model - Query Demonstrations"
echo "=============================================="
echo ""

echo "1️⃣ DevOps: Kubernetes Patterns"
echo "--------------------------------"
sqlite3 memory.db "SELECT problem, ROUND(confidence * 100, 1) || '%' as confidence FROM patterns WHERE problem LIKE '%Kubernetes%' LIMIT 3;" | head -5
echo ""

echo "2️⃣ Security: OAuth Patterns"
echo "--------------------------------"
sqlite3 memory.db "SELECT problem, ROUND(success_rate * 100, 1) || '%' as success_rate FROM patterns WHERE problem LIKE '%OAuth%' LIMIT 2;" | head -4
echo ""

echo "3️⃣ Data Engineering: ETL Patterns"
echo "--------------------------------"
sqlite3 memory.db "SELECT problem, domain FROM patterns WHERE problem LIKE '%ETL%' LIMIT 2;" | head -4
echo ""

echo "4️⃣ API Design: GraphQL Patterns"
echo "--------------------------------"
sqlite3 memory.db "SELECT problem, ROUND(confidence * 100, 1) || '%' as confidence FROM patterns WHERE problem LIKE '%GraphQL%' LIMIT 2;" | head -4
echo ""

echo "5️⃣ Performance: Caching Patterns"
echo "--------------------------------"
sqlite3 memory.db "SELECT problem, ROUND(success_rate * 100, 1) || '%' as success_rate FROM patterns WHERE problem LIKE '%Caching%' LIMIT 2;" | head -4
echo ""

echo "6️⃣ High-Confidence Patterns (>92%)"
echo "--------------------------------"
sqlite3 memory.db "SELECT domain, COUNT(*) as count FROM patterns WHERE confidence > 0.92 GROUP BY domain;" | head -6
echo ""

echo "7️⃣ Cross-Domain Links Sample"
echo "--------------------------------"
sqlite3 memory.db "SELECT link_type, COUNT(*) as count FROM pattern_links GROUP BY link_type;"
echo ""

echo "✅ Demo queries complete!"
