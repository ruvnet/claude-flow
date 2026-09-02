// Test file to verify typo and syntax fixes

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Typo and Syntax Fixes', () => {
  describe('daa-tools.js processCommunication fix', () => {
    test('should have fixed processCommuncation to processCommunication', () => {
      const filePath = path.join(process.cwd(), 'src/ui/console/js/daa-tools.js');
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      
      // Check that the typo has been fixed
      expect(fileContent).not.toContain('processCommuncation');
      expect(fileContent).toContain('processCommunication');
      
      // Check method definition exists
      const methodMatch = fileContent.match(/processCommunication\s*\([^)]*\)\s*{/);
      expect(methodMatch).toBeTruthy();
      
      // Check method call exists
      const callMatch = fileContent.match(/this\.processCommunication\s*\(/);
      expect(callMatch).toBeTruthy();
    });
  });
  
  describe('sparc-commands.js ternary operator check', () => {
    test('should have properly formatted ternary operators', () => {
      const filePath = path.join(process.cwd(), 'src/cli/simple-commands/init/claude-commands/sparc-commands.js');
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      
      // Check that the ternary operator on line 6-8 is complete
      const ternaryMatch = fileContent.match(/mode\.roleDefinition\.length > 100\s*\?\s*`[^`]+`\s*:\s*mode\.roleDefinition/);
      expect(ternaryMatch).toBeTruthy();
      
      // Check that Array.isArray ternary is complete (has the : 'None' part)
      // The pattern is: Array.isArray(mode.groups) ? ... : 'None'}
      const arrayTernaryPattern = /Array\.isArray\(mode\.groups\)\s*\?[\s\S]+?\)\s*:\s*'None'\}/;
      const arrayTernaryMatch = fileContent.match(arrayTernaryPattern);
      expect(arrayTernaryMatch).toBeTruthy();
    });
    
    test('should be valid JavaScript syntax', async () => {
      const filePath = path.join(process.cwd(), 'src/cli/simple-commands/init/claude-commands/sparc-commands.js');
      
      // Dynamic import to check syntax
      let imported;
      try {
        imported = await import(filePath);
        expect(imported).toBeDefined();
        expect(typeof imported.createSparcSlashCommand).toBe('function');
      } catch (error) {
        // If import fails, it's a syntax error
        throw new Error(`Syntax error in sparc-commands.js: ${error.message}`);
      }
    });
  });
});