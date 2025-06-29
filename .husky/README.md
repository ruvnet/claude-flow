# Husky Git Hooks

This directory contains Git hooks powered by Husky to ensure code quality before commits.

## Pre-commit Hook

The pre-commit hook runs the following validations:

1. **TypeScript Type Checking** (`npm run typecheck`)
   - Ensures all TypeScript code compiles without errors
   - Validates type safety across the entire codebase
   - Prevents runtime type errors

2. **ESLint Validation** (`npm run lint`)
   - Enforces code style and quality standards
   - Catches potential bugs and anti-patterns
   - Maintains consistent coding conventions

3. **Circular Dependency Check** (via validation script)
   - Detects circular dependencies in the module graph
   - Prevents architectural issues

## Usage

### Automatic Execution
The hooks run automatically when you commit:
```bash
git commit -m "Your commit message"
```

### Manual Validation
Run validations manually at any time:
```bash
# Quick TypeScript and lint check
npm run validate

# Comprehensive validation including tests
npm run validate-strict

# Individual checks
npm run typecheck
npm run lint
npm run check-deps
```

### Bypassing Hooks (Not Recommended)
In emergency situations only:
```bash
git commit --no-verify -m "Emergency commit"
```

## Configuration

- Hook scripts are located in `.husky/`
- TypeScript configuration: `tsconfig.json`
- ESLint configuration: Defined in `package.json`
- Validation script: `scripts/validate-typescript.js`

## Troubleshooting

If validation fails:

1. Run `npm run typecheck` to see TypeScript errors
2. Run `npm run lint` to see linting issues
3. Run `npm run check-deps` to see circular dependencies
4. Fix all issues before attempting to commit again

The pre-commit hook prevents any commits with TypeScript errors, ensuring a clean and maintainable codebase.