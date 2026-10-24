/**
 * Transfer Module
 * Pattern export, import, anonymization, and IPFS sharing
 */

// Types
export * from './types.js';

// Serialization
export {
  createCFP,
  serializeToJson,
  serializeToBuffer,
  deserializeCFP,
  validateCFP,
  getFileExtension,
  detectFormat,
} from './serialization/cfp.js';

// Anonymization
export {
  detectPII,
  redactPII,
  anonymizeCFP,
  scanCFPForPII,
} from './anonymization/index.js';

// Export
export {
  exportPatterns,
  exportSeraphine,
  quickExport,
  quickExportToIPFS,
} from './export.js';

// IPFS
export {
  uploadToIPFS,
  pinContent,
  unpinContent,
  checkContent,
  getGatewayURL,
  getIPNSURL,
} from './ipfs/upload.js';

// Models
export {
  SERAPHINE_VERSION,
  SERAPHINE_METADATA,
  SERAPHINE_ROUTING_PATTERNS,
  SERAPHINE_COMPLEXITY_PATTERNS,
  SERAPHINE_COVERAGE_PATTERNS,
  SERAPHINE_TRAJECTORY_PATTERNS,
  SERAPHINE_CUSTOM_PATTERNS,
  createSeraphinePatterns,
  createSeraphineGenesis,
  getSeraphineInfo,
} from './models/seraphine.js';

// Store - Decentralized Pattern Marketplace
export {
  // Types
  type PatternEntry,
  type PatternAuthor,
  type PatternCategory,
  type PatternRegistry,
  type SearchOptions,
  type SearchResult,
  type PublishOptions,
  type PublishResult,
  type DownloadOptions,
  type DownloadResult,
  type KnownRegistry,
  type StoreConfig,
  type DiscoveryResult,
  type IPNSResolution,
  type DownloadProgressCallback,
  type ContributionRequest,

  // Registry
  REGISTRY_VERSION,
  BOOTSTRAP_REGISTRIES,
  DEFAULT_STORE_CONFIG,
  createRegistry,
  getDefaultCategories,
  addPatternToRegistry,
  removePatternFromRegistry,
  serializeRegistry,
  deserializeRegistry,
  signRegistry,
  verifyRegistrySignature,
  mergeRegistries,
  generatePatternId,

  // Discovery
  PatternDiscovery,
  createDiscoveryService,

  // Search
  searchPatterns,
  getFeaturedPatterns,
  getTrendingPatterns,
  getNewestPatterns,
  getPatternById,
  getPatternByName,
  getPatternsByAuthor,
  getPatternsByCategory,
  getSimilarPatterns,
  getCategoryStats,
  getTagCloud,
  getSearchSuggestions,

  // Download
  PatternDownloader,
  batchDownload,
  createDownloader,

  // Publish
  PatternPublisher,
  submitContribution,
  checkContributionStatus,
  createPublisher,
  quickPublish,

  // High-level API
  PatternStore,
  createPatternStore,
} from './store/index.js';
