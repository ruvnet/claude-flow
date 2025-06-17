#!/usr/bin/env ts-node

/**
 * Researcher Agent Test - Designed for parallel execution
 * This agent performs research and data gathering
 */

export class ResearcherAgent {
  private agentId: string;
  private startTime: number;

  constructor(id: string = 'researcher-001') {
    this.agentId = id;
    this.startTime = Date.now();
  }

  async conductResearch(topic: string): Promise<any> {
    console.log(`[${this.agentId}] Researching: ${topic}`);
    
    await this.simulateWork(1000);
    
    const research = {
      sources: [
        { title: 'RESTful Web Services', relevance: 0.95, year: 2023 },
        { title: 'API Design Patterns', relevance: 0.88, year: 2023 },
        { title: 'Microservices Architecture', relevance: 0.82, year: 2022 },
        { title: 'HTTP/2 Best Practices', relevance: 0.75, year: 2023 }
      ],
      keyFindings: [
        'Use versioning in API endpoints',
        'Implement proper error handling with status codes',
        'Follow REST principles for resource naming',
        'Implement rate limiting and authentication'
      ],
      recommendations: [
        'Adopt OpenAPI specification',
        'Use JSON:API or GraphQL for complex queries',
        'Implement HATEOAS for discoverability'
      ],
      confidence: 0.87
    };
    
    console.log(`[${this.agentId}] Research completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      topic,
      research
    };
  }

  async analyzeData(data: number[]): Promise<any> {
    console.log(`[${this.agentId}] Analyzing data set with ${data.length} points`);
    
    await this.simulateWork(600);
    
    const analysis = {
      mean: this.calculateMean(data),
      median: this.calculateMedian(data),
      standardDeviation: this.calculateStdDev(data),
      outliers: this.findOutliers(data),
      trend: this.detectTrend(data),
      insights: [
        'Data shows normal distribution',
        'Slight upward trend detected',
        'One significant outlier identified'
      ]
    };
    
    console.log(`[${this.agentId}] Data analysis completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      dataPoints: data.length,
      analysis
    };
  }

  async gatherRequirements(project: string): Promise<any> {
    console.log(`[${this.agentId}] Gathering requirements for: ${project}`);
    
    await this.simulateWork(1200);
    
    const requirements = {
      functional: [
        'User registration and authentication',
        'Profile management',
        'Password reset functionality',
        'Two-factor authentication',
        'Session management'
      ],
      nonFunctional: [
        'Response time < 200ms',
        '99.9% uptime',
        'Support 10,000 concurrent users',
        'GDPR compliance',
        'AES-256 encryption'
      ],
      constraints: [
        'Must integrate with existing user database',
        'Support OAuth2 providers',
        'Mobile-first design'
      ],
      stakeholders: ['Product Team', 'Security Team', 'DevOps', 'QA Team'],
      priority: 'High'
    };
    
    console.log(`[${this.agentId}] Requirements gathering completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      project,
      requirements
    };
  }

  async analyzeTechnology(tech: string): Promise<any> {
    console.log(`[${this.agentId}] Analyzing technology: ${tech}`);
    
    await this.simulateWork(800);
    
    const techAnalysis = {
      maturity: 'Stable',
      communitySupport: 'Excellent',
      learningCurve: 'Moderate',
      performanceRating: 8.5,
      ecosystemSize: 'Large',
      pros: [
        'Large community and ecosystem',
        'Excellent documentation',
        'Strong typing support',
        'Great tooling'
      ],
      cons: [
        'Compilation step required',
        'Configuration complexity',
        'Larger bundle sizes'
      ],
      alternatives: ['JavaScript', 'Flow', 'ReasonML'],
      recommendation: 'Highly recommended for large-scale applications'
    };
    
    console.log(`[${this.agentId}] Technology analysis completed`);
    return {
      agentId: this.agentId,
      duration: Date.now() - this.startTime,
      technology: tech,
      analysis: techAnalysis
    };
  }

  private calculateMean(data: number[]): number {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }

  private calculateMedian(data: number[]): number {
    const sorted = [...data].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private calculateStdDev(data: number[]): number {
    const mean = this.calculateMean(data);
    const squaredDiffs = data.map(x => Math.pow(x - mean, 2));
    return Math.sqrt(this.calculateMean(squaredDiffs));
  }

  private findOutliers(data: number[]): number[] {
    const mean = this.calculateMean(data);
    const stdDev = this.calculateStdDev(data);
    return data.filter(x => Math.abs(x - mean) > 2 * stdDev);
  }

  private detectTrend(data: number[]): string {
    const firstHalf = this.calculateMean(data.slice(0, data.length / 2));
    const secondHalf = this.calculateMean(data.slice(data.length / 2));
    return secondHalf > firstHalf ? 'upward' : secondHalf < firstHalf ? 'downward' : 'stable';
  }

  private async simulateWork(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Allow direct execution
if (require.main === module) {
  const researcher = new ResearcherAgent();
  
  Promise.all([
    researcher.conductResearch('REST API best practices'),
    researcher.analyzeData([42, 38, 51, 47, 39, 52, 48, 45, 98, 41]),
    researcher.gatherRequirements('User Authentication System'),
    researcher.analyzeTechnology('TypeScript')
  ]).then(results => {
    console.log('\nResearcher Agent Results:', JSON.stringify(results, null, 2));
  });
}