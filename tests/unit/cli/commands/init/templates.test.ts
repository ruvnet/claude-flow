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
      
      assertStringIncludes(content, "# Claude Code Configuration");
      assertStringIncludes(content, "## Project Overview");
      assertStringIncludes(content, "## Key Commands");
      assertStringIncludes(content, "## Code Style");
      assertStringIncludes(content, "## Project Architecture");
    });

    it("should generate minimal CLAUDE.md with basic info", () => {
      const content = createMinimalClaudeMd();
      
      assertStringIncludes(content, "# Claude Code Configuration");
      assertStringIncludes(content, "Minimal project configuration");
      
      // Should be shorter than full version
      const fullContent = createFullClaudeMd();
      assertEquals(content.length < fullContent.length, true);
    });

    it("should generate SPARC-enhanced CLAUDE.md", () => {
      const content = createSparcClaudeMd();
      
      assertStringIncludes(content, "SPARC Development Environment");
      assertStringIncludes(content, "## SPARC Development Commands");
      assertStringIncludes(content, "## SPARC Methodology Workflow");
      assertStringIncludes(content, "### 1. Specification Phase");
      assertStringIncludes(content, "### 2. Pseudocode Phase");
      assertStringIncludes(content, "### 3. Architecture Phase");
      assertStringIncludes(content, "### 4. Refinement Phase");
      assertStringIncludes(content, "### 5. Completion Phase");
      assertStringIncludes(content, "Test-Driven Development");
    });

    it("should include proper SPARC commands in SPARC template", () => {
      const content = createSparcClaudeMd();
      
      // Check for SPARC commands
      assertStringIncludes(content, "npx claude-flow sparc modes");
      assertStringIncludes(content, "npx claude-flow sparc run");
      assertStringIncludes(content, "npx claude-flow sparc tdd");
      assertStringIncludes(content, "npx claude-flow sparc info");
    });
  });

  describe("memory-bank.md templates", () => {
    it("should generate full memory bank with sections", () => {
      const content = createFullMemoryBankMd();
      
      assertStringIncludes(content, "# Memory Bank");
      assertStringIncludes(content, "## Active Tasks");
      assertStringIncludes(content, "## Key Decisions");
      assertStringIncludes(content, "## Project Context");
      assertStringIncludes(content, "## Technical Specifications");
    });

    it("should generate minimal memory bank", () => {
      const content = createMinimalMemoryBankMd();
      
      assertStringIncludes(content, "# Memory Bank");
      assertStringIncludes(content, "Simple memory tracking");
      
      // Should be shorter
      const fullContent = createFullMemoryBankMd();
      assertEquals(content.length < fullContent.length, true);
    });
  });

  describe("coordination.md templates", () => {
    it("should generate full coordination with agent structure", () => {
      const content = createFullCoordinationMd();
      
      assertStringIncludes(content, "# Multi-Agent Coordination System");
      assertStringIncludes(content, "## Coordination Structure");
      assertStringIncludes(content, "## Agent Roles");
      assertStringIncludes(content, "## Current Coordination State");
      assertStringIncludes(content, "## Coordination Rules");
    });

    it("should generate minimal coordination", () => {
      const content = createMinimalCoordinationMd();
      
      assertStringIncludes(content, "# Multi-Agent Coordination");
      assertStringIncludes(content, "Simple coordination tracking");
      
      // Should be shorter
      const fullContent = createFullCoordinationMd();
      assertEquals(content.length < fullContent.length, true);
    });
  });

  describe("README templates", () => {
    it("should generate agents README with proper format", () => {
      const content = createAgentsReadme();
      
      assertStringIncludes(content, "# Agent Memory Storage");
      assertStringIncludes(content, "## Directory Structure");
      assertStringIncludes(content, "## File Format");
      assertStringIncludes(content, ".json");
    });

    it("should generate sessions README with proper format", () => {
      const content = createSessionsReadme();
      
      assertStringIncludes(content, "# Session Memory Storage");
      assertStringIncludes(content, "## Directory Structure");
      assertStringIncludes(content, "## File Format");
      assertStringIncludes(content, "session_");
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
        assertEquals(template.startsWith("#"), true);
        // All should have proper line endings
        assertEquals(template.includes("\r"), false);
      }
    });

    it("should include proper file extensions in examples", () => {
      const sparcTemplate = createSparcClaudeMd();
      
      // Check for file extensions in examples
      assertStringIncludes(sparcTemplate, ".json");
      assertStringIncludes(sparcTemplate, ".md");
      assertStringIncludes(sparcTemplate, ".ts");
    });
  });

  describe("SPARC-specific content", () => {
    it("should include all SPARC modes in template", () => {
      const content = createSparcClaudeMd();
      
      // Development modes
      assertStringIncludes(content, "architect");
      assertStringIncludes(content, "code");
      assertStringIncludes(content, "tdd");
      assertStringIncludes(content, "spec-pseudocode");
      assertStringIncludes(content, "integration");
      
      // Quality modes
      assertStringIncludes(content, "debug");
      assertStringIncludes(content, "security-review");
      assertStringIncludes(content, "refinement-optimization-mode");
      
      // Support modes
      assertStringIncludes(content, "docs-writer");
      assertStringIncludes(content, "devops");
      assertStringIncludes(content, "mcp");
      assertStringIncludes(content, "swarm");
    });

    it("should include workflow examples", () => {
      const content = createSparcClaudeMd();
      
      assertStringIncludes(content, "### Feature Development Workflow");
      assertStringIncludes(content, "### Bug Fix Workflow");
      assertStringIncludes(content, "# 1. Start with specification");
      assertStringIncludes(content, "# 2. Design architecture");
      assertStringIncludes(content, "# 3. Implement with TDD");
    });

    it("should include memory integration examples", () => {
      const content = createSparcClaudeMd();
      
      assertStringIncludes(content, "## SPARC Memory Integration");
      assertStringIncludes(content, "memory store spec_auth");
      assertStringIncludes(content, "memory store arch_decisions");
      assertStringIncludes(content, "memory store test_coverage");
      assertStringIncludes(content, "memory query");
      assertStringIncludes(content, "memory export");
    });
  });
});