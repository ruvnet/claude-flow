/**
 * Reviewer Agent Test
 * Role: Reviews code, ensures quality standards, and validates work
 */

const reviewerAgentTest = {
  name: 'Reviewer Agent',
  role: 'Code Review and Quality Assurance',
  capabilities: ['code-review', 'quality-assurance', 'validation', 'testing'],
  
  // Example task: Review a pull request
  demonstrateRole: () => {
    console.log('=== Reviewer Agent Test ===');
    console.log('Role: I review code and ensure quality standards');
    
    const reviewTask = {
      pullRequest: 'PR #42: Add user authentication',
      codeQuality: {
        score: 8.5,
        issues: [
          { severity: 'high', issue: 'Missing input validation in login endpoint' },
          { severity: 'medium', issue: 'Hardcoded JWT secret key' },
          { severity: 'low', issue: 'Inconsistent variable naming in auth.js' }
        ]
      },
      testCoverage: {
        overall: 78,
        newCode: 85,
        missingTests: ['Password reset functionality', 'Token refresh logic']
      },
      securityChecks: [
        '✓ SQL injection prevention',
        '✓ XSS protection',
        '✗ Rate limiting not implemented',
        '✗ Password complexity requirements missing'
      ],
      recommendations: [
        'Add input validation for all user inputs',
        'Move JWT secret to environment variables',
        'Implement rate limiting for authentication endpoints',
        'Add tests for edge cases'
      ]
    };
    
    console.log('Reviewing:', reviewTask.pullRequest);
    console.log(`Code Quality Score: ${reviewTask.codeQuality.score}/10`);
    console.log('\nIdentified Issues:');
    reviewTask.codeQuality.issues.forEach(issue => {
      console.log(`  [${issue.severity.toUpperCase()}] ${issue.issue}`);
    });
    console.log(`\nTest Coverage: ${reviewTask.testCoverage.overall}% (New code: ${reviewTask.testCoverage.newCode}%)`);
    console.log('Missing Tests:', reviewTask.testCoverage.missingTests.join(', '));
    console.log('\nSecurity Checks:');
    reviewTask.securityChecks.forEach(check => console.log(`  ${check}`));
    console.log('\nRecommendations:');
    reviewTask.recommendations.forEach(rec => console.log(`  • ${rec}`));
  },
  
  // Example review workflow
  reviewWorkflow: () => {
    const workflow = [
      'Receive code/work from Developer Agent',
      'Check code quality and standards',
      'Run static analysis tools',
      'Verify test coverage',
      'Perform security audit',
      'Check documentation completeness',
      'Provide detailed feedback and recommendations'
    ];
    
    console.log('\nReview Workflow:');
    workflow.forEach((step, index) => {
      console.log(`${index + 1}. ${step}`);
    });
  }
};

// Run the test
reviewerAgentTest.demonstrateRole();
reviewerAgentTest.reviewWorkflow();

module.exports = reviewerAgentTest;