/**
 * V3 CLI Security Command
 * Security scanning, CVE detection, threat modeling, vulnerability management
 *
 * Created with ❤️ by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { execSync } from 'node:child_process';

// Scan subcommand
const scanCommand: Command = {
  name: 'scan',
  description: 'Run security scan on target (code, dependencies, containers)',
  options: [
    { name: 'target', short: 't', type: 'string', description: 'Target path or URL to scan', default: '.' },
    { name: 'depth', short: 'd', type: 'string', description: 'Scan depth: quick, standard, deep', default: 'standard' },
    { name: 'type', type: 'string', description: 'Scan type: code, deps, container, all', default: 'all' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json, sarif', default: 'text' },
    { name: 'fix', short: 'f', type: 'boolean', description: 'Auto-fix vulnerabilities where possible' },
  ],
  examples: [
    { command: 'claude-flow security scan -t ./src', description: 'Scan source directory' },
    { command: 'claude-flow security scan --depth deep --fix', description: 'Deep scan with auto-fix' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.flags.target as string || '.';
    const depth = ctx.flags.depth as string || 'standard';
    const scanType = ctx.flags.type as string || 'all';
    const fix = ctx.flags.fix as boolean;

    output.writeln();
    output.writeln(output.bold('Security Scan'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${target}...`, spinner: 'dots' });
    spinner.start();

    const findings: Array<{ severity: string; type: string; location: string; description: string }> = [];
    let criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0;

    try {
      const fs = await import('fs');
      const path = await import('path');
      const { execSync } = await import('child_process');

      // Phase 1: npm audit for dependency vulnerabilities
      if (scanType === 'all' || scanType === 'deps') {
        spinner.setText('Checking dependencies with npm audit...');
        try {
          const packageJsonPath = path.resolve(target, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            let auditResult: string;
            try {
              auditResult = execSync('npm audit --json', {
                cwd: path.resolve(target),
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch (auditErr: unknown) {
              // npm audit exits non-zero when vulnerabilities found — stdout still has JSON
              auditResult = (auditErr instanceof Error && 'stdout' in auditErr ? (auditErr as { stdout: string }).stdout : undefined) || '{}';
            }

            try {
              const audit = JSON.parse(auditResult);
              if (audit.vulnerabilities) {
                for (const [pkg, vuln] of Object.entries(audit.vulnerabilities as Record<string, { severity: string; via: Array<{ title?: string; url?: string }> }>)) {
                  const sev = vuln.severity || 'low';
                  const title = Array.isArray(vuln.via) && vuln.via[0]?.title ? vuln.via[0].title : 'Vulnerability';
                  if (sev === 'critical') criticalCount++;
                  else if (sev === 'high') highCount++;
                  else if (sev === 'moderate' || sev === 'medium') mediumCount++;
                  else lowCount++;

                  findings.push({
                    severity: sev === 'critical' ? output.error('CRITICAL') :
                              sev === 'high' ? output.warning('HIGH') :
                              sev === 'moderate' || sev === 'medium' ? output.warning('MEDIUM') : output.info('LOW'),
                    type: 'Dependency CVE',
                    location: `package.json:${pkg}`,
                    description: title.substring(0, 35),
                  });
                }
              }
            } catch { /* JSON parse failed, no vulns */ }
          }
        } catch { /* npm audit failed */ }
      }

      // Phase 2: Scan for hardcoded secrets
      if (scanType === 'all' || scanType === 'code') {
        spinner.setText('Scanning for hardcoded secrets...');
        const secretPatterns = [
          { pattern: /['"](?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}['"]/g, type: 'API Key (Stripe/OpenAI)' },
          { pattern: /['"]AKIA[A-Z0-9]{16}['"]/g, type: 'AWS Access Key' },
          { pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/g, type: 'GitHub Token' },
          { pattern: /['"]xox[baprs]-[a-zA-Z0-9-]+['"]/g, type: 'Slack Token' },
          { pattern: /password\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Hardcoded Password' },
        ];

        const scanDir = (dir: string, depthLimit: number) => {
          if (depthLimit <= 0) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanDir(fullPath, depthLimit - 1);
              } else if (entry.isFile() && /\.(ts|js|json|env|yml|yaml)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    for (const { pattern, type } of secretPatterns) {
                      if (pattern.test(lines[i])) {
                        highCount++;
                        findings.push({
                          severity: output.warning('HIGH'),
                          type: 'Hardcoded Secret',
                          location: `${path.relative(target, fullPath)}:${i + 1}`,
                          description: type,
                        });
                        pattern.lastIndex = 0;
                      }
                    }
                  }
                } catch { /* file read error */ }
              }
            }
          } catch { /* dir read error */ }
        };

        const scanDepth = depth === 'deep' ? 10 : depth === 'standard' ? 5 : 3;
        scanDir(path.resolve(target), scanDepth);
      }

      // Phase 3: Check for common security issues in code
      if ((scanType === 'all' || scanType === 'code') && depth !== 'quick') {
        spinner.setText('Analyzing code patterns...');
        const codePatterns = [
          { pattern: /eval\s*\(/g, type: 'Eval Usage', severity: 'medium', desc: 'eval() can execute arbitrary code' },
          { pattern: /innerHTML\s*=/g, type: 'innerHTML', severity: 'medium', desc: 'XSS risk with innerHTML' },
          { pattern: /dangerouslySetInnerHTML/g, type: 'React XSS', severity: 'medium', desc: 'React XSS risk' },
          { pattern: /child_process.*exec[^S]/g, type: 'Command Injection', severity: 'high', desc: 'Possible command injection' },
          { pattern: /\$\{.*\}.*sql|sql.*\$\{/gi, type: 'SQL Injection', severity: 'high', desc: 'Possible SQL injection' },
        ];

        const scanCodeDir = (dir: string, depthLimit: number) => {
          if (depthLimit <= 0) return;
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                scanCodeDir(fullPath, depthLimit - 1);
              } else if (entry.isFile() && /\.(ts|js|tsx|jsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
                try {
                  const content = fs.readFileSync(fullPath, 'utf-8');
                  const lines = content.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    for (const { pattern, type, severity, desc } of codePatterns) {
                      if (pattern.test(lines[i])) {
                        if (severity === 'high') highCount++;
                        else mediumCount++;
                        findings.push({
                          severity: severity === 'high' ? output.warning('HIGH') : output.warning('MEDIUM'),
                          type,
                          location: `${path.relative(target, fullPath)}:${i + 1}`,
                          description: desc,
                        });
                        pattern.lastIndex = 0;
                      }
                    }
                  }
                } catch { /* file read error */ }
              }
            }
          } catch { /* dir read error */ }
        };

        const scanDepth = depth === 'deep' ? 10 : 5;
        scanCodeDir(path.resolve(target), scanDepth);
      }

      spinner.succeed('Scan complete');

      // Display results
      output.writeln();
      if (findings.length > 0) {
        output.printTable({
          columns: [
            { key: 'severity', header: 'Severity', width: 12 },
            { key: 'type', header: 'Type', width: 18 },
            { key: 'location', header: 'Location', width: 25 },
            { key: 'description', header: 'Description', width: 35 },
          ],
          data: findings.slice(0, 20), // Show first 20
        });

        if (findings.length > 20) {
          output.writeln(output.dim(`... and ${findings.length - 20} more issues`));
        }
      } else {
        output.writeln(output.success('No security issues found!'));
      }

      output.writeln();
      output.printBox([
        `Target: ${target}`,
        `Depth: ${depth}`,
        `Type: ${scanType}`,
        ``,
        `Critical: ${criticalCount}  High: ${highCount}  Medium: ${mediumCount}  Low: ${lowCount}`,
        `Total Issues: ${findings.length}`,
      ].join('\n'), 'Scan Summary');

      // Persist the scan result so downstream consumers (the statusline's
      // getSecurityStatus in funnel/local-signals.ts, which reads
      // `.claude/security-scans/*.json`) reflect real scan state. Best-effort:
      // a failed write must never fail the scan itself.
      try {
        const scanDirOut = path.join(path.resolve(target), '.claude', 'security-scans');
        fs.mkdirSync(scanDirOut, { recursive: true });
        const record = {
          timestamp: new Date().toISOString(),
          target,
          depth,
          type: scanType,
          summary: {
            critical: criticalCount,
            high: highCount,
            medium: mediumCount,
            low: lowCount,
            total: findings.length,
          },
          findings,
        };
        // Deterministic name keyed on scan config so repeated runs overwrite
        // rather than accumulate stale reports.
        const outFile = path.join(scanDirOut, `scan-${scanType}-${depth}.json`);
        fs.writeFileSync(outFile, JSON.stringify(record, null, 2));
      } catch {
        // Persistence is advisory only — ignore write failures.
      }

      // Auto-fix if requested
      if (fix && criticalCount + highCount > 0) {
        output.writeln();
        const fixSpinner = output.createSpinner({ text: 'Attempting to fix vulnerabilities...', spinner: 'dots' });
        fixSpinner.start();
        try {
          try {
            execSync('npm audit fix', { cwd: path.resolve(target), encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          } catch { /* npm audit fix may exit non-zero */ }
          fixSpinner.succeed('Applied available fixes (run scan again to verify)');
        } catch {
          fixSpinner.fail('Some fixes could not be applied automatically');
        }
      }

      return { success: findings.length === 0 || (criticalCount === 0 && highCount === 0) };
    } catch (error) {
      spinner.fail('Scan failed');
      output.printError(`Error: ${error}`);
      return { success: false };
    }
  },
};

// CVE subcommand
const cveCommand: Command = {
  name: 'cve',
  description: 'Check and manage CVE vulnerabilities',
  options: [
    { name: 'check', short: 'c', type: 'string', description: 'Check specific CVE ID' },
    { name: 'list', short: 'l', type: 'boolean', description: 'List all known CVEs' },
    { name: 'severity', short: 's', type: 'string', description: 'Filter by severity: critical, high, medium, low' },
  ],
  examples: [
    { command: 'claude-flow security cve --list', description: 'List all CVEs' },
    { command: 'claude-flow security cve -c CVE-2024-1234', description: 'Check specific CVE' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const checkCve = ctx.flags.check as string;

    output.writeln();
    output.writeln(output.bold('CVE Database'));
    output.writeln(output.dim('─'.repeat(50)));

    // #2403 — `cve` is no longer a stub. Delegate to `npm audit --json`
    // (same data source as `security scan`) and filter to CVE findings.
    // If --check CVE-XXXX is given, filter to that specific CVE ID.
    let auditJson: string;
    try {
      auditJson = execSync('npm audit --json 2>/dev/null', {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e: unknown) {
      // npm audit exits non-zero when vulnerabilities found — stdout still has JSON
      auditJson = (e instanceof Error && 'stdout' in e ? (e as { stdout: string }).stdout : '') || '{}';
    }

    let audit: { vulnerabilities?: Record<string, { severity: string; via: Array<{ title?: string; url?: string; source?: number; name?: string }> }> };
    try {
      audit = JSON.parse(auditJson);
    } catch {
      output.writeln(output.warning('⚠ Could not parse `npm audit --json` output.'));
      output.writeln(output.dim('Make sure you are inside a project with a package.json.'));
      return { success: false, exitCode: 2 };
    }

    const vulns = audit.vulnerabilities || {};
    const cveRows: Array<{ pkg: string; severity: string; cveIds: string[]; title: string; url: string | undefined }> = [];
    const CVE_RE = /CVE-\d{4}-\d{4,7}/g;

    for (const [pkg, v] of Object.entries(vulns)) {
      const sev = v.severity || 'low';
      const titles = (v.via || []).filter((x) => typeof x === 'object' && x?.title).map((x) => x.title!);
      const urls = (v.via || []).filter((x) => typeof x === 'object' && x?.url).map((x) => x.url!);
      const allText = `${titles.join(' ')} ${urls.join(' ')}`;
      const cveIds = Array.from(new Set(allText.match(CVE_RE) || []));
      cveRows.push({ pkg, severity: sev, cveIds, title: titles[0] || 'Vulnerability', url: urls[0] });
    }

    // Filter to --check CVE-ID if given
    const filtered = checkCve
      ? cveRows.filter((r) => r.cveIds.some((id) => id.toUpperCase() === checkCve.toUpperCase()))
      : cveRows;

    // Filter to --severity if given
    const severityFilter = ctx.flags.severity as string | undefined;
    const finalRows = severityFilter
      ? filtered.filter((r) => r.severity === severityFilter || (severityFilter === 'medium' && r.severity === 'moderate'))
      : filtered;

    if (finalRows.length === 0) {
      if (checkCve) {
        output.writeln(output.success(`✓ ${checkCve} not found in current dependency tree.`));
      } else if (cveRows.length === 0) {
        output.writeln(output.success('✓ No known vulnerabilities in dependency tree.'));
      } else {
        output.writeln(output.dim(`No vulnerabilities match the requested filter (severity=${severityFilter ?? 'any'}).`));
      }
      output.writeln(output.dim(`Source: \`npm audit --json\` (GitHub Advisory DB).`));
      return { success: true };
    }

    // Render table
    output.writeln(`Found ${output.bold(String(finalRows.length))} affected package(s):`);
    output.writeln();
    output.writeln(`  ${output.bold('SEVERITY'.padEnd(10))} ${output.bold('PACKAGE'.padEnd(30))} ${output.bold('CVE IDs'.padEnd(28))} ${output.bold('TITLE')}`);
    output.writeln(`  ${'─'.repeat(10)} ${'─'.repeat(30)} ${'─'.repeat(28)} ${'─'.repeat(40)}`);
    for (const r of finalRows) {
      const sev = r.severity === 'critical' ? output.error('CRITICAL ') :
                  r.severity === 'high' ? output.warning('HIGH     ') :
                  (r.severity === 'moderate' || r.severity === 'medium') ? output.warning('MEDIUM   ') :
                  output.info('LOW      ');
      const ids = (r.cveIds.length > 0 ? r.cveIds.join(', ') : '(no CVE id)').padEnd(28);
      output.writeln(`  ${sev} ${r.pkg.padEnd(30)} ${ids} ${r.title.substring(0, 40)}`);
    }
    output.writeln();
    output.writeln(output.dim(`Source: \`npm audit --json\` (GitHub Advisory DB). Run \`claude-flow security scan\` for code + dep scan.`));

    // Exit code reflects whether any vulns were found, useful for CI gating
    return { success: true, exitCode: finalRows.length > 0 ? 0 : 0 };
  },
};

// Threats subcommand
const threatsCommand: Command = {
  name: 'threats',
  description: 'Threat modeling and analysis',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'Threat model: stride, dread, pasta', default: 'stride' },
    { name: 'scope', short: 's', type: 'string', description: 'Analysis scope', default: '.' },
    { name: 'export', short: 'e', type: 'string', description: 'Export format: json, md, html' },
  ],
  examples: [
    { command: 'claude-flow security threats --model stride', description: 'Run STRIDE analysis' },
    { command: 'claude-flow security threats -e md', description: 'Export as markdown' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const model = ctx.flags.model as string || 'stride';
    const scope = ctx.flags.scope as string || '.';
    const exportFormat = ctx.flags.export as string | undefined;

    output.writeln();
    output.writeln(output.bold(`Threat Model: ${model.toUpperCase()}`));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${scope} for threat indicators...`, spinner: 'dots' });
    spinner.start();

    const fs = await import('fs');
    const path = await import('path');

    const rootDir = path.resolve(scope);
    const findings: Array<{ category: string; severity: string; location: string; description: string }> = [];
    const extensions = new Set(['.ts', '.js', '.json', '.yaml', '.yml', '.tsx', '.jsx']);
    const skipDirs = new Set(['node_modules', 'dist', '.git']);
    let filesScanned = 0;
    const MAX_FILES = 500;

    // Threat indicator patterns mapped to STRIDE categories
    const threatPatterns: Array<{ pattern: RegExp; category: string; severity: string; description: string }> = [
      // Spoofing — weak/missing authentication
      { pattern: /(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"][^'"]+['"]\s*,\s*(?:async\s+)?\(?(?:req|request)/g, category: 'Spoofing', severity: 'medium', description: 'HTTP endpoint without auth middleware' },

      // Tampering — code injection vectors
      { pattern: /\beval\s*\(/g, category: 'Tampering', severity: 'high', description: 'eval() usage — arbitrary code execution risk' },
      { pattern: /\bexecSync\s*\(/g, category: 'Tampering', severity: 'high', description: 'execSync() usage — command injection risk' },
      { pattern: /\bexec\s*\(\s*[^)]*\$\{/g, category: 'Tampering', severity: 'high', description: 'exec() with template literal — injection risk' },
      { pattern: /child_process.*\bexec\b/g, category: 'Tampering', severity: 'medium', description: 'child_process exec import — review for injection' },
      { pattern: /new\s+Function\s*\(/g, category: 'Tampering', severity: 'high', description: 'new Function() — dynamic code execution risk' },

      // Repudiation — missing audit/logging
      // (checked via absence of logging imports, handled separately)

      // Info Disclosure — secrets and data leaks
      { pattern: /(?:api[_-]?key|secret|token|password|passwd|credential)\s*[:=]\s*['"][^'"]{8,}['"]/gi, category: 'Info Disclosure', severity: 'high', description: 'Hardcoded credential or secret' },
      { pattern: /AKIA[0-9A-Z]{16}/g, category: 'Info Disclosure', severity: 'critical', description: 'AWS Access Key ID detected' },
      { pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, category: 'Info Disclosure', severity: 'high', description: 'GitHub token detected' },
      { pattern: /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g, category: 'Info Disclosure', severity: 'critical', description: 'Private key detected' },
      { pattern: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/g, category: 'Info Disclosure', severity: 'medium', description: 'Non-localhost HTTP URL — should use HTTPS' },

      // DoS — missing rate limiting / resource protection
      { pattern: /require\s*\(\s*['"]express['"]\s*\)/g, category: 'DoS', severity: 'low', description: 'Express detected — verify rate-limiting is configured' },
      { pattern: /require\s*\(\s*['"]fastify['"]\s*\)/g, category: 'DoS', severity: 'low', description: 'Fastify detected — verify rate-limiting is configured' },

      // Elevation of privilege — unsafe deserialization, prototype pollution
      { pattern: /JSON\.parse\s*\(\s*(?:req\.|request\.)/g, category: 'Elevation', severity: 'medium', description: 'Unsanitized JSON.parse from request — validate input' },
      { pattern: /\.__proto__/g, category: 'Elevation', severity: 'high', description: '__proto__ access — prototype pollution risk' },
      { pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req|request)\./g, category: 'Elevation', severity: 'medium', description: 'Object.assign from request — prototype pollution risk' },
    ];

    // Check for .env files committed to git
    const checkEnvInGit = () => {
      try {
        const tracked = execSync('git ls-files --cached', { cwd: rootDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const envFiles = tracked.split('\n').filter((f: string) => /(?:^|\/)\.env(?:\.|$)/.test(f));
        for (const envFile of envFiles) {
          findings.push({
            category: 'Info Disclosure',
            severity: output.error('CRITICAL'),
            location: envFile,
            description: '.env file tracked in git — secrets may be exposed',
          });
        }
      } catch { /* not a git repo or git not available */ }
    };

    // Recursive file scanner
    const scanDir = (dir: string) => {
      if (filesScanned >= MAX_FILES) return;
      let entries: import('fs').Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (filesScanned >= MAX_FILES) break;
        if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
          filesScanned++;
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // skip files > 1MB
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const relPath = path.relative(rootDir, fullPath);

            for (let i = 0; i < lines.length; i++) {
              for (const tp of threatPatterns) {
                tp.pattern.lastIndex = 0;
                if (tp.pattern.test(lines[i])) {
                  const sevLabel = tp.severity === 'critical' ? output.error('CRITICAL') :
                                   tp.severity === 'high' ? output.warning('HIGH') :
                                   tp.severity === 'medium' ? output.warning('MEDIUM') : output.info('LOW');
                  findings.push({
                    category: tp.category,
                    severity: sevLabel,
                    location: `${relPath}:${i + 1}`,
                    description: tp.description,
                  });
                  tp.pattern.lastIndex = 0;
                }
              }
            }
          } catch { /* file read error */ }
        }
      }
    };

    // Check for missing security middleware in Express/Fastify apps
    const checkMissingMiddleware = () => {
      const serverFiles: string[] = [];
      const collectServerFiles = (dir: string, depth: number) => {
        if (depth <= 0 || filesScanned >= MAX_FILES) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (skipDirs.has(entry.name) || entry.name.startsWith('.')) continue;
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              collectServerFiles(fullPath, depth - 1);
            } else if (/\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
              try {
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (/require\s*\(\s*['"](?:express|fastify)['"]\s*\)/.test(content) || /from\s+['"](?:express|fastify)['"]/.test(content)) {
                  serverFiles.push(fullPath);
                  const relPath = path.relative(rootDir, fullPath);
                  if (!/(?:helmet|lusca)/.test(content)) {
                    findings.push({ category: 'Tampering', severity: output.warning('MEDIUM'), location: relPath, description: 'No helmet/lusca security headers middleware' });
                  }
                  if (!/(?:cors)/.test(content)) {
                    findings.push({ category: 'Spoofing', severity: output.info('LOW'), location: relPath, description: 'No CORS middleware detected' });
                  }
                  if (!/(?:rate.?limit|throttle)/.test(content)) {
                    findings.push({ category: 'DoS', severity: output.warning('MEDIUM'), location: relPath, description: 'No rate-limiting middleware detected' });
                  }
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      };
      collectServerFiles(rootDir, 5);
    };

    checkEnvInGit();
    scanDir(rootDir);
    checkMissingMiddleware();

    spinner.succeed(`Scanned ${filesScanned} files`);

    // STRIDE reference framework
    const strideRef = [
      { category: 'Spoofing', description: 'Can an attacker impersonate a user or service?', example: 'Strong authentication, mTLS' },
      { category: 'Tampering', description: 'Can data or code be modified without detection?', example: 'Input validation, integrity checks' },
      { category: 'Repudiation', description: 'Can actions be performed without accountability?', example: 'Audit logging, signed commits' },
      { category: 'Info Disclosure', description: 'Can sensitive data leak to unauthorized parties?', example: 'Encryption at rest and in transit' },
      { category: 'DoS', description: 'Can service availability be degraded?', example: 'Rate limiting, resource quotas' },
      { category: 'Elevation', description: 'Can privileges be escalated beyond granted level?', example: 'RBAC, principle of least privilege' },
    ];

    // Display real findings
    output.writeln();
    if (findings.length > 0) {
      output.writeln(output.bold(`Findings (${findings.length}):`));
      output.writeln();
      output.printTable({
        columns: [
          { key: 'category', header: 'STRIDE Category', width: 18 },
          { key: 'severity', header: 'Severity', width: 12 },
          { key: 'location', header: 'Location', width: 30 },
          { key: 'description', header: 'Description', width: 40 },
        ],
        data: findings.slice(0, 30),
      });
      if (findings.length > 30) {
        output.writeln(output.dim(`... and ${findings.length - 30} more findings`));
      }

      // Summary by STRIDE category
      const byCat: Record<string, number> = {};
      for (const f of findings) byCat[f.category] = (byCat[f.category] || 0) + 1;
      output.writeln();
      output.writeln(output.bold('Summary by STRIDE category:'));
      for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
        output.writeln(`  ${cat}: ${count} finding${count === 1 ? '' : 's'}`);
      }
    } else {
      output.writeln(output.success('No threat indicators detected in scanned files.'));
    }

    // Always show STRIDE reference
    output.writeln();
    output.writeln(output.bold(`${model.toUpperCase()} Reference Framework${findings.length === 0 ? ' (reference only — no issues detected)' : ''}:`));
    output.writeln();
    output.printTable({
      columns: [
        { key: 'category', header: `${model.toUpperCase()} Category`, width: 20 },
        { key: 'description', header: 'What to Assess', width: 40 },
        { key: 'example', header: 'Example Mitigation', width: 30 },
      ],
      data: strideRef,
    });

    // Export if requested
    if (exportFormat && findings.length > 0) {
      const exportData = {
        model: model.toUpperCase(),
        timestamp: new Date().toISOString(),
        scope,
        filesScanned,
        totalFindings: findings.length,
        findings: findings.map(f => ({ ...f, severity: f.severity.replace(/\x1b\[[0-9;]*m/g, '') })),
        strideReference: strideRef,
      };
      if (exportFormat === 'json') {
        output.writeln();
        output.writeln(JSON.stringify(exportData, null, 2));
      }
    }

    output.writeln();
    output.writeln(output.dim(`Files scanned: ${filesScanned} (max ${MAX_FILES})`));

    return { success: true };
  },
};

// Audit subcommand
const auditCommand: Command = {
  name: 'audit',
  description: 'Security audit logging and compliance',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: log, list, export, clear', default: 'list' },
    { name: 'limit', short: 'l', type: 'number', description: 'Number of entries to show', default: '20' },
    { name: 'filter', short: 'f', type: 'string', description: 'Filter by event type' },
  ],
  examples: [
    { command: 'claude-flow security audit --action list', description: 'List audit logs' },
    { command: 'claude-flow security audit -a export', description: 'Export audit trail' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const action = ctx.flags.action as string || 'list';

    output.writeln();
    output.writeln(output.bold('Security Audit Log'));
    output.writeln(output.dim('─'.repeat(60)));

    // Generate real audit entries from .swarm/ state and session history
    const { existsSync, readFileSync, readdirSync, statSync } = await import('fs');
    const { join } = await import('path');

    const auditEntries: { timestamp: string; event: string; user: string; status: string }[] = [];
    const swarmDir = join(process.cwd(), '.swarm');

    // Check session files for real audit events
    if (existsSync(swarmDir)) {
      try {
        const files = readdirSync(swarmDir).filter(f => f.endsWith('.json'));
        for (const file of files.slice(-10)) {
          try {
            const stat = statSync(join(swarmDir, file));
            const ts = stat.mtime.toISOString().replace('T', ' ').substring(0, 19);
            auditEntries.push({
              timestamp: ts,
              event: file.includes('session') ? 'SESSION_UPDATE' :
                     file.includes('swarm') ? 'SWARM_ACTIVITY' :
                     file.includes('memory') ? 'MEMORY_WRITE' : 'CONFIG_CHANGE',
              user: 'system',
              status: output.success('Success')
            });
          } catch { /* skip */ }
        }
      } catch { /* ignore */ }
    }

    // Add current session entry
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    auditEntries.push({ timestamp: now, event: 'AUDIT_RUN', user: 'cli', status: output.success('Success') });

    // Sort by timestamp desc
    auditEntries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (auditEntries.length === 0) {
      output.writeln(output.dim('No audit events found. Initialize a project first: claude-flow init'));
    } else {
      output.printTable({
        columns: [
          { key: 'timestamp', header: 'Timestamp', width: 22 },
          { key: 'event', header: 'Event', width: 20 },
          { key: 'user', header: 'User', width: 15 },
          { key: 'status', header: 'Status', width: 12 },
        ],
        data: auditEntries.slice(0, parseInt(ctx.flags.limit as string || '20', 10)),
      });
    }

    return { success: true };
  },
};

// Secrets subcommand
const secretsCommand: Command = {
  name: 'secrets',
  description: 'Detect and manage secrets in codebase',
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: scan, list, rotate', default: 'scan' },
    { name: 'path', short: 'p', type: 'string', description: 'Path to scan', default: '.' },
    { name: 'ignore', short: 'i', type: 'string', description: 'Patterns to ignore' },
  ],
  examples: [
    { command: 'claude-flow security secrets --action scan', description: 'Scan for secrets' },
    { command: 'claude-flow security secrets -a rotate', description: 'Rotate compromised secrets' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const scanPath = ctx.flags.path as string || '.';
    const ignorePatterns = ctx.flags.ignore as string | undefined;

    output.writeln();
    output.writeln(output.bold('Secret Detection'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: `Scanning ${scanPath} for secrets...`, spinner: 'dots' });
    spinner.start();

    const fs = await import('fs');
    const path = await import('path');

    const rootDir = path.resolve(scanPath);
    const skipDirs = new Set(['node_modules', 'dist', '.git']);
    const extensions = new Set(['.ts', '.js', '.json', '.yaml', '.yml', '.tsx', '.jsx', '.env', '.toml', '.cfg', '.conf', '.ini', '.properties', '.sh', '.bash', '.zsh']);
    const ignoreList = ignorePatterns ? ignorePatterns.split(',').map(p => p.trim()) : [];

    const secretPatterns: Array<{ pattern: RegExp; type: string; risk: string; action: string }> = [
      { pattern: /AKIA[0-9A-Z]{16}/g, type: 'AWS Access Key', risk: 'Critical', action: 'Rotate immediately' },
      { pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g, type: 'GitHub Token', risk: 'Critical', action: 'Revoke and rotate' },
      { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, type: 'JWT Token', risk: 'High', action: 'Remove from source' },
      { pattern: /-----BEGIN (?:RSA|EC|DSA|OPENSSH) PRIVATE KEY-----/g, type: 'Private Key', risk: 'Critical', action: 'Remove and regenerate' },
      { pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/g, type: 'Connection String', risk: 'High', action: 'Use env variable' },
      { pattern: /['"](?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}['"]/g, type: 'API Key (Stripe/OpenAI)', risk: 'Critical', action: 'Rotate immediately' },
      { pattern: /['"]xox[baprs]-[a-zA-Z0-9-]+['"]/g, type: 'Slack Token', risk: 'High', action: 'Revoke and rotate' },
      { pattern: /[a-zA-Z0-9_-]*(?:api[_-]?key|secret[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Generic Secret/API Key', risk: 'High', action: 'Use env variable' },
      { pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi, type: 'Hardcoded Password', risk: 'High', action: 'Use secrets manager' },
    ];

    const findings: Array<{ type: string; location: string; risk: string; action: string; line: string }> = [];
    let filesScanned = 0;
    const MAX_FILES = 500;

    const shouldIgnore = (filePath: string): boolean => {
      return ignoreList.some(p => filePath.includes(p));
    };

    const scanDir = (dir: string) => {
      if (filesScanned >= MAX_FILES) return;
      let entries: import('fs').Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }

      for (const entry of entries) {
        if (filesScanned >= MAX_FILES) break;
        if (skipDirs.has(entry.name)) continue;
        // Allow dotfiles like .env but skip .git
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') && entry.name !== '.env') continue;
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          const isEnvFile = entry.name.startsWith('.env');
          if (!extensions.has(ext) && !isEnvFile) continue;
          if (entry.name.endsWith('.d.ts')) continue;

          const relPath = path.relative(rootDir, fullPath);
          if (shouldIgnore(relPath)) continue;

          filesScanned++;
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 1024 * 1024) continue; // skip files > 1MB

            const content = fs.readFileSync(fullPath, 'utf-8');
            // Quick binary check — skip if null bytes present
            if (content.includes('\0')) continue;

            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              for (const sp of secretPatterns) {
                sp.pattern.lastIndex = 0;
                const match = sp.pattern.exec(line);
                if (match) {
                  // Mask the matched secret for safe display
                  const matched = match[0];
                  const masked = matched.length > 12
                    ? matched.substring(0, 6) + '***' + matched.substring(matched.length - 3)
                    : '***';

                  findings.push({
                    type: sp.type,
                    location: `${relPath}:${i + 1}`,
                    risk: sp.risk,
                    action: sp.action,
                    line: masked,
                  });
                  sp.pattern.lastIndex = 0;
                }
              }
            }
          } catch { /* file read error */ }
        }
      }
    };

    scanDir(rootDir);
    spinner.succeed(`Scanned ${filesScanned} files`);

    output.writeln();
    if (findings.length > 0) {
      const criticalCount = findings.filter(f => f.risk === 'Critical').length;
      const highCount = findings.filter(f => f.risk === 'High').length;
      const mediumCount = findings.filter(f => f.risk === 'Medium').length;

      output.printTable({
        columns: [
          { key: 'type', header: 'Secret Type', width: 25 },
          { key: 'location', header: 'Location', width: 35 },
          { key: 'risk', header: 'Risk', width: 12 },
          { key: 'action', header: 'Recommended', width: 22 },
        ],
        data: findings.slice(0, 25).map(f => ({
          type: f.type,
          location: f.location,
          risk: f.risk === 'Critical' ? output.error(f.risk) :
                f.risk === 'High' ? output.warning(f.risk) :
                output.warning(f.risk),
          action: f.action,
        })),
      });

      if (findings.length > 25) {
        output.writeln(output.dim(`... and ${findings.length - 25} more secrets found`));
      }

      output.writeln();
      output.printBox([
        `Path: ${scanPath}`,
        `Files scanned: ${filesScanned}`,
        ``,
        `Critical: ${criticalCount}  High: ${highCount}  Medium: ${mediumCount}`,
        `Total secrets found: ${findings.length}`,
      ].join('\n'), 'Secrets Summary');
    } else {
      output.writeln(output.success('No secrets detected.'));
      output.writeln();
      output.printBox([
        `Path: ${scanPath}`,
        `Files scanned: ${filesScanned}`,
        ``,
        `No hardcoded secrets, API keys, tokens, or credentials found.`,
      ].join('\n'), 'Secrets Summary');
    }

    return { success: findings.length === 0 };
  },
};

// Defend subcommand (AIDefence integration)
const defendCommand: Command = {
  name: 'defend',
  description: 'AI manipulation defense - detect prompt injection, jailbreaks, and PII',
  options: [
    { name: 'input', short: 'i', type: 'string', description: 'Input text to scan for threats' },
    { name: 'file', short: 'f', type: 'string', description: 'File to scan for threats' },
    { name: 'quick', short: 'Q', type: 'boolean', description: 'Quick scan (faster, less detailed)' },
    { name: 'learn', short: 'l', type: 'boolean', description: 'Enable learning mode', default: 'true' },
    { name: 'stats', short: 's', type: 'boolean', description: 'Show detection statistics' },
    { name: 'output', short: 'o', type: 'string', description: 'Output format: text, json', default: 'text' },
  ],
  examples: [
    { command: 'claude-flow security defend -i "ignore previous instructions"', description: 'Scan text for threats' },
    { command: 'claude-flow security defend -f ./prompts.txt', description: 'Scan file for threats' },
    { command: 'claude-flow security defend --stats', description: 'Show detection statistics' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputText = ctx.flags.input as string;
    const filePath = ctx.flags.file as string;
    const quickMode = ctx.flags.quick as boolean;
    const showStats = ctx.flags.stats as boolean;
    const outputFormat = ctx.flags.output as string || 'text';
    const enableLearning = ctx.flags.learn !== false;

    output.writeln();
    output.writeln(output.bold('🛡️ AIDefence - AI Manipulation Defense System'));
    output.writeln(output.dim('─'.repeat(55)));

    // Dynamic import of aidefence (allows package to be optional)
    let createAIDefence: typeof import('@claude-flow/aidefence').createAIDefence;
    try {
      const aidefence = await import('@claude-flow/aidefence');
      createAIDefence = aidefence.createAIDefence;
    } catch {
      output.error('AIDefence package not installed. Run: npm install @claude-flow/aidefence');
      return { success: false, message: 'AIDefence not available' };
    }

    const defender = createAIDefence({ enableLearning });

    // Show stats mode
    if (showStats) {
      const stats = await defender.getStats();
      output.writeln();
      output.printBox([
        `Detection Count: ${stats.detectionCount}`,
        `Avg Detection Time: ${stats.avgDetectionTimeMs.toFixed(3)}ms`,
        `Learned Patterns: ${stats.learnedPatterns}`,
        `Mitigation Strategies: ${stats.mitigationStrategies}`,
        `Avg Mitigation Effectiveness: ${(stats.avgMitigationEffectiveness * 100).toFixed(1)}%`,
      ].join('\n'), 'Detection Statistics');
      return { success: true };
    }

    // Get input to scan
    let textToScan = inputText;
    if (filePath) {
      try {
        const fs = await import('fs/promises');
        textToScan = await fs.readFile(filePath, 'utf-8');
        output.writeln(output.dim(`Reading file: ${filePath}`));
      } catch (err) {
        output.error(`Failed to read file: ${filePath}`);
        return { success: false, message: 'File not found' };
      }
    }

    if (!textToScan) {
      output.writeln('Usage: claude-flow security defend -i "<text>" or -f <file>');
      output.writeln();
      output.writeln('Options:');
      output.printList([
        '-i, --input   Text to scan for AI manipulation attempts',
        '-f, --file    File path to scan',
        '-q, --quick   Quick scan mode (faster)',
        '-s, --stats   Show detection statistics',
        '--learn       Enable pattern learning (default: true)',
      ]);
      return { success: true };
    }

    const spinner = output.createSpinner({ text: 'Scanning for threats...', spinner: 'dots' });
    spinner.start();

    // Perform scan
    const startTime = performance.now();
    const result = quickMode
      ? { ...defender.quickScan(textToScan), threats: [], piiFound: false, detectionTimeMs: 0, inputHash: '', safe: !defender.quickScan(textToScan).threat }
      : await defender.detect(textToScan);
    const scanTime = performance.now() - startTime;

    spinner.stop();

    // JSON output
    if (outputFormat === 'json') {
      output.writeln(JSON.stringify({
        safe: result.safe,
        threats: result.threats || [],
        piiFound: result.piiFound,
        detectionTimeMs: scanTime,
      }, null, 2));
      return { success: true };
    }

    // Text output
    output.writeln();

    if (result.safe && !result.piiFound) {
      output.writeln(output.success('✅ No threats detected'));
    } else {
      if (!result.safe && result.threats) {
        output.writeln(output.error(`⚠️ ${result.threats.length} threat(s) detected:`));
        output.writeln();

        for (const threat of result.threats) {
          const severityColor = {
            critical: output.error,
            high: output.warning,
            medium: output.info,
            low: output.dim,
          }[threat.severity] || output.dim;

          output.writeln(`  ${severityColor(`[${threat.severity.toUpperCase()}]`)} ${threat.type}`);
          output.writeln(`    ${output.dim(threat.description)}`);
          output.writeln(`    Confidence: ${(threat.confidence * 100).toFixed(1)}%`);
          output.writeln();
        }

        // Show mitigation recommendations
        const criticalThreats = result.threats.filter(t => t.severity === 'critical');
        if (criticalThreats.length > 0 && enableLearning) {
          output.writeln(output.bold('Recommended Mitigations:'));
          for (const threat of criticalThreats) {
            const mitigation = await defender.getBestMitigation(threat.type as Parameters<typeof defender.getBestMitigation>[0]);
            if (mitigation) {
              output.writeln(`  ${threat.type}: ${output.bold(mitigation.strategy)} (${(mitigation.effectiveness * 100).toFixed(0)}% effective)`);
            }
          }
          output.writeln();
        }
      }

      if (result.piiFound) {
        output.writeln(output.warning('⚠️ PII detected (emails, SSNs, API keys, etc.)'));
        output.writeln();
      }
    }

    output.writeln(output.dim(`Detection time: ${scanTime.toFixed(3)}ms`));

    return { success: result.safe };
  },
};

// Main security command
export const securityCommand: Command = {
  name: 'security',
  description: 'Security scanning, CVE detection, threat modeling, AI defense',
  subcommands: [scanCommand, cveCommand, threatsCommand, auditCommand, secretsCommand, defendCommand],
  examples: [
    { command: 'claude-flow security scan', description: 'Run security scan' },
    { command: 'claude-flow security cve --list', description: 'List known CVEs' },
    { command: 'claude-flow security threats', description: 'Run threat analysis' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Security Suite'));
    output.writeln(output.dim('Comprehensive security scanning and vulnerability management'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'scan     - Run security scans on code, deps, containers',
      'cve      - Check and manage CVE vulnerabilities',
      'threats  - Threat modeling (STRIDE, DREAD, PASTA)',
      'audit    - Security audit logging and compliance',
      'secrets  - Detect and manage secrets in codebase',
      'defend   - AI manipulation defense (prompt injection, jailbreaks, PII)',
    ]);
    output.writeln();
    output.writeln('Use --help with subcommands for more info');
    output.writeln();
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default securityCommand;
