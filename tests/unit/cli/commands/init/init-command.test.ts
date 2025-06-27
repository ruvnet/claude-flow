/// <reference types="jest" />

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert/mod.ts";
import { ensureDir, exists } from "@std/fs/mod.ts";
import { join } from "@std/path/mod.ts";
import { beforeEach, afterEach, describe, it } from "@std/testing/bdd.ts";
import { initCommand } from "../../../../../src/cli/simple-commands/init/index.js";

describe("Init Command Unit Tests", () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary test directory
    testDir =  fs.mkdtempSync(path.join(os.tmpdir(), "claude-flow-test-"));
    // Store original working directory
    process.env["ORIGINAL_CWD"] =  process.cwd();
    // Set PWD for init command
    process.env["PWD"] =  testDir;
    // Change to test directory
      // TODO: Replace with mock -     Deno.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original working directory
    const originalCwd = process.env["ORIGINAL_CWD"];
    if (originalCwd) {
      // TODO: Replace with mock -       Deno.chdir(originalCwd);
    }
    // Clean up test directory
    try {
      // TODO: Replace with mock - // TODO: Replace with mock -       await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Basic initialization", () => {
    it("should create basic structure with no flags", async () => {
      await initCommand([], {});

      // Check basic files
      expect(await exists(join(testDir).toBe( "CLAUDE.md")));
      expect(await exists(join(testDir).toBe( "memory-bank.md")));
      expect(await exists(join(testDir).toBe( "coordination.md")));

      // Check directories
      expect(await exists(join(testDir).toBe( "memory")));
      expect(await exists(join(testDir).toBe( "memory/agents")));
      expect(await exists(join(testDir).toBe( "memory/sessions")));
      expect(await exists(join(testDir).toBe( "coordination")));
      expect(await exists(join(testDir).toBe( ".claude")));
      expect(await exists(join(testDir).toBe( ".claude/commands")));
    });

    it("should create minimal structure with --minimal flag", async () => {
      await initCommand(["--minimal"], {});

      // Check files exist
      expect(await exists(join(testDir).toBe( "CLAUDE.md")));
      expect(await exists(join(testDir).toBe( "memory-bank.md")));
      expect(await exists(join(testDir).toBe( "coordination.md")));

      // Check content is minimal (smaller size)
      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      const memoryBankMd = fs.readFileSync(join(testDir, "memory-bank.md", "utf8"));
      
      // Minimal versions should be shorter
      expect(claudeMd.includes("Minimal project configuration")).toBe( true);
      expect(memoryBankMd.includes("Simple memory tracking")).toBe( true);
    });

    it("should handle help flag correctly", async () => {
      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => logs.push(args.join(" "));

      await initCommand(["--help"], {});

      console.log = originalLog;

      // Check that help was displayed
      const helpOutput = logs.join("\n");
      expect(helpOutput).toBe( "Initialize Claude Code integration");
      expect(helpOutput).toBe( "--force");
      expect(helpOutput).toBe( "--minimal");
      expect(helpOutput).toBe( "--sparc");
    });
  });

  describe("Force flag behavior", () => {
    it("should fail when files exist without --force", async () => {
      // Create existing file
      fs.writeFileSync(join(testDir,  "CLAUDE.md", "utf8"), "existing content");

      const originalLog = console.log;
      const logs: string[] = [];
      console.log = (...args: any[]) => logs.push(args.join(" "));

      await initCommand([], {});

      console.log = originalLog;

      // Check warning was displayed
      const output = logs.join("\n");
      expect(output).toBe( "already exist");
      expect(output).toBe( "Use --force to overwrite");
    });

    it("should overwrite files with --force flag", async () => {
      // Create existing files
      fs.writeFileSync(join(testDir,  "CLAUDE.md", "utf8"), "old content");
      fs.writeFileSync(join(testDir,  "memory-bank.md", "utf8"), "old memory");

      await initCommand(["--force"], {});

      // Check files were overwritten
      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      const memoryBankMd = fs.readFileSync(join(testDir, "memory-bank.md", "utf8"));

      // Should not contain old content
      expect(claudeMd.includes("old content")).toBe( false);
      expect(memoryBankMd.includes("old memory")).toBe( false);

      // Should contain new content
      expect(claudeMd).toBe( "Claude Code Configuration");
      expect(memoryBankMd).toBe( "Memory Bank");
    });
  });

  describe("SPARC flag behavior", () => {
    it("should create SPARC-enhanced structure with --sparc flag", async () => {
      await initCommand(["--sparc"], {});

      // Check SPARC-specific files
      expect(await exists(join(testDir).toBe( "CLAUDE.md")));
      expect(await exists(join(testDir).toBe( ".claude/commands/sparc")));

      // Check CLAUDE.md contains SPARC content
      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      expect(claudeMd).toBe( "SPARC");
      expect(claudeMd).toBe( "Test-Driven Development");
    });

    it("should create SPARC structure manually when create-sparc fails", async () => {
      // This will trigger manual creation since create-sparc won't exist
      await initCommand(["--sparc", "--force"], {});

      // Check manual SPARC structure
      expect(await exists(join(testDir).toBe( ".roo")));
      expect(await exists(join(testDir).toBe( ".roo/templates")));
      expect(await exists(join(testDir).toBe( ".roo/workflows")));
      expect(await exists(join(testDir).toBe( ".roomodes")));
    });
  });

  describe("File content validation", () => {
    it("should create valid JSON files", async () => {
      await initCommand([], {});

      // Check claude-flow-data.json is valid JSON
      const dataPath = join(testDir, "memory/claude-flow-data.json");
      expect(await exists(dataPath));

      const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      expect(Array.isArray(data.agents)).toBe( true);
      expect(Array.isArray(data.tasks)).toBe( true);
      expect(typeof data.lastUpdated).toBe( "number");
    });

    it("should create proper README files", async () => {
      await initCommand([], {});

      // Check README files
      const agentsReadme = fs.readFileSync(join(testDir, "memory/agents/README.md", "utf8"));
      const sessionsReadme = fs.readFileSync(join(testDir, "memory/sessions/README.md", "utf8"));

      expect(agentsReadme).toBe( "# Agent Memory Storage");
      expect(sessionsReadme).toBe( "# Session Memory Storage");
    });
  });

  describe("Error handling", () => {
    it("should handle directory creation errors gracefully", async () => {
      // Create a file where a directory should be
      fs.writeFileSync(join(testDir,  "memory", "utf8"), "not a directory");

      const originalError = console.error;
      const errors: string[] = [];
      console.error = (...args: any[]) => errors.push(args.join(" "));

      try {
        await initCommand([], {});
      } catch {
        // Expected to fail
      }

      console.error = originalError;

      // Should have attempted to create directory
      expect(errors.length > 0).toBe( true);
    });

    it("should continue when some operations fail", async () => {
      // Make directory read-only (will fail on some operations)
      await Deno.chmod(testDir, 0o555);

      try {
        await initCommand(["--force"], {});
      } catch {
        // Expected some operations to fail
      }

      // Restore permissions
      await Deno.chmod(testDir, 0o755);

      // Should have created at least some files before failing
      // (This test may vary based on OS permissions)
    });
  });

  describe("Flag combinations", () => {
    it("should handle --sparc --minimal combination", async () => {
      await initCommand(["--sparc", "--minimal"], {});

      // Should create SPARC structure
      expect(await exists(join(testDir).toBe( ".claude/commands/sparc")));

      // But with minimal content
      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      expect(claudeMd).toBe( "SPARC");
      
      // Memory bank should be minimal
      const memoryBankMd = fs.readFileSync(join(testDir, "memory-bank.md", "utf8"));
      expect(memoryBankMd).toBe( "Simple memory tracking");
    });

    it("should handle --sparc --force combination", async () => {
      // Create existing files
      fs.writeFileSync(join(testDir,  "CLAUDE.md", "utf8"), "old content");
      fs.writeFileSync(join(testDir,  ".roomodes", "utf8"), "old roomodes");

      await initCommand(["--sparc", "--force"], {});

      // Should overwrite and create SPARC structure
      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      expect(claudeMd).toBe( "SPARC");
      expect(claudeMd.includes("old content")).toBe( false);

      // Should preserve or recreate .roomodes
      expect(await exists(join(testDir).toBe( ".roomodes")));
    });

    it("should handle all flags together", async () => {
      await initCommand(["--sparc", "--minimal", "--force"], {});

      // Should create minimal SPARC structure
      expect(await exists(join(testDir).toBe( "CLAUDE.md")));
      expect(await exists(join(testDir).toBe( ".claude/commands/sparc")));

      const claudeMd = fs.readFileSync(join(testDir, "CLAUDE.md", "utf8"));
      expect(claudeMd).toBe( "SPARC");
    });
  });
});
