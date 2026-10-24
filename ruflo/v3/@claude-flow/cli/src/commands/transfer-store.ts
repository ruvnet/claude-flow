/**
 * V3 CLI Transfer Store Commands
 * Pattern marketplace - list, search, download, publish
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  createPatternStore,
  createDiscoveryService,
  createDownloader,
  createPublisher,
  searchPatterns,
  type SearchOptions,
} from '../transfer/index.js';

// Store list subcommand
export const storeListCommand: Command = {
  name: 'list',
  aliases: ['ls'],
  description: 'List patterns from decentralized registry',
  options: [
    { name: 'registry', short: 'r', type: 'string', description: 'Registry name (default: claude-flow-official)' },
    { name: 'category', short: 'c', type: 'string', description: 'Filter by category' },
    { name: 'featured', short: 'f', type: 'boolean', description: 'Show featured patterns' },
    { name: 'trending', short: 't', type: 'boolean', description: 'Show trending patterns' },
    { name: 'newest', short: 'n', type: 'boolean', description: 'Show newest patterns' },
    { name: 'limit', short: 'l', type: 'number', description: 'Maximum results', default: 20 },
  ],
  examples: [
    { command: 'claude-flow hooks transfer store list', description: 'List all patterns' },
    { command: 'claude-flow hooks transfer store list --category routing', description: 'List routing patterns' },
    { command: 'claude-flow hooks transfer store list --featured', description: 'List featured patterns' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const registryName = ctx.flags.registry as string;
    const category = ctx.flags.category as string;
    const featured = ctx.flags.featured as boolean;
    const trending = ctx.flags.trending as boolean;
    const newest = ctx.flags.newest as boolean;
    const limit = (ctx.flags.limit as number) || 20;

    const spinner = output.createSpinner({ text: 'Discovering registry...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createDiscoveryService();
      const result = await discovery.discoverRegistry(registryName);

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        output.printError(result.error || 'Unknown error');
        return { success: false, exitCode: 1 };
      }

      spinner.succeed(`Connected to ${result.source}`);

      // Get patterns based on flags
      let patterns = result.registry.patterns;
      let title = 'Available Patterns';

      if (featured) {
        patterns = result.registry.featured
          .map(id => patterns.find(p => p.id === id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined);
        title = 'Featured Patterns';
      } else if (trending) {
        patterns = result.registry.trending
          .map(id => patterns.find(p => p.id === id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined);
        title = 'Trending Patterns';
      } else if (newest) {
        patterns = result.registry.newest
          .map(id => patterns.find(p => p.id === id))
          .filter((p): p is NonNullable<typeof p> => p !== undefined);
        title = 'Newest Patterns';
      }

      if (category) {
        patterns = patterns.filter(p => p.categories.includes(category));
        title = `Patterns in "${category}"`;
      }

      patterns = patterns.slice(0, limit);

      output.writeln();
      output.writeln(output.bold(title));
      output.writeln(output.dim('─'.repeat(70)));

      if (patterns.length === 0) {
        output.writeln(output.dim('No patterns found'));
      } else {
        output.printTable({
          columns: [
            { key: 'name', header: 'Name', width: 25 },
            { key: 'version', header: 'Version', width: 10 },
            { key: 'downloads', header: 'Downloads', width: 12 },
            { key: 'rating', header: 'Rating', width: 10 },
            { key: 'verified', header: 'Status', width: 12 },
          ],
          data: patterns.map(p => ({
            name: p.displayName,
            version: p.version,
            downloads: p.downloads.toLocaleString(),
            rating: `${p.rating.toFixed(1)}/5`,
            verified: p.verified ? output.success('Verified') : output.dim('Community'),
          })),
        });
      }

      output.writeln();
      output.writeln(output.dim(`Registry: ${result.source} | Total: ${result.registry.totalPatterns} patterns`));

      return { success: true };
    } catch (error) {
      spinner.fail('Error listing patterns');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Store search subcommand
export const storeSearchCommand: Command = {
  name: 'search',
  description: 'Search patterns in the decentralized registry',
  options: [
    { name: 'query', short: 'q', type: 'string', description: 'Search query', required: true },
    { name: 'category', short: 'c', type: 'string', description: 'Filter by category' },
    { name: 'language', short: 'l', type: 'string', description: 'Filter by language' },
    { name: 'framework', short: 'f', type: 'string', description: 'Filter by framework' },
    { name: 'tags', short: 't', type: 'string', description: 'Filter by tags (comma-separated)' },
    { name: 'min-rating', type: 'number', description: 'Minimum rating (0-5)' },
    { name: 'verified', short: 'v', type: 'boolean', description: 'Only verified patterns' },
    { name: 'limit', type: 'number', description: 'Maximum results', default: 20 },
  ],
  examples: [
    { command: 'claude-flow hooks transfer store search -q "routing"', description: 'Search for routing patterns' },
    { command: 'claude-flow hooks transfer store search -q "react" --language typescript', description: 'Search with filters' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = (ctx.args[0] || ctx.flags.query) as string;

    if (!query) {
      output.printError('Search query is required. Use --query or -q flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Searching patterns...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createDiscoveryService();
      const result = await discovery.discoverRegistry();

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        return { success: false, exitCode: 1 };
      }

      const searchOptions: SearchOptions = {
        query,
        category: ctx.flags.category as string,
        language: ctx.flags.language as string,
        framework: ctx.flags.framework as string,
        tags: ctx.flags.tags ? (ctx.flags.tags as string).split(',') : undefined,
        minRating: ctx.flags.minRating as number,
        verified: ctx.flags.verified as boolean,
        limit: (ctx.flags.limit as number) || 20,
      };

      const searchResult = searchPatterns(result.registry, searchOptions);

      spinner.succeed(`Found ${searchResult.total} patterns`);

      output.writeln();
      output.writeln(output.bold(`Search Results for "${query}"`));
      output.writeln(output.dim('─'.repeat(70)));

      if (searchResult.patterns.length === 0) {
        output.writeln(output.dim('No patterns match your search'));
      } else {
        for (const pattern of searchResult.patterns) {
          output.writeln();
          output.writeln(`  ${output.bold(pattern.displayName)} ${output.dim(`v${pattern.version}`)}`);
          output.writeln(`  ${output.dim(pattern.description.slice(0, 70))}...`);
          output.writeln(`  ${output.dim('Tags:')} ${pattern.tags.slice(0, 5).join(', ')}`);
          output.writeln(`  ${output.dim('Rating:')} ${pattern.rating.toFixed(1)}/5 | ${output.dim('Downloads:')} ${pattern.downloads}`);
        }
      }

      output.writeln();
      output.writeln(output.dim(`Showing ${searchResult.patterns.length} of ${searchResult.total} results`));

      return { success: true, data: searchResult };
    } catch (error) {
      spinner.fail('Search failed');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Store download subcommand
export const storeDownloadCommand: Command = {
  name: 'download',
  aliases: ['get', 'install'],
  description: 'Download a pattern from the registry',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Pattern name or ID', required: true },
    { name: 'output', short: 'o', type: 'string', description: 'Output path' },
    { name: 'verify', short: 'v', type: 'boolean', description: 'Verify checksum', default: true },
    { name: 'import', short: 'i', type: 'boolean', description: 'Import after download' },
  ],
  examples: [
    { command: 'claude-flow hooks transfer store download -n seraphine-genesis', description: 'Download pattern' },
    { command: 'claude-flow hooks transfer store download -n seraphine-genesis --import', description: 'Download and import' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const patternName = (ctx.args[0] || ctx.flags.name) as string;

    if (!patternName) {
      output.printError('Pattern name is required. Use --name or -n flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Finding pattern...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createDiscoveryService();
      const result = await discovery.discoverRegistry();

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        return { success: false, exitCode: 1 };
      }

      // Find pattern by name or ID
      const pattern = result.registry.patterns.find(
        p => p.name === patternName || p.id === patternName || p.displayName === patternName
      );

      if (!pattern) {
        spinner.fail(`Pattern not found: ${patternName}`);
        return { success: false, exitCode: 1 };
      }

      spinner.setText(`Downloading ${pattern.displayName}...`);

      const downloader = createDownloader();
      const downloadResult = await downloader.downloadPattern(pattern, {
        output: ctx.flags.output as string,
        verify: ctx.flags.verify as boolean,
        import: ctx.flags.import as boolean,
      }, (progress) => {
        spinner.setText(`Downloading... ${progress.percentage}%`);
      });

      if (!downloadResult.success) {
        spinner.fail('Download failed');
        return { success: false, exitCode: 1 };
      }

      spinner.succeed(`Downloaded ${pattern.displayName}`);

      output.writeln();
      output.printBox([
        `Pattern: ${pattern.displayName}`,
        `Version: ${pattern.version}`,
        `Size: ${downloadResult.size.toLocaleString()} bytes`,
        `Verified: ${downloadResult.verified ? 'Yes' : 'No'}`,
        downloadResult.outputPath ? `Path: ${downloadResult.outputPath}` : '',
        downloadResult.imported ? 'Status: Imported' : '',
      ].filter(Boolean).join('\n'), 'Download Complete');

      return { success: true, data: downloadResult };
    } catch (error) {
      spinner.fail('Download failed');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Store publish subcommand
export const storePublishCommand: Command = {
  name: 'publish',
  aliases: ['contribute'],
  description: 'Publish a pattern to the decentralized registry',
  options: [
    { name: 'input', short: 'i', type: 'string', description: 'Input CFP file path', required: true },
    { name: 'name', short: 'n', type: 'string', description: 'Pattern name', required: true },
    { name: 'description', short: 'd', type: 'string', description: 'Pattern description', required: true },
    { name: 'categories', short: 'c', type: 'string', description: 'Categories (comma-separated)', required: true },
    { name: 'tags', short: 't', type: 'string', description: 'Tags (comma-separated)', required: true },
    { name: 'license', short: 'l', type: 'string', description: 'SPDX license', default: 'MIT' },
    { name: 'anonymize', short: 'a', type: 'string', description: 'Anonymization level', default: 'strict' },
    { name: 'language', type: 'string', description: 'Primary language' },
    { name: 'framework', type: 'string', description: 'Primary framework' },
  ],
  examples: [
    { command: 'claude-flow hooks transfer store publish -i patterns.cfp -n my-patterns -d "My patterns" -c routing -t custom', description: 'Publish pattern' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const inputPath = ctx.flags.input as string;
    const name = ctx.flags.name as string;
    const description = ctx.flags.description as string;

    if (!inputPath || !name || !description) {
      output.printError('Input path, name, and description are required.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Preparing pattern...', spinner: 'dots' });
    spinner.start();

    try {
      // Read and parse CFP file
      const fs = await import('fs');
      if (!fs.existsSync(inputPath)) {
        spinner.fail(`File not found: ${inputPath}`);
        return { success: false, exitCode: 1 };
      }

      const content = fs.readFileSync(inputPath, 'utf-8');
      const cfp = JSON.parse(content);

      spinner.setText('Publishing to IPFS...');

      const publisher = createPublisher();
      const result = await publisher.publishPattern(cfp, {
        name,
        displayName: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description,
        categories: (ctx.flags.categories as string).split(',').map(s => s.trim()),
        tags: (ctx.flags.tags as string).split(',').map(s => s.trim()),
        license: ctx.flags.license as string || 'MIT',
        anonymize: (ctx.flags.anonymize as 'minimal' | 'standard' | 'strict' | 'paranoid') || 'strict',
        language: ctx.flags.language as string,
        framework: ctx.flags.framework as string,
      });

      if (!result.success) {
        spinner.fail('Publish failed');
        output.printError(result.message);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Pattern published!');

      output.writeln();
      output.printBox([
        `Pattern ID: ${result.patternId}`,
        `CID: ${result.cid}`,
        `Gateway URL: ${result.gatewayUrl}`,
        ``,
        `Your pattern has been uploaded to IPFS.`,
        `Submit a contribution request to add it to the official registry.`,
      ].join('\n'), 'Publish Complete');

      return { success: true, data: result };
    } catch (error) {
      spinner.fail('Publish failed');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Store info subcommand
export const storeInfoCommand: Command = {
  name: 'info',
  description: 'Show detailed information about a pattern',
  options: [
    { name: 'name', short: 'n', type: 'string', description: 'Pattern name or ID', required: true },
  ],
  examples: [
    { command: 'claude-flow hooks transfer store info -n seraphine-genesis', description: 'Show pattern info' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const patternName = (ctx.args[0] || ctx.flags.name) as string;

    if (!patternName) {
      output.printError('Pattern name is required. Use --name or -n flag.');
      return { success: false, exitCode: 1 };
    }

    const spinner = output.createSpinner({ text: 'Fetching pattern info...', spinner: 'dots' });
    spinner.start();

    try {
      const discovery = createDiscoveryService();
      const result = await discovery.discoverRegistry();

      if (!result.success || !result.registry) {
        spinner.fail('Failed to discover registry');
        return { success: false, exitCode: 1 };
      }

      const pattern = result.registry.patterns.find(
        p => p.name === patternName || p.id === patternName || p.displayName === patternName
      );

      if (!pattern) {
        spinner.fail(`Pattern not found: ${patternName}`);
        return { success: false, exitCode: 1 };
      }

      spinner.succeed('Pattern found');

      output.writeln();
      output.printBox([
        `Name: ${pattern.displayName}`,
        `ID: ${pattern.id}`,
        `Version: ${pattern.version}`,
        ``,
        `Description:`,
        `  ${pattern.description}`,
        ``,
        `Author: ${pattern.author.displayName || pattern.author.id}`,
        `License: ${pattern.license}`,
        ``,
        `Categories: ${pattern.categories.join(', ')}`,
        `Tags: ${pattern.tags.join(', ')}`,
        ``,
        `Stats:`,
        `  Downloads: ${pattern.downloads.toLocaleString()}`,
        `  Rating: ${pattern.rating.toFixed(1)}/5 (${pattern.ratingCount} reviews)`,
        ``,
        `IPFS:`,
        `  CID: ${pattern.cid}`,
        `  Size: ${pattern.size.toLocaleString()} bytes`,
        `  Checksum: ${pattern.checksum.slice(0, 16)}...`,
        ``,
        `Trust: ${pattern.trustLevel}`,
        `Verified: ${pattern.verified ? 'Yes' : 'No'}`,
        `Min Version: ${pattern.minClaudeFlowVersion}`,
        ``,
        `Created: ${pattern.createdAt}`,
        `Updated: ${pattern.lastUpdated}`,
      ].join('\n'), 'Pattern Details');

      return { success: true, data: pattern };
    } catch (error) {
      spinner.fail('Error fetching pattern info');
      output.printError(String(error));
      return { success: false, exitCode: 1 };
    }
  },
};

// Main store command
export const storeCommand: Command = {
  name: 'store',
  description: 'Pattern marketplace - list, search, download, publish',
  subcommands: [
    storeListCommand,
    storeSearchCommand,
    storeDownloadCommand,
    storePublishCommand,
    storeInfoCommand,
  ],
  examples: [
    { command: 'claude-flow hooks transfer store list', description: 'List patterns' },
    { command: 'claude-flow hooks transfer store search -q "routing"', description: 'Search patterns' },
    { command: 'claude-flow hooks transfer store download -n seraphine-genesis', description: 'Download pattern' },
    { command: 'claude-flow hooks transfer store publish -i patterns.cfp ...', description: 'Publish pattern' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Claude Flow Pattern Store'));
    output.writeln(output.dim('Decentralized pattern marketplace via IPFS'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'list      - List patterns from registry',
      'search    - Search patterns',
      'download  - Download a pattern',
      'publish   - Publish a pattern',
      'info      - Show pattern details',
    ]);
    output.writeln();
    output.writeln('Example:');
    output.writeln(output.dim('  claude-flow hooks transfer store list --featured'));
    output.writeln(output.dim('  claude-flow hooks transfer store search -q "routing"'));
    output.writeln(output.dim('  claude-flow hooks transfer store download -n seraphine-genesis'));

    return { success: true };
  },
};

export default storeCommand;
