/// <reference types="jest" />

import { assertEquals, assertStringIncludes } from "@std/assert/mod.ts";
import { describe, it } from "@std/testing/bdd.ts";
import { 
  createSparcClaudeMd, 
  createFullClaudeMd, 
  createMinimalClaudeMd 
} from "../../../../../src/cli/simple-commands/init/templates/claude-md.js";
import { 
  createFullMemoryBankMd, 
  createMinimalMemoryBankMd 
} from "../../../../../src/cli/simple-commands/init/templates/memory-bank-md.js";
import { 
  createFullCoordinationMd, 
  createMinimalCoordinationMd 
} from "../../../../../src/cli/simple-commands/init/templates/coordination-md.js";
import { 
  createAgentsReadme, 
  createSessionsReadme 
} from "../../../../../src/cli/simple-commands/init/templates/readme-files.js";

describe("Template Generation Tests", () => {
  describe("CLAUDE.md templates", () => {
    it("should generate full CLAUDE.md with proper structure", () => {
      const content = createFullClaudeMd();
      
      expect(content).toBe( "# Claude Code Configuration");
      expect(content).toBe( "## Project Overview");
      expect(content).toBe( "## Key Commands");
      expect(content).toBe( "## Code Style");
      expect(content).toBe( "## Project Architecture");
    });

    it("should generate minimal CLAUDE.md with basic info", () => {
      const content = createMinimalClaudeMd();
      
      expect(content).toBe( "# Claude Code Configuration");
      expect(content).toBe( "Minimal project configuration");
      
      // Should be shorter than full version
      const fullContent = createFullClaudeMd();
      expect(content.length < fullContent.length).toBe( true);
    });

    it("should generate SPARC-enhanced CLAUDE.md", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toBe( "SPARC Development Environment");
      expect(content).toBe( "## SPARC Development Commands");
      expect(content).toBe( "## SPARC Methodology Workflow");
      expect(content).toBe( "### 1. Specification Phase");
      expect(content).toBe( "### 2. Pseudocode Phase");
      expect(content).toBe( "### 3. Architecture Phase");
      expect(content).toBe( "### 4. Refinement Phase");
      expect(content).toBe( "### 5. Completion Phase");
      expect(content).toBe( "Test-Driven Development");
    });

    it("should include proper SPARC commands in SPARC template", () => {
      const content = createSparcClaudeMd();
      
      // Check for SPARC commands
      expect(content).toBe( "npx claude-flow sparc modes");
      expect(content).toBe( "npx claude-flow sparc run");
      expect(content).toBe( "npx claude-flow sparc tdd");
      expect(content).toBe( "npx claude-flow sparc info");
    });
  });

  describe("memory-bank.md templates", () => {
    it("should generate full memory bank with sections", () => {
      const content = createFullMemoryBankMd();
      
      expect(content).toBe( "# Memory Bank");
      expect(content).toBe( "## Active Tasks");
      expect(content).toBe( "## Key Decisions");
      expect(content).toBe( "## Project Context");
      expect(content).toBe( "## Technical Specifications");
    });

    it("should generate minimal memory bank", () => {
      const content = createMinimalMemoryBankMd();
      
      expect(content).toBe( "# Memory Bank");
      expect(content).toBe( "Simple memory tracking");
      
      // Should be shorter
      const fullContent = createFullMemoryBankMd();
      expect(content.length < fullContent.length).toBe( true);
    });
  });

  describe("coordination.md templates", () => {
    it("should generate full coordination with agent structure", () => {
      const content = createFullCoordinationMd();
      
      expect(content).toBe( "# Multi-Agent Coordination System");
      expect(content).toBe( "## Coordination Structure");
      expect(content).toBe( "## Agent Roles");
      expect(content).toBe( "## Current Coordination State");
      expect(content).toBe( "## Coordination Rules");
    });

    it("should generate minimal coordination", () => {
      const content = createMinimalCoordinationMd();
      
      expect(content).toBe( "# Multi-Agent Coordination");
      expect(content).toBe( "Simple coordination tracking");
      
      // Should be shorter
      const fullContent = createFullCoordinationMd();
      expect(content.length < fullContent.length).toBe( true);
    });
  });

  describe("README templates", () => {
    it("should generate agents README with proper format", () => {
      const content = createAgentsReadme();
      
      expect(content).toBe( "# Agent Memory Storage");
      expect(content).toBe( "## Directory Structure");
      expect(content).toBe( "## File Format");
      expect(content).toBe( ".json");
    });

    it("should generate sessions README with proper format", () => {
      const content = createSessionsReadme();
      
      expect(content).toBe( "# Session Memory Storage");
      expect(content).toBe( "## Directory Structure");
      expect(content).toBe( "## File Format");
      expect(content).toBe( "session_");
    });
  });

  describe("Template consistency", () => {
    it("should have consistent markdown formatting", () => {
      const templates = [
        createFullClaudeMd(),
        createMinimalClaudeMd(),
        createSparcClaudeMd(),
        createFullMemoryBankMd(),
        createMinimalMemoryBankMd(),
        createFullCoordinationMd(),
        createMinimalCoordinationMd(),
        createAgentsReadme(),
        createSessionsReadme()
      ];

      for (const template of templates) {
        // All should start with a header
        expect(template.startsWith("#")).toBe( true);
        // All should have proper line endings
        expect(template.includes("\r")).toBe( false);
      }
    });

    it("should include proper file extensions in examples", () => {
      const sparcTemplate = createSparcClaudeMd();
      
      // Check for file extensions in examples
      expect(sparcTemplate).toBe( ".json");
      expect(sparcTemplate).toBe( ".md");
      expect(sparcTemplate).toBe( ".ts");
    });
  });

  describe("SPARC-specific content", () => {
    it("should include all SPARC modes in template", () => {
      const content = createSparcClaudeMd();
      
      // Development modes
      expect(content).toBe( "architect");
      expect(content).toBe( "code");
      expect(content).toBe( "tdd");
      expect(content).toBe( "spec-pseudocode");
      expect(content).toBe( "integration");
      
      // Quality modes
      expect(content).toBe( "debug");
      expect(content).toBe( "security-review");
      expect(content).toBe( "refinement-optimization-mode");
      
      // Support modes
      expect(content).toBe( "docs-writer");
      expect(content).toBe( "devops");
      expect(content).toBe( "mcp");
      expect(content).toBe( "swarm");
    });

    it("should include workflow examples", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toBe( "### Feature Development Workflow");
      expect(content).toBe( "### Bug Fix Workflow");
      expect(content).toBe( "# 1. Start with specification");
      expect(content).toBe( "# 2. Design architecture");
      expect(content).toBe( "# 3. Implement with TDD");
    });

    it("should include memory integration examples", () => {
      const content = createSparcClaudeMd();
      
      expect(content).toBe( "## SPARC Memory Integration");
      expect(content).toBe( "memory store spec_auth");
      expect(content).toBe( "memory store arch_decisions");
      expect(content).toBe( "memory store test_coverage");
      expect(content).toBe( "memory query");
      expect(content).toBe( "memory export");
    });
  });
});
