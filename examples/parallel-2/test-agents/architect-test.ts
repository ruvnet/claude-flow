// Test case for architect agent
export const architectTestCase = {
  name: "Microservices Architecture Design",
  description: "Test the architect agent's ability to design scalable systems",
  task: "Design a microservices architecture for an e-commerce platform with the following services: user management, product catalog, shopping cart, order processing, payment integration, and notification service. Include API gateway, service discovery, load balancing, and data consistency strategies",
  expectedOutputs: [
    "Service boundaries and responsibilities",
    "Inter-service communication patterns",
    "Data management strategy",
    "Security architecture",
    "Scalability considerations",
    "Technology stack recommendations"
  ],
  validateOutput: (output: string): boolean => {
    const requiredConcepts = [
      "service",
      "api",
      "database",
      "communication",
      "security"
    ];
    
    return requiredConcepts.every(concept => 
      output.toLowerCase().includes(concept)
    );
  }
};