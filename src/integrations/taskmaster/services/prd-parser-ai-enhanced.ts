/**
 * AI-Enhanced PRD Parser Service
 * Combines traditional parsing with AI analysis for better understanding
 */

import { PRDParserService, ParsedPRD, Feature, Requirement } from './prd-parser-deno.ts';
import { AIService } from './ai-service-deno.ts';

export interface AIEnhancedPRDOptions {
  useAI?: boolean;
  aiModel?: string;
  extractDetailedFeatures?: boolean;
  generateAcceptanceCriteria?: boolean;
}

export class AIEnhancedPRDParser extends PRDParserService {
  private aiService: AIService;
  
  constructor(aiConfig?: { apiKey?: string; model?: string }) {
    super();
    this.aiService = new AIService(aiConfig);
  }
  
  /**
   * Parse PRD with optional AI enhancement
   */
  async parsePRD(content: string, options?: AIEnhancedPRDOptions): Promise<ParsedPRD> {
    // First, do traditional parsing
    const baseParsed = await super.parsePRD(content);
    
    // If AI is not available or not requested, return base parsing
    if (!options?.useAI || !this.aiService.isAvailable()) {
      if (options?.useAI && !this.aiService.isAvailable()) {
        console.warn('AI enhancement requested but no API key available. Using traditional parsing.');
      }
      return baseParsed;
    }
    
    try {
      // Get AI analysis of the entire document
      console.log('Enhancing PRD with AI analysis...');
      const aiAnalysis = await this.aiService.analyzePRD(content);
      
      // Enhance the parsed PRD with AI insights
      const enhanced = { ...baseParsed };
      
      // Add AI-generated summary to metadata
      enhanced.metadata = {
        ...enhanced.metadata,
        aiSummary: aiAnalysis.summary,
        aiComplexity: aiAnalysis.complexity,
        aiEstimatedEffort: aiAnalysis.estimatedEffort,
        aiEnhanced: true
      };
      
      // Enhance features with AI analysis
      if (options.extractDetailedFeatures) {
        enhanced.features = await this.enhanceFeatures(
          baseParsed.features,
          baseParsed.sections,
          aiAnalysis.features
        );
      } else {
        // Just merge AI-identified features
        const aiFeatures = this.convertAIFeaturesToFeatures(aiAnalysis.features);
        enhanced.features = this.mergeFeatures(baseParsed.features, aiFeatures);
      }
      
      // Enhance requirements with AI insights
      const aiRequirements = this.convertAIRequirementsToRequirements(aiAnalysis.requirements);
      enhanced.requirements = this.mergeRequirements(baseParsed.requirements, aiRequirements);
      
      return enhanced;
    } catch (error) {
      console.error('AI enhancement failed, returning base parsing:', error);
      return baseParsed;
    }
  }
  
  /**
   * Enhance features with detailed AI analysis
   */
  private async enhanceFeatures(
    baseFeatures: Feature[],
    sections: any[],
    aiFeatures: string[]
  ): Promise<Feature[]> {
    const enhancedFeatures: Feature[] = [];
    
    // Process feature sections for detailed extraction
    const featureSections = sections.filter(s => 
      s.type === 'requirements' || s.title.toLowerCase().includes('feature')
    );
    
    for (const section of featureSections) {
      try {
        const detailed = await this.aiService.extractDetailedFeatures(
          section.content,
          section.title
        );
        
        for (const detail of detailed.features) {
          enhancedFeatures.push({
            id: crypto.randomUUID(),
            title: detail.title,
            description: detail.description,
            priority: detail.priority as 'high' | 'medium' | 'low',
            category: section.title,
            acceptanceCriteria: detail.acceptanceCriteria
          });
        }
      } catch (error) {
        console.error('Failed to extract detailed features from section:', section.title);
      }
    }
    
    // Merge with base features, avoiding duplicates
    const merged = this.mergeFeatures(baseFeatures, enhancedFeatures);
    
    // Add any AI-identified features not found in sections
    const additionalFeatures = aiFeatures
      .filter(f => !merged.some(m => 
        m.title.toLowerCase().includes(f.toLowerCase()) ||
        m.description.toLowerCase().includes(f.toLowerCase())
      ))
      .map(f => ({
        id: crypto.randomUUID(),
        title: f,
        description: f,
        priority: 'medium' as const,
        category: 'AI Identified'
      }));
    
    return [...merged, ...additionalFeatures];
  }
  
  /**
   * Convert AI-identified features to Feature objects
   */
  private convertAIFeaturesToFeatures(aiFeatures: string[]): Feature[] {
    return aiFeatures.map(feature => ({
      id: crypto.randomUUID(),
      title: this.extractFeatureTitle(feature),
      description: feature,
      priority: this.detectPriority(feature),
      category: 'AI Identified',
      acceptanceCriteria: []
    }));
  }
  
  /**
   * Convert AI-identified requirements to Requirement objects
   */
  private convertAIRequirementsToRequirements(aiRequirements: string[]): Requirement[] {
    return aiRequirements.map(req => ({
      id: crypto.randomUUID(),
      type: this.detectRequirementType(req, 'AI Analysis'),
      description: req,
      priority: this.detectPriority(req),
      category: 'AI Identified'
    }));
  }
  
  /**
   * Merge features avoiding duplicates
   */
  private mergeFeatures(base: Feature[], additional: Feature[]): Feature[] {
    const merged = [...base];
    
    for (const feature of additional) {
      // Check if similar feature already exists
      const exists = merged.some(f => 
        this.areSimilar(f.title, feature.title) ||
        this.areSimilar(f.description, feature.description)
      );
      
      if (!exists) {
        merged.push(feature);
      }
    }
    
    return merged;
  }
  
  /**
   * Merge requirements avoiding duplicates
   */
  private mergeRequirements(base: Requirement[], additional: Requirement[]): Requirement[] {
    const merged = [...base];
    
    for (const req of additional) {
      const exists = merged.some(r => 
        this.areSimilar(r.description, req.description)
      );
      
      if (!exists) {
        merged.push(req);
      }
    }
    
    return merged;
  }
  
  /**
   * Check if two strings are similar (basic similarity check)
   */
  private areSimilar(str1: string, str2: string): boolean {
    const normalize = (s: string) => s.toLowerCase().trim();
    const n1 = normalize(str1);
    const n2 = normalize(str2);
    
    // Exact match
    if (n1 === n2) return true;
    
    // One contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;
    
    // Share significant words
    const words1 = n1.split(/\s+/).filter(w => w.length > 3);
    const words2 = n2.split(/\s+/).filter(w => w.length > 3);
    const commonWords = words1.filter(w => words2.includes(w));
    
    return commonWords.length > Math.min(words1.length, words2.length) * 0.5;
  }
}