// executable-wrapper.js - Create local executable wrapper

export async function createLocalExecutable(workingDir) {
  try {
    if (Deno.build.os === 'windows') {
      // Create Windows batch file
      const wrapperScript = `@echo off
REM Claude-Flow local wrapper
REM This script ensures claude-flow runs from your project directory

set PROJECT_DIR=%CD%
set PWD=%PROJECT_DIR%
set CLAUDE_WORKING_DIR=%PROJECT_DIR%

REM Try to find claude-flow binary
REM Check common locations for npm/npx installations

REM 1. Local node_modules (npm install claude-flow)
if exist "%PROJECT_DIR%\\node_modules\\.bin\\claude-flow.cmd" (
  cd /d "%PROJECT_DIR%"
  "%PROJECT_DIR%\\node_modules\\.bin\\claude-flow.cmd" %*
  exit /b %ERRORLEVEL%
)

REM 2. Parent directory node_modules (monorepo setup)
if exist "%PROJECT_DIR%\\..\\node_modules\\.bin\\claude-flow.cmd" (
  cd /d "%PROJECT_DIR%"
  "%PROJECT_DIR%\\..\\node_modules\\.bin\\claude-flow.cmd" %*
  exit /b %ERRORLEVEL%
)

REM 3. Global installation (npm install -g claude-flow)
where claude-flow >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  cd /d "%PROJECT_DIR%"
  claude-flow %*
  exit /b %ERRORLEVEL%
)

REM 4. Fallback to npx (will download if needed)
cd /d "%PROJECT_DIR%"
npx claude-flow %*
`;

      // Write the Windows batch file
      await Deno.writeTextFile(`${workingDir}/claude-flow.cmd`, wrapperScript);
      console.log('  ✓ Created local claude-flow.cmd executable wrapper');
      console.log('    You can now use: claude-flow instead of npx claude-flow');
      
    } else {
      // Check if we're in development mode (claude-code-flow repo)
      const isDevelopment = workingDir.includes('claude-code-flow');
      const devBinPath = isDevelopment ? 
        workingDir.split('claude-code-flow')[0] + 'claude-code-flow/bin/claude-flow' : '';
      
      // Create Unix/Linux/Mac shell script
      const wrapperScript = `#!/usr/bin/env bash
# Claude-Flow local wrapper
# This script ensures claude-flow runs from your project directory

# Save the current directory
PROJECT_DIR="\${PWD}"

# Set environment to ensure correct working directory
export PWD="\${PROJECT_DIR}"
export CLAUDE_WORKING_DIR="\${PROJECT_DIR}"

# Try to find claude-flow binary
# Check common locations for npm/npx installations

${isDevelopment ? `# Development mode - use local bin
if [ -f "${devBinPath}" ]; then
  cd "\${PROJECT_DIR}"
  exec "${devBinPath}" "$@"
fi

` : ''}# 1. Local node_modules (npm install claude-flow)
if [ -f "\${PROJECT_DIR}/node_modules/.bin/claude-flow" ]; then
  cd "\${PROJECT_DIR}"
  exec "\${PROJECT_DIR}/node_modules/.bin/claude-flow" "$@"

# 2. Parent directory node_modules (monorepo setup)
elif [ -f "\${PROJECT_DIR}/../node_modules/.bin/claude-flow" ]; then
  cd "\${PROJECT_DIR}"
  exec "\${PROJECT_DIR}/../node_modules/.bin/claude-flow" "$@"

# 3. Global installation (npm install -g claude-flow)
elif command -v claude-flow &> /dev/null; then
  cd "\${PROJECT_DIR}"
  exec claude-flow "$@"

# 4. Fallback to npx (will download if needed)
else
  cd "\${PROJECT_DIR}"
  exec npx claude-flow@latest "$@"
fi
`;

      // Write the wrapper script
      await Deno.writeTextFile(`${workingDir}/claude-flow`, wrapperScript);
      
      // Make it executable
      await Deno.chmod(`${workingDir}/claude-flow`, 0o755);
      
      console.log('  ✓ Created local claude-flow executable wrapper');
      console.log('    You can now use: ./claude-flow instead of npx claude-flow');
    }
    
  } catch (err) {
    console.log(`  ⚠️  Could not create local executable: ${err.message}`);
  }
}