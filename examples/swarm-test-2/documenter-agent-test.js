/**
 * Documenter Agent Test
 * Role: Creates and maintains documentation, generates API docs
 */

const documenterAgentTest = {
  name: 'Documenter Agent',
  role: 'Documentation Creation and Maintenance',
  capabilities: ['documentation', 'technical-writing', 'knowledge-management'],
  
  // Example task: Document an API endpoint
  demonstrateRole: () => {
    console.log('=== Documenter Agent Test ===');
    console.log('Role: I create comprehensive documentation');
    
    const documentationTask = {
      component: 'User Authentication API',
      documentation: {
        overview: 'RESTful API for user authentication and authorization',
        endpoints: [
          {
            method: 'POST',
            path: '/api/auth/login',
            description: 'Authenticate user and receive JWT token',
            requestBody: {
              email: 'string (required) - User email address',
              password: 'string (required) - User password'
            },
            responses: {
              200: { description: 'Success', body: '{ token: "jwt-token", user: {...} }' },
              401: { description: 'Invalid credentials' },
              429: { description: 'Too many attempts' }
            },
            example: `curl -X POST https://api.example.com/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email": "user@example.com", "password": "securepass"}'`
          }
        ],
        authentication: 'Bearer token required for protected endpoints',
        rateLimiting: '10 requests per minute per IP',
        errorHandling: 'All errors return JSON with "error" field'
      },
      userGuide: {
        gettingStarted: [
          'Sign up for an API key',
          'Include API key in Authorization header',
          'Make requests to API endpoints',
          'Handle responses and errors appropriately'
        ],
        bestPractices: [
          'Store tokens securely',
          'Implement token refresh logic',
          'Handle rate limit responses',
          'Log errors for debugging'
        ]
      }
    };
    
    console.log('Documenting:', documentationTask.component);
    console.log('Overview:', documentationTask.documentation.overview);
    console.log('\nAPI Endpoints:');
    documentationTask.documentation.endpoints.forEach(endpoint => {
      console.log(`\n${endpoint.method} ${endpoint.path}`);
      console.log(`Description: ${endpoint.description}`);
      console.log('Request Body:', JSON.stringify(endpoint.requestBody, null, 2));
      console.log('Responses:');
      Object.entries(endpoint.responses).forEach(([code, resp]) => {
        console.log(`  ${code}: ${resp.description}`);
      });
      console.log('Example:', endpoint.example);
    });
    console.log('\nUser Guide - Getting Started:');
    documentationTask.userGuide.gettingStarted.forEach((step, i) => {
      console.log(`${i + 1}. ${step}`);
    });
    console.log('\nBest Practices:');
    documentationTask.userGuide.bestPractices.forEach(practice => {
      console.log(`• ${practice}`);
    });
  },
  
  // Example documentation workflow
  documentationWorkflow: () => {
    const workflow = [
      'Receive component/feature from Developer',
      'Analyze code and functionality',
      'Create API documentation',
      'Write user guides and tutorials',
      'Generate code examples',
      'Create troubleshooting guides',
      'Maintain changelog and version history',
      'Publish to documentation platform'
    ];
    
    console.log('\nDocumentation Workflow:');
    workflow.forEach((step, index) => {
      console.log(`${index + 1}. ${step}`);
    });
  }
};

// Run the test
documenterAgentTest.demonstrateRole();
documenterAgentTest.documentationWorkflow();

module.exports = documenterAgentTest;