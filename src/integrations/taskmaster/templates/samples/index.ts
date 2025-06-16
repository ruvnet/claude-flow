/**
 * Sample Templates Index
 * Export all available sample templates
 */

export { webAppTemplate } from './web-app-template.ts';
export { apiServiceTemplate } from './api-service-template.ts';
export { mobileAppTemplate } from './mobile-app-template.ts';

import { TaskTemplate } from '../types/template-types.ts';
import { webAppTemplate } from './web-app-template.ts';
import { apiServiceTemplate } from './api-service-template.ts';
import { mobileAppTemplate } from './mobile-app-template.ts';

// Collection of all sample templates
export const sampleTemplates: TaskTemplate[] = [
  webAppTemplate,
  apiServiceTemplate,
  mobileAppTemplate
];

// Helper function to load all sample templates into memory
export async function loadSampleTemplates(templateService: any): Promise<void> {
  console.log('Loading sample templates...');
  
  for (const template of sampleTemplates) {
    try {
      // Remove id and timestamps as they'll be regenerated
      const { id, createdAt, updatedAt, ...templateData } = template;
      await templateService.createTemplate(templateData);
      console.log(`✓ Loaded template: ${template.name}`);
    } catch (error) {
      console.error(`✗ Failed to load template ${template.name}:`, error);
    }
  }
}