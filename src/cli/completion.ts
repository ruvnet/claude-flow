/**
 * Shell completion generator for Claude-Flow CLI
 */

import { colors } from '../utils/cliffy-compat/colors.js';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';

export class CompletionGenerator {
  private commands = [
    'start', 'agent', 'task', 'memory', 'config', 'status', 
    'monitor', 'session', 'workflow', 'repl', 'version', 'completion'
  ];

  private subcommands = {
    agent: ['spawn', 'list', 'terminate', 'info'],
    task: ['create', 'list', 'status', 'cancel', 'workflow'],
    memory: ['query', 'export', 'import', 'stats', 'cleanup'],
    config: ['show', 'get', 'set', 'init', 'validate'],
    session: ['list', 'save', 'restore', 'delete', 'export', 'import', 'info', 'clean'],
    workflow: ['run', 'validate', 'list', 'status', 'stop', 'template'],
  };

  async generate(shell: string, install: boolean = false): Promise<void> {
    const detectedShell = shell === 'detect' ? await this.detectShell() : shell;
    
    switch (detectedShell) {
      case 'bash':
        await this.generateBashCompletion(install);
        break;
      case 'zsh':
        await this.generateZshCompletion(install);
        break;
      case 'fish':
        await this.generateFishCompletion(install);
        break;
      default:
        console.error(colors.red(`Unsupported shell: ${detectedShell}`));
        console.log(colors.gray('Supported shells: bash, zsh, fish'));
        break;
    }
  }

  private async detectShell(): Promise<string> {
    const shell = process.env['SHELL'] || '';
    
    if (shell.includes('bash')) return 'bash';
    if (shell.includes('zsh')) return 'zsh';
    if (shell.includes('fish')) return 'fish';
    
    console.log(colors.yellow('Could not detect shell, defaulting to bash'));
    return 'bash';
  }

  private async generateBashCompletion(install: boolean): Promise<void> {
    const script = this.getBashCompletionScript();
    
    if (install) {
      await this.installBashCompletion(script);
    } else {
      console.log(script);
    }
  }

  private async generateZshCompletion(install: boolean): Promise<void> {
    const script = this.getZshCompletionScript();
    
    if (install) {
      await this.installZshCompletion(script);
    } else {
      console.log(script);
    }
  }

  private async generateFishCompletion(install: boolean): Promise<void> {
    const script = this.getFishCompletionScript();
    
    if (install) {
      await this.installFishCompletion(script);
    } else {
      console.log(script);
    }
  }

  private getBashCompletionScript(): string {
    return `# Claude-Flow bash completion
_claude_flow_completion() {
    local cur prev words cword
    _init_completion || return

    case \${words[1]} in
        agent)
            case \${words[2]} in
                spawn)
                    COMPREPLY=($(compgen -W "coordinator researcher implementer analyst custom" -- "$cur"))
                    return
                    ;;
                terminate|info)
                    # In production, this would complete with actual agent IDs
                    COMPREPLY=($(compgen -W "agent-001 agent-002 agent-003" -- "$cur"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "${this.subcommands.agent.join(' ')}" -- "$cur"))
                    return
                    ;;
            esac
            ;;
        task)
            case \${words[2]} in
                create)
                    if [[ \${#words[@]} -eq 4 ]]; then
                        COMPREPLY=($(compgen -W "research implementation analysis coordination" -- "$cur"))
                    fi
                    return
                    ;;
                status|cancel)
                    # In production, this would complete with actual task IDs
                    COMPREPLY=($(compgen -W "task-001 task-002 task-003" -- "$cur"))
                    return
                    ;;
                workflow)
                    COMPREPLY=($(compgen -f -X '!*.@(json|yaml|yml)' -- "$cur"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "${this.subcommands.task.join(' ')}" -- "$cur"))
                    return
                    ;;
            esac
            ;;
        memory)
            COMPREPLY=($(compgen -W "${this.subcommands.memory.join(' ')}" -- "$cur"))
            return
            ;;
        config)
            COMPREPLY=($(compgen -W "${this.subcommands.config.join(' ')}" -- "$cur"))
            return
            ;;
        session)
            case \${words[2]} in
                restore|delete|info|export)
                    # In production, this would complete with actual session IDs
                    COMPREPLY=($(compgen -W "session-001 session-002 session-003" -- "$cur"))
                    return
                    ;;
                import)
                    COMPREPLY=($(compgen -f -X '!*.@(json|yaml|yml)' -- "$cur"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "${this.subcommands.session.join(' ')}" -- "$cur"))
                    return
                    ;;
            esac
            ;;
        workflow)
            case \${words[2]} in
                run|validate)
                    COMPREPLY=($(compgen -f -X '!*.@(json|yaml|yml)' -- "$cur"))
                    return
                    ;;
                template)
                    COMPREPLY=($(compgen -W "research implementation coordination" -- "$cur"))
                    return
                    ;;
                status|stop)
                    # In production, this would complete with actual workflow IDs
                    COMPREPLY=($(compgen -W "workflow-001 workflow-002 workflow-003" -- "$cur"))
                    return
                    ;;
                *)
                    COMPREPLY=($(compgen -W "${this.subcommands.workflow.join(' ')}" -- "$cur"))
                    return
                    ;;
            esac
            ;;
        completion)
            COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))
            return
            ;;
        *)
            COMPREPLY=($(compgen -W "${this.commands.join(' ')}" -- "$cur"))
            return
            ;;
    esac
}

complete -F _claude_flow_completion claude-flow`;
  }

  private getZshCompletionScript(): string {
    return `#compdef claude-flow

# Claude-Flow zsh completion

_claude_flow() {
    local context state state_descr line
    typeset -A opt_args

    _arguments -C \\
        '(-h --help)'{-h,--help}'[Show help information]' \\
        '(-v --verbose)'{-v,--verbose}'[Enable verbose logging]' \\
        '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]' \\
        '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.json"' \\
        '--log-level[Set log level]:level:(debug info warn error)' \\
        '--no-color[Disable colored output]' \\
        '--json[Output in JSON format]' \\
        '--profile[Use named configuration profile]:profile:' \\
        '1: :_claude_flow_commands' \\
        '*::arg:->args'

    case $state in
        args)
            case $words[1] in
                agent)
                    _claude_flow_agent
                    ;;
                task)
                    _claude_flow_task
                    ;;
                memory)
                    _claude_flow_memory
                    ;;
                config)
                    _claude_flow_config
                    ;;
                session)
                    _claude_flow_session
                    ;;
                workflow)
                    _claude_flow_workflow
                    ;;
                completion)
                    _arguments \\
                        '--install[Install completion script automatically]' \\
                        '1: :(bash zsh fish)'
                    ;;
            esac
            ;;
    esac
}

_claude_flow_commands() {
    local commands
    commands=(
        'start:Start the Claude-Flow orchestration system'
        'agent:Manage Claude-Flow agents'
        'task:Manage tasks'
        'memory:Manage agent memory'
        'config:Manage Claude-Flow configuration'
        'status:Show Claude-Flow system status'
        'monitor:Start live monitoring dashboard'
        'session:Manage Claude-Flow sessions'
        'workflow:Execute and manage workflows'
        'repl:Start interactive REPL mode'
        'version:Show detailed version information'
        'completion:Generate shell completion scripts'
    )
    _describe 'commands' commands
}

_claude_flow_agent() {
    case $words[2] in
        spawn)
            _arguments \\
                '(-n --name)'{-n,--name}'[Agent name]:name:' \\
                '(-p --priority)'{-p,--priority}'[Agent priority]:priority:' \\
                '(-m --max-tasks)'{-m,--max-tasks}'[Maximum concurrent tasks]:max:' \\
                '--system-prompt[Custom system prompt]:prompt:' \\
                '1: :(coordinator researcher implementer analyst custom)'
            ;;
        terminate|info)
            _arguments '1: :_claude_flow_agents'
            ;;
        *)
            _arguments '1: :(${this.subcommands.agent.join(' ')})'
            ;;
    esac
}

_claude_flow_task() {
    case $words[2] in
        create)
            _arguments \\
                '(-p --priority)'{-p,--priority}'[Task priority]:priority:' \\
                '(-d --dependencies)'{-d,--dependencies}'[Comma-separated dependency task IDs]:deps:' \\
                '(-i --input)'{-i,--input}'[Task input as JSON]:input:' \\
                '(-a --assign)'{-a,--assign}'[Assign to specific agent]:agent:_claude_flow_agents' \\
                '1: :(research implementation analysis coordination)' \\
                '2: :_message_or_description'
            ;;
        workflow)
            _arguments '1: :_files -g "*.json *.yaml *.yml"'
            ;;
        status|cancel)
            _arguments '1: :_claude_flow_tasks'
            ;;
        *)
            _arguments '1: :(${this.subcommands.task.join(' ')})'
            ;;
    esac
}

_claude_flow_memory() {
    _arguments '1: :(${this.subcommands.memory.join(' ')})'
}

_claude_flow_config() {
    _arguments '1: :(${this.subcommands.config.join(' ')})'
}

_claude_flow_session() {
    case $words[2] in
        restore|delete|info|export)
            _arguments '1: :_claude_flow_sessions'
            ;;
        import)
            _arguments '1: :_files -g "*.json *.yaml *.yml"'
            ;;
        *)
            _arguments '1: :(${this.subcommands.session.join(' ')})'
            ;;
    esac
}

_claude_flow_workflow() {
    case $words[2] in
        run|validate)
            _arguments '1: :_files -g "*.json *.yaml *.yml"'
            ;;
        template)
            _arguments '1: :(research implementation coordination)'
            ;;
        status|stop)
            _arguments '1: :_claude_flow_workflows'
            ;;
        *)
            _arguments '1: :(${this.subcommands.workflow.join(' ')})'
            ;;
    esac
}

# Helper functions for completion
_claude_flow_agents() {
    # In production, this would query the running orchestrator
    local agents
    agents=('agent-001:Coordinator Agent' 'agent-002:Research Agent' 'agent-003:Implementation Agent')
    _describe 'agents' agents
}

_claude_flow_tasks() {
    # In production, this would query the running orchestrator
    local tasks
    tasks=('task-001:Research Task' 'task-002:Analysis Task' 'task-003:Implementation Task')
    _describe 'tasks' tasks
}

_claude_flow_sessions() {
    # In production, this would query saved sessions
    local sessions
    sessions=('session-001:Research Session' 'session-002:Development Session' 'session-003:Analysis Session')
    _describe 'sessions' sessions
}

_claude_flow_workflows() {
    # In production, this would query running workflows
    local workflows
    workflows=('workflow-001:Research Workflow' 'workflow-002:Implementation Workflow')
    _describe 'workflows' workflows
}

_message_or_description() {
    _message 'task description'
}

_claude_flow "$@"`;
  }

  private getFishCompletionScript(): string {
    return `# Claude-Flow fish completion

function __fish_claude_flow_needs_command
    set cmd (commandline -opc)
    if [ (count $cmd) -eq 1 ]
        return 0
    end
    return 1
end

function __fish_claude_flow_using_command
    set cmd (commandline -opc)
    if [ (count $cmd) -gt 1 ]
        if [ $argv[1] = $cmd[2] ]
            return 0
        end
    end
    return 1
end

# Main commands
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'start' -d 'Start the Claude-Flow orchestration system'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'agent' -d 'Manage Claude-Flow agents'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'task' -d 'Manage tasks'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'memory' -d 'Manage agent memory'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'config' -d 'Manage Claude-Flow configuration'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'status' -d 'Show Claude-Flow system status'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'monitor' -d 'Start live monitoring dashboard'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'session' -d 'Manage Claude-Flow sessions'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'workflow' -d 'Execute and manage workflows'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'repl' -d 'Start interactive REPL mode'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'version' -d 'Show detailed version information'
complete -f -c claude-flow -n '__fish_claude_flow_needs_command' -a 'completion' -d 'Generate shell completion scripts'

# Global options
complete -c claude-flow -s h -l help -d 'Show help information'
complete -c claude-flow -s v -l verbose -d 'Enable verbose logging'
complete -c claude-flow -s q -l quiet -d 'Suppress non-essential output'
complete -c claude-flow -s c -l config -r -d 'Path to configuration file'
complete -c claude-flow -l log-level -r -a 'debug info warn error' -d 'Set log level'
complete -c claude-flow -l no-color -d 'Disable colored output'
complete -c claude-flow -l json -d 'Output in JSON format'
complete -c claude-flow -l profile -r -d 'Use named configuration profile'

# Agent subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command agent' -a 'spawn' -d 'Spawn a new agent'
complete -f -c claude-flow -n '__fish_claude_flow_using_command agent' -a 'list' -d 'List all agents'
complete -f -c claude-flow -n '__fish_claude_flow_using_command agent' -a 'terminate' -d 'Terminate an agent'
complete -f -c claude-flow -n '__fish_claude_flow_using_command agent' -a 'info' -d 'Get agent information'

# Task subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command task' -a 'create' -d 'Create a new task'
complete -f -c claude-flow -n '__fish_claude_flow_using_command task' -a 'list' -d 'List all tasks'
complete -f -c claude-flow -n '__fish_claude_flow_using_command task' -a 'status' -d 'Get task status'
complete -f -c claude-flow -n '__fish_claude_flow_using_command task' -a 'cancel' -d 'Cancel a task'
complete -f -c claude-flow -n '__fish_claude_flow_using_command task' -a 'workflow' -d 'Execute workflow from file'

# Memory subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command memory' -a 'query' -d 'Query memory entries'
complete -f -c claude-flow -n '__fish_claude_flow_using_command memory' -a 'export' -d 'Export memory to file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command memory' -a 'import' -d 'Import memory from file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command memory' -a 'stats' -d 'Show memory statistics'
complete -f -c claude-flow -n '__fish_claude_flow_using_command memory' -a 'cleanup' -d 'Clean up old entries'

# Config subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command config' -a 'show' -d 'Show current configuration'
complete -f -c claude-flow -n '__fish_claude_flow_using_command config' -a 'get' -d 'Get specific config value'
complete -f -c claude-flow -n '__fish_claude_flow_using_command config' -a 'set' -d 'Set config value'
complete -f -c claude-flow -n '__fish_claude_flow_using_command config' -a 'init' -d 'Initialize config file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command config' -a 'validate' -d 'Validate config file'

# Session subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'list' -d 'List all saved sessions'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'save' -d 'Save current session state'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'restore' -d 'Restore a saved session'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'delete' -d 'Delete a saved session'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'export' -d 'Export session to file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'import' -d 'Import session from file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'info' -d 'Show detailed session information'
complete -f -c claude-flow -n '__fish_claude_flow_using_command session' -a 'clean' -d 'Clean up old sessions'

# Workflow subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'run' -d 'Execute a workflow from file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'validate' -d 'Validate a workflow file'
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'list' -d 'List running workflows'
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'status' -d 'Show workflow execution status'
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'stop' -d 'Stop a running workflow'
complete -f -c claude-flow -n '__fish_claude_flow_using_command workflow' -a 'template' -d 'Generate workflow templates'

# Completion subcommands
complete -f -c claude-flow -n '__fish_claude_flow_using_command completion' -a 'bash zsh fish'`;
  }

  private async installBashCompletion(script: string): Promise<void> {
    const homeDir = homedir();
    const possiblePaths = [
      '/etc/bash_completion.d/claude-flow',
      '/usr/local/etc/bash_completion.d/claude-flow',
      join(homeDir, '.local/share/bash-completion/completions/claude-flow'),
      join(homeDir, '.bash_completion.d/claude-flow')
    ];

    for (const path of possiblePaths) {
      try {
        const dir = dirname(path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path, script, 'utf8');
        
        console.log(colors.green('✓ Bash completion installed'));
        console.log(`${colors.white('Location:')} ${path}`);
        console.log(colors.gray('Restart your shell or run: source ~/.bashrc'));
        return;
      } catch (error) {
        // Try next path
        continue;
      }
    }

    console.error(colors.red('Failed to install bash completion'));
    console.log(colors.gray('You can manually save the completion script to a bash completion directory'));
  }

  private async installZshCompletion(script: string): Promise<void> {
    const homeDir = homedir();
    const possiblePaths = [
      join(homeDir, '.zsh/completions/_claude-flow'),
      '/usr/local/share/zsh/site-functions/_claude-flow',
      '/usr/share/zsh/site-functions/_claude-flow'
    ];

    for (const path of possiblePaths) {
      try {
        const dir = dirname(path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path, script, 'utf8');
        
        console.log(colors.green('✓ Zsh completion installed'));
        console.log(`${colors.white('Location:')} ${path}`);
        console.log(colors.gray('Restart your shell or run: autoload -U compinit && compinit'));
        return;
      } catch (error) {
        // Try next path
        continue;
      }
    }

    console.error(colors.red('Failed to install zsh completion'));
    console.log(colors.gray('You can manually save the completion script to your zsh completion directory'));
  }

  private async installFishCompletion(script: string): Promise<void> {
    const homeDir = homedir();
    const possiblePaths = [
      join(homeDir, '.config/fish/completions/claude-flow.fish'),
      '/usr/local/share/fish/completions/claude-flow.fish',
      '/usr/share/fish/completions/claude-flow.fish'
    ];

    for (const path of possiblePaths) {
      try {
        const dir = dirname(path);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path, script, 'utf8');
        
        console.log(colors.green('✓ Fish completion installed'));
        console.log(`${colors.white('Location:')} ${path}`);
        console.log(colors.gray('Completions will be available in new fish sessions'));
        return;
      } catch (error) {
        // Try next path
        continue;
      }
    }

    console.error(colors.red('Failed to install fish completion'));
    console.log(colors.gray('You can manually save the completion script to your fish completion directory'));
  }
}