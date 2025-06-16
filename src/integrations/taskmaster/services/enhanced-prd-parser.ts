import { AIProviderManager } from './ai-provider.ts';
import { AIRequest, AIResponse } from '../types/ai-types.ts';
import {
  ParsedPRD,
  DocumentFormat,
  DocumentStructure,
  DocumentSection,
  Requirement,
  Constraint,
  AcceptanceCriteria,
  ComplexityAnalysis,
  ParseOptions,
  ValidationResult
} from '../types/prd-types.ts';

export class EnhancedPRDParser {
  private aiProvider: AIProviderManager;
  private formatParsers: Map<DocumentFormat, FormatParser>;

  constructor(aiProvider: AIProviderManager) {
    this.aiProvider = aiProvider;
    this.formatParsers = new Map([
      ['markdown', new MarkdownParser()],
      ['html', new HTMLParser()],
      ['pdf', new PDFParser()],
      ['docx', new DOCXParser()],
      ['text', new TextParser()]
    ]);
  }

  async parsePRD(content: string | Buffer, options: ParseOptions = {}): Promise<ParsedPRD> {
    try {
      // Step 1: Parse document based on format
      const parsedDocument = await this.parseDocument(content, options.format || 'markdown');
      
      // Step 2: Validate document structure
      const validation = await this.validateDocument(parsedDocument);
      if (!validation.isValid) {
        throw new Error(`Document validation failed: ${validation.errors.join(', ')}`);
      }

      // Step 3: Extract document structure using AI
      const structure = await this.extractDocumentStructure(parsedDocument);
      
      // Step 4: Identify and extract requirements
      const requirements = await this.extractRequirements(structure);
      
      // Step 5: Extract constraints and acceptance criteria
      const constraints = await this.extractConstraints(structure);
      const acceptanceCriteria = await this.extractAcceptanceCriteria(requirements);
      
      // Step 6: Analyze complexity
      const complexity = await this.analyzeComplexity(requirements, constraints);

      // Step 7: Extract metadata
      const metadata = await this.extractMetadata(parsedDocument, structure);

      return {
        id: this.generatePRDId(),
        title: metadata.title || 'Untitled PRD',
        version: metadata.version || '1.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        structure,
        requirements,
        constraints,
        acceptanceCriteria,
        complexity,
        metadata,
        rawContent: typeof content === 'string' ? content : content.toString(),
        format: options.format || 'markdown'
      };
    } catch (error) {
      throw new Error(`PRD parsing failed: ${error}`);
    }
  }

  private async parseDocument(content: string | Buffer, format: DocumentFormat): Promise<any> {
    const parser = this.formatParsers.get(format);
    if (!parser) {
      throw new Error(`Unsupported document format: ${format}`);
    }

    return await parser.parse(content);
  }

  private async validateDocument(document: any): Promise<ValidationResult> {
    const errors: string[] = [];
    
    if (!document || typeof document !== 'object') {
      errors.push('Document is empty or invalid');
    }

    if (!document.content || document.content.length < 100) {
      errors.push('Document content is too short (minimum 100 characters)');
    }

    // Use AI to validate PRD structure
    const aiValidationRequest: AIRequest = {
      type: 'analysis',
      content: `Analyze this document and determine if it contains typical PRD elements like requirements, objectives, acceptance criteria, etc. Document preview: ${JSON.stringify(document).substring(0, 1000)}`,
      systemPrompt: 'You are a technical document validator. Respond with "VALID" if this appears to be a Product Requirements Document or similar technical specification, or "INVALID: reason" if not.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiValidationRequest);
      if (response.content.startsWith('INVALID')) {
        errors.push(response.content.replace('INVALID: ', ''));
      }
    } catch (error) {
      // If AI validation fails, continue with basic validation
      console.warn('AI validation failed, using basic validation only');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async extractDocumentStructure(document: any): Promise<DocumentStructure> {
    const aiRequest: AIRequest = {
      type: 'structured-output',
      content: `Analyze this document and extract its hierarchical structure. Identify sections, subsections, and classify each by type (overview, requirements, constraints, acceptance criteria, technical specs, etc.).

Document content:
${JSON.stringify(document, null, 2)}

Return a JSON structure with sections array, where each section has:
- id: unique identifier
- title: section title
- type: classification (overview, functional_requirements, non_functional_requirements, constraints, acceptance_criteria, technical_specifications, user_stories, other)
- level: hierarchy level (1-5)
- content: section content
- subsections: array of child sections`,
      systemPrompt: 'You are a document structure analyzer. Extract and classify document sections accurately. Always return valid JSON.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const structure = JSON.parse(response.content);
      
      return {
        sections: structure.sections || [],
        hierarchy: this.buildHierarchy(structure.sections || []),
        totalSections: (structure.sections || []).length,
        maxDepth: this.calculateMaxDepth(structure.sections || [])
      };
    } catch (error) {
      // Fallback to basic structure extraction
      return this.extractBasicStructure(document);
    }
  }

  private async extractRequirements(structure: DocumentStructure): Promise<Requirement[]> {
    const requirementSections = structure.sections.filter(
      section => section.type.includes('requirements') || section.type === 'user_stories'
    );

    const requirements: Requirement[] = [];

    for (const section of requirementSections) {
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Extract specific requirements from this section. Each requirement should be atomic, testable, and clearly defined.

Section: ${section.title}
Content: ${section.content}

Return a JSON array of requirements, where each requirement has:
- id: unique identifier (req_xxx format)
- title: brief title
- description: detailed description
- type: functional, non_functional, technical, or business
- priority: must_have, should_have, could_have, or wont_have (MoSCoW)
- complexity: low, medium, or high
- dependencies: array of requirement IDs this depends on
- acceptanceCriteria: array of testable criteria
- source: section where it was found
- estimatedEffort: rough effort estimate in story points (1-13)`,
        systemPrompt: 'You are a requirements analyst. Extract clear, atomic requirements from technical documents. Always return valid JSON array.'
      };

      try {
        const response = await this.aiProvider.executeWithFallback(aiRequest);
        const sectionRequirements = JSON.parse(response.content);
        
        for (const req of sectionRequirements) {
          requirements.push({
            id: req.id || `req_${requirements.length + 1}`,
            title: req.title,
            description: req.description,
            type: req.type || 'functional',
            priority: req.priority || 'should_have',
            complexity: req.complexity || 'medium',
            dependencies: req.dependencies || [],
            acceptanceCriteria: req.acceptanceCriteria || [],
            source: section.id,
            estimatedEffort: req.estimatedEffort || 3,
            metadata: {
              extractedFrom: section.title,
              confidence: 0.8
            }
          });
        }
      } catch (error) {
        console.warn(`Failed to extract requirements from section ${section.id}: ${error}`);
        // Fallback to basic text extraction
        const basicReqs = this.extractBasicRequirements(section);
        requirements.push(...basicReqs);
      }
    }

    return this.deduplicateRequirements(requirements);
  }

  private async extractConstraints(structure: DocumentStructure): Promise<Constraint[]> {
    const constraintSections = structure.sections.filter(
      section => section.type === 'constraints' || 
                 section.title.toLowerCase().includes('constraint') ||
                 section.title.toLowerCase().includes('limitation')
    );

    const constraints: Constraint[] = [];

    for (const section of constraintSections) {
      const aiRequest: AIRequest = {
        type: 'analysis',
        content: `Extract constraints and limitations from this section. Focus on technical, business, regulatory, and resource constraints.

Section: ${section.title}
Content: ${section.content}

Return a JSON array of constraints, where each constraint has:
- id: unique identifier (const_xxx format)
- title: brief title
- description: detailed description
- type: technical, business, regulatory, resource, time, or budget
- impact: low, medium, or high
- mandatory: true if non-negotiable
- workaround: possible workaround if any
- affectedRequirements: array of requirement IDs affected`,
        systemPrompt: 'You are a constraints analyst. Extract clear constraints that limit or restrict the solution. Always return valid JSON array.'
      };

      try {
        const response = await this.aiProvider.executeWithFallback(aiRequest);
        const sectionConstraints = JSON.parse(response.content);
        
        for (const constraint of sectionConstraints) {
          constraints.push({
            id: constraint.id || `const_${constraints.length + 1}`,
            title: constraint.title,
            description: constraint.description,
            type: constraint.type || 'technical',
            impact: constraint.impact || 'medium',
            mandatory: constraint.mandatory || false,
            workaround: constraint.workaround,
            affectedRequirements: constraint.affectedRequirements || [],
            source: section.id
          });
        }
      } catch (error) {
        console.warn(`Failed to extract constraints from section ${section.id}: ${error}`);
      }
    }

    return constraints;
  }

  private async extractAcceptanceCriteria(requirements: Requirement[]): Promise<AcceptanceCriteria[]> {
    const criteria: AcceptanceCriteria[] = [];

    for (const requirement of requirements) {
      if (requirement.acceptanceCriteria.length > 0) {
        // Already has criteria, convert to proper format
        for (let i = 0; i < requirement.acceptanceCriteria.length; i++) {
          criteria.push({
            id: `ac_${requirement.id}_${i + 1}`,
            requirementId: requirement.id,
            description: requirement.acceptanceCriteria[i],
            type: 'functional',
            testable: true,
            priority: requirement.priority,
            method: 'manual'
          });
        }
      } else {
        // Generate acceptance criteria using AI
        const aiRequest: AIRequest = {
          type: 'analysis',
          content: `Generate specific, testable acceptance criteria for this requirement:

Requirement: ${requirement.title}
Description: ${requirement.description}
Type: ${requirement.type}

Return a JSON array of acceptance criteria, where each has:
- description: specific, testable criterion
- type: functional, non_functional, or usability
- testable: always true
- method: manual, automated, or integration
- priority: inherit from requirement`,
          systemPrompt: 'You are a QA analyst. Generate clear, testable acceptance criteria using Given/When/Then format where appropriate. Always return valid JSON array.'
        };

        try {
          const response = await this.aiProvider.executeWithFallback(aiRequest);
          const reqCriteria = JSON.parse(response.content);
          
          for (let i = 0; i < reqCriteria.length; i++) {
            criteria.push({
              id: `ac_${requirement.id}_${i + 1}`,
              requirementId: requirement.id,
              description: reqCriteria[i].description,
              type: reqCriteria[i].type || 'functional',
              testable: true,
              priority: requirement.priority,
              method: reqCriteria[i].method || 'manual'
            });
          }
        } catch (error) {
          console.warn(`Failed to generate acceptance criteria for ${requirement.id}: ${error}`);
        }
      }
    }

    return criteria;
  }

  private async analyzeComplexity(requirements: Requirement[], constraints: Constraint[]): Promise<ComplexityAnalysis> {
    const aiRequest: AIRequest = {
      type: 'analysis',
      content: `Analyze the complexity of this project based on the requirements and constraints:

Requirements (${requirements.length} total):
${requirements.map(r => `- ${r.title} (${r.type}, ${r.complexity})`).join('\n')}

Constraints (${constraints.length} total):
${constraints.map(c => `- ${c.title} (${c.type}, ${c.impact})`).join('\n')}

Analyze and return JSON with:
- overallComplexity: low, medium, high, or very_high
- factors: array of complexity factors found
- technicalComplexity: assessment of technical challenges
- businessComplexity: assessment of business logic complexity
- integrationComplexity: assessment of integration challenges
- estimatedDuration: rough project duration in weeks
- riskLevel: low, medium, high, or critical
- recommendedTeamSize: suggested team size
- keyRisks: array of main risk factors
- mitigationStrategies: suggested mitigation approaches`,
      systemPrompt: 'You are a project complexity analyst. Provide thorough analysis of project complexity factors. Always return valid JSON.'
    };

    try {
      const response = await this.aiProvider.executeWithFallback(aiRequest);
      const analysis = JSON.parse(response.content);
      
      return {
        overallComplexity: analysis.overallComplexity || 'medium',
        factors: analysis.factors || [],
        scores: {
          technical: this.calculateTechnicalComplexity(requirements),
          business: this.calculateBusinessComplexity(requirements),
          integration: this.calculateIntegrationComplexity(requirements, constraints),
          ui: this.calculateUIComplexity(requirements)
        },
        estimatedDuration: analysis.estimatedDuration || 8,
        riskLevel: analysis.riskLevel || 'medium',
        recommendedTeamSize: analysis.recommendedTeamSize || 3,
        keyRisks: analysis.keyRisks || [],
        mitigationStrategies: analysis.mitigationStrategies || []
      };
    } catch (error) {
      console.warn(`Failed to analyze complexity: ${error}`);
      return this.calculateBasicComplexity(requirements, constraints);
    }
  }

  private async extractMetadata(document: any, structure: DocumentStructure): Promise<Record<string, any>> {
    return {
      title: this.extractTitle(document, structure),
      version: this.extractVersion(document),
      author: this.extractAuthor(document),
      createdDate: this.extractCreatedDate(document),
      lastModified: Date.now(),
      wordCount: this.calculateWordCount(document),
      sectionCount: structure.totalSections,
      tags: await this.extractTags(document),
      projectType: await this.determineProjectType(structure),
      estimatedReadTime: this.calculateReadTime(document)
    };
  }

  // Helper methods for basic parsing fallbacks
  private extractBasicStructure(document: any): DocumentStructure {
    const sections: DocumentSection[] = [];
    const content = document.content || document.toString();
    
    // Basic header detection
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    let match;
    let sectionId = 1;
    
    while ((match = headerRegex.exec(content)) !== null) {
      const level = match[1].length;
      const title = match[2].trim();
      
      sections.push({
        id: `section_${sectionId++}`,
        title,
        type: this.classifySectionType(title),
        level,
        content: '', // Would need more parsing to extract content
        startIndex: match.index,
        endIndex: match.index + match[0].length
      });
    }

    return {
      sections,
      hierarchy: this.buildHierarchy(sections),
      totalSections: sections.length,
      maxDepth: Math.max(...sections.map(s => s.level), 1)
    };
  }

  private classifySectionType(title: string): string {
    const lower = title.toLowerCase();
    
    if (lower.includes('requirement') || lower.includes('spec')) return 'functional_requirements';
    if (lower.includes('constraint') || lower.includes('limitation')) return 'constraints';
    if (lower.includes('acceptance') || lower.includes('criteria')) return 'acceptance_criteria';
    if (lower.includes('technical') || lower.includes('architecture')) return 'technical_specifications';
    if (lower.includes('user') || lower.includes('story')) return 'user_stories';
    if (lower.includes('overview') || lower.includes('summary')) return 'overview';
    
    return 'other';
  }

  private extractBasicRequirements(section: DocumentSection): Requirement[] {
    const requirements: Requirement[] = [];
    const lines = section.content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
        requirements.push({
          id: `req_basic_${i}`,
          title: line.replace(/^[-*\d.]\s*/, ''),
          description: line,
          type: 'functional',
          priority: 'should_have',
          complexity: 'medium',
          dependencies: [],
          acceptanceCriteria: [],
          source: section.id,
          estimatedEffort: 3,
          metadata: { extractedFrom: section.title, confidence: 0.5 }
        });
      }
    }
    
    return requirements;
  }

  private deduplicateRequirements(requirements: Requirement[]): Requirement[] {
    const seen = new Set<string>();
    const deduplicated: Requirement[] = [];
    
    for (const req of requirements) {
      const key = req.title.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(req);
      }
    }
    
    return deduplicated;
  }

  private buildHierarchy(sections: DocumentSection[]): any {
    // Build section hierarchy tree
    const hierarchy: any = { children: [] };
    const stack: any[] = [hierarchy];
    
    for (const section of sections) {
      const node = { ...section, children: [] };
      
      while (stack.length > 1 && stack[stack.length - 1].level >= section.level) {
        stack.pop();
      }
      
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    
    return hierarchy;
  }

  private calculateMaxDepth(sections: DocumentSection[]): number {
    return Math.max(...sections.map(s => s.level), 1);
  }

  private calculateTechnicalComplexity(requirements: Requirement[]): number {
    const techReqs = requirements.filter(r => r.type === 'technical');
    const highComplexityReqs = requirements.filter(r => r.complexity === 'high');
    
    return Math.min(10, (techReqs.length * 2 + highComplexityReqs.length * 3) / requirements.length * 10);
  }

  private calculateBusinessComplexity(requirements: Requirement[]): number {
    const businessReqs = requirements.filter(r => r.type === 'business');
    const mustHaveReqs = requirements.filter(r => r.priority === 'must_have');
    
    return Math.min(10, (businessReqs.length * 2 + mustHaveReqs.length) / requirements.length * 10);
  }

  private calculateIntegrationComplexity(requirements: Requirement[], constraints: Constraint[]): number {
    const integrationKeywords = ['api', 'integration', 'external', 'third-party', 'service'];
    const integrationReqs = requirements.filter(r => 
      integrationKeywords.some(keyword => 
        r.title.toLowerCase().includes(keyword) || r.description.toLowerCase().includes(keyword)
      )
    );
    
    return Math.min(10, (integrationReqs.length * 3 + constraints.length) / requirements.length * 10);
  }

  private calculateUIComplexity(requirements: Requirement[]): number {
    const uiKeywords = ['ui', 'interface', 'dashboard', 'form', 'page', 'screen'];
    const uiReqs = requirements.filter(r => 
      uiKeywords.some(keyword => 
        r.title.toLowerCase().includes(keyword) || r.description.toLowerCase().includes(keyword)
      )
    );
    
    return Math.min(10, uiReqs.length * 2 / requirements.length * 10);
  }

  private calculateBasicComplexity(requirements: Requirement[], constraints: Constraint[]): ComplexityAnalysis {
    const techScore = this.calculateTechnicalComplexity(requirements);
    const businessScore = this.calculateBusinessComplexity(requirements);
    const integrationScore = this.calculateIntegrationComplexity(requirements, constraints);
    const uiScore = this.calculateUIComplexity(requirements);
    
    const avgScore = (techScore + businessScore + integrationScore + uiScore) / 4;
    
    let overallComplexity: 'low' | 'medium' | 'high' | 'very_high';
    if (avgScore < 3) overallComplexity = 'low';
    else if (avgScore < 6) overallComplexity = 'medium';
    else if (avgScore < 8) overallComplexity = 'high';
    else overallComplexity = 'very_high';
    
    return {
      overallComplexity,
      factors: ['Basic analysis - AI unavailable'],
      scores: {
        technical: techScore,
        business: businessScore,
        integration: integrationScore,
        ui: uiScore
      },
      estimatedDuration: Math.ceil(requirements.length / 5), // 5 requirements per week
      riskLevel: avgScore > 6 ? 'high' : 'medium',
      recommendedTeamSize: Math.ceil(avgScore / 2),
      keyRisks: [],
      mitigationStrategies: []
    };
  }

  private extractTitle(document: any, structure: DocumentStructure): string {
    if (structure.sections.length > 0) {
      return structure.sections[0].title;
    }
    
    const content = document.content || document.toString();
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return titleMatch ? titleMatch[1] : 'Untitled Document';
  }

  private extractVersion(document: any): string {
    const content = document.content || document.toString();
    const versionMatch = content.match(/version[:\s]+([0-9.]+)/i);
    return versionMatch ? versionMatch[1] : '1.0';
  }

  private extractAuthor(document: any): string | undefined {
    const content = document.content || document.toString();
    const authorMatch = content.match(/author[:\s]+([^\n]+)/i);
    return authorMatch ? authorMatch[1].trim() : undefined;
  }

  private extractCreatedDate(document: any): number | undefined {
    const content = document.content || document.toString();
    const dateMatch = content.match(/created?[:\s]+([^\n]+)/i);
    if (dateMatch) {
      const date = new Date(dateMatch[1]);
      return isNaN(date.getTime()) ? undefined : date.getTime();
    }
    return undefined;
  }

  private calculateWordCount(document: any): number {
    const content = document.content || document.toString();
    return content.split(/\s+/).filter(word => word.length > 0).length;
  }

  private async extractTags(document: any): Promise<string[]> {
    // Simple tag extraction - could be enhanced with AI
    const content = document.content || document.toString();
    const tagMatch = content.match(/tags?[:\s]+([^\n]+)/i);
    if (tagMatch) {
      return tagMatch[1].split(',').map(tag => tag.trim());
    }
    return [];
  }

  private async determineProjectType(structure: DocumentStructure): Promise<string> {
    const sectionTypes = structure.sections.map(s => s.type);
    
    if (sectionTypes.includes('technical_specifications')) return 'technical';
    if (sectionTypes.includes('user_stories')) return 'product';
    if (sectionTypes.includes('functional_requirements')) return 'software';
    
    return 'general';
  }

  private calculateReadTime(document: any): number {
    const wordCount = this.calculateWordCount(document);
    return Math.ceil(wordCount / 200); // 200 words per minute
  }

  private generatePRDId(): string {
    return `prd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Format parser interfaces and implementations
interface FormatParser {
  parse(content: string | Buffer): Promise<any>;
}

class MarkdownParser implements FormatParser {
  async parse(content: string | Buffer): Promise<any> {
    const text = typeof content === 'string' ? content : content.toString();
    return { content: text, format: 'markdown' };
  }
}

class HTMLParser implements FormatParser {
  async parse(content: string | Buffer): Promise<any> {
    const text = typeof content === 'string' ? content : content.toString();
    // Basic HTML to text conversion
    const textContent = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return { content: textContent, format: 'html', originalHtml: text };
  }
}

class PDFParser implements FormatParser {
  async parse(content: string | Buffer): Promise<any> {
    // PDF parsing would require pdf-parse or similar library
    // For now, return placeholder
    throw new Error('PDF parsing not yet implemented - requires pdf-parse library');
  }
}

class DOCXParser implements FormatParser {
  async parse(content: string | Buffer): Promise<any> {
    // DOCX parsing would require mammoth or similar library
    // For now, return placeholder
    throw new Error('DOCX parsing not yet implemented - requires mammoth library');
  }
}

class TextParser implements FormatParser {
  async parse(content: string | Buffer): Promise<any> {
    const text = typeof content === 'string' ? content : content.toString();
    return { content: text, format: 'text' };
  }
}