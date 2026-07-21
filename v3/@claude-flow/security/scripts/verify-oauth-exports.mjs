/**
 * Release and CI guard for the OAuth surface consumed by `ruflo auth`.
 * This deliberately imports the built package entry point, rather than
 * source files, so a stale or incomplete npm artifact cannot pass.
 */
const security = await import('../dist/index.js');

const requiredFunctions = [
  'authorizeUrl',
  'exchangeCode',
  'refreshToken',
  'exchangeManualCode',
  'generatePkce',
  'openBrowser',
  'createKeychainAdapter',
];
const requiredClasses = ['CallbackServer', 'OAuthError'];

const missing = [
  ...requiredFunctions.filter((name) => typeof security[name] !== 'function'),
  ...requiredClasses.filter((name) => typeof security[name] !== 'function'),
  ...(typeof security.OOB_REDIRECT_URI === 'string' ? [] : ['OOB_REDIRECT_URI']),
];

if (missing.length > 0) {
  throw new Error(`@claude-flow/security is missing required OAuth exports: ${missing.join(', ')}`);
}

console.log(`OAuth export surface verified (${requiredFunctions.length + requiredClasses.length + 1} exports)`);
