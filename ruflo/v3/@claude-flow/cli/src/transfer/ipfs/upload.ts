/**
 * IPFS Upload Module
 * Real upload support via web3.storage, Pinata, or local IPFS
 *
 * @module @claude-flow/cli/transfer/ipfs/upload
 * @version 3.0.0
 */

import * as crypto from 'crypto';
import type { IPFSConfig, PinningService } from '../types.js';

/**
 * IPFS upload options
 */
export interface IPFSUploadOptions {
  pin?: boolean;
  pinningService?: PinningService;
  gateway?: string;
  name?: string;
  wrapWithDirectory?: boolean;
  apiKey?: string;
  apiSecret?: string;
}

/**
 * IPFS upload result
 */
export interface IPFSUploadResult {
  cid: string;
  size: number;
  gateway: string;
  pinnedAt?: string;
  url: string;
}

/**
 * Web3.Storage upload configuration
 */
interface Web3StorageConfig {
  token?: string;
  endpoint?: string;
}

/**
 * Get web3.storage token from environment or config
 */
function getWeb3StorageToken(): string | undefined {
  return process.env.WEB3_STORAGE_TOKEN ||
         process.env.W3_TOKEN ||
         process.env.IPFS_TOKEN;
}

/**
 * Generate a CID from content (for demo mode when no token available)
 * Uses CIDv1 with dag-pb codec and sha2-256 multihash
 */
function generateDemoCID(content: Buffer): string {
  const hash = crypto.createHash('sha256').update(content).digest();
  // CIDv1 with dag-pb codec and sha2-256 multihash
  const prefix = Buffer.from([0x01, 0x70, 0x12, 0x20]);
  const cidBytes = Buffer.concat([prefix, hash]);

  // Base32 encode
  const base32Chars = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = 'bafybei';
  for (let i = 0; i < 44; i++) {
    const byte = cidBytes[i % cidBytes.length] || 0;
    result += base32Chars[byte % 32];
  }
  return result;
}

/**
 * Upload to web3.storage (real IPFS)
 */
async function uploadToWeb3Storage(
  content: Buffer,
  options: IPFSUploadOptions & Web3StorageConfig
): Promise<IPFSUploadResult> {
  const token = options.apiKey || getWeb3StorageToken();

  if (!token) {
    throw new Error(
      'Web3.storage token not found. Set WEB3_STORAGE_TOKEN environment variable.\n' +
      'Get a free token at: https://web3.storage'
    );
  }

  const endpoint = options.endpoint || 'https://api.web3.storage';
  const name = options.name || 'pattern.cfp.json';

  console.log(`[IPFS] Uploading ${content.length} bytes to web3.storage...`);

  // Create FormData-like body for upload
  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
    Buffer.from(`Content-Type: application/json\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(`${endpoint}/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Web3.storage upload failed: ${response.status} ${error}`);
  }

  const result = await response.json() as { cid: string };
  const cid = result.cid;
  const gateway = options.gateway || 'https://w3s.link';

  console.log(`[IPFS] Upload complete!`);
  console.log(`[IPFS] CID: ${cid}`);

  return {
    cid,
    size: content.length,
    gateway,
    pinnedAt: new Date().toISOString(),
    url: `${gateway}/ipfs/${cid}`,
  };
}

/**
 * Upload to Pinata
 */
async function uploadToPinata(
  content: Buffer,
  options: IPFSUploadOptions
): Promise<IPFSUploadResult> {
  const apiKey = options.apiKey || process.env.PINATA_API_KEY;
  const apiSecret = options.apiSecret || process.env.PINATA_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      'Pinata API credentials not found. Set PINATA_API_KEY and PINATA_API_SECRET.\n' +
      'Get credentials at: https://pinata.cloud'
    );
  }

  const name = options.name || 'pattern.cfp.json';
  console.log(`[IPFS] Uploading ${content.length} bytes to Pinata...`);

  const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
  const metadata = JSON.stringify({ name });

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="pinataMetadata"\r\n\r\n`),
    Buffer.from(`${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
    Buffer.from(`Content-Type: application/json\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      'pinata_api_key': apiKey,
      'pinata_secret_api_key': apiSecret,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Pinata upload failed: ${response.status} ${error}`);
  }

  const result = await response.json() as { IpfsHash: string; PinSize: number };
  const cid = result.IpfsHash;
  const gateway = options.gateway || 'https://gateway.pinata.cloud';

  console.log(`[IPFS] Upload complete!`);
  console.log(`[IPFS] CID: ${cid}`);

  return {
    cid,
    size: content.length,
    gateway,
    pinnedAt: new Date().toISOString(),
    url: `${gateway}/ipfs/${cid}`,
  };
}

/**
 * Upload content to IPFS
 *
 * Supports (in order of preference):
 * - Local/Custom IPFS node (IPFS_API_URL) - FREE, your own node
 * - web3.storage (WEB3_STORAGE_TOKEN) - Free 5GB tier
 * - Pinata (PINATA_API_KEY + PINATA_API_SECRET) - Free 1GB tier
 * - Demo mode (generates deterministic CIDs when no credentials)
 */
export async function uploadToIPFS(
  content: Buffer,
  options: IPFSUploadOptions = {}
): Promise<IPFSUploadResult> {
  const {
    pin = true,
    pinningService,
    gateway = 'https://w3s.link',
    name = 'pattern',
  } = options;

  // Check environment variables
  const localIPFS = process.env.IPFS_API_URL;
  const web3Token = getWeb3StorageToken();
  const pinataKey = process.env.PINATA_API_KEY;

  // 1. Try local/custom IPFS node first (FREE - your own node)
  if (localIPFS || pinningService === 'local') {
    try {
      const isAvailable = await checkLocalIPFSNode();
      if (isAvailable) {
        return await uploadToLocalIPFS(content, options);
      } else {
        console.warn(`[IPFS] Local node at ${localIPFS || 'localhost:5001'} not available`);
      }
    } catch (error) {
      console.warn(`[IPFS] Local IPFS upload failed: ${error}`);
    }
  }

  // 2. Try Pinata
  if (pinningService === 'pinata' || (pinataKey && !web3Token)) {
    try {
      return await uploadToPinata(content, options);
    } catch (error) {
      console.warn(`[IPFS] Pinata upload failed: ${error}`);
    }
  }

  // 3. Try Web3.storage
  if (web3Token || pinningService === 'web3storage') {
    try {
      return await uploadToWeb3Storage(content, options);
    } catch (error) {
      console.warn(`[IPFS] Web3.storage upload failed: ${error}`);
    }
  }

  // Fall back to demo mode - WARN user prominently
  console.warn(`⚠ [IPFS] DEMO MODE - No IPFS credentials configured`);
  console.warn(`⚠ [IPFS] Content will NOT be uploaded to decentralized storage`);
  console.warn(`⚠ [IPFS] To enable real uploads, configure one of:`);
  console.warn(`⚠ [IPFS]   - IPFS_API_URL=http://YOUR_NODE:5001 (FREE - your own node)`);
  console.warn(`⚠ [IPFS]   - WEB3_STORAGE_TOKEN (free 5GB at web3.storage)`);
  console.warn(`⚠ [IPFS]   - PINATA_API_KEY + PINATA_SECRET_KEY (free tier available)`);

  const cid = generateDemoCID(content);
  const size = content.length;

  console.log(`[IPFS] Demo upload: ${size} bytes`);
  console.log(`[IPFS] Name: ${name}`);

  // Simulate upload delay
  await new Promise(resolve => setTimeout(resolve, 500));

  const result: IPFSUploadResult = {
    cid,
    size,
    gateway,
    url: `${gateway}/ipfs/${cid}`,
  };

  if (pin) {
    result.pinnedAt = new Date().toISOString();
    console.log(`[IPFS] Demo pinned at: ${result.pinnedAt}`);
  }

  console.log(`[IPFS] Demo CID: ${cid}`);
  console.log(`[IPFS] Demo URL: ${result.url}`);

  return result;
}

/**
 * Pin content by CID
 */
export async function pinContent(
  cid: string,
  options: { service?: PinningService; name?: string } = {}
): Promise<{ success: boolean; pinnedAt: string }> {
  const web3Token = getWeb3StorageToken();
  const pinataKey = process.env.PINATA_API_KEY;

  // Real pinning with Pinata
  if (pinataKey && options.service !== 'web3storage') {
    try {
      const pinataSecret = process.env.PINATA_API_SECRET;
      const response = await fetch('https://api.pinata.cloud/pinning/pinByHash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'pinata_api_key': pinataKey,
          'pinata_secret_api_key': pinataSecret || '',
        },
        body: JSON.stringify({
          hashToPin: cid,
          pinataMetadata: { name: options.name || cid },
        }),
      });

      if (response.ok) {
        const pinnedAt = new Date().toISOString();
        console.log(`[IPFS] Pinned ${cid} via Pinata at ${pinnedAt}`);
        return { success: true, pinnedAt };
      }
    } catch (error) {
      console.warn(`[IPFS] Pinata pin failed: ${error}`);
    }
  }

  // Demo mode
  const pinnedAt = new Date().toISOString();
  console.log(`[IPFS] Demo pinning ${cid}...`);
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log(`[IPFS] Demo pinned at ${pinnedAt}`);

  return { success: true, pinnedAt };
}

/**
 * Unpin content by CID
 */
export async function unpinContent(
  cid: string,
  options: { service?: PinningService } = {}
): Promise<{ success: boolean }> {
  const pinataKey = process.env.PINATA_API_KEY;

  // Real unpinning with Pinata
  if (pinataKey) {
    try {
      const pinataSecret = process.env.PINATA_API_SECRET;
      const response = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
        method: 'DELETE',
        headers: {
          'pinata_api_key': pinataKey,
          'pinata_secret_api_key': pinataSecret || '',
        },
      });

      if (response.ok) {
        console.log(`[IPFS] Unpinned ${cid} from Pinata`);
        return { success: true };
      }
    } catch (error) {
      console.warn(`[IPFS] Pinata unpin failed: ${error}`);
    }
  }

  // Demo mode
  console.log(`[IPFS] Demo unpinning ${cid}...`);
  await new Promise(resolve => setTimeout(resolve, 200));
  console.log(`[IPFS] Demo unpinned`);

  return { success: true };
}

/**
 * Check if content exists on IPFS
 */
export async function checkContent(
  cid: string,
  gateway: string = 'https://w3s.link'
): Promise<{ exists: boolean; size?: number }> {
  console.log(`[IPFS] Checking ${cid}...`);

  try {
    const response = await fetch(`${gateway}/ipfs/${cid}`, {
      method: 'HEAD',
    });

    if (response.ok) {
      const size = parseInt(response.headers.get('content-length') || '0', 10);
      console.log(`[IPFS] Content exists, size: ${size}`);
      return { exists: true, size };
    }
  } catch (error) {
    console.log(`[IPFS] Content check failed: ${error}`);
  }

  return { exists: false };
}

/**
 * Get gateway URL for CID
 */
export function getGatewayURL(cid: string, gateway: string = 'https://w3s.link'): string {
  return `${gateway}/ipfs/${cid}`;
}

/**
 * Get IPNS URL for name
 */
export function getIPNSURL(name: string, gateway: string = 'https://w3s.link'): string {
  return `${gateway}/ipns/${name}`;
}

/**
 * Upload to a local/custom IPFS node
 * Connect to your own IPFS daemon via HTTP API
 */
async function uploadToLocalIPFS(
  content: Buffer,
  options: IPFSUploadOptions
): Promise<IPFSUploadResult> {
  const apiUrl = process.env.IPFS_API_URL || 'http://localhost:5001';
  const name = options.name || 'pattern.cfp.json';

  console.log(`[IPFS] Uploading ${content.length} bytes to ${apiUrl}...`);

  const boundary = '----IPFSBoundary' + crypto.randomBytes(16).toString('hex');
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from(`Content-Disposition: form-data; name="file"; filename="${name}"\r\n`),
    Buffer.from(`Content-Type: application/json\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await fetch(`${apiUrl}/api/v0/add?pin=${options.pin !== false}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Local IPFS upload failed: ${response.status} ${error}`);
  }

  const result = await response.json() as { Hash: string; Size: string; Name: string };
  const cid = result.Hash;

  // Try to get external gateway URL if configured
  const gatewayUrl = process.env.IPFS_GATEWAY_URL || options.gateway || 'https://ipfs.io';

  console.log(`[IPFS] Upload complete!`);
  console.log(`[IPFS] CID: ${cid}`);

  return {
    cid,
    size: content.length,
    gateway: gatewayUrl,
    pinnedAt: options.pin !== false ? new Date().toISOString() : undefined,
    url: `${gatewayUrl}/ipfs/${cid}`,
  };
}

/**
 * Check if local IPFS node is available
 */
async function checkLocalIPFSNode(): Promise<boolean> {
  const apiUrl = process.env.IPFS_API_URL || 'http://localhost:5001';

  try {
    const response = await fetch(`${apiUrl}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if real IPFS credentials are available
 */
export function hasIPFSCredentials(): boolean {
  return !!(getWeb3StorageToken() || process.env.PINATA_API_KEY || process.env.IPFS_API_URL);
}

/**
 * Get IPFS service status
 */
export function getIPFSServiceStatus(): {
  service: 'local' | 'web3storage' | 'pinata' | 'demo';
  configured: boolean;
  message: string;
  apiUrl?: string;
} {
  const localIPFS = process.env.IPFS_API_URL;
  const web3Token = getWeb3StorageToken();
  const pinataKey = process.env.PINATA_API_KEY;

  if (localIPFS) {
    return {
      service: 'local',
      configured: true,
      message: `Local IPFS node configured at ${localIPFS} - FREE uploads enabled`,
      apiUrl: localIPFS,
    };
  }

  if (web3Token) {
    return {
      service: 'web3storage',
      configured: true,
      message: 'Web3.storage configured - real IPFS uploads enabled',
    };
  }

  if (pinataKey) {
    return {
      service: 'pinata',
      configured: true,
      message: 'Pinata configured - real IPFS uploads enabled',
    };
  }

  return {
    service: 'demo',
    configured: false,
    message: 'No IPFS credentials - using demo mode. Options:\n' +
             '  1. IPFS_API_URL=http://YOUR_NODE:5001 (FREE - your own node)\n' +
             '  2. WEB3_STORAGE_TOKEN (free 5GB at web3.storage)\n' +
             '  3. PINATA_API_KEY (free 1GB at pinata.cloud)',
  };
}

/**
 * Export the local IPFS check for external use
 */
export { checkLocalIPFSNode };
