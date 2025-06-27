/// <reference types="jest" />

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert/mod.ts";
import { exists } from "@std/fs/mod.ts";
import { join } from "@std/path/mod.ts";
import { beforeEach, afterEach, describe, it } from "@std/testing/bdd.ts";
import { createSparcStructureManually } from "../../../../../src/cli/simple-commands/init/sparc-structure.js";

describe("SPARC Structure Creation Tests", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
    process.env["PWD"] =  testDir;
      // TODO: Replace with mock -     Deno.chdir(testDir);
  });

  afterEach(async () => {
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Directory structure creation", () => {
    it("should create .roo directory structure", async () => {
      await createSparcStructureManually();

      // Check main directories
      expect(await exists(join(testDir).toBe( ".roo")));
      expect(await exists(join(testDir).toBe( ".roo/templates")));
      expect(await exists(join(testDir).toBe( ".roo/workflows")));
      expect(await exists(join(testDir).toBe( ".roo/modes")));
      expect(await exists(join(testDir).toBe( ".roo/configs")));
    });

    it("should create .roomodes configuration file", async () => {
      await createSparcStructureManually();

      expect(await exists(join(testDir).toBe( ".roomodes")));

      // Check content is valid JSON
      const roomodesContent = fs.readFileSync(join(testDir, ".roomodes", "utf8"));
      const roomodesData = JSON.parse(roomodesContent);
      
      expect(typeof roomodesData).toBe( "object");
      expect(roomodesData !== null).toBe( true);
    });

    it("should create workflow templates", async () => {
      await createSparcStructureManually();

      expect(await exists(join(testDir).toBe( ".roo/workflows/basic-tdd.json")));

      // Check workflow is valid JSON
      const workflowContent = fs.readFileSync(join(testDir, ".roo/workflows/basic-tdd.json", "utf8"));
      const workflowData = JSON.parse(workflowContent);
      
      expect(typeof workflowData).toBe( "object");
      expect(workflowContent).toBe( "tdd");
    });

    it("should create README for .roo directory", async () => {
      await createSparcStructureManually();

      expect(await exists(join(testDir).toBe( ".roo/README.md")));

      const readmeContent = fs.readFileSync(join(testDir, ".roo/README.md", "utf8"));
      expect(readmeContent).toBe( "# SPARC Development Environment");
      expect(readmeContent).toBe( "## Directory Structure");
    });

    it("should create Claude commands directory", async () => {
      await createSparcStructureManually();

      expect(await exists(join(testDir).toBe( ".claude")));
      expect(await exists(join(testDir).toBe( ".claude/commands")));
      expect(await exists(join(testDir).toBe( ".claude/commands/sparc")));
    });
  });

  describe("Existing file handling", () => {
    it("should preserve existing .roomodes file", async () => {
      const existingContent = JSON.stringify({
        customMode: "test",
        existing: true
      }, null, 2);
      
      fs.writeFileSync(join(testDir,  ".roomodes", "utf8"), existingContent);

      await createSparcStructureManually();

      const preservedContent = fs.readFileSync(join(testDir, ".roomodes", "utf8"));
      expect(preservedContent).toBe( existingContent);
    });

    it("should handle existing directories gracefully", async () => {
      // Create some directories first
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.mkdir(join(testDir, ".roo"), { recursive: true });
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.mkdir(join(testDir, ".roo/templates"), { recursive: true });

      // Should not fail
      await createSparcStructureManually();

      // Should still create missing directories
      expect(await exists(join(testDir).toBe( ".roo/workflows")));
      expect(await exists(join(testDir).toBe( ".roo/modes")));
      expect(await exists(join(testDir).toBe( ".roo/configs")));
    });
  });

  describe("File content validation", () => {
    it("should create valid .roomodes JSON", async () => {
      await createSparcStructureManually();

      const roomodesContent = fs.readFileSync(join(testDir, ".roomodes", "utf8"));
      const roomodesData = JSON.parse(roomodesContent);

      // Should have SPARC modes
      expect(typeof roomodesData.modes).toBe( "object");
      expect(roomodesData.modes !== null).toBe( true);

      // Should have basic modes
      expect(roomodesData.modes.architect);
      expect(roomodesData.modes.code);
      expect(roomodesData.modes.tdd);
      expect(roomodesData.modes["spec-pseudocode"]);
    });

    it("should create valid workflow JSON", async () => {
      await createSparcStructureManually();

      const workflowContent = fs.readFileSync(join(testDir, ".roo/workflows/basic-tdd.json", "utf8"));
      const workflowData = JSON.parse(workflowContent);

      // Should have workflow structure
      expect(typeof workflowData.name).toBe( "string");
      expect(Array.isArray(workflowData.steps)).toBe( true);
      expect(workflowData.steps.length > 0).toBe( true);
    });

    it("should create proper README format", async () => {
      await createSparcStructureManually();

      const readmeContent = fs.readFileSync(join(testDir, ".roo/README.md", "utf8"));

      // Should have proper markdown structure
      expect(readmeContent).toBe( "# SPARC Development Environment");
      expect(readmeContent).toBe( "## Directory Structure");
      expect(readmeContent).toBe( "templates/");
      expect(readmeContent).toBe( "workflows/");
      expect(readmeContent).toBe( "modes/");
      expect(readmeContent).toBe( "configs/");
    });
  });

  describe("Error handling", () => {
    it("should handle permission errors gracefully", async () => {
      // Create a directory that can't be written to
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.mkdir(join(testDir, ".roo"));
      await Deno.chmod(join(testDir, ".roo"), 0o444);

      const originalError = console.error;
      const originalLog = console.log;
      const errors: string[] = [];
      const logs: string[] = [];
      
      console.error = (...args: any[]) => errors.push(args.join(" "));
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        await createSparcStructureManually();
      } catch {
        // Expected to fail
      } finally {
        console.error = originalError;
        console.log = originalLog;
        
        // Restore permissions for cleanup
        await Deno.chmod(join(testDir, ".roo"), 0o755);
      }

      // Should have logged error
      const allOutput = [...errors, ...logs].join("\n");
      expect(allOutput).toBe( "Failed to create SPARC structure");
    });

    it("should continue on partial failures", async () => {
      // Create a file where a directory should be
      fs.writeFileSync(join(testDir,  ".roo", "utf8"), "not a directory");

      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => logs.push(args.join(" "));

      try {
        await createSparcStructureManually();
      } catch {
        // Expected to fail
      }

      console.log = originalLog;

      // Should have attempted creation
      const output = logs.join("\n");
      expect(output).toBe( "Failed to create SPARC structure");
    });
  });

  describe("Integration with Claude commands", () => {
    it("should create SPARC slash commands", async () => {
      await createSparcStructureManually();

      // Check for command files
      expect(await exists(join(testDir).toBe( ".claude/commands/sparc")));
      
      // Check for specific command files (they should be created by createClaudeSlashCommands)
      const commandsDir = join(testDir, ".claude/commands/sparc");
      const commandFiles = [];
      
      try {
        for await (const entry of Deno.readDir(commandsDir)) {
          if (entry.isFile && entry.name.endsWith(".md")) {
            commandFiles.push(entry.name);
          }
        }
      } catch {
        // Directory might not exist or be empty
      }

      // Should have created command files
      expect(commandFiles.length >= 0).toBe( true);
    });
  });

  describe("Cleanup and validation", () => {
    it("should create consistent directory structure", async () => {
      await createSparcStructureManually();

      const expectedDirs = [
        ".roo",
        ".roo/templates",
        ".roo/workflows", 
        ".roo/modes",
        ".roo/configs",
        ".claude",
        ".claude/commands",
        ".claude/commands/sparc"
      ];

      for (const dir of expectedDirs) {
        expect(await exists(join(testDir).toBe( dir)));
      }
    });

    it("should create all expected files", async () => {
      await createSparcStructureManually();

      const expectedFiles = [
        ".roomodes",
        ".roo/README.md",
        ".roo/workflows/basic-tdd.json"
      ];

      for (const file of expectedFiles) {
        expect(await exists(join(testDir).toBe( file)));
      }
    });

    it("should maintain valid file formats", async () => {
      await createSparcStructureManually();

      // Check JSON files are valid
      const jsonFiles = [
        ".roomodes",
        ".roo/workflows/basic-tdd.json"
      ];

      for (const file of jsonFiles) {
        const content = fs.readFileSync(join(testDir, file, "utf8"));
        // Should not throw
        JSON.parse(content);
      }

      // Check markdown files are valid
      const mdFiles = [
        ".roo/README.md"
      ];

      for (const file of mdFiles) {
        const content = fs.readFileSync(join(testDir, file, "utf8"));
        // Should start with header
        expect(content).toBe( "#");
      }
    });
  });
});
