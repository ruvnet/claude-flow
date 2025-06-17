/**
 * Claude Flow SPARC Executor
 * Executes tasks using the full claude-flow SPARC system in non-interactive mode
 */

import { TaskDefinition, AgentState, TaskResult } from './types.ts';
import { Logger } from '../core/logger.ts';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

export interface LLMAssistantExecutorConfig {
  logger?: Logger;
  openCodexModel: string;
  openCodexBaseUrl: string;
  openCodexApiKey: string;
  openCodexPath: string;
  verbose?: boolean;
  timeoutMinutes?: number;
}

export class LLMAssistantExecutor {
  private logger: Logger;
  private openCodexModel: string;
  private openCodexBaseUrl: string;
  private openCodexApiKey: string;
  private openCodexPath: string;
  private verbose: boolean;
  private timeoutMinutes: number;

  constructor(config: LLMAssistantExecutorConfig) {
    this.logger = config.logger || new Logger(
      { level: 'info', format: 'text', destination: 'console' },
      { component: 'LLMAssistantExecutor' }
    );
    this.openCodexModel = config.openCodexModel;
    this.openCodexBaseUrl = config.openCodexBaseUrl;
    this.openCodexApiKey = config.openCodexApiKey;
    this.openCodexPath = config.openCodexPath;
    this.verbose = config.verbose ?? false;
    this.timeoutMinutes = config.timeoutMinutes ?? 59;
  }

  async executeTask(
    task: TaskDefinition,
    agent: AgentState,
    targetDir?: string
  ): Promise<TaskResult> {
    this.logger.info('Executing task with OpenCodex Assistant', {
      taskId: task.id.id,
      taskName: task.name,
      agentType: agent.type,
      targetDir
    });

    const startTime = Date.now();

    try {
      // Build the command
      const command = this.buildOpenCodexCommand(task, targetDir);

      this.logger.info('Executing OpenCodex command', {
        command: command.join(' ')
      });

      // Execute the command
      const result = await this.executeCommand(command, targetDir);

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      return {
        output: result.output,
        artifacts: result.artifacts || {},
        metadata: {
          executionTime,
          command: command.join(' '),
          exitCode: result.exitCode,
          quality: 0.95, // Placeholder, actual quality assessment would be more complex
          completeness: 0.9 // Placeholder
        },
        error: result.error
      };
    } catch (error) {
      this.logger.error('Failed to execute OpenCodex command', {
        error: error.message,
        taskId: task.id.id
      });

      return {
        output: '',
        artifacts: {},
        metadata: {
          executionTime: Date.now() - startTime,
          quality: 0,
          completeness: 0
        },
        error: error.message
      };
    }
  }

  private buildOpenCodexCommand(task: TaskDefinition, targetDir?: string): string[] {
    const promptString = `"${this.formatTaskPrompt(task, targetDir)}"`;

    const command = [
      this.openCodexPath,
      "--model", this.openCodexModel,
      "--approval-mode", "full-auto",
      "--quiet",
      promptString
    ];

    // Note: targetDir is used as cwd in executeCommand for open-codex
    // If open-codex needs targetDir as an argument, it should be added here.
    // For now, assuming it operates on CWD.

    if (this.verbose) {
      command.push('--verbose'); // Assuming open-codex has a verbose flag
    }

    return command;
  }

  private formatTaskPrompt(task: TaskDefinition, targetDir?: string): string {
    // Format the task description for OpenCodex prompt
    let prompt = task.description;

    // If the task has specific instructions, include them
    if (task.instructions && task.instructions !== task.description) {
      prompt = `${task.description}. ${task.instructions}`;
    }

    // Add context about the target directory if available and not already in prompt
    // This helps open-codex understand the context of its operations.
    if (targetDir && !prompt.toLowerCase().includes(targetDir.toLowerCase())) {
      prompt += ` (Target directory: ${targetDir})`;
    } else if (task.context?.targetDir && !prompt.toLowerCase().includes(task.context.targetDir.toLowerCase())) {
      prompt += ` (Target directory: ${task.context.targetDir})`;
    }

    return prompt.replace(/"/g, '\\"');
  }

  private async executeCommand(command: string[], cwd?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const [cmdExecutable, ...args] = command;

      const proc = spawn(cmdExecutable, args, {
        shell: true, // Keep true if openCodexPath might need shell interpretation or args have quotes
        cwd: cwd, // Set current working directory for open-codex
        env: {
          ...process.env,
          OPENAI_API_KEY: this.openCodexApiKey,
          OPENAI_API_BASE: this.openCodexBaseUrl,
          // CODEX_MODEL is passed as --model flag, so not needed here
        }
      });

      let stdout = '';
      let stderr = '';
      const artifacts: Record<string, any> = {};

      proc.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // TODO: Adjust artifact parsing if open-codex output is different
        // For now, assume similar "Created file: ..." or "Applied changes to ..."
        const artifactMatch = chunk.match(/(?:Created file|Applied changes to): (.+)/g);
        if (artifactMatch) {
          artifactMatch.forEach(match => {
            const filePath = match.replace(/(?:Created file|Applied changes to): /, '').trim();
            artifacts[filePath] = true; // Mark as created or modified
          });
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutId); // Clear timeout when process completes
        if (code === 0) {
          resolve({
            output: stdout,
            artifacts,
            exitCode: code,
            error: null
          });
        } else {
          // Log stderr for debugging even if we resolve
          if (stderr) {
            this.logger.warn(`OpenCodex command stderr (exit code ${code}): ${stderr}`, { command: command.join(' ') });
          }
          resolve({
            output: stdout, // stdout might still contain useful info
            artifacts,
            exitCode: code,
            error: stderr || `OpenCodex command exited with code ${code}`
          });
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        this.logger.error('Failed to start OpenCodex command', { error: err, command: command.join(' ') });
        reject(err);
      });

      // Handle timeout
      const timeoutMs = this.timeoutMinutes * 60 * 1000;
      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM'); // Send SIGTERM first
        setTimeout(() => { // Give it a moment to shut down gracefully
            if (!proc.killed) {
                proc.kill('SIGKILL'); // Force kill if still running
            }
        }, 5000); // 5 seconds grace period
        reject(new Error('OpenCodex command execution timeout'));
      }, timeoutMs);
    });
  }
}

// Export for use in swarm coordinator
export default LLMAssistantExecutor;
export { LLMAssistantExecutor };