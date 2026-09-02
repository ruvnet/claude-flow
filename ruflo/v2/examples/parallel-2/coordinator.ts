import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

interface AgentTask {
  name: string;
  mode: string;
  task: string;
  priority: number;
}

interface TaskResult {
  agent: string;
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

class ParallelCoordinator {
  private results: TaskResult[] = [];
  private startTime: number = 0;

  async runParallelAgents(tasks: AgentTask[]): Promise<void> {
    console.log("🚀 Starting parallel agent execution...\n");
    this.startTime = Date.now();

    const promises = tasks.map(task => this.executeAgent(task));
    
    try {
      await Promise.all(promises);
    } catch (error) {
      console.error("Error during parallel execution:", error);
    }

    await this.generateReport();
  }

  private async executeAgent(task: AgentTask): Promise<void> {
    const startTime = Date.now();
    console.log(`📋 Starting ${task.name} agent (mode: ${task.mode})...`);

    try {
      const command = `npx claude-flow sparc run ${task.mode} "${task.task}"`;
      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
        timeout: 300000 // 5 minute timeout
      });

      const duration = Date.now() - startTime;
      
      this.results.push({
        agent: task.name,
        success: true,
        output: stdout,
        duration
      });

      console.log(`✅ ${task.name} completed in ${duration}ms`);
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      this.results.push({
        agent: task.name,
        success: false,
        error: error.message || String(error),
        duration
      });

      console.error(`❌ ${task.name} failed after ${duration}ms:`, error.message);
    }
  }

  private async generateReport(): Promise<void> {
    const totalDuration = Date.now() - this.startTime;
    const successCount = this.results.filter(r => r.success).length;
    
    const report = {
      summary: {
        totalAgents: this.results.length,
        successfulAgents: successCount,
        failedAgents: this.results.length - successCount,
        totalDuration: totalDuration,
        averageDuration: totalDuration / this.results.length
      },
      results: this.results,
      timestamp: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(__dirname, "results.json"),
      JSON.stringify(report, null, 2)
    );

    console.log("\n📊 Execution Summary:");
    console.log(`Total agents: ${report.summary.totalAgents}`);
    console.log(`Successful: ${report.summary.successfulAgents}`);
    console.log(`Failed: ${report.summary.failedAgents}`);
    console.log(`Total duration: ${report.summary.totalDuration}ms`);
    console.log(`Average duration: ${Math.round(report.summary.averageDuration)}ms`);
    console.log("\nDetailed results saved to results.json");
  }
}

export { ParallelCoordinator, AgentTask, TaskResult };