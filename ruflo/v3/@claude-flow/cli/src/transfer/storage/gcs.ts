/**
 * Google Cloud Storage Backend
 * Real storage implementation using gcloud CLI or GCS APIs
 *
 * @module @claude-flow/cli/transfer/storage/gcs
 * @version 3.0.0
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, exec } from 'child_process';

/**
 * GCS configuration
 */
export interface GCSConfig {
  bucket: string;
  projectId?: string;
  keyFile?: string;
  prefix?: string;
}

/**
 * GCS upload result
 */
export interface GCSUploadResult {
  success: boolean;
  uri: string;
  publicUrl: string;
  size: number;
  checksum: string;
  contentId: string;
}

/**
 * Get GCS configuration from environment
 */
export function getGCSConfig(): GCSConfig | null {
  const bucket = process.env.GCS_BUCKET || process.env.GOOGLE_CLOUD_BUCKET;
  if (!bucket) return null;

  return {
    bucket,
    projectId: process.env.GCS_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    prefix: process.env.GCS_PREFIX || 'claude-flow-patterns',
  };
}

/**
 * Check if gcloud CLI is available
 */
export function isGCloudAvailable(): boolean {
  try {
    execSync('gcloud --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if authenticated with gcloud
 */
export async function isGCloudAuthenticated(): Promise<boolean> {
  try {
    execSync('gcloud auth print-access-token', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate content ID from content hash
 */
function generateContentId(content: Buffer): string {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `cfp-${hash.slice(0, 16)}`;
}

/**
 * Upload content to Google Cloud Storage using gcloud CLI
 */
export async function uploadToGCS(
  content: Buffer,
  options: {
    name?: string;
    contentType?: string;
    config?: GCSConfig;
    metadata?: Record<string, string>;
  } = {}
): Promise<GCSUploadResult> {
  const config = options.config || getGCSConfig();
  if (!config) {
    throw new Error(
      'GCS not configured. Set GCS_BUCKET environment variable.\n' +
      'Or authenticate: gcloud auth login && gcloud config set project YOUR_PROJECT'
    );
  }

  const contentId = generateContentId(content);
  const checksum = crypto.createHash('sha256').update(content).digest('hex');
  const fileName = options.name || `${contentId}.cfp.json`;
  const objectPath = config.prefix ? `${config.prefix}/${fileName}` : fileName;

  console.log(`[GCS] Uploading to gs://${config.bucket}/${objectPath}...`);

  // Write content to temp file
  const tempDir = process.env.TMPDIR || '/tmp';
  const tempFile = path.join(tempDir, `claude-flow-upload-${Date.now()}.json`);
  fs.writeFileSync(tempFile, content);

  try {
    // Build gcloud command
    const metadataArgs = options.metadata
      ? Object.entries(options.metadata)
          .map(([k, v]) => `--metadata=${k}=${v}`)
          .join(' ')
      : '';

    const projectArg = config.projectId ? `--project=${config.projectId}` : '';

    // Upload using gcloud storage cp
    const cmd = `gcloud storage cp "${tempFile}" "gs://${config.bucket}/${objectPath}" ${projectArg} --content-type="${options.contentType || 'application/json'}" 2>&1`;

    execSync(cmd, { encoding: 'utf-8' });

    // Set metadata if provided
    if (options.metadata && Object.keys(options.metadata).length > 0) {
      const metadataJson = JSON.stringify(options.metadata);
      try {
        execSync(
          `gcloud storage objects update "gs://${config.bucket}/${objectPath}" --custom-metadata='${metadataJson}' ${projectArg} 2>&1`,
          { encoding: 'utf-8' }
        );
      } catch {
        // Metadata update failed, but upload succeeded
      }
    }

    // Clean up temp file
    fs.unlinkSync(tempFile);

    const uri = `gs://${config.bucket}/${objectPath}`;
    const publicUrl = `https://storage.googleapis.com/${config.bucket}/${objectPath}`;

    console.log(`[GCS] Upload complete: ${uri}`);

    return {
      success: true,
      uri,
      publicUrl,
      size: content.length,
      checksum,
      contentId,
    };
  } catch (error) {
    // Clean up temp file on error
    try {
      fs.unlinkSync(tempFile);
    } catch { /* ignore */ }

    throw new Error(`GCS upload failed: ${error}`);
  }
}

/**
 * Download content from Google Cloud Storage
 */
export async function downloadFromGCS(
  uri: string,
  config?: GCSConfig
): Promise<Buffer | null> {
  const cfg = config || getGCSConfig();
  const projectArg = cfg?.projectId ? `--project=${cfg.projectId}` : '';

  console.log(`[GCS] Downloading from ${uri}...`);

  // Write to temp file first
  const tempDir = process.env.TMPDIR || '/tmp';
  const tempFile = path.join(tempDir, `claude-flow-download-${Date.now()}.json`);

  try {
    // Download using gcloud storage cp
    execSync(
      `gcloud storage cp "${uri}" "${tempFile}" ${projectArg} 2>&1`,
      { encoding: 'utf-8' }
    );

    const content = fs.readFileSync(tempFile);
    fs.unlinkSync(tempFile);

    console.log(`[GCS] Downloaded ${content.length} bytes`);
    return content;
  } catch (error) {
    try {
      fs.unlinkSync(tempFile);
    } catch { /* ignore */ }

    console.error(`[GCS] Download failed: ${error}`);
    return null;
  }
}

/**
 * Check if object exists in GCS
 */
export async function existsInGCS(
  uri: string,
  config?: GCSConfig
): Promise<boolean> {
  const cfg = config || getGCSConfig();
  const projectArg = cfg?.projectId ? `--project=${cfg.projectId}` : '';

  try {
    execSync(
      `gcloud storage ls "${uri}" ${projectArg} 2>&1`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * List objects in GCS bucket with prefix
 */
export async function listGCSObjects(
  prefix?: string,
  config?: GCSConfig
): Promise<Array<{ name: string; size: number; updated: string }>> {
  const cfg = config || getGCSConfig();
  if (!cfg) return [];

  const objectPrefix = prefix || cfg.prefix || '';
  const projectArg = cfg.projectId ? `--project=${cfg.projectId}` : '';
  const uri = `gs://${cfg.bucket}/${objectPrefix}`;

  try {
    const result = execSync(
      `gcloud storage ls -l "${uri}" ${projectArg} --format=json 2>&1`,
      { encoding: 'utf-8' }
    );

    const objects = JSON.parse(result);
    return objects.map((obj: { name: string; size: number; updated: string }) => ({
      name: obj.name,
      size: obj.size || 0,
      updated: obj.updated || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * Delete object from GCS
 */
export async function deleteFromGCS(
  uri: string,
  config?: GCSConfig
): Promise<boolean> {
  const cfg = config || getGCSConfig();
  const projectArg = cfg?.projectId ? `--project=${cfg.projectId}` : '';

  try {
    execSync(
      `gcloud storage rm "${uri}" ${projectArg} 2>&1`,
      { encoding: 'utf-8' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get GCS storage status
 */
export function getGCSStatus(): {
  available: boolean;
  authenticated: boolean;
  bucket?: string;
  message: string;
} {
  const config = getGCSConfig();
  const gcloudAvailable = isGCloudAvailable();

  if (!gcloudAvailable) {
    return {
      available: false,
      authenticated: false,
      message: 'gcloud CLI not installed. Install from: https://cloud.google.com/sdk/docs/install',
    };
  }

  if (!config?.bucket) {
    return {
      available: true,
      authenticated: false,
      message: 'GCS bucket not configured. Set GCS_BUCKET environment variable.',
    };
  }

  return {
    available: true,
    authenticated: true,
    bucket: config.bucket,
    message: `GCS configured with bucket: ${config.bucket}`,
  };
}

/**
 * Export for storage backend detection
 */
export function hasGCSCredentials(): boolean {
  return !!getGCSConfig() && isGCloudAvailable();
}
