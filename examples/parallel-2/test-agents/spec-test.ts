// Test case for spec-pseudocode agent
export const specTestCase = {
  name: "Calculator API Specification",
  description: "Test the specification agent's ability to create detailed API specs",
  task: "Create a comprehensive specification for a calculator REST API with the following requirements: basic arithmetic operations (add, subtract, multiply, divide), error handling for division by zero, input validation, response format standardization, and rate limiting considerations",
  expectedOutputs: [
    "API endpoints definition",
    "Request/response schemas", 
    "Error codes and messages",
    "Input validation rules",
    "Non-functional requirements"
  ],
  validateOutput: (output: string): boolean => {
    const requiredElements = [
      "endpoint",
      "request",
      "response",
      "error",
      "validation"
    ];
    
    return requiredElements.every(element => 
      output.toLowerCase().includes(element)
    );
  }
};