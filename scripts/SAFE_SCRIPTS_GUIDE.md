# Safe TypeScript Fix Scripts Guide

## ✅ SAFE Scripts to Use

### Recommended Scripts
1. **`fix-ts2375-exact-optional.ts`** - Fixes exactOptionalPropertyTypes errors (TESTED & SAFE)
2. **`fix-ts-syntax-errors.ts`** - General syntax error fixes
3. **`fix-import-syntax.ts`** - Fixes import statement syntax (created to fix damage from bad scripts)
4. **`fix-string-literals.ts`** - Fixes malformed string literals

### Other Available Scripts
- `fix-type-assignment-errors.ts` - Type assignment fixes
- `fix-remaining-syntax.ts` - Additional syntax fixes
- `fix-property-access.ts` - Property access patterns
- `fix-import-meta.ts` - Import meta fixes
- `fix-ts4111-targeted.ts` - Targeted TS4111 fixes (use with caution)

## ❌ DELETED Problematic Scripts
The following scripts have been removed because they introduced syntax errors:
- ~~fix-ts4111-bracket-notation.ts~~ - Incorrectly converted imports to `['js']` syntax
- ~~fix-bracket-notation.ts~~ - Applied bracket notation too broadly
- ~~fix-aggressive-bracket-notation.ts~~ - Overly aggressive pattern matching
- ~~fix-all-bracket-syntax.ts~~ - Applied incorrect patterns
- ~~fix-bracket-notation-all.ts~~ - Similar issues
- ~~fix-import-bracket-notation.ts~~ - Broke import statements

## Usage Instructions

### To fix remaining TypeScript errors safely:
```bash
# 1. Fix exactOptionalPropertyTypes errors (SAFE)
npx tsx scripts/fix-ts2375-exact-optional.ts

# 2. Fix general syntax errors
npx tsx scripts/fix-ts-syntax-errors.ts

# 3. Check current error count
npm run typecheck | grep -c "error TS"
```

### Manual Fixes Still Needed
Based on the swarm analysis, approximately 48% of remaining errors require manual fixes:
- Complex type mismatches
- Context-specific undefined handling
- Interface compatibility issues

Refer to `/TYPESCRIPT_PATTERNS.md` for patterns and examples for manual fixes.