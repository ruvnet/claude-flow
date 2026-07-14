# Windows 4688 Audit Rig for Console Window Flash Measurement

**Purpose:** Verify that console window flashes on Windows have been eliminated (or reduced to baseline) after upstream fixes or ruflo mitigations land.

**Status:** Verification methodology ready. Use this guide to measure flash reduction on your Windows development machine.

---

## Problem Statement

On Windows 10/11, running ruflo with Claude Code (Desktop or Windows Terminal) produces visible `cmd.exe` / `bash.exe` / `conhost.exe` console window flashes on every hook execution and statusline refresh. The root cause is upstream in Claude Code: `claude.exe` spawns child processes without the Win32 `CREATE_NO_WINDOW` flag, which causes `conhost.exe` to briefly appear when the parent is a console-less environment (like Claude Desktop or Windows Terminal in delegation mode).

Ruflo v3.29.0 (commit c89a98a4f) mitigated this on our side by adding `windowsHide: true` to ruflo's own subprocess spawns and by increasing the statusline cache TTL 60s → 300s. The upstream issue `anthropics/claude-code#70200` tracks a permanent fix in Claude Code. This audit rig lets you measure whether the residual flashes have been eliminated.

**Related:**
- Issue #2669: [Windows] cmd/console windows flash on hook + statusline spawns
- Upstream: `anthropics/claude-code#70200` — main tracking issue
- Prior art: clawd-on-desk#627 (same class of bug, similar audit methodology)

---

## Setup: Enable Windows Event 4688 (Process Creation Auditing)

Windows Event 4688 (`Process Creation`) captures every process spawn with optional command-line detail. Enable it to capture a complete trace of which processes Claude Code spawns.

### Option A: Group Policy Editor (GUI, Windows Pro/Enterprise/Home 22H2+)

1. Press **Win + R**, type `gpedit.msc`, press Enter
2. Navigate to: **Computer Configuration** → **Windows Settings** → **Security Settings** → **Advanced Audit Policy Configuration** → **System Audit Policies** → **Detailed Tracking**
3. Double-click **Audit Process Creation**
4. Check **Configure the following audit events**, then check **Success**
5. Click **OK**

### Option B: Registry (Command-line, all Windows versions)

Run this in Command Prompt (Admin) or PowerShell (Admin):

```powershell
# Enable 4688 event logging for process creation
auditpol.exe /set /subcategory:"Process Creation" /success:enable

# Enable command-line capture (required for this audit)
reg add HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit /v ProcessCreationIncludeCmdLine_Enabled /t REG_DWORD /d 1 /f
```

Verify with:
```powershell
auditpol.exe /get /category:"Detailed Tracking"
```

You should see `Process Creation: Success`.

### Option C: PowerShell (Automated, recommended for repeatability)

```powershell
# One-liner to enable both settings
auditpol.exe /set /subcategory:"Process Creation" /success:enable; reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit" /v "ProcessCreationIncludeCmdLine_Enabled" /t REG_DWORD /d 1 /f
```

---

## Reproduction Protocol

This protocol captures a baseline trace of process spawns during a standardized ruflo workload.

### Step 1: Clear the Security Event Log

```powershell
# As Administrator
wevtutil cl Security
```

### Step 2: Start a Fresh ruflo Session

Open a new Claude Code instance in your target environment:
- **Target A (baseline):** Claude Desktop
- **Target B (Windows Terminal, delegation mode):** Open Windows Terminal and start a Claude Code session
- **Target C (cmd.exe):** Start a pure cmd.exe session

Note which target you are testing.

### Step 3: Run a Standardized Workload

Execute 20 tool calls in rapid succession, mixing call types (Read, Grep, Bash). Then wait 5 minutes idle to capture statusline refreshes.

**Example workload (20 calls):**
```bash
# (Run these commands one after another in Claude Code)
read src/index.ts
read src/lib/utils.ts
grep -r "export function" src/ | head -5
bash ls -la src/
read docs/CLAUDE.md | head -20
grep -r "windowsHide" . 2>/dev/null | head -5
bash echo "test 1"
read package.json
bash echo "test 2"
grep -r "claude-flow" src/ | head -5
# ... continue for ~20 calls total
```

Then wait 5 minutes without running additional commands — this accumulates statusline refresh spawns.

### Step 4: Collect 4688 Events

After the workload + idle period, export the Security event log:

```powershell
# Via Event Viewer (GUI)
# Open Event Viewer → Windows Logs → Security
# Right-click → Filter Current Log
# Event ID: 4688
# Copy all matching events to a text file or CSV

# OR via command-line (generates XML)
wevtutil qe Security /q:"*[System[EventID=4688]]" /f:text > c:\temp\4688-events.txt

# OR via Get-WinEvent (PowerShell, most flexible)
Get-WinEvent -FilterHashtable @{LogName='Security';ID=4688} | Export-Csv -Path c:\temp\4688-events.csv -NoTypeInformation

# Prettified PowerShell (recommended)
Get-WinEvent -FilterHashtable @{LogName='Security';ID=4688} | Select-Object @(
  @{N='Time';E={$_.TimeCreated.ToString('HH:mm:ss.fff')}},
  @{N='ParentPID';E={$_.Properties[13].Value}},
  @{N='ParentProcessName';E={Split-Path -Leaf $_.Properties[5].Value}},
  @{N='ProcessName';E={Split-Path -Leaf $_.Properties[6].Value}},
  @{N='CommandLine';E={$_.Properties[8].Value}},
  @{N='TargetLogonID';E={$_.Properties[11].Value}}
) | Out-GridView
```

### Step 5: Analyze the Results

Filter for events with:
- **New Process Name** (field 6): matches `cmd.exe`, `bash.exe`, `conhost.exe`, or `node.exe`
- **Creator Process Name** (field 5): contains `claude.exe` (direct parent) or one of ruflo's node processes (grandparent chain)

**Example PowerShell filter:**

```powershell
$events = Get-WinEvent -FilterHashtable @{LogName='Security';ID=4688} | 
  Where-Object {
    $parentName = Split-Path -Leaf $_.Properties[5].Value
    $procName = Split-Path -Leaf $_.Properties[6].Value
    ($parentName -like '*claude*' -or $parentName -like '*node*') -and
    ($procName -like 'cmd.exe' -or $procName -like 'bash.exe' -or $procName -like 'conhost.exe' -or $procName -like 'node.exe')
  }

$events | Select-Object @(
  @{N='Time';E={$_.TimeCreated.ToString('HH:mm:ss.fff')}},
  @{N='Parent';E={Split-Path -Leaf $_.Properties[5].Value}},
  @{N='NewProcess';E={Split-Path -Leaf $_.Properties[6].Value}},
  @{N='CommandLine';E={$_.Properties[8].Value}}
) | Format-Table
```

---

## Baseline Expectations

### Current Behavior (before upstream fix, v3.29.0)

| Event | Expected Spawns per Baseline |
|-------|------------------------------|
| Per tool call (20 calls total) | 1–3 `cmd.exe` / `bash.exe` flashes |
| Per statusline refresh | ~1 spawn (statusline now caches for 300s, was 60s) |
| Idle 5-min accumulation | ~1 statusline spawn per 300s = ~1 total |
| **Total 4688 events for workload** | ~30–70 events (20–60 from tool calls + 1–10 from statusline) |

### Success Criteria (after upstream #70200 lands or workaround applied)

| Event | Target Spawns |
|-------|---------------|
| Per tool call | 0 flashes (or only hook initialization on SessionStart) |
| Per statusline refresh | 0 spawns (cached or daemon-based) |
| Idle 5-min accumulation | 0 spawns |
| **Total 4688 events for workload** | ~1–2 events maximum (only SessionStart process discovery) |

---

## Interpretation & Gotchas

### What to Look For

1. **`cmd.exe` / `conhost.exe` chains:** If you see:
   ```
   Parent: claude.exe → Child: cmd.exe → Grandchild: node.exe
   ```
   or
   ```
   Parent: node.exe (hook wrapper) → Child: bash.exe
   ```
   These are the flash sources. Count them.

2. **Hook wrapper spawns:** ruflo's own `.claude/helpers/hook-handler.cjs` runs as a Node process. Any `cmd.exe` spawned from a node.exe child of claude.exe is a candidate flash source (this is the hook wrapper). On v3.29.0+, these should have `windowsHide: true`, reducing visibility even if they still appear in 4688.

3. **Statusline spawns:** Similar pattern but originating from `.claude/helpers/statusline.cjs`. Look for:
   ```
   Parent: node.exe (statusline) → Child: bash.exe / cmd.exe
   ```

### Noise & False Positives

- **`\WindowsApps\` processes:** Windows Store Terminal and MSIX-repackaged apps show up as Store processes (PID paths like `C:\Program Files\WindowsApps\…`). Filter these out unless testing Store Terminal directly.
- **Background processes:** Windows itself may spawn processes during the test window. Filter to only events with `claude.exe` or `node.exe` ancestors.
- **Fast spawns:** If a process spawns and exits in < ~1 ms, Windows may not log it in 4688 (log is asynchronous). A "no 4688 seen" for a tool call doesn't completely rule out a flash. **Cross-check by watching the screen / recording a video** for visible flicker.
- **Scheduled tasks:** Some Windows updates or antivirus runs may spawn processes. Test during a quiet time to reduce noise.

### Verification Beyond 4688

4688 is the primary measurement tool, but it's not infallible:

1. **Visual confirmation:** Run the workload while recording your screen (e.g., with ShareX or OBS) and watch for visible console window flashes. Count them against 4688 logs.
2. **Task Manager:** Open Task Manager and sort by **Process creation time**. After running the workload, look for processes created in the time window. Correlate with 4688.

---

## Reporting Results

When you complete this audit, document:

1. **Environment:**
   - Windows version (10 or 11, build number)
   - Terminal used (Claude Desktop, Windows Terminal, cmd.exe)
   - Claude Code version
   - Ruflo version

2. **Measurements:**
   - Total 4688 events captured during workload
   - Breakdown by process type (`cmd.exe`, `bash.exe`, `node.exe`, etc.)
   - Events per tool call (average)
   - Events during idle 5-min (total)

3. **Comparison to baseline:**
   - Did you see fewer events than the baseline ~30–70 range?
   - Did visual flashing reduce or disappear?
   - Did the workaround (Windows Console Host) eliminate flashes?

4. **Open questions:**
   - Did any flashes remain after the upstream fix landed?
   - Were there flashes that did NOT appear in 4688 (suggesting sub-millisecond spawns)?

---

## Cross-References

- **Issue #2669:** Windows console flash tracking and workaround documentation
- **Upstream anthropics/claude-code#70200:** Root cause and upstream fix status
- **Upstream anthropics/claude-code#66540:** Deep analysis of flash behavior across multiple session types
- **Ruflo v3.29.0:** First version with `windowsHide: true` mitigation (commit c89a98a4f)
- **ADR (pending):** Architecture Decision Record for Windows subprocess handling (TODO: ADR number will be added once ADR is published)
- **Prior art:** clawd-on-desk#627 (same class of bug, cross-process PID-snapshot cache solution)

---

## TODO

- [ ] Link to ADR once published
- [ ] Update baseline expectations after upstream #70200 fix lands
- [ ] Publish aggregated results from community Windows audits (if collected)
