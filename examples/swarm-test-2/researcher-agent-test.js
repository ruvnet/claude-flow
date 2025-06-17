/**
 * Researcher Agent Test
 * Role: Performs research, data gathering, and information synthesis
 */

const researcherAgentTest = {
  name: 'Researcher Agent',
  role: 'Research and Data Gathering',
  capabilities: ['web-search', 'data-collection', 'analysis', 'documentation'],
  
  // Example task: Research best practices for API design
  demonstrateRole: () => {
    console.log('=== Researcher Agent Test ===');
    console.log('Role: I gather information and conduct research');
    
    const researchTask = {
      topic: 'REST API Best Practices',
      findings: [
        {
          source: 'RESTful Web Services',
          keyPoints: [
            'Use proper HTTP methods (GET, POST, PUT, DELETE)',
            'Implement versioning (e.g., /api/v1/)',
            'Use meaningful resource names',
            'Return appropriate status codes'
          ]
        },
        {
          source: 'API Design Guidelines',
          keyPoints: [
            'Implement pagination for large datasets',
            'Use consistent naming conventions',
            'Include comprehensive error messages',
            'Provide clear documentation'
          ]
        }
      ],
      synthesis: 'Modern REST APIs should follow RESTful principles, use semantic versioning, implement proper error handling, and provide clear documentation for developers.'
    };
    
    console.log('Research Topic:', researchTask.topic);
    console.log('\nKey Findings:');
    researchTask.findings.forEach(finding => {
      console.log(`\nSource: ${finding.source}`);
      finding.keyPoints.forEach(point => console.log(`  - ${point}`));
    });
    console.log('\nSynthesis:', researchTask.synthesis);
  },
  
  // Example research workflow
  researchWorkflow: () => {
    const workflow = [
      'Receive research topic from Coordinator',
      'Identify reliable sources',
      'Gather relevant information',
      'Analyze and filter data',
      'Synthesize findings',
      'Create research report',
      'Share findings with team'
    ];
    
    console.log('\nResearch Workflow:');
    workflow.forEach((step, index) => {
      console.log(`${index + 1}. ${step}`);
    });
  }
};

// Run the test
researcherAgentTest.demonstrateRole();
researcherAgentTest.researchWorkflow();

module.exports = researcherAgentTest;