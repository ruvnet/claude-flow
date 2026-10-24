# Token Tracking Implementation Status

## Summary

We've researched and implemented real token tracking capabilities for Claude API calls. The implementation provides infrastructure for capturing actual token usage from Claude Code CLI, though there are limitations due to how Claude Code handles telemetry in interactive mode.

## What Was Implemented

### 1. Research Findings
- Claude Code has native OpenTelemetry support for telemetry
- Token usage is tracked via `CLAUDE_CODE_ENABLE_TELEMETRY=1` 
- Claude emits metrics including `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`
- Open source tools exist (ccusage, Claude-Code-Usage-Monitor, claude-code-otel) that parse JSONL files

### 2. Created Components

#### `claude-telemetry.js`
- Wrapper module for Claude CLI execution with telemetry
- Functions to parse token usage from Claude output
- Session monitoring capabilities
- Cost extraction from `/cost` command

#### `claude-track.js`
- Background token tracker for Claude sessions
- Parses telemetry stream for token information
- Saves data to `.claude-flow/metrics/token-usage.json`

#### Analysis Commands
- `analysis setup-telemetry` - Configure token tracking
- `analysis claude-monitor` - Monitor Claude session in real-time
- `analysis claude-cost` - Get current session cost

### 3. Integration Updates
- Modified `swarm.js` to handle telemetry properly
- Updated `analysis.js` with new commands
- Created comprehensive documentation

## Current Status

### ✅ Working
- Token tracking infrastructure is in place
- Analysis commands are functional
- Documentation is comprehensive
- Claude CLI launches properly without telemetry interference

### ⚠️ Limitations
- When using `--claude` flag for interactive mode, telemetry must be disabled to prevent console output interference
- Claude's OpenTelemetry output to console blocks interactive usage
- Token tracking works best with non-interactive Claude commands

## The Core Challenge

The fundamental issue is that Claude Code's telemetry system outputs to console when `OTEL_METRICS_EXPORTER=console` (or any valid exporter), which interferes with the interactive CLI experience. Setting it to an invalid value like "none" causes Claude to throw an error.

## Solutions Available

### Option 1: Non-Interactive Commands
Token tracking works perfectly for non-interactive Claude commands where console output doesn't interfere.

### Option 2: Session File Parsing
Parse Claude's JSONL session files after execution (requires access to Claude's data directory).

### Option 3: Separate Monitoring Process
Run a monitoring process alongside Claude that captures telemetry data.

### Option 4: Custom OpenTelemetry Collector
Set up a local OTLP collector to receive telemetry data without console output.

## Recommendations

1. **For Interactive Use**: Continue using Claude without telemetry to ensure smooth operation
2. **For Batch Operations**: Enable telemetry for accurate token tracking
3. **For Cost Tracking**: Use the `/cost` command within Claude sessions
4. **For Analytics**: Consider implementing a local OTLP collector for silent telemetry collection

## Next Steps

To fully enable real token tracking, consider:

1. **Implement OTLP Collector**: Set up a lightweight local collector
   ```bash
   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   OTEL_METRICS_EXPORTER=otlp
   ```

2. **Parse Session Files**: Access Claude's session JSONL files directly
   - Location varies by OS
   - Contains complete token usage data

3. **Hook Integration**: Use Claude's session hooks to capture data post-execution

## Files Created/Modified

- `/src/cli/simple-commands/claude-telemetry.js` - Core telemetry module
- `/src/cli/simple-commands/claude-track.js` - Background tracker
- `/src/cli/simple-commands/analysis.js` - Updated with new commands
- `/src/cli/simple-commands/swarm.js` - Fixed telemetry handling
- `/docs/token-tracking-guide.md` - Comprehensive guide
- `/docs/token-tracking-status.md` - This status document

## Conclusion

Real token tracking infrastructure is implemented and functional. The main constraint is Claude Code's telemetry system outputting to console in interactive mode. The solution currently disables telemetry for interactive sessions to ensure proper Claude operation. For production token tracking, implementing a local OTLP collector would be the ideal solution.