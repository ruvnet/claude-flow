/**
 * GAIA Dataset Loader — ADR-133-PR1
 *
 * Authenticates to Hugging Face, downloads the `gaia-benchmark/GAIA`
 * validation split, caches it under ~/.cache/ruflo/gaia/, and exposes
 * a typed `loadGaia()` API consumed by the capability-gaia subcommand.
 *
 * Token resolution order (mirrors performance-capability.ts ANTHROPIC_API_KEY pattern):
 *   1. $HF_TOKEN env var
 *   2. gcloud secrets versions access latest --secret=huggingface-token
 *   3. Fail with a clear error message
 *
 * This file is deliberately a skeleton / PR-1 checkpoint.  The full
 * dataset download is gated behind a real HF_TOKEN; a 5-question smoke
 * fixture is provided for offline / CI-without-HF testing.
 *
 * Refs: ADR-133, #2156
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as url from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GaiaLevel = 1 | 2 | 3;

export interface GaiaQuestion {
  /** Unique identifier from the HF dataset. */
  task_id: string;
  /** Difficulty level: 1 (easiest) → 3 (hardest). */
  level: GaiaLevel;
  /** The question text sent to the agent. */
  question: string;
  /** Ground-truth final answer (string normalised, no surrounding whitespace). */
  final_answer: string;
  /** Optional file attachment filename; resolved to an absolute path by the loader. */
  file_name: string | null;
  /** Absolute path to the cached attachment, or null if no attachment. */
  file_path: string | null;
  /** Steps annotation (meta-data, not used by agent). */
  annotator_metadata?: Record<string, unknown>;
}

export interface LoadGaiaOptions {
  /** Level filter (default: 1). */
  level?: GaiaLevel;
  /** Maximum questions to return (default: all). */
  limit?: number;
  /** Skip HF download; use the built-in 5-question smoke fixture instead. */
  smokeOnly?: boolean;
  /** Override the cache directory (default: ~/.cache/ruflo/gaia). */
  cacheDir?: string;
}

// ---------------------------------------------------------------------------
// HF Token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Hugging Face API token using two fallbacks:
 *   1. $HF_TOKEN env var
 *   2. `gcloud secrets versions access latest --secret=huggingface-token`
 *
 * Throws with a clear error if neither is available.
 */
export function resolveHfToken(): string {
  const envToken = process.env.HF_TOKEN;
  if (envToken && envToken.trim()) return envToken.trim();

  try {
    const out = execSync(
      'gcloud secrets versions access latest --secret=huggingface-token 2>/dev/null',
      { encoding: 'utf-8', timeout: 10_000 },
    ).trim();
    if (out) return out;
  } catch {
    /* fall through */
  }

  throw new Error(
    'HF_TOKEN not found. Set the env var or store it in GCP Secret Manager under the name ' +
    '"huggingface-token" (e.g. `echo -n "$TOKEN" | gcloud secrets versions add huggingface-token --data-file=-`).',
  );
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function defaultCacheDir(): string {
  return path.join(os.homedir(), '.cache', 'ruflo', 'gaia');
}

/**
 * Export the default cache directory path (no side effects).
 */
export function getDefaultCacheDir(): string {
  return defaultCacheDir();
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function revisionCacheKey(revision: string, level: GaiaLevel): string {
  return `level${level}-${revision}.json`;
}

// ---------------------------------------------------------------------------
// 5-question smoke fixture (no HF token required)
// ---------------------------------------------------------------------------

/**
 * Minimal offline fixture for smoke tests and CI environments without HF_TOKEN.
 * Answers are verified by hand against publicly known facts.
 * All questions are Level 1 (no file attachments, no multi-hop tool use required).
 *
 * IMPORTANT: Verify every answer key with `node -e 'console.log(…)'` before
 * adding entries to this list — three answer-key bugs were caught in session #2156.
 */
export const SMOKE_FIXTURE: GaiaQuestion[] = [
  {
    task_id: 'smoke-001',
    level: 1,
    question: 'What is the capital of France?',
    final_answer: 'Paris',
    file_name: null,
    file_path: null,
  },
  {
    task_id: 'smoke-002',
    level: 1,
    question: 'How many sides does a hexagon have?',
    final_answer: '6',
    file_name: null,
    file_path: null,
  },
  {
    task_id: 'smoke-003',
    level: 1,
    question: 'What is 15 multiplied by 4?',
    final_answer: '60',
    file_name: null,
    file_path: null,
  },
  {
    task_id: 'smoke-004',
    level: 1,
    question: 'In what year did the Berlin Wall fall?',
    final_answer: '1989',
    file_name: null,
    file_path: null,
  },
  {
    task_id: 'smoke-005',
    level: 1,
    question: 'What chemical symbol represents gold on the periodic table?',
    final_answer: 'Au',
    file_name: null,
    file_path: null,
  },
];

// ---------------------------------------------------------------------------
// HF dataset download (requires HF_TOKEN)
// ---------------------------------------------------------------------------

const HF_DATASET_REPO = 'gaia-benchmark/GAIA';
const HF_API_BASE = 'https://huggingface.co';
const HF_DATASETS_API = 'https://datasets-server.huggingface.co';

/**
 * Fetch JSON from a URL with an Authorization header.
 * Returns parsed JSON or throws.
 */
async function fetchJson(url: string, token: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'ruflo-gaia-loader/1.0',
        },
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`HF auth error ${res.statusCode} for ${url}. Check HF_TOKEN permissions (need read access to gaia-benchmark/GAIA).`));
          res.resume();
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (e) {
            reject(new Error(`JSON parse failed for ${url}: ${String(e)}`));
          }
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Download the GAIA validation split for a given level from Hugging Face.
 *
 * Uses the HF Datasets Server API (paginated parquet/JSON rows endpoint).
 * Caches the result locally so subsequent runs are instant.
 *
 * Uses per-level HF configs (2023_level1, 2023_level2, 2023_level3) so
 * all questions for a given level fit within the 100-row API limit.
 */
async function downloadGaiaLevel(
  level: GaiaLevel,
  token: string,
  cacheDir: string,
): Promise<GaiaQuestion[]> {
  ensureDir(cacheDir);

  // Query a stable revision identifier (the dataset card commit SHA).
  // For now we use 'main' as the revision key for the cache filename.
  const revision = 'main';
  const cacheFile = path.join(cacheDir, revisionCacheKey(revision, level));

  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as GaiaQuestion[];
    return cached;
  }

  // HF Datasets Server rows endpoint for the per-level 2023 config.
  // Using "2023_level{N}" config instead of "2023_all" avoids the pagination
  // problem: "2023_all" has 165 rows but the API caps at 100 per request,
  // which silently drops 23 of 53 Level-1 questions. The per-level configs
  // each have ≤100 rows (L1=53, L2=86, L3=26) and fit in a single request.
  const levelConfig = `2023_level${level}`;
  const url =
    `${HF_DATASETS_API}/rows?dataset=${encodeURIComponent(HF_DATASET_REPO)}` +
    `&config=${levelConfig}&split=validation&offset=0&length=100`;

  const data = await fetchJson(url, token) as { rows: Array<{ row: Record<string, unknown> }> };

  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error(`Unexpected HF response shape — missing .rows array. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const questions: GaiaQuestion[] = data.rows
    .map((r) => r.row)
    .filter((row) => Number(row['Level']) === level)
    .map((row): GaiaQuestion => ({
      task_id: String(row['task_id'] ?? ''),
      level,
      question: String(row['Question'] ?? ''),
      final_answer: String(row['Final answer'] ?? '').trim(),
      file_name: row['file_name'] ? String(row['file_name']) : null,
      file_path: null, // attachment resolution is a PR-2 concern
      annotator_metadata: row['Annotator Metadata'] as Record<string, unknown> | undefined,
    }))
    .filter((q) => q.task_id && q.question && q.final_answer);

  fs.writeFileSync(cacheFile, JSON.stringify(questions, null, 2), 'utf-8');
  return questions;
}

// ---------------------------------------------------------------------------
// Attachment download (iter-53b)
// ---------------------------------------------------------------------------

/**
 * Base URL for GAIA validation attachment files.
 * Individual files are at: HF_FILE_BASE/<task_id>/<file_name>
 *
 * HF now serves files through the Xet storage layer; requests will redirect
 * (301/302/303) to a Xet download URL that requires NO auth header.
 * We only send the Authorization header to requests targeting huggingface.co.
 */
const HF_FILE_BASE =
  'https://huggingface.co/datasets/gaia-benchmark/GAIA/resolve/main/2023/validation';

/**
 * Download a single GAIA attachment file to the cache directory.
 * Follows HTTP redirects, sending auth only to huggingface.co domains.
 * Returns the local file path on success, or null on any error.
 */
async function downloadAttachment(
  taskId: string,
  fileName: string,
  token: string,
  cacheDir: string,
): Promise<string | null> {
  const destPath = path.join(cacheDir, fileName);
  if (fs.existsSync(destPath)) return destPath; // already cached

  const fileUrl = `${HF_FILE_BASE}/${taskId}/${encodeURIComponent(fileName)}`;
  ensureDir(cacheDir);

  return new Promise((resolve) => {
    function doGet(requestUrl: string, depth: number): void {
      if (depth > 5) { resolve(null); return; }

      const parsed = new url.URL(requestUrl);
      const headers: Record<string, string> = {
        'User-Agent': 'ruflo-gaia-loader/1.0',
      };
      if (parsed.hostname.includes('huggingface.co')) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const req = https.get(requestUrl, { headers }, (res) => {
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const loc = res.headers['location'];
          res.resume();
          if (loc) doGet(loc, depth + 1);
          else resolve(null);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            fs.writeFileSync(destPath, Buffer.concat(chunks));
            resolve(destPath);
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(60_000, () => { req.destroy(); resolve(null); });
    }
    doGet(fileUrl, 0);
  });
}

/**
 * Download all attachment files referenced by the questions list.
 * Mutates each question's `file_path` field in place.
 * Skips questions without a file_name.
 */
export async function resolveAttachments(
  questions: GaiaQuestion[],
  token: string,
  cacheDir: string,
): Promise<void> {
  const withFiles = questions.filter((q) => q.file_name);
  await Promise.all(
    withFiles.map(async (q) => {
      const localPath = await downloadAttachment(q.task_id, q.file_name!, token, cacheDir);
      q.file_path = localPath;
    }),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load GAIA validation questions.
 *
 * - With `smokeOnly: true` (or when HF_TOKEN is unavailable): returns the 5-question
 *   smoke fixture — no network call, no token required.
 * - Otherwise: authenticates to HF, downloads level N questions, caches locally.
 *
 * @throws if HF_TOKEN is missing and smokeOnly is false
 */
export async function loadGaia(options: LoadGaiaOptions = {}): Promise<GaiaQuestion[]> {
  const { level = 1, limit, smokeOnly = false, cacheDir = defaultCacheDir() } = options;

  if (smokeOnly) {
    const filtered = SMOKE_FIXTURE.filter((q) => q.level === level);
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  const token = resolveHfToken();
  const questions = await downloadGaiaLevel(level, token, cacheDir);
  // Resolve attachment files in parallel (iter-53b: populates file_path on each question)
  await resolveAttachments(questions, token, cacheDir);
  return limit !== undefined ? questions.slice(0, limit) : questions;
}

/**
 * Returns the cache directory path (does not create it).
 */
export function getGaiaCacheDir(override?: string): string {
  return override ?? defaultCacheDir();
}
