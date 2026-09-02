# SPARC Test-Driven Development Guide

Learn how to use SPARC methodology for systematic TDD with Claude Flow.

## What is SPARC?

SPARC stands for:
- **S**pecification: Define requirements clearly
- **P**seudocode: Plan the logic
- **A**rchitecture: Design the structure
- **R**efinement: Implement with TDD
- **C**ompletion: Integrate and polish

## Prerequisites

- Claude Flow with SPARC modes configured
- Understanding of TDD principles
- Basic programming knowledge

## Tutorial: Building a User Authentication System

### Step 1: Specification Phase

Define what we're building:

```bash
cd examples
../claude-flow sparc run spec-pseudocode \
  "Design a user authentication system with:
   - Email/password login
   - JWT tokens
   - Password reset
   - Rate limiting
   - Security best practices"
```

This creates:
- Detailed requirements document
- User stories
- Acceptance criteria
- Edge cases

### Step 2: Pseudocode Phase

Plan the implementation logic:

```bash
../claude-flow sparc run spec-pseudocode \
  "Create pseudocode for authentication flow:
   - Login process
   - Token generation
   - Password hashing
   - Session management"
```

Output includes:
- Algorithm descriptions
- Data flow diagrams
- State transitions
- Error handling logic

### Step 3: Architecture Phase

Design the system structure:

```bash
../claude-flow sparc run architect \
  "Design authentication service architecture:
   - API endpoints
   - Database schema
   - Security layers
   - Integration points"
```

Creates:
- System diagrams
- API specifications
- Database designs
- Security architecture

### Step 4: TDD Implementation (Refinement)

Now we implement using Test-Driven Development:

```bash
../claude-flow sparc tdd \
  "Implement user authentication system" \
  --spec ./output/auth-spec.md \
  --architecture ./output/auth-architecture.md
```

#### The TDD Cycle:

1. **RED Phase** - Write failing tests first:
   ```javascript
   // Generated test example
   describe('Authentication', () => {
     it('should hash passwords securely', async () => {
       const password = 'testPass123';
       const hash = await authService.hashPassword(password);
       expect(hash).not.toBe(password);
       expect(hash.length).toBeGreaterThan(50);
     });
   });
   ```

2. **GREEN Phase** - Implement minimal code to pass:
   ```javascript
   // Generated implementation
   async hashPassword(password) {
     const salt = await bcrypt.genSalt(10);
     return bcrypt.hash(password, salt);
   }
   ```

3. **REFACTOR Phase** - Optimize and clean up:
   ```javascript
   // Refactored version
   async hashPassword(password, rounds = 10) {
     if (!password || password.length < 8) {
       throw new Error('Invalid password');
     }
     const salt = await bcrypt.genSalt(rounds);
     return bcrypt.hash(password, salt);
   }
   ```

### Step 5: Integration Testing

Test the complete system:

```bash
../claude-flow sparc run integration \
  "Test authentication system integration:
   - API endpoints
   - Database operations
   - Token validation
   - Error handling"
```

### Step 6: Security Review

Ensure security best practices:

```bash
../claude-flow sparc run security-review \
  "Review authentication system for:
   - OWASP compliance
   - SQL injection
   - XSS vulnerabilities
   - Token security"
```

## Advanced SPARC Features

### Parallel Mode Execution

Run multiple SPARC modes simultaneously:

```bash
../claude-flow sparc run parallel \
  --modes "spec-pseudocode,architect,code" \
  "Create payment processing system"
```

### Memory Integration

Store and retrieve SPARC artifacts:

```bash
# Store specifications
../claude-flow memory store auth_spec "$(cat ./output/auth-spec.md)"

# Retrieve for future work
../claude-flow memory query auth_spec > ./restored-spec.md
```

### Custom Test Patterns

Define test templates:

```bash
../claude-flow sparc tdd \
  "Create user service" \
  --test-pattern "AAA" \  # Arrange-Act-Assert
  --coverage-threshold 90
```

## Best Practices

### 1. Specification Quality
- Be specific about requirements
- Include error scenarios
- Define performance criteria
- Document security needs

### 2. TDD Discipline
- Always write tests first
- One test at a time
- Keep tests simple
- Test behavior, not implementation

### 3. Architecture Decisions
- Document why, not just what
- Consider scalability early
- Plan for change
- Keep it simple

### 4. Integration Points
- Test boundaries thoroughly
- Mock external services
- Verify error propagation
- Check edge cases

## Common Patterns

### Authentication Flow
```bash
../claude-flow sparc tdd "implement login flow" \
  --pattern "request-validate-authenticate-respond"
```

### CRUD Operations
```bash
../claude-flow sparc tdd "implement user CRUD" \
  --pattern "rest-api" \
  --with-validation
```

### Event-Driven Systems
```bash
../claude-flow sparc tdd "implement event handlers" \
  --pattern "pub-sub" \
  --async
```

## Troubleshooting

### Tests Not Running
- Check test file naming (*.test.js)
- Verify test runner configuration
- Ensure dependencies installed

### Coverage Too Low
- Add edge case tests
- Test error conditions
- Cover all branches

### Integration Failures
- Check service dependencies
- Verify environment variables
- Test in isolation first

## Summary

You've learned:
- ✅ SPARC methodology phases
- ✅ TDD implementation cycle
- ✅ Integration and security testing
- ✅ Best practices and patterns

## Next Steps

1. Try building a complete feature with SPARC
2. Explore other SPARC modes
3. Create custom test patterns
4. Integrate with CI/CD

Continue to [Advanced SPARC Patterns](./sparc-advanced-patterns.md)