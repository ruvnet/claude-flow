# Claude Flow on Windows

## Reducing console window flashes on Windows

### Symptom

When running ruflo on Windows with Claude Code (Desktop or Windows Terminal), you may see brief flashes of `cmd.exe`, `bash.exe`, or `conhost.exe` console windows appearing and disappearing during hook execution and statusline refreshes. This is especially noticeable during heavy tool use, when the terminal loses and regains focus dozens of times per minute.

### Root cause

The flashing is caused by an upstream issue in Claude Code: `claude.exe` spawns child processes for hooks, statusline updates, and MCP servers without setting the Win32 `CREATE_NO_WINDOW` flag (or Node's `windowsHide: true` option). When the parent process is a GUI or console-less environment (Claude Desktop, or Windows Terminal in delegation mode), each child process spawn creates a new visible `conhost.exe` window briefly before closing — appearing as a flash.

**Tracking:**
- **Upstream root cause:** `anthropics/claude-code#70200` — Claude Code spawns without `CREATE_NO_WINDOW`
- **Related upstream:** `anthropics/claude-code#66540` — comprehensive analysis of the flash behavior across multiple sessions
- **Ruflo mitigation:** v3.29.0 (commit c89a98a4f) added `windowsHide: true` to all ruflo-spawned child processes and increased the statusline cache TTL from 60s to 300s. These mitigations silence flashes from processes spawned *by* ruflo's own hooks and statusline. They cannot silence the upstream direct spawn — that requires a fix in Claude Code itself.

### Primary workaround: Switch to Windows Console Host

The most effective workaround is to switch Windows' default terminal application from Windows Terminal to the legacy Windows Console Host. Several users on the upstream issue threads confirm this fully silences the residual flashes.

**Why this works:** Windows Terminal's "default terminal" delegation mode (available on Windows 10 21H2+ and Windows 11) causes the system to delegate subprocess creation through the default terminal app. This delegation propagates to Claude Code's hook spawns even when they have `CREATE_NO_WINDOW` set. Windows Console Host does not use this delegation mode, so the flag is respected.

**How to switch (Windows 11):**
1. Open **Settings** (Win + I)
2. Navigate to **System** → **For developers**
3. Under **Terminal**, find the dropdown that currently shows "Windows Terminal"
4. Click the dropdown and select **Windows Console Host**

**How to switch (Windows 10):**
1. Open **Settings** (Win + I)
2. Navigate to **System** → **About**
3. Click **Advanced system settings**
4. In the Environment Variables window, look for the terminal setting (or use **Settings** → **Apps** → **Default apps** if available)

The setting is reversible — you can switch back to Windows Terminal at any time with the same steps.

**Note:** This workaround addresses only the visible flashes from subprocess spawning. It does not affect ruflo's functionality or Claude Code's core behavior. Switching terminals is a display-only change.

### Related issues

- RFC/feature request for ruflo: reduce hook count and implement per-session state caching to eliminate unnecessary spawns (see issue #2669 follow-ups)
- Upstream status tracking: follow `anthropics/claude-code#70200` for progress on a permanent fix in Claude Code
