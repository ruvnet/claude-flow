/**
 * Stream processor for Claude stream-json output
 * Provides real-time status updates and progress tracking
 */

import { Transform } from 'stream';

export class StreamJsonProcessor extends Transform {
  constructor(options = {}) {
    super({ objectMode: false });
    this.buffer = '';
    this.agentId = options.agentId;
    this.agentName = options.agentName || 'Agent';
    this.agentIcon = options.agentIcon || '🤖';
    this.taskId = options.taskId || 'unknown';
    this.startTime = Date.now();
    this.eventCount = 0;
    this.lastUpdate = Date.now();
    this.options = options;
    this.display = options.display; // Reference to concurrent display
  }

  _transform(chunk, encoding, callback) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          this.processEvent(event);
        } catch (e) {
          // Not JSON, pass through if in verbose mode
          if (this.options.verbose) {
            console.log(`[${this.agentName}] ${line}`);
          }
        }
      }
    }

    // Update progress display periodically
    if (Date.now() - this.lastUpdate > 1000) {
      this.updateProgress();
      this.lastUpdate = Date.now();
    }

    callback();
  }

  _flush(callback) {
    if (this.buffer.trim()) {
      try {
        const event = JSON.parse(this.buffer);
        this.processEvent(event);
      } catch (e) {
        // Ignore
      }
    }
    this.showFinalStatus();
    callback();
  }

  processEvent(event) {
    this.eventCount++;
    
    // If we have a concurrent display, update it instead of console logging
    if (this.display) {
      this.updateDisplay(event);
      return;
    }
    
    // Handle quiet mode - show important actions and commands
    if (this.options.verbose === false && this.options.logLevel === 'quiet') {
      switch (event.type) {
        case 'system':
          if (event.subtype === 'init') {
            console.log(`🤖 ${this.agentName} - Started`);
          }
          break;
        case 'assistant':
          // In quiet mode, still show bash commands and key actions
          if (event.message?.content?.length > 0) {
            const content = event.message.content[0];
            if (content.type === 'tool_use' && content.name === 'Bash' && content.input?.command) {
              const command = content.input.command;
              if (command.length > 60) {
                console.log(`  🔧 ${command.substring(0, 57)}...`);
              } else {
                console.log(`  🔧 ${command}`);
              }
            } else if (content.type === 'tool_use' && ['WebSearch', 'Read', 'Write'].includes(content.name)) {
              const toolName = content.name.replace(/([A-Z])/g, ' $1').trim();
              if (content.input) {
                const firstKey = Object.keys(content.input)[0];
                const firstValue = content.input[firstKey];
                if (typeof firstValue === 'string' && firstValue.length < 40) {
                  console.log(`  🔧 ${toolName}: ${firstValue}`);
                } else {
                  console.log(`  🔧 ${toolName}`);
                }
              }
            }
          }
          break;
        case 'result':
          if (event.subtype === 'success') {
            console.log(`✅ ${this.agentName} - Completed (${this.formatDuration(event.duration_ms)})`);
          } else if (event.is_error) {
            console.log(`❌ ${this.agentName} - Failed: ${event.error || 'Unknown error'}`);
          }
          break;
      }
      return;
    }
    
    // Use clean, concise formatting for non-interactive mode
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          console.log(`\n🤖 ${this.agentName} - Started (Session: ${event.session_id?.substring(0, 8) || 'unknown'})`);
        }
        break;
        
      case 'assistant':
        if (event.message?.content?.length > 0) {
          const content = event.message.content[0];
          if (content.type === 'text') {
            // Show only the first meaningful line, skip verbose details
            const lines = content.text.split('\n').filter(line => line.trim());
            if (lines.length > 0) {
              const firstLine = lines[0].trim();
              if (firstLine.length > 100) {
                console.log(`💭 ${firstLine.substring(0, 97)}...`);
              } else {
                console.log(`💭 ${firstLine}`);
              }
            }
          } else if (content.type === 'tool_use') {
            // Show tool use with actual command/input when available
            const toolName = content.name.replace(/([A-Z])/g, ' $1').trim();
            
            // For Bash tool, show the actual command
            if (content.name === 'Bash' && content.input?.command) {
              const command = content.input.command;
              if (command.length > 80) {
                console.log(`🔧 Bash: ${command.substring(0, 77)}...`);
              } else {
                console.log(`🔧 Bash: ${command}`);
              }
            }
            // For other tools, show key parameters
            else if (content.input && Object.keys(content.input).length > 0) {
              const firstKey = Object.keys(content.input)[0];
              const firstValue = content.input[firstKey];
              
              if (typeof firstValue === 'string' && firstValue.length < 60) {
                console.log(`🔧 ${toolName}: ${firstValue}`);
              } else if (typeof firstValue === 'string') {
                console.log(`🔧 ${toolName}: ${firstValue.substring(0, 57)}...`);
              } else {
                console.log(`🔧 ${toolName}`);
              }
            } else {
              console.log(`🔧 ${toolName}`);
            }
          }
        }
        break;
        
      case 'user':
        // Tool results - show only success/failure
        if (event.message?.content?.[0]?.type === 'tool_result') {
          const result = event.message.content[0];
          if (!result.is_error) {
            console.log(`  ✅ Tool completed`);
          } else {
            console.log(`  ❌ Tool failed: ${result.error || 'Unknown error'}`);
          }
        }
        break;
        
      case 'result':
        if (event.subtype === 'success') {
          console.log(`\n✅ ${this.agentName} - Completed (${this.formatDuration(event.duration_ms)})`);
          if (event.total_cost_usd) {
            console.log(`   💰 Cost: $${event.total_cost_usd.toFixed(4)}`);
          }
        } else if (event.is_error) {
          console.log(`\n❌ ${this.agentName} - Failed: ${event.error || 'Unknown error'}`);
        }
        break;
        
      default:
        // Only show important events in verbose mode
        if (this.options.verbose && ['tool_call', 'error', 'warning'].includes(event.type)) {
          console.log(`ℹ️  [${event.type}] ${event.message || JSON.stringify(event).substring(0, 80)}...`);
        }
    }
  }
  
  /**
   * Update the concurrent display instead of console
   */
  updateDisplay(event) {
    switch (event.type) {
      case 'system':
        if (event.subtype === 'init') {
          this.display.updateAgent(this.agentId, { status: 'active' });
          this.display.addActivity(this.agentId, 'Initialized');
        }
        break;
        
      case 'assistant':
        if (event.message?.content?.length > 0) {
          const content = event.message.content[0];
          if (content.type === 'text') {
            const preview = content.text.substring(0, 80);
            this.display.addActivity(this.agentId, preview);
          } else if (content.type === 'tool_use') {
            this.display.addActivity(this.agentId, `Using ${content.name}`, content.name);
          }
        }
        break;
        
      case 'user':
        // Tool results
        if (event.message?.content?.[0]?.type === 'tool_result') {
          const result = event.message.content[0];
          if (!result.is_error) {
            this.display.addActivity(this.agentId, 'Tool completed', null);
          }
        }
        break;
        
      case 'result':
        if (event.subtype === 'success') {
          this.display.updateAgent(this.agentId, { 
            status: 'completed',
            progress: 100
          });
          this.display.addActivity(this.agentId, 'Task completed successfully');
        } else if (event.is_error) {
          this.display.updateAgent(this.agentId, { 
            status: 'failed'
          });
          this.display.addActivity(this.agentId, `Failed: ${event.error || 'Unknown error'}`);
        }
        break;
    }
  }

  updateProgress() {
    // Don't show progress updates in interactive-style mode - events handle the display
  }

  showFinalStatus() {
    const elapsed = this.formatDuration(Date.now() - this.startTime);
    if (this.eventCount > 0) {
      console.log(`\n📊 ${this.agentName} - Processed ${this.eventCount} events in ${elapsed}`);
    }
  }

  getSpinner() {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    return frames[Math.floor(Date.now() / 100) % frames.length];
  }

  getProgressBar(elapsed, expected) {
    const progress = Math.min(elapsed / expected, 1);
    const filled = Math.floor(progress * 10);
    const empty = 10 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  formatToolParams(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).length === 0) {
      return '';
    }
    
    // Format key parameters for display
    const keys = Object.keys(input);
    if (keys.length === 1) {
      const key = keys[0];
      const value = input[key];
      if (typeof value === 'string' && value.length < 30) {
        return `(${key}: "${value}")`;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        return `(${key}: ${value})`;
      }
    } else if (keys.length <= 3) {
      const params = keys.map(key => {
        const value = input[key];
        if (typeof value === 'string' && value.length < 20) {
          return `${key}: "${value}"`;
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          return `${key}: ${value}`;
        } else {
          return `${key}: ...`;
        }
      }).join(', ');
      return `(${params})`;
    }
    
    return '(...)';
  }
}

/**
 * Create a stream processor for an agent
 */
export function createStreamProcessor(agentName, agentIcon, options = {}) {
  return new StreamJsonProcessor({
    agentName,
    agentIcon,
    ...options
  });
}