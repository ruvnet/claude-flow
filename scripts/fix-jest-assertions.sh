#!/bin/bash

# Fix Jest assertion syntax - convert from Deno style to Jest style
# Deno: expect(actual, expected)
# Jest: expect(actual).toBe(expected)

find tests -name "*.ts" -type f | while read -r file; do
  echo "Fixing Jest assertions in: $file"
  
  # Backup original
  cp "$file" "$file.bak"
  
  # Fix expect assertions using sed
  # Pattern: expect(value, expected) -> expect(value).toBe(expected)
  sed -E '
    # Fix basic expect(a, b) -> expect(a).toBe(b)
    s/expect\(([^,]+),\s*([^)]+)\)/expect(\1).toBe(\2)/g
    
    # Fix expect with complex expressions
    s/expect\(([^,]+),\s*([^)]+)\);/expect(\1).toBe(\2);/g
  ' "$file.bak" > "$file"
  
  # Clean up backup
  rm "$file.bak"
  
  echo "Fixed: $file"
done

echo "Jest assertion syntax fix complete!"
echo ""
echo "Running test to verify fixes..."