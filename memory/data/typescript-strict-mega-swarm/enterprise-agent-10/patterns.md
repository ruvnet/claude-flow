# Enterprise Module TypeScript Strict Mode Patterns

## Pattern 1: Handling Undefined in Record Types
**Problem**: `Record<string, T>` access can return undefined
```typescript
// Before
async queryMetrics(...): Promise<Record<string, any[]>> {
  // ...
}
const value = data['key']; // Type error: possibly undefined

// After
async queryMetrics(...): Promise<Record<string, any[] | undefined>> {
  // ...
}
const value = data['key'] || []; // Handle undefined
```

## Pattern 2: exactOptionalPropertyTypes with Spread Operators
**Problem**: Spread operators with conditional properties fail in strict mode
```typescript
// Before
const obj = {
  required: value,
  ...(optional && { optional })
};

// After (Option 1 - Explicit check)
const obj = {
  required: value,
  ...(optional !== undefined ? { optional } : {})
};

// After (Option 2 - Direct assignment for simple cases)
const obj = {
  required: value,
  optional: optionalValue, // Let TypeScript handle undefined
};
```

## Pattern 3: Non-null Assertions After Guards
**Problem**: TypeScript doesn't infer array access safety after checks
```typescript
// Pattern
if (!match) return defaultValue;
const value = match[1]!; // Safe to use ! after guard
const unit = match[2]!;
```

## Pattern 4: Optional Properties in Object Literals
**Problem**: Setting optional properties to undefined vs omitting them
```typescript
// For interfaces with optional properties
interface Foo {
  required: string;
  optional?: string;
}

// Use conditional spreading
const foo: Foo = {
  required: 'value',
  ...(optionalValue ? { optional: optionalValue } : {})
};
```

## Common Enterprise Module Issues:
1. **Analytics**: Array access from query results
2. **Audit**: Index signature property access
3. **Deployment**: Optional metadata handling
4. **Project**: Timeline optional date fields
5. **Security**: Configuration spreading with partials