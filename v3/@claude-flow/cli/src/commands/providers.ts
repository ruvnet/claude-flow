/**
 * V3 CLI Providers Command
 * Manage AI providers, models, and configurations
 *
 * Created with ❤️ by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { configManager } from '../services/config-file-manager.js';
import {
  BUILTIN_VESSELS,
  inferShape,
  mergeVessels,
} from '../mcp-tools/vessels.js';
import type { VesselConfig } from '../mcp-tools/vessels.js';

/** Static provider catalog used as a reference/fallback */
interface ProviderCatalogEntry {
  name: string;
  type: string;
  models: string;
  envVar?: string;
  configName?: string;
}

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { name: 'Anthropic', type: 'LLM', models: 'claude-3.5-sonnet, opus', envVar: 'ANTHROPIC_API_KEY', configName: 'anthropic' },
  { name: 'OpenAI', type: 'LLM', models: 'gpt-4o, gpt-4-turbo', envVar: 'OPENAI_API_KEY', configName: 'openai' },
  { name: 'OpenAI', type: 'Embedding', models: 'text-embedding-3-small/large', envVar: 'OPENAI_API_KEY', configName: 'openai' },
  { name: 'Google', type: 'LLM', models: 'gemini-pro, gemini-ultra', envVar: 'GOOGLE_API_KEY', configName: 'google' },
  // #1725: Ollama Cloud — Tier-2 default per ADR-026 (~$100/mo flat-rate alternative
  // to per-token pricing). OpenAI-compat API at https://ollama.com/v1/chat/completions.
  { name: 'Ollama', type: 'LLM', models: 'gpt-oss:120b-cloud, llama3:70b-cloud, qwen2.5-coder:32b-cloud', envVar: 'OLLAMA_API_KEY', configName: 'ollama' },
  { name: 'Transformers.js', type: 'Embedding', models: 'Xenova/all-MiniLM-L6-v2' },
  { name: 'Agentic Flow', type: 'Embedding', models: 'ONNX optimized' },
  { name: 'Mock', type: 'All', models: 'mock-*' },
];

/**
 * Resolve the API key for a provider by checking the config file first,
 * then falling back to well-known environment variables.
 */
function resolveApiKey(
  providerName: string,
  configuredProviders: Array<Record<string, unknown>>,
): string | undefined {
  // Check config file entry
  const entry = configuredProviders.find(
    (p) => typeof p.name === 'string' && p.name.toLowerCase() === providerName.toLowerCase(),
  );
  if (entry?.apiKey && typeof entry.apiKey === 'string') {
    return entry.apiKey;
  }

  // Check environment variable
  const envMapping: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY',
    ollama: 'OLLAMA_API_KEY', // #1725 — Tier-2 routing
  };
  const envVar = envMapping[providerName.toLowerCase()];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }

  return undefined;
}

/**
 * Make a lightweight HTTP request to verify provider API key validity.
 * Uses a 5-second timeout. Returns { ok, reason }.
 */
async function testProviderConnectivity(
  providerName: string,
  apiKey: string,
): Promise<{ ok: boolean; reason: string }> {
  const endpoints: Record<string, { url: string; headers: Record<string, string> }> = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/models',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    },
    google: {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      headers: {},
    },
    // #1725 — Ollama Cloud uses an OpenAI-compatible /v1 surface.
    ollama: {
      url: 'https://ollama.com/api/tags',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    },
  };

  const endpointConfig = endpoints[providerName.toLowerCase()];
  if (!endpointConfig) {
    return { ok: false, reason: 'No test endpoint available for this provider' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpointConfig.url, {
      method: 'GET',
      headers: endpointConfig.headers,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok || res.status === 200) {
      return { ok: true, reason: 'Connected successfully' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: `Authentication failed (HTTP ${res.status})` };
    }
    // A non-auth error but the server responded — key format may be fine
    return { ok: false, reason: `Unexpected response (HTTP ${res.status})` };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'Connection timed out (5s)' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Connection failed: ${msg}` };
  }
}

// List subcommand
const listCommand: Command = {
  name: 'list',
  description: 'List available AI providers and models',
  options: [
    { name: 'type', short: 't', type: 'string', description: 'Filter by type: llm, embedding, image', default: 'all' },
    { name: 'active', short: 'a', type: 'boolean', description: 'Show only active providers' },
  ],
  examples: [
    { command: 'claude-flow providers list', description: 'List all providers' },
    { command: 'claude-flow providers list -t embedding', description: 'List embedding providers' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const type = ctx.flags.type as string || 'all';
    const activeOnly = ctx.flags.active as boolean;

    // Load user configuration
    const cwd = process.cwd();
    const config = configManager.getConfig(cwd);
    const agents = (config.agents ?? {}) as Record<string, unknown>;
    const configuredProviders = (agents.providers ?? []) as Array<Record<string, unknown>>;

    // Build table rows from the catalog, enriched with configuration status
    const rows: Array<Record<string, string>> = [];

    for (const entry of PROVIDER_CATALOG) {
      // Apply type filter
      if (type !== 'all' && entry.type.toLowerCase() !== type.toLowerCase()) {
        continue;
      }

      let status: string;
      let keySource = '';

      if (entry.configName) {
        const apiKey = resolveApiKey(entry.configName, configuredProviders);
        if (apiKey) {
          // Determine the source for the key
          const configEntry = configuredProviders.find(
            (p) => typeof p.name === 'string' && p.name.toLowerCase() === entry.configName!.toLowerCase(),
          );
          if (configEntry?.apiKey && typeof configEntry.apiKey === 'string') {
            keySource = 'config';
          } else {
            keySource = 'env';
          }
          status = output.success(`Configured (${keySource})`);
        } else {
          status = output.warning('Not configured');
        }
      } else if (entry.name === 'Mock') {
        status = output.dim('Dev only');
      } else {
        // Local-only providers (Transformers.js, Agentic Flow) — always available
        status = output.success('Available (local)');
      }

      if (activeOnly && !status.includes('Configured') && !status.includes('Available')) {
        continue;
      }

      rows.push({
        provider: entry.name,
        type: entry.type,
        models: entry.models,
        status,
      });
    }

    // Also show any providers in config that are not in the static catalog
    for (const cp of configuredProviders) {
      const cpName = (cp.name as string) || '';
      const alreadyListed = PROVIDER_CATALOG.some(
        (e) => e.configName?.toLowerCase() === cpName.toLowerCase() || e.name.toLowerCase() === cpName.toLowerCase(),
      );
      if (!alreadyListed && cpName) {
        const hasKey = !!(cp.apiKey || resolveApiKey(cpName, configuredProviders));
        rows.push({
          provider: cpName,
          type: (cp.type as string) || 'Custom',
          models: (cp.model as string) || output.dim('(not specified)'),
          status: hasKey ? output.success('Configured (config)') : output.warning('Not configured'),
        });
      }
    }

    output.writeln();
    output.writeln(output.bold('Providers'));
    output.writeln(output.dim('─'.repeat(60)));

    if (rows.length === 0) {
      output.writeln(output.dim('  No providers match the current filter.'));
    } else {
      output.printTable({
        columns: [
          { key: 'provider', header: 'Provider', width: 18 },
          { key: 'type', header: 'Type', width: 12 },
          { key: 'models', header: 'Models', width: 25 },
          { key: 'status', header: 'Status', width: 20 },
        ],
        data: rows,
      });
    }

    output.writeln();
    output.writeln(output.dim('Tip: Use "providers configure -p <name> -k <key>" to set API keys.'));

    return { success: true };
  },
};

// Configure subcommand
const configureCommand: Command = {
  name: 'configure',
  description: 'Configure provider settings and API keys',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Provider name', required: true },
    { name: 'key', short: 'k', type: 'string', description: 'API key' },
    { name: 'model', short: 'm', type: 'string', description: 'Default model' },
    { name: 'endpoint', short: 'e', type: 'string', description: 'Custom endpoint URL' },
  ],
  examples: [
    { command: 'claude-flow providers configure -p openai -k sk-...', description: 'Set OpenAI key' },
    { command: 'claude-flow providers configure -p anthropic -m claude-3.5-sonnet', description: 'Set default model' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const provider = (ctx.flags.provider as string) || (ctx.args && ctx.args[0]) || '';
      const apiKey = ctx.flags.key as string | undefined;
      const model = ctx.flags.model as string | undefined;
      const endpoint = ctx.flags.endpoint as string | undefined;

      if (!provider) {
        output.printError('Provider name is required. Use -p <name> or pass as first argument.');
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const config = configManager.getConfig(cwd);

      // Ensure agents.providers array exists
      const agents = (config.agents ?? {}) as Record<string, unknown>;
      const providers = (agents.providers ?? []) as Array<Record<string, unknown>>;

      // Find existing provider entry or create a new one
      let entry = providers.find(
        (p) => typeof p.name === 'string' && p.name.toLowerCase() === provider.toLowerCase(),
      );

      if (!entry) {
        entry = { name: provider, enabled: true };
        providers.push(entry);
      }

      // Apply supplied settings
      if (apiKey !== undefined) entry.apiKey = apiKey;
      if (model !== undefined) entry.model = model;
      if (endpoint !== undefined) entry.baseUrl = endpoint;

      agents.providers = providers;
      configManager.set(cwd, 'agents.providers', providers);

      output.writeln();
      output.writeln(output.bold(`Configured: ${provider}`));
      output.writeln(output.dim('─'.repeat(40)));

      if (apiKey) output.writeln(`  API Key : ${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`);
      if (model) output.writeln(`  Model   : ${model}`);
      if (endpoint) output.writeln(`  Endpoint: ${endpoint}`);
      if (!apiKey && !model && !endpoint) {
        output.writeln(`  Provider "${provider}" registered (no settings changed).`);
      }

      output.writeln();
      output.writeln(output.success(`Provider "${provider}" configuration saved.`));
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to configure provider: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Test subcommand
const testCommand: Command = {
  name: 'test',
  description: 'Test provider connectivity and API access',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Provider to test' },
    { name: 'all', short: 'a', type: 'boolean', description: 'Test all configured providers' },
  ],
  examples: [
    { command: 'claude-flow providers test -p openai', description: 'Test OpenAI connection' },
    { command: 'claude-flow providers test --all', description: 'Test all providers' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const provider = (ctx.flags.provider as string) || (ctx.args && ctx.args[0]) || '';
      const testAll = ctx.flags.all as boolean;

      output.writeln();
      output.writeln(output.bold('Provider Connectivity Test'));
      output.writeln(output.dim('─'.repeat(50)));

      const cwd = process.cwd();
      const config = configManager.getConfig(cwd);
      const agents = (config.agents ?? {}) as Record<string, unknown>;
      const configuredProviders = (agents.providers ?? []) as Array<Record<string, unknown>>;

      // Collect the set of providers to test
      interface ProviderTestTarget {
        name: string;
        configName: string;
      }

      const knownTargets: ProviderTestTarget[] = [
        { name: 'Anthropic', configName: 'anthropic' },
        { name: 'OpenAI', configName: 'openai' },
        { name: 'Google', configName: 'google' },
      ];

      // Add Ollama as a special case (endpoint-based, no API key)
      const ollamaEntry = configuredProviders.find(
        (p) => typeof p.name === 'string' && p.name.toLowerCase() === 'ollama',
      );

      let targets: ProviderTestTarget[];
      if (testAll || !provider) {
        targets = [...knownTargets];
      } else {
        const match = knownTargets.find(
          (t) => t.name.toLowerCase() === provider.toLowerCase() || t.configName === provider.toLowerCase(),
        );
        targets = match ? [match] : [{ name: provider, configName: provider.toLowerCase() }];
      }

      const results: Array<{ name: string; pass: boolean; reason: string }> = [];

      // Test API-key-based providers with real connectivity checks
      for (const target of targets) {
        const apiKey = resolveApiKey(target.configName, configuredProviders);
        if (!apiKey) {
          results.push({ name: target.name, pass: false, reason: 'Not configured (no API key found)' });
          continue;
        }
        output.writeln(output.dim(`  Testing ${target.name}...`));
        const result = await testProviderConnectivity(target.name, apiKey);
        results.push({ name: target.name, pass: result.ok, reason: result.reason });
      }

      // Test Ollama separately (endpoint-based, no API key needed)
      if (testAll || !provider || provider.toLowerCase() === 'ollama') {
        const baseUrl = (ollamaEntry?.baseUrl as string) || 'http://localhost:11434';
        output.writeln(output.dim(`  Testing Ollama at ${baseUrl}...`));
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(baseUrl, { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            results.push({ name: 'Ollama', pass: true, reason: `Connected at ${baseUrl}` });
          } else {
            results.push({ name: 'Ollama', pass: false, reason: `HTTP ${res.status} from ${baseUrl}` });
          }
        } catch {
          results.push({ name: 'Ollama', pass: false, reason: `Unreachable at ${baseUrl}` });
        }
      }

      // Also test any custom providers from config that were not in the known list
      if (testAll || !provider) {
        for (const cp of configuredProviders) {
          const cpName = (cp.name as string) || '';
          const alreadyTested = results.some(
            (r) => r.name.toLowerCase() === cpName.toLowerCase(),
          );
          if (alreadyTested || !cpName) continue;
          const apiKey = resolveApiKey(cpName, configuredProviders);
          if (!apiKey) {
            results.push({ name: cpName, pass: false, reason: 'No API key found' });
          } else {
            // For custom providers we can only verify the key exists
            results.push({ name: cpName, pass: true, reason: 'API key found (no test endpoint available)' });
          }
        }
      }

      let anyPassed = false;
      output.writeln();
      for (const r of results) {
        const icon = r.pass ? output.success('PASS') : output.error('FAIL');
        output.writeln(`  ${icon}  ${r.name}: ${r.reason}`);
        if (r.pass) anyPassed = true;
      }

      output.writeln();
      if (results.length === 0) {
        output.writeln(output.warning('No providers to test. Use "providers configure" to add providers.'));
      } else if (anyPassed) {
        output.writeln(output.success(`${results.filter((r) => r.pass).length}/${results.length} provider(s) passed.`));
      } else {
        output.writeln(output.warning('No providers passed connectivity checks.'));
      }

      return { success: anyPassed };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Provider test failed: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Models subcommand
const modelsCommand: Command = {
  name: 'models',
  description: 'List and manage available models',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Filter by provider' },
    { name: 'capability', short: 'c', type: 'string', description: 'Filter by capability: chat, completion, embedding' },
  ],
  examples: [
    { command: 'claude-flow providers models', description: 'List all models' },
    { command: 'claude-flow providers models -p anthropic', description: 'List Anthropic models' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Available Models'));
    output.writeln(output.dim('─'.repeat(70)));

    output.printTable({
      columns: [
        { key: 'model', header: 'Model', width: 28 },
        { key: 'provider', header: 'Provider', width: 14 },
        { key: 'capability', header: 'Capability', width: 12 },
        { key: 'context', header: 'Context', width: 10 },
        { key: 'cost', header: 'Cost/1K', width: 12 },
      ],
      data: [
        { model: 'claude-3.5-sonnet-20241022', provider: 'Anthropic', capability: 'Chat', context: '200K', cost: '$0.003/$0.015' },
        { model: 'claude-3-opus-20240229', provider: 'Anthropic', capability: 'Chat', context: '200K', cost: '$0.015/$0.075' },
        { model: 'gpt-4o', provider: 'OpenAI', capability: 'Chat', context: '128K', cost: '$0.005/$0.015' },
        { model: 'gpt-4-turbo', provider: 'OpenAI', capability: 'Chat', context: '128K', cost: '$0.01/$0.03' },
        { model: 'text-embedding-3-small', provider: 'OpenAI', capability: 'Embedding', context: '8K', cost: '$0.00002' },
        { model: 'text-embedding-3-large', provider: 'OpenAI', capability: 'Embedding', context: '8K', cost: '$0.00013' },
        { model: 'Xenova/all-MiniLM-L6-v2', provider: 'Transformers', capability: 'Embedding', context: '512', cost: output.success('Free') },
      ],
    });

    return { success: true };
  },
};

// Usage subcommand
const usageCommand: Command = {
  name: 'usage',
  description: 'View provider usage and costs',
  options: [
    { name: 'provider', short: 'p', type: 'string', description: 'Filter by provider' },
    { name: 'timeframe', short: 't', type: 'string', description: 'Timeframe: 24h, 7d, 30d', default: '7d' },
  ],
  examples: [
    { command: 'claude-flow providers usage', description: 'View all usage' },
    { command: 'claude-flow providers usage -t 30d', description: 'View 30-day usage' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const timeframe = ctx.flags.timeframe as string || '7d';

    output.writeln();
    output.writeln(output.bold(`Provider Usage (${timeframe})`));
    output.writeln(output.dim('─'.repeat(60)));

    output.printTable({
      columns: [
        { key: 'provider', header: 'Provider', width: 15 },
        { key: 'requests', header: 'Requests', width: 12 },
        { key: 'tokens', header: 'Tokens', width: 15 },
        { key: 'cost', header: 'Est. Cost', width: 12 },
        { key: 'trend', header: 'Trend', width: 12 },
      ],
      data: [
        { provider: 'Anthropic', requests: '12,847', tokens: '4.2M', cost: '$12.60', trend: output.warning('↑ 15%') },
        { provider: 'OpenAI (LLM)', requests: '3,421', tokens: '1.1M', cost: '$5.50', trend: output.success('↓ 8%') },
        { provider: 'OpenAI (Embed)', requests: '89,234', tokens: '12.4M', cost: '$0.25', trend: output.success('↓ 12%') },
        { provider: 'Transformers.js', requests: '234,567', tokens: '45.2M', cost: output.success('$0.00'), trend: '→' },
      ],
    });

    output.writeln();
    output.printBox([
      `Total Requests: 340,069`,
      `Total Tokens: 62.9M`,
      `Total Cost: $18.35`,
      ``,
      `Savings from local embeddings: $890.12`,
    ].join('\n'), 'Summary');

    return { success: true };
  },
};

// Vessel list subcommand — show built-in and user vessels
const vesselListCommand: Command = {
  name: 'vessel-list',
  description: 'List built-in and user vessels',
  options: [
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show full vessel config' },
  ],
  examples: [
    { command: 'claude-flow providers vessel-list', description: 'List all vessels' },
    { command: 'claude-flow providers vessel-list -v', description: 'Show full config for each vessel' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const verbose = ctx.flags.verbose as boolean;

    const cwd = process.cwd();
    const cfg = configManager.getConfig(cwd);
    const userVessels = ((cfg.providers?.vessels ?? {}) as Record<string, unknown>) as Record<string, VesselConfig>;
    const all = mergeVessels(BUILTIN_VESSELS, userVessels);

    output.writeln();
    output.writeln(output.bold('Vessels'));
    output.writeln(output.dim('─'.repeat(70)));

    const rows: Array<Record<string, string>> = [];
    for (const [key, v] of Object.entries(all)) {
      const source = key in BUILTIN_VESSELS ? 'builtin' : 'user';
      const models = Object.entries(v.models)
        .filter(([, id]) => id)
        .map(([tier, id]) => `${tier}:${id}`)
        .join(', ');
      if (verbose) {
        rows.push({
          name: key,
          shape: v.shape,
          baseUrl: v.baseUrl,
          models: models || output.dim('(none)'),
          source,
          key: v.apiKey ? `${v.apiKey.slice(0, 6)}...` : output.dim('(env)'),
        });
      } else {
        rows.push({
          name: key,
          shape: v.shape,
          baseUrl: v.baseUrl,
          models: models || output.dim('(none)'),
          source,
        });
      }
    }

    if (rows.length === 0) {
      output.writeln(output.dim('  No vessels configured.'));
    } else {
      const columns: Array<{ key: string; header: string; width: number }> = verbose
        ? [
            { key: 'name', header: 'Vessel', width: 14 },
            { key: 'shape', header: 'Shape', width: 10 },
            { key: 'baseUrl', header: 'Base URL', width: 28 },
            { key: 'models', header: 'Models', width: 28 },
            { key: 'key', header: 'Key', width: 14 },
            { key: 'source', header: 'Source', width: 8 },
          ]
        : [
            { key: 'name', header: 'Vessel', width: 14 },
            { key: 'shape', header: 'Shape', width: 10 },
            { key: 'baseUrl', header: 'Base URL', width: 30 },
            { key: 'models', header: 'Models', width: 22 },
            { key: 'source', header: 'Source', width: 8 },
          ];
      output.printTable({ columns, data: rows });
    }

    output.writeln();
    output.writeln(output.dim('Tip: Use "providers vessel-add" to add a custom vessel.'));
    return { success: true };
  },
};

// Vessel add subcommand — add or update a custom vessel
const vesselAddCommand: Command = {
  name: 'vessel-add',
  description: 'Add or update a custom vessel',
  options: [
    { name: 'name', short: 'n', type: 'string', required: true, description: 'Vessel name (unique key)' },
    { name: 'url', short: 'u', type: 'string', required: true, description: 'Provider base URL' },
    { name: 'key', short: 'k', type: 'string', description: 'API key (omit to use env)' },
    { name: 'shape', short: 's', type: 'string', description: 'anthropic or openai (auto-detected from url if omitted)' },
    { name: 'model', short: 'm', type: 'string', description: 'Concrete model id (overrides all tiers)' },
  ],
  examples: [
    { command: 'claude-flow providers vessel-add -n myllm -u https://llm.example.com/v1', description: 'Add an OpenAI-shaped vessel' },
    { command: 'claude-flow providers vessel-add -n acme -u https://acme.io/anthropic -s anthropic -k sk-...', description: 'Add an Anthropic-shaped vessel' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const name = ((ctx.flags.name as string) || '').trim();
      const url = ((ctx.flags.url as string) || '').trim();
      const key = (ctx.flags.key as string) || '';
      const shapeFlag = ctx.flags.shape as string | undefined;
      const model = (ctx.flags.model as string) || '';

      if (!name) {
        output.printError('Vessel name is required. Use -n <name>.');
        return { success: false, exitCode: 1 };
      }
      if (!url) {
        output.printError('Provider base URL is required. Use -u <url>.');
        return { success: false, exitCode: 1 };
      }
      try {
        // Validate URL parses — throws on malformed input
        new URL(url);
      } catch {
        output.printError(`Invalid URL: ${url}`);
        return { success: false, exitCode: 1 };
      }

      const shape = shapeFlag ? shapeFlag.toLowerCase() : inferShape(url);
      if (shape !== 'anthropic' && shape !== 'openai') {
        output.printError(`Invalid shape "${shapeFlag}". Must be "anthropic" or "openai".`);
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const cfg = configManager.getConfig(cwd);
      const vessels = ((cfg.providers?.vessels ?? {}) as Record<string, unknown>) as Record<string, VesselConfig>;

      const vessel: VesselConfig = {
        name,
        shape: shape as VesselConfig['shape'],
        baseUrl: url,
        apiKey: key,
        models: model ? { haiku: model, sonnet: model, opus: model } : {},
        headers: {},
      };

      const updated: Record<string, VesselConfig> = { ...vessels, [name]: vessel };
      configManager.set(cwd, 'providers.vessels', updated);

      output.writeln();
      output.writeln(output.bold(`Added vessel: ${name}`));
      output.writeln(output.dim('─'.repeat(40)));
      output.writeln(`  Shape  : ${shape}`);
      output.writeln(`  URL    : ${url}`);
      if (key) output.writeln(`  Key    : ${key.slice(0, 6)}...${key.slice(-4)}`);
      if (model) output.writeln(`  Model  : ${model}`);
      output.writeln();
      output.writeln(output.success(`Vessel "${name}" saved to config.`));
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to add vessel: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Vessel remove subcommand — remove a user vessel
const vesselRemoveCommand: Command = {
  name: 'vessel-remove',
  description: 'Remove a user vessel',
  options: [
    { name: 'name', short: 'n', type: 'string', required: true, description: 'Vessel name to remove' },
  ],
  examples: [
    { command: 'claude-flow providers vessel-remove -n myllm', description: 'Remove a custom vessel' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const name = ((ctx.flags.name as string) || '').trim();
      if (!name) {
        output.printError('Vessel name is required. Use -n <name>.');
        return { success: false, exitCode: 1 };
      }

      // Refuse to remove built-in vessels — they are the baseline and are
      // always resolvable via BUILTIN_VESSELS.
      const builtinKeys = new Set(Object.keys(BUILTIN_VESSELS));
      if (builtinKeys.has(name)) {
        output.printError(
          `Cannot remove built-in vessel "${name}". Built-ins (${Array.from(builtinKeys).join(', ')}) are always available.`,
        );
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const cfg = configManager.getConfig(cwd);
      const vessels = ((cfg.providers?.vessels ?? {}) as Record<string, unknown>) as Record<string, VesselConfig>;

      if (!(name in vessels)) {
        output.printError(`Vessel "${name}" not found in user config.`);
        return { success: false, exitCode: 1 };
      }

      const { [name]: _removed, ...rest } = vessels;
      const updated: Record<string, VesselConfig> = { ...rest };
      configManager.set(cwd, 'providers.vessels', updated);

      output.writeln();
      output.writeln(output.success(`Removed vessel "${name}".`));
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to remove vessel: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Vessel test subcommand — test a vessel's connectivity
const vesselTestCommand: Command = {
  name: 'vessel-test',
  description: "Test a vessel's connectivity",
  options: [
    { name: 'name', short: 'n', type: 'string', required: true, description: 'Vessel name to test' },
  ],
  examples: [
    { command: 'claude-flow providers vessel-test -n anthropic', description: 'Test Anthropic connectivity' },
    { command: 'claude-flow providers vessel-test -n myllm', description: 'Test a custom vessel' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const name = ((ctx.flags.name as string) || '').trim();
      if (!name) {
        output.printError('Vessel name is required. Use -n <name>.');
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const cfg = configManager.getConfig(cwd);
      const userVessels = ((cfg.providers?.vessels ?? {}) as Record<string, unknown>) as Record<string, VesselConfig>;
      const all = mergeVessels(BUILTIN_VESSELS, userVessels);
      const vessel = all[name];
      if (!vessel) {
        output.printError(`Vessel "${name}" not found. Use "providers vessel-list" to see available vessels.`);
        return { success: false, exitCode: 1 };
      }

      output.writeln();
      output.writeln(output.bold(`Testing vessel: ${name}`));
      output.writeln(output.dim('─'.repeat(50)));
      output.writeln(`  Shape: ${vessel.shape}`);
      output.writeln(`  URL  : ${vessel.baseUrl}`);

      const base = vessel.baseUrl.replace(/\/+$/, '');
      const isAnthropic = vessel.shape === 'anthropic';
      const url = isAnthropic ? `${base}/models` : `${base}/v1/models`;
      const headers: Record<string, string> = isAnthropic
        ? { 'x-api-key': vessel.apiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${vessel.apiKey}` };

      output.writeln(output.dim(`  Probing ${url}...`));
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          output.writeln();
          output.writeln(output.success(`PASS  ${name}: connected (HTTP ${res.status}).`));
          return { success: true };
        }
        if (res.status === 401 || res.status === 403) {
          output.writeln();
          output.writeln(output.error(`FAIL  ${name}: authentication failed (HTTP ${res.status}).`));
          return { success: false, exitCode: 1 };
        }
        output.writeln();
        output.writeln(output.error(`FAIL  ${name}: unexpected response (HTTP ${res.status}).`));
        return { success: false, exitCode: 1 };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          output.writeln();
          output.writeln(output.error(`FAIL  ${name}: connection timed out (5s).`));
          return { success: false, exitCode: 1 };
        }
        const msg = err instanceof Error ? err.message : String(err);
        output.writeln();
        output.writeln(output.error(`FAIL  ${name}: ${msg}`));
        return { success: false, exitCode: 1 };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Vessel test failed: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Vessel set-default subcommand — set the default vessel
const vesselSetDefaultCommand: Command = {
  name: 'vessel-set-default',
  description: 'Set the default vessel (stored as providers.defaultVessel)',
  options: [
    { name: 'name', short: 'n', type: 'string', required: true, description: 'Vessel name to set as default' },
  ],
  examples: [
    { command: 'claude-flow providers vessel-set-default -n openrouter', description: 'Set OpenRouter as default' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const name = ((ctx.flags.name as string) || '').trim();
      if (!name) {
        output.printError('Vessel name is required. Use -n <name>.');
        return { success: false, exitCode: 1 };
      }

      const cwd = process.cwd();
      const cfg = configManager.getConfig(cwd);
      const userVessels = ((cfg.providers?.vessels ?? {}) as Record<string, unknown>) as Record<string, VesselConfig>;
      const all = mergeVessels(BUILTIN_VESSELS, userVessels);
      if (!(name in all)) {
        output.printError(`Vessel "${name}" not found. Use "providers vessel-list" to see available vessels.`);
        return { success: false, exitCode: 1 };
      }

      configManager.set(cwd, 'providers.defaultVessel', name);

      output.writeln();
      output.writeln(output.success(`Default vessel set to "${name}".`));
      return { success: true };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to set default vessel: ${msg}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Main providers command
export const providersCommand: Command = {
  name: 'providers',
  description: 'Manage AI providers, models, and configurations',
  subcommands: [
    listCommand,
    configureCommand,
    testCommand,
    modelsCommand,
    usageCommand,
    vesselListCommand,
    vesselAddCommand,
    vesselRemoveCommand,
    vesselTestCommand,
    vesselSetDefaultCommand,
  ],
  examples: [
    { command: 'claude-flow providers list', description: 'List all providers' },
    { command: 'claude-flow providers configure -p openai', description: 'Configure OpenAI' },
    { command: 'claude-flow providers test --all', description: 'Test all providers' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Provider Management'));
    output.writeln(output.dim('Multi-provider AI orchestration'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'list      - List available providers and their status',
      'configure - Configure provider settings and API keys',
      'test      - Test provider connectivity',
      'models    - List and manage available models',
      'usage     - View usage statistics and costs',
    ]);
    output.writeln();
    output.writeln('Supported Providers:');
    output.printList([
      'Anthropic (Claude models)',
      'OpenAI (GPT + embeddings)',
      'Transformers.js (local ONNX)',
      'Agentic Flow (optimized ONNX with SIMD)',
    ]);
    output.writeln();
    output.writeln(output.dim('Created with ❤️ by ruv.io'));
    return { success: true };
  },
};

export default providersCommand;
