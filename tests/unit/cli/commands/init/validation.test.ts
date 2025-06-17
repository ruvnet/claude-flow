import { assertEquals, assertExists, assertStringIncludes, assertMatch } from "@std/assert/mod.ts";
import { exists } from "@std/fs/mod.ts";
import { join } from "@std/path/mod.ts";
import { beforeEach, afterEach, describe, it } from "@std/testing/bdd.ts";

describe("Init Command Validation Tests", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = Deno.cwd();
    testDir = await Deno.makeTempDir({ prefix: "claude_flow_validation_test_" });
    Deno.env.set("PWD", testDir);
    Deno.chdir(testDir);
  });

  afterEach(async () => {
    Deno.chdir(originalCwd);
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("File integrity validation", () => {
    it("should create valid JSON files", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      // Validate claude-flow-data.json
      const dataPath = join(testDir, "memory/claude-flow-data.json");
      assertExists(await exists(dataPath));

      const dataContent = await Deno.readTextFile(dataPath);
      const data = JSON.parse(dataContent);

      // Validate structure
      assertEquals(Array.isArray(data.agents), true);
      assertEquals(Array.isArray(data.tasks), true);
      assertEquals(typeof data.lastUpdated, "number");
      assertEquals(data.lastUpdated > 0, true);

      // Validate arrays are initially empty
      assertEquals(data.agents.length, 0);
      assertEquals(data.tasks.length, 0);

      // Validate timestamp is recent (within last minute)
      const now = Date.now();
      assertEquals(Math.abs(now - data.lastUpdated) < 60000, true);
    });

    it("should create valid SPARC JSON files", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      // Validate .roomodes file
      if (await exists(join(testDir, ".roomodes"))) {
        const roomodesContent = await Deno.readTextFile(join(testDir, ".roomodes"));
        const roomodesData = JSON.parse(roomodesContent);

        // Should have modes object
        assertEquals(typeof roomodesData.modes, "object");
        assertEquals(roomodesData.modes !== null, true);

        // Should have essential SPARC modes
        const requiredModes = ["architect", "code", "tdd", "spec-pseudocode", "integration"];
        for (const mode of requiredModes) {
          assertExists(roomodesData.modes[mode]);
          assertEquals(typeof roomodesData.modes[mode], "object");
        }
      }

      // Validate workflow JSON files
      const workflowPath = join(testDir, ".roo/workflows/basic-tdd.json");
      if (await exists(workflowPath)) {
        const workflowContent = await Deno.readTextFile(workflowPath);
        const workflowData = JSON.parse(workflowContent);

        // Should have workflow structure
        assertEquals(typeof workflowData.name, "string");
        assertEquals(Array.isArray(workflowData.steps), true);
        assertEquals(workflowData.steps.length > 0, true);

        // Validate step structure
        for (const step of workflowData.steps) {
          assertEquals(typeof step.name, "string");
          assertEquals(typeof step.description, "string");
        }
      }
    });

    it("should create properly formatted markdown files", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const markdownFiles = [
        "CLAUDE.md",
        "memory-bank.md",
        "coordination.md",
        "memory/agents/README.md",
        "memory/sessions/README.md"
      ];

      for (const file of markdownFiles) {
        const filePath = join(testDir, file);
        assertExists(await exists(filePath));

        const content = await Deno.readTextFile(filePath);

        // Should start with header
        assertEquals(content.startsWith("#"), true);

        // Should not have Windows line endings
        assertEquals(content.includes("\r"), false);

        // Should not have trailing spaces
        const lines = content.split("\n");
        for (const line of lines) {
          assertEquals(line.endsWith(" "), false);
        }

        // Should have consistent header levels (no skipping)
        const headerLevels = lines
          .filter(line => line.startsWith("#"))
          .map(line => line.match(/^#+/)?.[0].length || 0);

        // First header should be level 1
        assertEquals(headerLevels[0], 1);

        // No skipping levels (can't go from # to ###)
        for (let i = 1; i < headerLevels.length; i++) {
          const diff = headerLevels[i] - headerLevels[i - 1];
          assertEquals(diff <= 1, true); // Can only increase by 1 level at a time
        }
      }
    });

    it("should create executable files with correct permissions", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const executablePath = join(testDir, "claude-flow");
      assertExists(await exists(executablePath));

      // Check file stats
      const stat = await Deno.stat(executablePath);
      assertEquals(stat.isFile, true);

      // On Unix-like systems, check if it's executable
      if (Deno.build.os !== "windows") {
        assertEquals(stat.mode !== null, true);
        // Check if user execute bit is set (at least 0o100)
        assertEquals((stat.mode! & 0o100) !== 0, true);
      }
    });
  });

  describe("Configuration correctness validation", () => {
    it("should create consistent directory structure", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      // Validate required directories exist
      const requiredDirs = [
        "memory",
        "memory/agents",
        "memory/sessions",
        "coordination",
        "coordination/memory_bank",
        "coordination/subtasks",
        "coordination/orchestration",
        ".claude",
        ".claude/commands",
        ".claude/logs"
      ];

      for (const dir of requiredDirs) {
        const dirPath = join(testDir, dir);
        assertExists(await exists(dirPath));

        const stat = await Deno.stat(dirPath);
        assertEquals(stat.isDirectory, true);
      }

      // Validate directory hierarchy
      assertExists(await exists(join(testDir, "memory")));
      assertExists(await exists(join(testDir, "memory/agents")));
      assertExists(await exists(join(testDir, "memory/sessions")));
      
      assertExists(await exists(join(testDir, "coordination")));
      assertExists(await exists(join(testDir, "coordination/memory_bank")));
      assertExists(await exists(join(testDir, "coordination/subtasks")));
      assertExists(await exists(join(testDir, "coordination/orchestration")));
    });

    it("should create SPARC configuration correctly", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      // Validate SPARC directory structure
      const sparcDirs = [
        ".roo",
        ".roo/templates",
        ".roo/workflows",
        ".roo/modes",
        ".roo/configs"
      ];

      for (const dir of sparcDirs) {
        assertExists(await exists(join(testDir, dir)));
      }

      // Validate SPARC configuration files
      assertExists(await exists(join(testDir, ".roomodes")));
      assertExists(await exists(join(testDir, ".roo/README.md")));
      assertExists(await exists(join(testDir, ".roo/workflows/basic-tdd.json")));

      // Validate Claude commands for SPARC
      assertExists(await exists(join(testDir, ".claude/commands/sparc")));
    });

    it("should validate CLAUDE.md content structure", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));

      // Should have essential sections
      const requiredSections = [
        "# Claude Code Configuration",
        "## Project Overview",
        "## Key Commands",
        "## Code Style"
      ];

      for (const section of requiredSections) {
        assertStringIncludes(claudeContent, section);
      }

      // Should include command examples
      assertStringIncludes(claudeContent, "claude-flow");
      assertStringIncludes(claudeContent, "./claude-flow");
    });

    it("should validate SPARC CLAUDE.md content", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));

      // Should have SPARC-specific sections
      const sparcSections = [
        "SPARC Development Environment",
        "## SPARC Development Commands",
        "## SPARC Methodology Workflow",
        "### 1. Specification Phase",
        "### 2. Pseudocode Phase", 
        "### 3. Architecture Phase",
        "### 4. Refinement Phase",
        "### 5. Completion Phase"
      ];

      for (const section of sparcSections) {
        assertStringIncludes(claudeContent, section);
      }

      // Should include SPARC command examples
      assertStringIncludes(claudeContent, "npx claude-flow sparc modes");
      assertStringIncludes(claudeContent, "npx claude-flow sparc run");
      assertStringIncludes(claudeContent, "npx claude-flow sparc tdd");

      // Should include all SPARC modes
      const sparcModes = [
        "architect", "code", "tdd", "spec-pseudocode", "integration",
        "debug", "security-review", "refinement-optimization-mode",
        "docs-writer", "devops", "mcp", "swarm"
      ];

      for (const mode of sparcModes) {
        assertStringIncludes(claudeContent, mode);
      }
    });
  });

  describe("Content validation", () => {
    it("should validate memory-bank.md structure", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const memoryContent = await Deno.readTextFile(join(testDir, "memory-bank.md"));

      // Should have proper structure
      assertStringIncludes(memoryContent, "# Memory Bank");
      assertStringIncludes(memoryContent, "## Active Tasks");
      assertStringIncludes(memoryContent, "## Key Decisions");
      assertStringIncludes(memoryContent, "## Project Context");

      // Should include usage instructions
      assertStringIncludes(memoryContent, "memory store");
      assertStringIncludes(memoryContent, "memory query");
    });

    it("should validate coordination.md structure", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const coordContent = await Deno.readTextFile(join(testDir, "coordination.md"));

      // Should have proper structure
      assertStringIncludes(coordContent, "# Multi-Agent Coordination");
      assertStringIncludes(coordContent, "## Coordination Structure");
      assertStringIncludes(coordContent, "## Agent Roles");
      assertStringIncludes(coordContent, "## Current Coordination State");
    });

    it("should validate README files content", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      // Validate agents README
      const agentsReadme = await Deno.readTextFile(join(testDir, "memory/agents/README.md"));
      assertStringIncludes(agentsReadme, "# Agent Memory Storage");
      assertStringIncludes(agentsReadme, "## Directory Structure");
      assertStringIncludes(agentsReadme, ".json");

      // Validate sessions README
      const sessionsReadme = await Deno.readTextFile(join(testDir, "memory/sessions/README.md"));
      assertStringIncludes(sessionsReadme, "# Session Memory Storage");
      assertStringIncludes(sessionsReadme, "## Directory Structure");
      assertStringIncludes(sessionsReadme, "session_");
    });
  });

  describe("Cross-file consistency validation", () => {
    it("should have consistent command references across files", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));
      const memoryContent = await Deno.readTextFile(join(testDir, "memory-bank.md"));
      const coordContent = await Deno.readTextFile(join(testDir, "coordination.md"));

      // All should reference the local executable
      assertStringIncludes(claudeContent, "./claude-flow");
      assertStringIncludes(memoryContent, "claude-flow");
      assertStringIncludes(coordContent, "claude-flow");

      // All should reference the memory system consistently
      assertStringIncludes(claudeContent, "memory");
      assertStringIncludes(memoryContent, "memory");
    });

    it("should have consistent SPARC references", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));

      if (await exists(join(testDir, ".roomodes"))) {
        const roomodesContent = await Deno.readTextFile(join(testDir, ".roomodes"));
        const roomodesData = JSON.parse(roomodesContent);

        // CLAUDE.md should reference modes that exist in .roomodes
        for (const mode in roomodesData.modes) {
          assertStringIncludes(claudeContent, mode);
        }
      }

      // Should have consistent slash command references
      assertStringIncludes(claudeContent, "/sparc");
      assertStringIncludes(claudeContent, "/sparc-architect");
      assertStringIncludes(claudeContent, "/sparc-tdd");
    });

    it("should validate file path references", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));

      // Should reference existing directories
      assertStringIncludes(claudeContent, "memory/");
      assertStringIncludes(claudeContent, "coordination/");
      assertStringIncludes(claudeContent, ".claude/");

      // SPARC references should point to existing paths
      if (claudeContent.includes(".roo/")) {
        assertExists(await exists(join(testDir, ".roo")));
      }
      if (claudeContent.includes(".roomodes")) {
        assertExists(await exists(join(testDir, ".roomodes")));
      }
    });
  });

  describe("Data format validation", () => {
    it("should create valid timestamp formats", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const dataContent = await Deno.readTextFile(join(testDir, "memory/claude-flow-data.json"));
      const data = JSON.parse(dataContent);

      // Validate timestamp format
      assertEquals(typeof data.lastUpdated, "number");
      assertEquals(data.lastUpdated > 1000000000000, true); // After year 2001
      assertEquals(data.lastUpdated < 10000000000000, true); // Before year 2286

      // Should be a valid Date
      const date = new Date(data.lastUpdated);
      assertEquals(isNaN(date.getTime()), false);
    });

    it("should validate workflow step format", async () => {
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await command.output();

      const workflowPath = join(testDir, ".roo/workflows/basic-tdd.json");
      if (await exists(workflowPath)) {
        const workflowContent = await Deno.readTextFile(workflowPath);
        const workflow = JSON.parse(workflowContent);

        // Validate workflow structure
        assertEquals(typeof workflow.name, "string");
        assertEquals(workflow.name.length > 0, true);
        assertEquals(Array.isArray(workflow.steps), true);

        // Validate each step
        for (const step of workflow.steps) {
          assertEquals(typeof step.name, "string");
          assertEquals(step.name.length > 0, true);
          assertEquals(typeof step.description, "string");
          assertEquals(step.description.length > 0, true);
        }
      }
    });
  });
});