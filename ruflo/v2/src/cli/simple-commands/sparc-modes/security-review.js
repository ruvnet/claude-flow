// security-review.js - Security Reviewer mode orchestration template
export function getSecurityReviewOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Security Audit Scope Definition** (10 mins)
   - Define audit boundaries for: "${taskDescription}"
   - Query system architecture and sensitive areas:
     \`\`\`bash
     npx claude-flow memory query ${memoryNamespace}_architecture
     npx claude-flow memory query ${memoryNamespace}_auth
     npx claude-flow memory query ${memoryNamespace}_config
     \`\`\`
   - Identify critical assets:
     - User data and PII
     - Authentication tokens/sessions
     - API keys and credentials
     - Payment/financial data
   - Map data flows and trust boundaries
   - List all external interfaces and integrations
   - Review authentication/authorization points
   - Store scope: \`npx claude-flow memory store ${memoryNamespace}_security_scope "Audit scope: ${taskDescription}. Critical assets: user PII, JWT tokens, payment data. External interfaces: REST API, webhooks, third-party integrations."\`

2. **Static Security Analysis** (20 mins)
   - Scan for hardcoded secrets and credentials:
     - Check all code files for API keys, passwords
     - Verify .env files are properly gitignored
     - Ensure no secrets in logs or error messages
   - Review environment configuration:
     - Check for direct env coupling
     - Verify secrets management approach
     - Ensure config files don't expose sensitive data
   - Analyze authentication/authorization:
     - Review JWT implementation
     - Check session management
     - Verify role-based access control
   - Inspect input validation and sanitization:
     - SQL injection prevention
     - XSS protection
     - Command injection safeguards
   - Check cryptographic implementations:
     - Password hashing (bcrypt/scrypt/argon2)
     - Data encryption at rest/transit
     - Secure random number generation
   - Audit file size compliance (< 500 lines)
   - Review dependency vulnerabilities:
     \`\`\`bash
     npm audit
     \`\`\`
   - Store findings: \`npx claude-flow memory store ${memoryNamespace}_vulnerabilities "Critical: 2 hardcoded API keys found. High: Missing input validation in user-controller. Medium: Outdated JWT library. Low: Verbose error messages expose stack traces."\`

3. **Dynamic Security Analysis** (10 mins)
   - Test authentication flows:
     - Login/logout sequences
     - Password reset process
     - Token refresh mechanisms
   - Check authorization boundaries:
     - Test role-based access
     - Verify resource ownership checks
     - Test privilege escalation vectors
   - Analyze rate limiting and DoS protection
   - Review CORS and CSP policies
   - Test error handling for information leakage
   - Store dynamic findings: \`npx claude-flow memory store ${memoryNamespace}_dynamic_findings "Auth bypass: None found. Rate limiting: Missing on login endpoint. CORS: Overly permissive. Error handling: Leaks database schema in dev mode."\`

4. **Risk Assessment & Prioritization** (15 mins)
   - Categorize findings by severity (CVSS scores):
     - Critical (9.0-10.0): Immediate action required
     - High (7.0-8.9): Fix before deployment
     - Medium (4.0-6.9): Fix in next sprint
     - Low (0.1-3.9): Track for future
   - Assess potential business impact:
     - Data breach consequences
     - Compliance violations (GDPR, PCI-DSS)
     - Reputation damage
   - Calculate risk scores (likelihood × impact)
   - Prioritize remediation efforts
   - Document attack vectors and exploit scenarios
   - Store assessment: \`npx claude-flow memory store ${memoryNamespace}_risk_assessment "Critical risks: 2 (hardcoded secrets, missing auth on admin endpoints). High risks: 3 (outdated deps, missing rate limiting, weak session management). Compliance impact: GDPR violation risk due to logging PII."\`

5. **Remediation Plan & Implementation** (10 mins)
   - Create specific fix recommendations:
     - Move secrets to environment variables
     - Implement proper secrets management (Vault/AWS Secrets Manager)
     - Add comprehensive input validation
     - Update vulnerable dependencies
     - Implement rate limiting
     - Fix authorization checks
   - Suggest security enhancements:
     - Add security headers (HSTS, CSP, X-Frame-Options)
     - Implement audit logging
     - Add intrusion detection
     - Set up security monitoring
   - Create security checklist for future development
   - Implement critical fixes if authorized
   - Store plan: \`npx claude-flow memory store ${memoryNamespace}_remediation_plan "Immediate: Remove hardcoded secrets, fix auth bypass. Next sprint: Implement rate limiting, update dependencies. Future: Add WAF, implement SIEM integration."\`

## Deliverables
- security-audit-report.md:
  - Executive summary
  - Detailed findings with CVSS scores
  - Risk assessment matrix
  - Compliance gaps
- remediation-plan.md:
  - Prioritized fix list
  - Implementation guidelines
  - Timeline recommendations
- security-checklist.md:
  - Pre-deployment security checks
  - Code review guidelines
  - Security testing procedures
- Fixed code (for critical issues):
  - Removed hardcoded secrets
  - Added input validation
  - Fixed authorization gaps

## Security Review Standards
- OWASP Top 10 compliance
- SANS CWE Top 25 coverage
- Industry-specific requirements (PCI-DSS, HIPAA, etc.)
- Zero tolerance for hardcoded secrets
- All files must be < 500 lines for maintainability
- Comprehensive logging without exposing sensitive data

## Next Steps
After security review:
- \`npx claude-flow sparc run code "Implement security remediation plan" --non-interactive\`
- \`npx claude-flow sparc run tdd "Write security test cases" --non-interactive\`
- \`npx claude-flow sparc run post-deployment-monitoring-mode "Set up security monitoring and alerts" --non-interactive\``;
}
