#!/usr/bin/env npx tsx
/**
 * Standalone Plugin Store Test
 * Run this in any environment to verify the IPFS-based plugin store works
 *
 * Usage:
 *   npx tsx standalone-test.ts
 *   # or
 *   npm run test:plugin-store
 */

import {
  createPluginDiscoveryService,
  searchPlugins,
  getFeaturedPlugins,
  getOfficialPlugins,
  getTrendingPlugins,
  getPluginSearchSuggestions,
  getPluginTagCloud,
  findSimilarPlugins,
} from '../store/index.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CLAUDE FLOW V3 - STANDALONE PLUGIN STORE TEST               ║');
  console.log('║  IPFS-Based Decentralized Plugin Marketplace                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  // Test 1: Discovery Service Creation
  console.log('▶ Test 1: Create Discovery Service');
  try {
    const discovery = createPluginDiscoveryService();
    const registries = discovery.listRegistries();
    console.log(`  ✅ Created service with ${registries.length} bootstrap registries`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 2: Discover Registry
  console.log('▶ Test 2: Discover Registry via IPNS');
  let registry: any = null;
  try {
    const discovery = createPluginDiscoveryService();
    const result = await discovery.discoverRegistry();
    if (result.success && result.registry) {
      registry = result.registry;
      console.log(`  ✅ Discovered ${result.registry.plugins.length} plugins from ${result.source}`);
      passed++;
    } else {
      throw new Error(result.error || 'No registry');
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  if (!registry) {
    console.log('\n❌ Cannot continue without registry\n');
    process.exit(1);
  }

  // Test 3: Search Plugins
  console.log('▶ Test 3: Search for "plugin creator"');
  try {
    const results = searchPlugins(registry, { query: 'plugin creator' });
    const found = results.plugins.find(p => p.id === 'plugin-creator');
    if (found) {
      console.log(`  ✅ Found Plugin Creator Pro v${found.version}`);
      passed++;
    } else {
      throw new Error('Plugin Creator not found in search results');
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 4: Get Official Plugins
  console.log('▶ Test 4: Get Official Plugins');
  try {
    const official = getOfficialPlugins(registry);
    console.log(`  ✅ Found ${official.length} official plugins:`);
    official.forEach(p => console.log(`     - ${p.displayName} (${p.id})`));
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 5: Get Featured Plugins
  console.log('▶ Test 5: Get Featured Plugins');
  try {
    const featured = getFeaturedPlugins(registry);
    const hasPluginCreator = featured.some(p => p.id === 'plugin-creator');
    console.log(`  ✅ Found ${featured.length} featured plugins (Plugin Creator featured: ${hasPluginCreator})`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 6: Search with Filters
  console.log('▶ Test 6: Search with Filters (verified only)');
  try {
    const results = searchPlugins(registry, { verified: true });
    console.log(`  ✅ Found ${results.plugins.length} verified plugins`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 7: Plugin Details
  console.log('▶ Test 7: Get Plugin Creator Details');
  try {
    const plugin = registry.plugins.find((p: any) => p.id === 'plugin-creator');
    if (plugin) {
      console.log(`  ✅ Plugin Creator Pro Details:`);
      console.log(`     Version: ${plugin.version}`);
      console.log(`     Trust: ${plugin.trustLevel}`);
      console.log(`     Commands: ${plugin.commands.length}`);
      console.log(`     Downloads: ${plugin.downloads.toLocaleString()}`);
      console.log(`     Rating: ${plugin.rating}/5`);
      passed++;
    } else {
      throw new Error('Plugin not found');
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 8: Tag Cloud
  console.log('▶ Test 8: Get Tag Cloud');
  try {
    const tags = getPluginTagCloud(registry);
    console.log(`  ✅ Found ${tags.size} unique tags`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 9: Search Suggestions
  console.log('▶ Test 9: Get Search Suggestions');
  try {
    const suggestions = getPluginSearchSuggestions(registry, 'plug');
    console.log(`  ✅ Got ${suggestions.length} suggestions for "plug"`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 10: Similar Plugins
  console.log('▶ Test 10: Find Similar Plugins');
  try {
    const similar = findSimilarPlugins(registry, '@claude-flow/neural', 3);
    console.log(`  ✅ Found ${similar.length} similar plugins to @claude-flow/neural`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        TEST RESULTS                            ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log('  🎉 All tests passed! Plugin Store is working correctly.');
    console.log('');
    console.log('  Available CLI Commands:');
    console.log('    npx @claude-flow/cli plugins list');
    console.log('    npx @claude-flow/cli plugins list --official');
    console.log('    npx @claude-flow/cli plugins search -q "plugin creator"');
    console.log('    npx @claude-flow/cli plugins info -n plugin-creator');
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
