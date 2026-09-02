/**
 * Official Claude Code Hooks Bridge
 *
 * Maps V3 internal hook events to official Claude Code hook events.
 * This bridge enables seamless integration between claude-flow's
 * internal hook system and the official Claude Code plugin API.
 *
 * @module v3/hooks/bridge/official-hooks-bridge
 */

import { HookEvent, HookPriority, type HookHandler, type HookContext, type HookResult } from '../types.js';

/**
 * Official Claude Code hook event types
 * Based on https://code.claude.com/docs/en/hooks
 */
export type OfficialHookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'UserPromptSubmit'
  | 'PermissionRequest'
  | 'Notification'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SessionStart';

/**
 * Official hook input structure (received via stdin)
 */
export interface OfficialHookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: OfficialHookEvent;

  // Tool-specific fields
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_success?: boolean;
  tool_exit_code?: number;

  // Prompt-specific fields
  prompt?: string;

  // Notification-specific fields
  notification_message?: string;
  notification_level?: 'info' | 'warning' | 'error';
}

/**
 * Official hook output structure (returned via stdout)
 */
export interface OfficialHookOutput {
  /** Decision for permission/flow control */
  decision?: 'allow' | 'deny' | 'block' | 'ask' | 'approve' | 'stop' | 'continue';

  /** Reason for the decision */
  reason?: string;

  /** Whether to continue processing (false stops Claude) */
  continue?: boolean;

  /** Modified tool input (for PreToolUse) */
  updatedInput?: Record<string, unknown>;

  /** Suppress the tool call result display */
  suppressOutput?: boolean;
}

/**
 * Mapping from V3 HookEvent to Official hook events
 */
export const V3_TO_OFFICIAL_HOOK_MAP: Record<HookEvent, OfficialHookEvent | null> = {
  // Direct mappings
  [HookEvent.PreToolUse]: 'PreToolUse',
  [HookEvent.PostToolUse]: 'PostToolUse',
  [HookEvent.SessionStart]: 'SessionStart',

  // File operations map to tool hooks with matchers
  [HookEvent.PreEdit]: 'PreToolUse', // matcher: Edit|Write|MultiEdit
  [HookEvent.PostEdit]: 'PostToolUse', // matcher: Edit|Write|MultiEdit
  [HookEvent.PreRead]: 'PreToolUse', // matcher: Read
  [HookEvent.PostRead]: 'PostToolUse', // matcher: Read

  // Command operations map to tool hooks
  [HookEvent.PreCommand]: 'PreToolUse', // matcher: Bash
  [HookEvent.PostCommand]: 'PostToolUse', // matcher: Bash

  // Task operations
  [HookEvent.PreTask]: 'UserPromptSubmit',
  [HookEvent.PostTask]: 'PostToolUse', // matcher: Task
  [HookEvent.TaskProgress]: null, // Internal only

  // Session operations
  [HookEvent.SessionEnd]: 'Stop',
  [HookEvent.SessionRestore]: 'SessionStart',

  // Agent operations
  [HookEvent.AgentSpawn]: 'PostToolUse', // matcher: Task
  [HookEvent.AgentTerminate]: 'SubagentStop',

  // Routing (internal)
  [HookEvent.PreRoute]: 'UserPromptSubmit',
  [HookEvent.PostRoute]: null, // Internal only

  // Learning (internal)
  [HookEvent.PatternLearned]: null, // Internal only
  [HookEvent.PatternConsolidated]: null, // Internal only
};

/**
 * Tool matchers for V3 events that map to PreToolUse/PostToolUse
 */
export const V3_TOOL_MATCHERS: Partial<Record<HookEvent, string>> = {
  [HookEvent.PreEdit]: '^(Write|Edit|MultiEdit)$',
  [HookEvent.PostEdit]: '^(Write|Edit|MultiEdit)$',
  [HookEvent.PreRead]: '^Read$',
  [HookEvent.PostRead]: '^Read$',
  [HookEvent.PreCommand]: '^Bash$',
  [HookEvent.PostCommand]: '^Bash$',
  [HookEvent.PreTask]: '^Task$',
  [HookEvent.PostTask]: '^Task$',
  [HookEvent.AgentSpawn]: '^Task$',
};

/**
 * Bridge class for converting between V3 and official hooks
 */
export class OfficialHooksBridge {
  /**
   * Convert official hook input to V3 HookContext
   */
  static toV3Context(input: OfficialHookInput): HookContext {
    const event = this.officialToV3Event(input.hook_event_name, input.tool_name);

    const context: HookContext = {
      event,
      timestamp: new Date(),
      metadata: {
        session_id: input.session_id,
        transcript_path: input.transcript_path,
        cwd: input.cwd,
        permission_mode: input.permission_mode,
      },
    };

    // Add tool information
    if (input.tool_name) {
      context.tool = {
        name: input.tool_name,
        parameters: input.tool_input ?? {},
      };
    }

    // Add file information for file operations
    if (input.tool_name && ['Write', 'Edit', 'MultiEdit', 'Read'].includes(input.tool_name)) {
      context.file = {
        path: (input.tool_input?.file_path as string) ?? '',
        operation: input.tool_name === 'Read' ? 'read' : 'modify',
      };
    }

    // Add command information for Bash
    if (input.tool_name === 'Bash') {
      context.command = {
        raw: (input.tool_input?.command as string) ?? '',
        workingDirectory: input.cwd,
        exitCode: input.tool_exit_code,
        output: typeof input.tool_output === 'string' ? input.tool_output : undefined,
      };
    }

    // Add task information for Task tool
    if (input.tool_name === 'Task') {
      context.task = {
        id: `task-${Date.now()}`,
        description: (input.tool_input?.prompt as string) ?? '',
        agent: input.tool_input?.subagent_type as string,
      };
    }

    // Add session information
    context.session = {
      id: input.session_id,
      startedAt: new Date(),
    };

    // Add prompt for UserPromptSubmit
    if (input.prompt) {
      context.routing = {
        task: input.prompt,
      };
    }

    return context;
  }

  /**
   * Convert V3 HookResult to official hook output
   */
  static toOfficialOutput(result: HookResult, event: OfficialHookEvent): OfficialHookOutput {
    const output: OfficialHookOutput = {};

    // Map abort to decision
    if (result.abort) {
      output.decision = event === 'PermissionRequest' ? 'deny' : 'block';
      output.continue = false;
    } else if (result.success) {
      output.decision = event === 'PermissionRequest' ? 'allow' : 'continue';
      output.continue = true;
    }

    // Add reason
    if (result.error) {
      output.reason = result.error;
    } else if (result.message) {
      output.reason = result.message;
    }

    // Pass through updated input if present
    if (result.data?.updatedInput) {
      output.updatedInput = result.data.updatedInput as Record<string, unknown>;
    }

    return output;
  }

  /**
   * Convert official hook event to V3 HookEvent
   */
  static officialToV3Event(officialEvent: OfficialHookEvent, toolName?: string): HookEvent {
    // Handle tool-specific mappings
    if (officialEvent === 'PreToolUse' && toolName) {
      if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
        return HookEvent.PreEdit;
      }
      if (toolName === 'Read') {
        return HookEvent.PreRead;
      }
      if (toolName === 'Bash') {
        return HookEvent.PreCommand;
      }
      if (toolName === 'Task') {
        return HookEvent.PreTask;
      }
      return HookEvent.PreToolUse;
    }

    if (officialEvent === 'PostToolUse' && toolName) {
      if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
        return HookEvent.PostEdit;
      }
      if (toolName === 'Read') {
        return HookEvent.PostRead;
      }
      if (toolName === 'Bash') {
        return HookEvent.PostCommand;
      }
      if (toolName === 'Task') {
        return HookEvent.PostTask;
      }
      return HookEvent.PostToolUse;
    }

    // Direct mappings
    const mapping: Record<OfficialHookEvent, HookEvent> = {
      PreToolUse: HookEvent.PreToolUse,
      PostToolUse: HookEvent.PostToolUse,
      UserPromptSubmit: HookEvent.PreTask,
      PermissionRequest: HookEvent.PreToolUse,
      Notification: HookEvent.PostTask, // Closest match
      Stop: HookEvent.SessionEnd,
      SubagentStop: HookEvent.AgentTerminate,
      PreCompact: HookEvent.SessionEnd, // Closest match
      SessionStart: HookEvent.SessionStart,
    };

    return mapping[officialEvent] ?? HookEvent.PreToolUse;
  }

  /**
   * Get tool matcher for a V3 event
   */
  static getToolMatcher(event: HookEvent): string | null {
    return V3_TOOL_MATCHERS[event] ?? null;
  }

  /**
   * Check if V3 event maps to an official hook
   */
  static hasOfficialMapping(event: HookEvent): boolean {
    return V3_TO_OFFICIAL_HOOK_MAP[event] !== null;
  }

  /**
   * Create a CLI command for a V3 hook handler
   */
  static createCLICommand(event: HookEvent, handler: string): string {
    const baseCommand = 'npx claude-flow@alpha hooks';

    switch (event) {
      case HookEvent.PreEdit:
        return `${baseCommand} pre-edit --file "$TOOL_INPUT_file_path"`;
      case HookEvent.PostEdit:
        return `${baseCommand} post-edit --file "$TOOL_INPUT_file_path" --success "$TOOL_SUCCESS" --train-patterns`;
      case HookEvent.PreCommand:
        return `${baseCommand} pre-command --command "$TOOL_INPUT_command"`;
      case HookEvent.PostCommand:
        return `${baseCommand} post-command --command "$TOOL_INPUT_command" --success "$TOOL_SUCCESS"`;
      case HookEvent.PreTask:
        return `${baseCommand} pre-task --description "$PROMPT"`;
      case HookEvent.PostTask:
        return `${baseCommand} post-task --task-id "$TOOL_RESULT_agent_id" --analyze-performance`;
      case HookEvent.SessionStart:
        return `${baseCommand} session-start --session-id "$SESSION_ID" --load-context`;
      case HookEvent.SessionEnd:
        return `${baseCommand} session-end --session-id "$SESSION_ID" --export-metrics`;
      default:
        return `${baseCommand} ${handler}`;
    }
  }
}

/**
 * Process stdin from official Claude Code hook system
 */
export async function processOfficialHookInput(): Promise<OfficialHookInput | null> {
  return new Promise((resolve) => {
    let data = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('readable', () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });

    // Handle case where no stdin (testing)
    setTimeout(() => {
      if (!data) {
        resolve(null);
      }
    }, 100);
  });
}

/**
 * Output result to official Claude Code hook system
 */
export function outputOfficialHookResult(output: OfficialHookOutput): void {
  console.log(JSON.stringify(output));
}

/**
 * Execute a V3 handler and bridge to official output
 */
export async function executeWithBridge(
  input: OfficialHookInput,
  handler: HookHandler
): Promise<OfficialHookOutput> {
  const context = OfficialHooksBridge.toV3Context(input);
  const result = await handler(context);
  return OfficialHooksBridge.toOfficialOutput(result, input.hook_event_name);
}

export default OfficialHooksBridge;
