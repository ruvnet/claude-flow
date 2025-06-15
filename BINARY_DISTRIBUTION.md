# Claude-Flow Binary Distribution

Claude-Flow supports multiple platforms through both pre-compiled binaries and Deno runtime fallback.

## Supported Platforms

### Pre-compiled Binaries
- **macOS (Intel)**: `claude-flow-darwin-x64`
- **macOS (Apple Silicon)**: `claude-flow-darwin-arm64`
- **Linux x64**: `claude-flow-linux-x64`
- **Windows x64**: `claude-flow-win-x64.exe`

### Runtime Fallback
- Any platform with Deno installed

## Installation Behavior

When you install Claude-Flow via npm, the installer will:

1. **Detect your platform** and look for a pre-compiled binary
2. **Use the binary** if available (fastest option)
3. **Fall back to Deno** if no binary is found
4. **Install Deno automatically** on Unix-like systems if needed

## Building Binaries

To build binaries for all platforms:

```bash
npm run build:all
```

This requires Deno to be installed and will create binaries for all supported platforms.

## Manual Binary Installation

You can also download pre-compiled binaries from the [GitHub Releases](https://github.com/ruvnet/claude-code-flow/releases) page.

### macOS/Linux
```bash
# Download the appropriate binary
curl -L https://github.com/ruvnet/claude-code-flow/releases/latest/download/claude-flow-darwin-arm64 -o claude-flow
chmod +x claude-flow
sudo mv claude-flow /usr/local/bin/
```

### Windows
Download `claude-flow-win-x64.exe` and add to your PATH.

## Platform-Specific Notes

### macOS
- Intel Macs use `claude-flow-darwin-x64`
- Apple Silicon Macs use `claude-flow-darwin-arm64`
- Both architectures are fully supported

### Linux
- Currently supports x64 architecture
- ARM support coming soon

### Windows
- Requires Windows 10 or later
- x64 architecture only

## Troubleshooting

If the binary doesn't work on your platform:

1. Install Deno: https://deno.land/
2. Run: `npx claude-flow@latest`

The package will automatically use Deno as a runtime.