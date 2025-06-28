# Module Resolution Configuration

This document describes the module resolution configuration for the Claude-Flow project, ensuring consistent path resolution between TypeScript and Jest.

## Overview

The project uses path aliases to improve import readability and maintainability. These aliases are configured in both TypeScript (`tsconfig.json`) and Jest (`jest.config.js`) to ensure consistent behavior across development and testing environments.

## Path Aliases

The following path aliases are configured:

| Alias | Resolves To | Usage |
|-------|-------------|-------|
| `@/*` | `./src/*` | Source code imports |
| `@test/*` | `./tests/*` | Test helper imports |
| `@fixtures/*` | `./tests/fixtures/*` | Test fixture imports |
| `@mocks/*` | `./tests/mocks/*` | Test mock imports |
| `@cliffy/ansi/colors` | `./src/utils/cliffy-compat/colors` | Cliffy compatibility |
| `@cliffy/table` | `./src/utils/cliffy-compat/table` | Cliffy compatibility |
| `@cliffy/prompt` | `./src/utils/cliffy-compat/prompt` | Cliffy compatibility |
| `@cliffy/command` | `./src/utils/cliffy-compat/command` | Cliffy compatibility |

## Configuration Files

### TypeScript Configuration (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@test/*": ["./tests/*"],
      "@fixtures/*": ["./tests/fixtures/*"],
      "@mocks/*": ["./tests/mocks/*"],
      "@cliffy/ansi/colors": ["./src/utils/cliffy-compat/colors"],
      "@cliffy/table": ["./src/utils/cliffy-compat/table"],
      "@cliffy/prompt": ["./src/utils/cliffy-compat/prompt"],
      "@cliffy/command": ["./src/utils/cliffy-compat/command"]
    }
  }
}
```

### Jest Configuration (`jest.config.js`)

Jest uses a shared `moduleNameMapper` configuration to ensure consistency across all test projects:

```javascript
// Shared module name mapper for consistent resolution across all projects
const sharedModuleNameMapper = {
  '^(\\.{1,2}/.*)\\.js$': '$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  '^@test/(.*)$': '<rootDir>/tests/$1',
  '^@fixtures/(.*)$': '<rootDir>/tests/fixtures/$1',
  '^@mocks/(.*)$': '<rootDir>/tests/mocks/$1',
};

export default {
  // Global configuration
  moduleNameMapper: sharedModuleNameMapper,
  
  // Test environments
  projects: [
    {
      displayName: 'unit',
      moduleNameMapper: sharedModuleNameMapper,
      // ... other config
    },
    {
      displayName: 'integration',
      moduleNameMapper: sharedModuleNameMapper,
      // ... other config
    },
    {
      displayName: 'e2e',
      moduleNameMapper: sharedModuleNameMapper,
      // ... other config
    }
  ]
};
```

## Usage Examples

### Source Code Imports

```typescript
// Instead of: import { Logger } from '../../../core/logger';
import { Logger } from '@/core/logger';

// Instead of: import { SwarmCoordinator } from '../../coordination/swarm-coordinator';
import { SwarmCoordinator } from '@/coordination/swarm-coordinator';
```

### Test Imports

```typescript
// Import test helpers
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';

// Import test fixtures
import { mockAgentData } from '@fixtures/test-data';

// Import mocks
import { MockLogger } from '@mocks/logger';

// Mock modules in tests
jest.mock('@/core/logger');
jest.mock('@/coordination/swarm-monitor');
```

## Maintaining Consistency

To ensure module resolution remains consistent:

1. **Always update both files**: When adding new path aliases, update both `tsconfig.json` and `jest.config.js`
2. **Use the shared mapper**: All Jest projects should use `sharedModuleNameMapper`
3. **Test after changes**: Run both TypeScript compilation and Jest tests to verify resolution works

### Verification Commands

```bash
# Check TypeScript can resolve all imports
npx tsc --noEmit --skipLibCheck

# Run tests to verify Jest resolution
npm test

# Test a specific file with module imports
npm test -- path/to/test.ts --no-coverage
```

## Troubleshooting

### Common Issues

1. **"Cannot find module '@/...'"** in TypeScript
   - Ensure the path is added to `tsconfig.json` paths
   - Verify the baseUrl is set correctly (should be ".")
   - Restart your TypeScript language server in your IDE

2. **"Cannot find module '@/...'"** in Jest
   - Ensure the path is added to `sharedModuleNameMapper`
   - Verify all test projects use the shared configuration
   - Clear Jest cache: `npm test -- --clearCache`

3. **Module resolution works in tests but not in TypeScript**
   - This usually means the path is in Jest config but not in tsconfig.json
   - Add the missing path to tsconfig.json paths section

4. **Imports work in development but fail in production build**
   - Ensure your build tool (webpack, rollup, etc.) is configured to handle the path aliases
   - Consider using a tool like `tsconfig-paths` for runtime resolution

## Best Practices

1. **Use absolute imports for cross-module dependencies**: Use `@/` imports when importing from different modules
2. **Use relative imports within modules**: Use relative imports (./file) for files within the same module
3. **Organize test helpers**: Keep test utilities in the appropriate directories (@test/helpers, @fixtures, @mocks)
4. **Document new aliases**: When adding new path aliases, update this documentation

## Implementation Details

The module resolution system was unified in Phase 2 remediation to fix inconsistencies between TypeScript and Jest configuration. The key changes were:

1. Added missing test-related paths to tsconfig.json
2. Created a shared moduleNameMapper for Jest to ensure all projects use the same resolution
3. Updated all Jest project configurations to use the shared mapper

This ensures that imports like `@/core/logger` work consistently in both TypeScript compilation and Jest test execution.