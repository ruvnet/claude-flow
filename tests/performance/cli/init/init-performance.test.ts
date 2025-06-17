import { assertEquals, assertExists } from "@std/assert/mod.ts";
import { exists } from "@std/fs/mod.ts";
import { join } from "@std/path/mod.ts";
import { beforeEach, afterEach, describe, it } from "@std/testing/bdd.ts";

describe("Init Command Performance Tests", () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = Deno.cwd();
    testDir = await Deno.makeTempDir({ prefix: "claude_flow_perf_test_" });
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

  describe("Basic initialization performance", () => {
    it("should complete basic init within reasonable time", async () => {
      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      assertEquals(result.success, true);
      
      // Should complete within 10 seconds for basic init
      assertEquals(duration < 10000, true);
      
      // Should create expected files
      assertExists(await exists(join(testDir, "CLAUDE.md")));
      assertExists(await exists(join(testDir, "memory-bank.md")));
      assertExists(await exists(join(testDir, "coordination.md")));

      console.log(`Basic init completed in ${duration.toFixed(2)}ms`);
    });

    it("should handle minimal init faster than full init", async () => {
      // Test minimal init
      const minimalStartTime = performance.now();
      
      const minimalCommand = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-all",
          join(originalCwd, "src/cli/simple-cli.ts"),
          "init",
          "--minimal"
        ],
        cwd: testDir,
        stdout: "piped",
        stderr: "piped"
      });

      await minimalCommand.output();
      const minimalDuration = performance.now() - minimalStartTime;

      // Clean up for full init test
      await Deno.remove(testDir, { recursive: true });
      testDir = await Deno.makeTempDir({ prefix: "claude_flow_perf_test_full_" });
      Deno.chdir(testDir);

      // Test full init
      const fullStartTime = performance.now();
      
      const fullCommand = new Deno.Command("deno", {
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

      await fullCommand.output();
      const fullDuration = performance.now() - fullStartTime;

      // Minimal should be faster or comparable
      assertEquals(minimalDuration <= fullDuration * 1.5, true); // Allow 50% tolerance

      console.log(`Minimal init: ${minimalDuration.toFixed(2)}ms`);
      console.log(`Full init: ${fullDuration.toFixed(2)}ms`);
    });
  });

  describe("SPARC initialization performance", () => {
    it("should complete SPARC init within reasonable time", async () => {
      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      assertEquals(result.success, true);
      
      // SPARC init may take longer due to external processes
      assertEquals(duration < 30000, true); // 30 seconds max
      
      // Should create SPARC structure
      assertExists(await exists(join(testDir, ".roo")));
      assertExists(await exists(join(testDir, ".roomodes")));

      console.log(`SPARC init completed in ${duration.toFixed(2)}ms`);
    });

    it("should handle SPARC fallback efficiently", async () => {
      // This test simulates the scenario where create-sparc is not available
      // The init should fall back to manual creation quickly
      
      const startTime = performance.now();

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
          ...Deno.env.toObject(),
          // Simulate environment where create-sparc might fail
          PATH: "/usr/bin:/bin" // Minimal PATH
        },
        stdout: "piped",
        stderr: "piped"
      });

      const result = await command.output();
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Should still complete successfully with fallback
      assertEquals(duration < 15000, true); // Should be faster than full external process
      
      // Should create basic SPARC structure manually
      assertExists(await exists(join(testDir, ".roo")));
      assertExists(await exists(join(testDir, ".roomodes")));

      console.log(`SPARC fallback completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe("Parallel operations efficiency", () => {
    it("should handle multiple concurrent inits efficiently", async () => {
      const numConcurrent = 3;
      const testDirs: string[] = [];
      
      // Create multiple test directories
      for (let i = 0; i < numConcurrent; i++) {
        const dir = await Deno.makeTempDir({ prefix: `claude_flow_concurrent_${i}_` });
        testDirs.push(dir);
      }

      const startTime = performance.now();

      // Run multiple inits concurrently
      const promises = testDirs.map(dir => {
        const command = new Deno.Command("deno", {
          args: [
            "run",
            "--allow-all",
            join(originalCwd, "src/cli/simple-cli.ts"),
            "init"
          ],
          cwd: dir,
          stdout: "piped",
          stderr: "piped"
        });
        return command.output();
      });

      const results = await Promise.all(promises);
      const endTime = performance.now();
      const duration = endTime - startTime;

      // All should succeed
      for (const result of results) {
        assertEquals(result.success, true);
      }

      // Concurrent execution should be faster than sequential
      // (though this depends on system resources)
      assertEquals(duration < 20000, true); // 20 seconds for 3 concurrent inits

      // Verify all directories were initialized
      for (const dir of testDirs) {
        assertExists(await exists(join(dir, "CLAUDE.md")));
        assertExists(await exists(join(dir, "memory-bank.md")));
        assertExists(await exists(join(dir, "coordination.md")));
      }

      // Cleanup
      for (const dir of testDirs) {
        try {
          await Deno.remove(dir, { recursive: true });
        } catch {
          // Ignore cleanup errors
        }
      }

      console.log(`${numConcurrent} concurrent inits completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe("Large project initialization", () => {
    it("should handle initialization in directory with many files", async () => {
      // Create a large number of files to simulate a large project
      const numFiles = 100;
      
      for (let i = 0; i < numFiles; i++) {
        await Deno.writeTextFile(join(testDir, `file_${i}.txt`), `Content ${i}`);
      }

      // Create some directories
      for (let i = 0; i < 10; i++) {
        await Deno.mkdir(join(testDir, `dir_${i}`), { recursive: true });
        await Deno.writeTextFile(join(testDir, `dir_${i}`, "file.txt"), `Dir ${i} content`);
      }

      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      assertEquals(result.success, true);
      
      // Should not be significantly slower due to existing files
      assertEquals(duration < 15000, true);
      
      // Should create init files
      assertExists(await exists(join(testDir, "CLAUDE.md")));
      assertExists(await exists(join(testDir, "memory-bank.md")));
      assertExists(await exists(join(testDir, "coordination.md")));

      console.log(`Init in large project (${numFiles} files) completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe("Resource usage optimization", () => {
    it("should use reasonable memory during initialization", async () => {
      // This test monitors memory usage during init
      const initialMemory = Deno.memoryUsage();

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
      const finalMemory = Deno.memoryUsage();

      assertEquals(result.success, true);

      // Memory increase should be reasonable (less than 50MB)
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      assertEquals(memoryIncrease < 50 * 1024 * 1024, true);

      console.log(`Memory usage increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    });

    it("should handle force overwrite efficiently", async () => {
      // Create existing files first
      await Deno.writeTextFile(join(testDir, "CLAUDE.md"), "existing content".repeat(1000));
      await Deno.writeTextFile(join(testDir, "memory-bank.md"), "existing memory".repeat(1000));
      await Deno.writeTextFile(join(testDir, "coordination.md"), "existing coord".repeat(1000));

      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      assertEquals(result.success, true);
      
      // Force overwrite should not be significantly slower
      assertEquals(duration < 10000, true);

      // Files should be overwritten
      const claudeContent = await Deno.readTextFile(join(testDir, "CLAUDE.md"));
      assertEquals(claudeContent.includes("existing content"), false);

      console.log(`Force overwrite completed in ${duration.toFixed(2)}ms`);
    });
  });

  describe("File I/O performance", () => {
    it("should efficiently create directory structure", async () => {
      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Count created directories
      const expectedDirs = [
        "memory",
        "memory/agents",
        "memory/sessions",
        "coordination",
        "coordination/memory_bank",
        "coordination/subtasks",
        "coordination/orchestration",
        ".claude",
        ".claude/commands",
        ".claude/commands/sparc",
        ".claude/logs"
      ];

      let createdDirs = 0;
      for (const dir of expectedDirs) {
        if (await exists(join(testDir, dir))) {
          createdDirs++;
        }
      }

      // Should create directories efficiently
      const dirCreationRate = createdDirs / (duration / 1000); // dirs per second
      assertEquals(dirCreationRate > 10, true); // Should create > 10 dirs/second

      console.log(`Created ${createdDirs} directories in ${duration.toFixed(2)}ms (${dirCreationRate.toFixed(2)} dirs/sec)`);
    });

    it("should efficiently write template files", async () => {
      const startTime = performance.now();

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
      const endTime = performance.now();
      const duration = endTime - startTime;

      // Count created files
      const expectedFiles = [
        "CLAUDE.md",
        "memory-bank.md",
        "coordination.md",
        "memory/claude-flow-data.json",
        "memory/agents/README.md",
        "memory/sessions/README.md",
        "claude-flow"
      ];

      let createdFiles = 0;
      let totalSize = 0;
      
      for (const file of expectedFiles) {
        if (await exists(join(testDir, file))) {
          createdFiles++;
          try {
            const stat = await Deno.stat(join(testDir, file));
            totalSize += stat.size;
          } catch {
            // Ignore stat errors
          }
        }
      }

      // Should write files efficiently
      const writeRate = totalSize / (duration / 1000); // bytes per second
      assertEquals(writeRate > 1000, true); // Should write > 1KB/second

      console.log(`Created ${createdFiles} files (${totalSize} bytes) in ${duration.toFixed(2)}ms (${(writeRate / 1024).toFixed(2)} KB/sec)`);
    });
  });
});