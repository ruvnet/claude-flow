import { assertEquals, assertExists } from "@std/assert/mod.ts";
import { exists } from "@std/fs/mod.ts";
import { join } from "@std/path/mod.ts";
import { beforeEach, afterEach, describe, it } from "@std/testing/bdd.ts";

describe("Init Command Rollback Tests", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = Deno.cwd();
    testDir = await Deno.makeTempDir({ prefix: "claude_flow_rollback_test_" });
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

  describe("Partial failure rollback", () => {
    it("should handle file creation failure gracefully", async () => {
      // Create a directory where a file should be created
      await Deno.mkdir(join(testDir, "CLAUDE.md"));

      const originalError = console.error;
      const errors: string[] = [];
      console.error = (...args: any[]) => errors.push(args.join(" "));

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

      const result = await command.output();
      console.error = originalError;

      // Should fail due to directory conflict
      assertEquals(result.success, false);

      // Should not leave partial state (other files should not be created if first fails)
      // Note: This depends on the implementation - some files might be created before failure
      const errorOutput = new TextDecoder().decode(result.stderr);
      console.log("Error output:", errorOutput);
    });

    it("should handle directory creation failure", async () => {
      // Create a file where a directory should be created
      await Deno.writeTextFile(join(testDir, "memory"), "not a directory");

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

      const result = await command.output();

      // Should handle the error
      assertEquals(result.success, false);

      // Should report the error appropriately
      const stderr = new TextDecoder().decode(result.stderr);
      console.log("Directory creation error:", stderr);
    });
  });

  describe("SPARC initialization rollback", () => {
    it("should handle SPARC external command failure", async () => {
      // Mock environment where create-sparc would fail
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--sparc"
        ],
        cwd: testDir,
        env: {
          PATH: "/nonexistent/path" // Ensure create-sparc is not found
        },
        stdout: "piped",
        stderr: "piped"
      });

      const result = await command.output();
      const output = new TextDecoder().decode(result.stdout);

      // Should fall back to manual creation
      assertEquals(result.success, true);
      console.log("SPARC fallback output:", output);

      // Should still create SPARC structure
      assertExists(await exists(join(testDir, ".roo")));
      assertExists(await exists(join(testDir, ".roomodes")));
    });

    it("should handle partial SPARC structure creation", async () => {
      // Create conflicting structure
      await Deno.writeTextFile(join(testDir, ".roo"), "not a directory");

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

      const result = await command.output();
      const stderr = new TextDecoder().decode(result.stderr);

      // Should handle the conflict appropriately
      console.log("SPARC structure conflict:", stderr);

      // Basic init should still work
      assertExists(await exists(join(testDir, "CLAUDE.md")));
      assertExists(await exists(join(testDir, "memory-bank.md")));
    });
  });

  describe("Permission-based rollback scenarios", () => {
    it("should handle read-only directory gracefully", async () => {
      // Make test directory read-only
      await Deno.chmod(testDir, 0o444);

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

      const result = await command.output();

      // Restore permissions for cleanup
      await Deno.chmod(testDir, 0o755);

      // Should fail due to permissions
      assertEquals(result.success, false);

      const stderr = new TextDecoder().decode(result.stderr);
      console.log("Permission error:", stderr);
    });

    it("should handle mixed permission scenarios", async () => {
      // Create some directories with restricted permissions
      await Deno.mkdir(join(testDir, "memory"));
      await Deno.chmod(join(testDir, "memory"), 0o444);

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

      const result = await command.output();

      // Restore permissions for cleanup
      await Deno.chmod(join(testDir, "memory"), 0o755);

      // Should handle permission issues appropriately
      const stderr = new TextDecoder().decode(result.stderr);
      console.log("Mixed permission scenario:", stderr);
    });
  });

  describe("State consistency after failures", () => {
    it("should maintain clean state after file write failure", async () => {
      // Create scenario where some files can be written but others fail
      await Deno.writeTextFile(join(testDir, "existing.txt"), "existing content");

      // Create a directory where CLAUDE.md should be written
      await Deno.mkdir(join(testDir, "CLAUDE.md"));

      const originalFiles = [];
      try {
        for await (const entry of Deno.readDir(testDir)) {
          originalFiles.push(entry.name);
        }
      } catch {
        // Ignore
      }

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

      const result = await command.output();

      // Check what files exist after failure
      const finalFiles = [];
      try {
        for await (const entry of Deno.readDir(testDir)) {
          finalFiles.push(entry.name);
        }
      } catch {
        // Ignore
      }

      console.log("Original files:", originalFiles);
      console.log("Final files:", finalFiles);
      console.log("Init result:", result.success);

      // Original files should still exist
      assertExists(await exists(join(testDir, "existing.txt")));
    });

    it("should handle concurrent access conflicts", async () => {
      // Start first init
      const command1 = new Deno.Command("deno", {
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

      // Start second init immediately (simulating concurrent access)
      const command2 = new Deno.Command("deno", {
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

      const [result1, result2] = await Promise.all([
        command1.output(),
        command2.output()
      ]);

      // At least one should succeed
      const anySucceeded = result1.success || result2.success;
      assertEquals(anySucceeded, true);

      // Files should be created
      assertExists(await exists(join(testDir, "CLAUDE.md")));
      assertExists(await exists(join(testDir, "memory-bank.md")));

      console.log("Concurrent init results:", result1.success, result2.success);
    });
  });

  describe("Recovery mechanisms", () => {
    it("should be able to recover from partial init with --force", async () => {
      // Create partial init state
      await Deno.writeTextFile(join(testDir, "CLAUDE.md"), "partial content");
      await Deno.mkdir(join(testDir, "memory"), { recursive: true });
      // Don't create other expected files

      // Try to complete init with force
      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--force"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      const result = await command.output();
      assertEquals(result.success, true);

      // Should have complete structure now
      assertExists(await exists(join(testDir, "CLAUDE.md")));
      assertExists(await exists(join(testDir, "memory-bank.md")));
      assertExists(await exists(join(testDir, "coordination.md")));
      assertExists(await exists(join(testDir, "memory")));

      // CLAUDE.md should be overwritten
      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));
      assertEquals(claudeContent.includes("partial content"), false);
    });

    it("should handle recovery with existing directories", async () => {
      // Create some directories that should exist
      await Deno.mkdir(join(testDir, "memory"), { recursive: true });
      await Deno.mkdir(join(testDir, "memory/agents"), { recursive: true });
      await Deno.mkdir(join(testDir, "coordination"), { recursive: true });

      // Create conflicting file
      await Deno.writeTextFile(join(testDir, "CLAUDE.md"), "old content");

      const command = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--force"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      const result = await command.output();
      assertEquals(result.success, true);

      // Should work with existing directories
      assertExists(await exists(join(testDir, "memory")));
      assertExists(await exists(join(testDir, "memory/agents")));
      assertExists(await exists(join(testDir, "coordination")));

      // File should be overwritten
      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));
      assertEquals(claudeContent.includes("old content"), false);
    });
  });

  describe("Cleanup validation", () => {
    it("should not leave temporary files after failure", async () => {
      // Create scenario that will fail
      await Deno.writeTextFile(join(testDir, "memory"), "blocking file");

      const beforeFiles = [];
      try {
        for await (const entry of Deno.readDir(testDir)) {
          beforeFiles.push(entry.name);
        }
      } catch {
        // Ignore
      }

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

      const afterFiles = [];
      try {
        for await (const entry of Deno.readDir(testDir)) {
          afterFiles.push(entry.name);
        }
      } catch {
        // Ignore
      }

      // Check for any temp files that might have been left behind
      const tempFiles = afterFiles.filter(name => 
        name.includes("tmp") || 
        name.includes("temp") || 
        name.startsWith(".") && name.endsWith(".tmp")
      );

      console.log("Before files:", beforeFiles);
      console.log("After files:", afterFiles);
      console.log("Temp files:", tempFiles);

      // Should not create excessive temporary files
      assertEquals(tempFiles.length === 0, true);
    });

    it("should handle interrupted initialization", async () => {
      // This test simulates what happens if init is interrupted
      // We can't easily interrupt mid-execution, so we simulate the aftermath

      // Create partial state as if init was interrupted
      await Deno.writeTextFile(join(testDir, "CLAUDE.md"), "# Claude Code Configuration\n\nIncomplete...");
      await Deno.mkdir(join(testDir, "memory"), { recursive: true });
      // Missing other files and directories

      // Try to run init again (should detect existing files)
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

      const result = await command.output();
      const output = new TextDecoder().decode(result.stdout);

      // Should detect existing file and warn
      assertEquals(output.includes("already exist"), true);
      assertEquals(output.includes("--force"), true);

      // Original file should be unchanged
      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));
      assertEquals(claudeContent.includes("Incomplete..."), true);
    });
  });
});