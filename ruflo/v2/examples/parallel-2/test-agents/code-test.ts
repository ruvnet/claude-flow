// Test case for code agent
export const codeTestCase = {
  name: "Algorithm Implementation",
  description: "Test the code agent's ability to implement complex algorithms",
  task: "Implement a comprehensive binary search tree (BST) class in TypeScript with the following methods: insert, delete, search, findMin, findMax, inOrderTraversal, preOrderTraversal, postOrderTraversal, getHeight, isBalanced, and rotateLeft/rotateRight for balancing",
  expectedOutputs: [
    "TypeScript class definition",
    "All requested methods implemented",
    "Proper type annotations",
    "Edge case handling",
    "Time complexity comments"
  ],
  validateOutput: (output: string): boolean => {
    const requiredMethods = [
      "insert",
      "delete",
      "search",
      "findMin",
      "findMax",
      "traversal"
    ];
    
    const hasClass = output.includes("class") && output.includes("BST");
    const hasTypes = output.includes("<T>") || output.includes(": number") || output.includes(": boolean");
    const hasMethods = requiredMethods.every(method => output.includes(method));
    
    return hasClass && hasTypes && hasMethods;
  }
};