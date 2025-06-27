#!/bin/bash

# Bulk fix all Deno references in test files

echo "🔧 Starting bulk Deno to Node.js conversion..."

# Find all test files with Deno references
FILES_WITH_DENO=$(grep -r "Deno\." tests/ --include="*.ts" --include="*.js" -l)

echo "Found $(echo "$FILES_WITH_DENO" | wc -l) files with Deno references"

for file in $FILES_WITH_DENO; do
    echo "Processing: $file"
    
    # Add Node.js imports if not present
    if ! grep -q "import \* as fs from 'fs'" "$file"; then
        if grep -q "^import" "$file"; then
            # Add after existing imports
            sed -i '' '1,/^import.*from.*$/s//&\
import * as fs from '\''fs'\'';/' "$file"
        else
            # Add at top after reference comments
            sed -i '' '1a\
import * as fs from '\''fs'\'';
' "$file"
        fi
    fi
    
    if ! grep -q "import \* as path from 'path'" "$file"; then
        if grep -q "import \* as fs from 'fs'" "$file"; then
            sed -i '' '/import \* as fs from '\''fs'\'';/a\
import * as path from '\''path'\'';
' "$file"
        fi
    fi
    
    if ! grep -q "import \* as os from 'os'" "$file"; then
        if grep -q "import \* as path from 'path'" "$file"; then
            sed -i '' '/import \* as path from '\''path'\'';/a\
import * as os from '\''os'\'';
' "$file"
        fi
    fi
    
    # Replace Deno API calls
    sed -i '' 's/Deno\.env\.set(\([^,]*\),\s*\([^)]*\))/process.env[\1] = \2/g' "$file"
    sed -i '' 's/Deno\.env\.get(\([^)]*\))/process.env[\1]/g' "$file"
    sed -i '' 's/Deno\.env\.delete(\([^)]*\))/delete process.env[\1]/g' "$file"
    sed -i '' 's/await Deno\.writeTextFile(\([^,]*\),\s*\([^)]*\))/fs.writeFileSync(\1, \2, "utf8")/g' "$file"
    sed -i '' 's/Deno\.writeTextFile(\([^,]*\),\s*\([^)]*\))/fs.writeFileSync(\1, \2, "utf8")/g' "$file"
    sed -i '' 's/await Deno\.readTextFile(\([^)]*\))/fs.readFileSync(\1, "utf8")/g' "$file"
    sed -i '' 's/Deno\.readTextFile(\([^)]*\))/fs.readFileSync(\1, "utf8")/g' "$file"
    sed -i '' 's/await Deno\.makeTempDir([^)]*)/ fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"))/g' "$file"
    sed -i '' 's/Deno\.makeTempDir([^)]*)/ fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"))/g' "$file"
    sed -i '' 's/await Deno\.remove(\([^,]*\),\s*{\s*recursive:\s*true\s*})/fs.rmSync(\1, { recursive: true, force: true })/g' "$file"
    sed -i '' 's/Deno\.remove(\([^,]*\),\s*{\s*recursive:\s*true\s*})/fs.rmSync(\1, { recursive: true, force: true })/g' "$file"
    sed -i '' 's/await Deno\.stat(\([^)]*\))/fs.statSync(\1)/g' "$file"
    sed -i '' 's/Deno\.stat(\([^)]*\))/fs.statSync(\1)/g' "$file"
    sed -i '' 's/Deno\.cwd()/process.cwd()/g' "$file"
    sed -i '' 's/Deno\.execPath()/process.execPath/g' "$file"
    sed -i '' 's/Deno\.memoryUsage()/process.memoryUsage()/g' "$file"
    
    echo "  ✅ Fixed $(grep -c "Deno\." "$file" || echo "0") remaining Deno references"
done

echo "🎉 Bulk conversion complete!"