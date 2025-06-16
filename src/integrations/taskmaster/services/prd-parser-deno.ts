/**
 * Enhanced PRD Parser Service (Deno Compatible)
 * Provides intelligent parsing of Product Requirements Documents
 */

import { marked } from "https://deno.land/x/marked@1.0.2/mod.ts";

export interface PRDSection {
  id: string;
  title: string;
  level: number;
  type: string;
  content: string;
  children: PRDSection[];
  metadata?: Record<string, any>;
}

export interface ParsedPRD {
  id: string;
  title: string;
  version: string;
  sections: PRDSection[];
  features: Feature[];
  requirements: Requirement[];
  metadata: PRDMetadata;
  rawContent: string;
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  priority?: string;
  category?: string;
  acceptanceCriteria?: string[];
}

export interface Requirement {
  id: string;
  type: 'functional' | 'non-functional' | 'technical' | 'business';
  description: string;
  priority: string;
  category?: string;
}

export interface PRDMetadata {
  created: string;
  modified: string;
  author?: string;
  version: string;
  tags?: string[];
  stakeholders?: string[];
}

export class PRDParserService {
  private sectionTypePatterns: Map<string, RegExp[]>;
  
  constructor() {
    this.initializeSectionPatterns();
  }

  private initializeSectionPatterns(): void {
    this.sectionTypePatterns = new Map([
      ['overview', [
        /overview|introduction|summary|abstract|executive summary/i,
        /^about|^description/i
      ]],
      ['requirements', [
        /requirements?|features?|functionality/i,
        /functional requirements|business requirements/i
      ]],
      ['technical', [
        /technical|architecture|technology|stack|infrastructure/i,
        /implementation|development/i
      ]],
      ['user-stories', [
        /user stor(y|ies)|personas?|use cases?/i,
        /as a .+ i want/i
      ]],
      ['constraints', [
        /constraints?|limitations?|assumptions?|dependencies/i,
        /non-functional|performance|security/i
      ]],
      ['success-metrics', [
        /success|metrics?|kpis?|goals?|objectives?/i,
        /measurement|tracking/i
      ]]
    ]);
  }

  async parsePRD(content: string, options?: { aiEnhanced?: boolean }): Promise<ParsedPRD> {
    // Parse markdown structure
    const tokens = marked.lexer(content);
    const sections = this.extractSections(tokens);
    
    // Extract features and requirements
    const features = this.extractFeatures(sections);
    const requirements = this.extractRequirements(sections);
    
    // Generate metadata
    const metadata = this.generateMetadata(content);
    
    // Extract title
    const title = this.extractTitle(tokens) || 'Untitled PRD';
    
    return {
      id: crypto.randomUUID(),
      title,
      version: metadata.version,
      sections,
      features,
      requirements,
      metadata,
      rawContent: content
    };
  }

  private extractSections(tokens: any[]): PRDSection[] {
    const sections: PRDSection[] = [];
    const sectionStack: PRDSection[] = [];
    let currentContent: string[] = [];

    for (const token of tokens) {
      if (token.type === 'heading') {
        // Save previous section content
        if (sectionStack.length > 0) {
          const lastSection = sectionStack[sectionStack.length - 1];
          lastSection.content = currentContent.join('\n').trim();
        }

        // Pop sections from stack if new heading is at same or higher level
        while (sectionStack.length > 0 && 
               sectionStack[sectionStack.length - 1].level >= token.depth) {
          sectionStack.pop();
        }

        // Create new section
        const section: PRDSection = {
          id: crypto.randomUUID(),
          title: token.text,
          level: token.depth,
          type: this.identifySectionType(token.text),
          content: '',
          children: []
        };

        // Add to parent or root
        if (sectionStack.length === 0) {
          sections.push(section);
        } else {
          sectionStack[sectionStack.length - 1].children.push(section);
        }

        sectionStack.push(section);
        currentContent = [];
      } else if (token.type === 'paragraph' || token.type === 'list' || token.type === 'text') {
        currentContent.push(token.raw || token.text || '');
      }
    }

    // Save last section content
    if (sectionStack.length > 0) {
      sectionStack[sectionStack.length - 1].content = currentContent.join('\n').trim();
    }

    return sections;
  }

  private identifySectionType(title: string): string {
    for (const [type, patterns] of this.sectionTypePatterns.entries()) {
      for (const pattern of patterns) {
        if (pattern.test(title)) {
          return type;
        }
      }
    }
    return 'other';
  }

  private extractFeatures(sections: PRDSection[]): Feature[] {
    const features: Feature[] = [];
    
    const featureSections = this.findSectionsByType(sections, 'requirements');
    
    for (const section of featureSections) {
      const bullets = this.extractBulletPoints(section.content);
      
      for (const bullet of bullets) {
        const feature: Feature = {
          id: crypto.randomUUID(),
          title: this.extractFeatureTitle(bullet),
          description: bullet,
          priority: this.detectPriority(bullet),
          category: section.title
        };
        
        features.push(feature);
      }
      
      // Also process child sections
      if (section.children.length > 0) {
        features.push(...this.extractFeatures(section.children));
      }
    }
    
    return features;
  }

  private extractRequirements(sections: PRDSection[]): Requirement[] {
    const requirements: Requirement[] = [];
    
    // Look for technical and constraint sections
    const techSections = this.findSectionsByType(sections, 'technical');
    const constraintSections = this.findSectionsByType(sections, 'constraints');
    
    const allSections = [...techSections, ...constraintSections];
    
    for (const section of allSections) {
      const bullets = this.extractBulletPoints(section.content);
      
      for (const bullet of bullets) {
        const requirement: Requirement = {
          id: crypto.randomUUID(),
          type: this.detectRequirementType(bullet, section.type),
          description: bullet,
          priority: this.detectPriority(bullet),
          category: section.title
        };
        
        requirements.push(requirement);
      }
    }
    
    return requirements;
  }

  private findSectionsByType(sections: PRDSection[], type: string): PRDSection[] {
    const found: PRDSection[] = [];
    
    for (const section of sections) {
      if (section.type === type) {
        found.push(section);
      }
      
      if (section.children.length > 0) {
        found.push(...this.findSectionsByType(section.children, type));
      }
    }
    
    return found;
  }

  private extractBulletPoints(content: string): string[] {
    const bullets: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.match(/^[-*+]\s+/)) {
        bullets.push(trimmed.replace(/^[-*+]\s+/, ''));
      } else if (trimmed.match(/^\d+\.\s+/)) {
        bullets.push(trimmed.replace(/^\d+\.\s+/, ''));
      }
    }
    
    return bullets;
  }

  private extractFeatureTitle(description: string): string {
    // Extract title from feature description
    const colonIndex = description.indexOf(':');
    if (colonIndex > 0 && colonIndex < 50) {
      return description.substring(0, colonIndex).trim();
    }
    
    // Use first few words as title
    const words = description.split(' ');
    return words.slice(0, Math.min(5, words.length)).join(' ');
  }

  private detectPriority(text: string): string {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('critical') || lowerText.includes('must have') || 
        lowerText.includes('essential') || lowerText.includes('core')) {
      return 'high';
    }
    
    if (lowerText.includes('should have') || lowerText.includes('important') ||
        lowerText.includes('recommended')) {
      return 'medium';
    }
    
    if (lowerText.includes('nice to have') || lowerText.includes('optional') ||
        lowerText.includes('future') || lowerText.includes('could have')) {
      return 'low';
    }
    
    return 'medium';
  }

  private detectRequirementType(text: string, sectionType: string): 'functional' | 'non-functional' | 'technical' | 'business' {
    const lowerText = text.toLowerCase();
    
    if (sectionType === 'technical' || lowerText.includes('api') || 
        lowerText.includes('database') || lowerText.includes('architecture')) {
      return 'technical';
    }
    
    if (lowerText.includes('performance') || lowerText.includes('security') ||
        lowerText.includes('scalability') || lowerText.includes('availability')) {
      return 'non-functional';
    }
    
    if (lowerText.includes('business') || lowerText.includes('revenue') ||
        lowerText.includes('cost') || lowerText.includes('roi')) {
      return 'business';
    }
    
    return 'functional';
  }

  private generateMetadata(content: string): PRDMetadata {
    const lines = content.split('\n').slice(0, 20); // Check first 20 lines for metadata
    
    const metadata: PRDMetadata = {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      version: '1.0.0'
    };
    
    // Look for metadata patterns
    for (const line of lines) {
      if (line.includes('Author:') || line.includes('By:')) {
        metadata.author = line.split(':')[1]?.trim();
      }
      if (line.includes('Version:')) {
        metadata.version = line.split(':')[1]?.trim() || '1.0.0';
      }
      if (line.includes('Date:') || line.includes('Created:')) {
        const dateStr = line.split(':')[1]?.trim();
        if (dateStr) {
          metadata.created = new Date(dateStr).toISOString();
        }
      }
    }
    
    // Extract tags from content
    metadata.tags = this.extractTags(content);
    
    return metadata;
  }

  private extractTitle(tokens: any[]): string | null {
    const headingToken = tokens.find(t => t.type === 'heading' && t.depth === 1);
    return headingToken?.text || null;
  }

  private extractTags(content: string): string[] {
    const tags = new Set<string>();
    
    // Common technology tags
    const techPatterns = [
      /react|vue|angular/gi,
      /node\.?js|python|java|typescript/gi,
      /docker|kubernetes|aws|azure/gi,
      /postgresql|mysql|mongodb|redis/gi,
      /rest|graphql|websocket/gi
    ];
    
    for (const pattern of techPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach(match => tags.add(match.toLowerCase()));
      }
    }
    
    return Array.from(tags);
  }

  async enhanceWithAI(prd: ParsedPRD, apiKey?: string): Promise<ParsedPRD> {
    // Placeholder for AI enhancement
    // In a real implementation, this would call Claude API to:
    // 1. Improve requirement clarity
    // 2. Identify missing requirements
    // 3. Suggest acceptance criteria
    // 4. Detect potential conflicts
    
    console.log('AI enhancement not yet implemented');
    return prd;
  }
}