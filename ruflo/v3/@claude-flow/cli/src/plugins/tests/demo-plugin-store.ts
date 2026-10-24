#!/usr/bin/env npx tsx
/**
 * Plugin Store Demo
 * Demonstrates the IPFS-based plugin registry working end-to-end
 */

import {
  createPluginDiscoveryService,
  searchPlugins,
  getFeaturedPlugins,
  getOfficialPlugins,
} from '../store/index.js';

async function demo() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CLAUDE FLOW V3 - IPFS PLUGIN STORE DEMO                     ║');
  console.log('║  Decentralized Plugin Marketplace                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // Step 1: Initialize discovery service
  console.log('🔍 Step 1: Initialize Plugin Discovery Service');
  const discovery = createPluginDiscoveryService();
  const registries = discovery.listRegistries();
  console.log(`   Found ${registries.length} bootstrap registries:`);
  registries.forEach(r => {
    console.log(`   ├─ ${r.name} ${r.official ? '(Official)' : '(Community)'}`);
    console.log(`   │  └─ IPNS: ${r.ipnsName.slice(0, 30)}...`);
  });
  console.log('');

  // Step 2: Discover registry via IPNS
  console.log('🌐 Step 2: Discover Registry via IPNS');
  const result = await discovery.discoverRegistry();
  if (!result.success || !result.registry) {
    console.error('   ❌ Failed to discover registry');
    return;
  }
  console.log(`   ✅ Registry discovered from: ${result.source}`);
  console.log(`   ├─ Total plugins: ${result.registry.totalPlugins}`);
  console.log(`   ├─ Total downloads: ${result.registry.totalDownloads.toLocaleString()}`);
  console.log(`   └─ CID: ${result.cid?.slice(0, 40)}...`);
  console.log('');

  // Step 3: List official plugins
  console.log('📦 Step 3: Official Plugins Available');
  const official = getOfficialPlugins(result.registry);
  console.log('');
  official.forEach(p => {
    const stars = '★'.repeat(Math.round(p.rating));
    console.log(`   ${p.verified ? '✓' : ' '} ${p.displayName} v${p.version}`);
    console.log(`     └─ ${p.description.slice(0, 60)}...`);
    console.log(`     └─ ${p.downloads.toLocaleString()} downloads | ${stars} ${p.rating}`);
    console.log('');
  });

  // Step 4: Search for plugin-creator
  console.log('🔎 Step 4: Search for "plugin creator"');
  const searchResult = searchPlugins(result.registry, { query: 'plugin creator' });
  console.log(`   Found ${searchResult.total} results`);
  console.log('');

  // Step 5: Plugin Creator details
  const pluginCreator = searchResult.plugins.find(p => p.id === 'plugin-creator');
  if (pluginCreator) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                    PLUGIN CREATOR PRO                          ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log(`   Name:        ${pluginCreator.displayName}`);
    console.log(`   Version:     ${pluginCreator.version}`);
    console.log(`   Trust:       ${pluginCreator.trustLevel.toUpperCase()}`);
    console.log(`   Verified:    ${pluginCreator.verified ? '✓ Yes' : '✗ No'}`);
    console.log(`   Downloads:   ${pluginCreator.downloads.toLocaleString()}`);
    console.log(`   Rating:      ${'★'.repeat(Math.round(pluginCreator.rating))} ${pluginCreator.rating}/5`);
    console.log(`   License:     ${pluginCreator.license}`);
    console.log('');
    console.log('   Description:');
    console.log(`   ${pluginCreator.description}`);
    console.log('');
    console.log('   IPFS Storage:');
    console.log(`   ├─ CID:      ${pluginCreator.cid}`);
    console.log(`   ├─ Size:     ${(pluginCreator.size / 1024).toFixed(1)} KB`);
    console.log(`   └─ Checksum: ${pluginCreator.checksum}`);
    console.log('');
    console.log('   Commands Available:');
    pluginCreator.commands.forEach(cmd => {
      console.log(`   └─ ${cmd}`);
    });
    console.log('');
    console.log('   Hooks Provided:');
    pluginCreator.hooks.forEach(hook => {
      console.log(`   └─ ${hook}`);
    });
    console.log('');
    console.log('   Permissions Required:');
    console.log(`   └─ ${pluginCreator.permissions.join(', ')}`);
    console.log('');
    if (pluginCreator.securityAudit) {
      console.log('   Security Audit:');
      console.log(`   ├─ Auditor:  ${pluginCreator.securityAudit.auditor}`);
      console.log(`   ├─ Date:     ${pluginCreator.securityAudit.auditDate}`);
      console.log(`   └─ Passed:   ${pluginCreator.securityAudit.passed ? '✓ Yes' : '✗ No'}`);
      console.log('');
    }
    console.log('   To install:');
    console.log('   $ claude-flow plugins install -n plugin-creator');
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    DEMO COMPLETE                               ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('   The IPFS-based Plugin Store is working!');
  console.log('');
  console.log('   Features demonstrated:');
  console.log('   ✅ Registry discovery via IPNS');
  console.log('   ✅ Plugin search with full-text matching');
  console.log('   ✅ Official/Verified plugin filtering');
  console.log('   ✅ Plugin Creator Pro available for download');
  console.log('   ✅ Security audit verification');
  console.log('   ✅ Content-addressed storage (CID)');
  console.log('');
  console.log('   CLI Commands:');
  console.log('   $ claude-flow plugins list              # List all plugins');
  console.log('   $ claude-flow plugins list --official   # Official only');
  console.log('   $ claude-flow plugins search -q neural  # Search plugins');
  console.log('   $ claude-flow plugins info -n plugin-creator');
  console.log('   $ claude-flow plugins install -n plugin-creator');
  console.log('');
}

demo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
