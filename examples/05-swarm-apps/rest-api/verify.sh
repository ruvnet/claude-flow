#!/bin/bash

echo "🔍 Verifying REST API structure..."

# Check directories
directories=(
    "src/controllers"
    "src/models"
    "src/routes"
    "src/middleware"
    "src/utils"
    "tests"
)

for dir in "${directories[@]}"; do
    if [ -d "$dir" ]; then
        echo "✅ $dir exists"
    else
        echo "❌ $dir is missing"
    fi
done

# Check key files
files=(
    "package.json"
    "src/server.js"
    "src/routes/index.js"
    "src/routes/users.js"
    "src/routes/products.js"
    "src/controllers/usersController.js"
    "src/controllers/productsController.js"
    "src/models/userModel.js"
    "src/models/productModel.js"
    "src/middleware/errorHandler.js"
    "tests/server.test.js"
    "tests/users.test.js"
    "tests/products.test.js"
    "README.md"
    "API.md"
)

echo ""
echo "📄 Checking files..."
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file is missing"
    fi
done

echo ""
echo "📊 API Statistics:"
echo "- Endpoints: $(grep -E "(router\.(get|post|put|delete))" src/routes/*.js | wc -l)"
echo "- Tests: $(grep -E "(describe|it)\(" tests/*.js | grep -c "it(")"
echo "- Models: $(ls src/models/*.js 2>/dev/null | wc -l)"
echo "- Controllers: $(ls src/controllers/*.js 2>/dev/null | wc -l)"

echo ""
echo "✨ REST API structure verification complete!"