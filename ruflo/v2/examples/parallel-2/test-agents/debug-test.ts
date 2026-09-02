// Test case for debug agent
export const debugTestCase = {
  name: "Memory Leak Analysis",
  description: "Test the debug agent's ability to identify and fix issues",
  task: "Analyze the following Node.js code snippet for memory leaks and performance issues: A web server that maintains a global array of all incoming requests without cleanup, creates new event listeners on each request without removing old ones, and has circular references in cached objects. Identify the issues, explain why they cause memory leaks, and provide fixed code",
  expectedOutputs: [
    "Issue identification",
    "Root cause analysis",
    "Memory leak explanation",
    "Performance impact assessment",
    "Fixed code implementation",
    "Prevention recommendations"
  ],
  validateOutput: (output: string): boolean => {
    const debugConcepts = [
      "memory",
      "leak",
      "garbage collection",
      "reference",
      "event listener"
    ];
    
    const hasDiagnostics = debugConcepts.some(concept => 
      output.toLowerCase().includes(concept)
    );
    
    const hasSolution = output.includes("fix") || output.includes("solution") || output.includes("resolved");
    const hasCode = output.includes("```") || output.includes("function") || output.includes("const");
    
    return hasDiagnostics && hasSolution && hasCode;
  }
};