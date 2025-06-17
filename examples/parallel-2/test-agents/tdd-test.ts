// Test case for TDD agent
export const tddTestCase = {
  name: "String Utility Library TDD",
  description: "Test the TDD agent's ability to follow red-green-refactor cycle",
  task: "Using Test-Driven Development, create a string utility library with the following functions: capitalizeWords (capitalize first letter of each word), truncateWithEllipsis (truncate string to length with ...), countVowels, isPalindrome, reverseWords (reverse word order), and camelToSnakeCase. Write comprehensive tests first, then implement each function",
  expectedOutputs: [
    "Test suite with multiple test cases",
    "Implementation of all functions",
    "Red-Green-Refactor cycle evidence",
    "Edge case testing",
    "Test coverage information"
  ],
  validateOutput: (output: string): boolean => {
    const hasTests = output.includes("describe") || output.includes("test") || output.includes("it(");
    const hasImplementation = output.includes("function") || output.includes("const") || output.includes("=>");
    const hasTDDMarkers = output.includes("// Red") || output.includes("// Green") || output.includes("fail") || output.includes("pass");
    
    const functionNames = [
      "capitalizeWords",
      "truncateWithEllipsis",
      "countVowels",
      "isPalindrome"
    ];
    
    const hasFunctions = functionNames.some(fn => output.includes(fn));
    
    return hasTests && hasImplementation && (hasTDDMarkers || hasFunctions);
  }
};