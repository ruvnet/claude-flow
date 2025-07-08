# Testing TTY Fixes

You have several options to run the tests:

## Option 1: Quick Test (Recommended)
```bash
npx tsx test-tty-fixes.ts
```

## Option 2: Using the test script
```bash
bash run-test.sh
```

## Option 3: Build first, then test
```bash
npm run build:ts
node test-fixes.js
```

## Option 4: If you don't have dependencies installed
```bash
npm install
npx tsx test-tty-fixes.ts
```

The test will validate:
- ✅ TTY error handling functionality
- ✅ Safe readline interface creation
- ✅ SPARC command integration
- ✅ Graceful degradation in non-TTY environments
