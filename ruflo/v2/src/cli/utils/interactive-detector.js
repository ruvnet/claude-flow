// interactive-detector.js - Detect and handle non-interactive environments

/**
 * Check if the current environment supports interactive TTY features
 */
export function isInteractive() {
  // Check if stdin is a TTY
  if (!process.stdin.isTTY) {
    return false;
  }

  // Check if stdout is a TTY
  if (!process.stdout.isTTY) {
    return false;
  }

  // Check for CI environment variables
  const ciVars = [
    'CI',
    'CONTINUOUS_INTEGRATION',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'JENKINS_URL',
    'TRAVIS',
    'CIRCLECI',
    'CODEBUILD_BUILD_ID',
    'BUILDKITE',
    'DRONE',
  ];

  for (const varName of ciVars) {
    if (process.env[varName]) {
      return false;
    }
  }

  // Check if running inside Docker (common indicator)
  if (process.env.DOCKER_CONTAINER || process.env.KUBERNETES_SERVICE_HOST) {
    return false;
  }

  // Check if running in non-interactive mode explicitly
  if (process.env.CLAUDE_FLOW_NON_INTERACTIVE === 'true') {
    return false;
  }

  return true;
}

/**
 * Check if raw mode is supported (for Ink UI components)
 */
export function isRawModeSupported() {
  return process.stdin.isTTY && process.stdin.setRawMode !== undefined;
}

/**
 * Get environment type for logging/debugging
 */
export function getEnvironmentType() {
  if (!process.stdin.isTTY) return 'non-tty-stdin';
  if (!process.stdout.isTTY) return 'non-tty-stdout';
  if (process.env.CI) return 'ci-environment';
  if (process.env.GITHUB_ACTIONS) return 'github-actions';
  if (process.env.DOCKER_CONTAINER) return 'docker';
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return 'wsl';
  if (process.platform === 'win32') return 'windows';
  if (process.env.TERM_PROGRAM === 'vscode') return 'vscode';
  if (!isRawModeSupported()) return 'no-raw-mode';
  return 'interactive';
}

/**
 * Wrap a command to handle non-interactive environments
 */
export function handleNonInteractive(commandName, interactiveFn, nonInteractiveFn) {
  return async (...args) => {
    if (isInteractive() && isRawModeSupported()) {
      // Run interactive version
      return interactiveFn(...args);
    } else {
      // Run non-interactive version or show helpful message
      if (nonInteractiveFn) {
        return nonInteractiveFn(...args);
      } else {
        console.error(`\n⚠️  ${commandName} requires an interactive terminal.`);
        console.error(`\nDetected environment: ${getEnvironmentType()}`);
        console.error('\nPossible solutions:');
        console.error('1. Run this command in an interactive terminal');
        console.error('2. Use environment variables for authentication:');
        console.error('   export ANTHROPIC_API_KEY="your-api-key"');
        console.error('3. Use --non-interactive flag with required parameters');
        console.error('4. If using Docker, run with: docker run -it');
        console.error('5. If using SSH, ensure pseudo-TTY allocation with: ssh -t');
        console.error(
          '\nFor more info: https://github.com/ruvnet/claude-code-flow/docs/non-interactive.md\n',
        );
        process.exit(1);
      }
    }
  };
}

/**
 * Show warning for commands that work better in interactive mode
 */
export function warnNonInteractive(commandName) {
  if (!isInteractive()) {
    console.warn(
      `\n⚠️  Running '${commandName}' in non-interactive mode (${getEnvironmentType()})`,
    );
    console.warn(
      'Some features may be limited. For full functionality, use an interactive terminal.\n',
    );
  }
}

/**
 * Check for required environment variables in non-interactive mode
 */
export function checkNonInteractiveAuth() {
  if (!isInteractive()) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      console.error('\n❌ Non-interactive mode requires API key to be set.');
      console.error('\nSet one of these environment variables:');
      console.error('  export ANTHROPIC_API_KEY="your-api-key"');
      console.error('  export CLAUDE_API_KEY="your-api-key"');
      console.error('\nOr run in an interactive terminal for login prompt.\n');
      return false;
    }
    return true;
  }
  return true;
}
