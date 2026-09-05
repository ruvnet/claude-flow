/**
 * GAIA Tool: file_read — ADR-133-PR2 / iter-53b attachment-tools
 *
 * Reads a file from the local filesystem and returns its contents as a
 * UTF-8 string.  Performs content-type dispatch based on extension +
 * magic bytes:
 *
 * Supported extraction formats (iter-53b):
 *   - Plain text, JSON, CSV, XML, HTML, Markdown, JS/TS, Python, shell, YAML
 *   - XLSX  — openpyxl subprocess (cell values + fill colours)
 *   - PPTX  — python-pptx subprocess (per-slide text)
 *   - PNG / JPEG / GIF / WebP — returns IMAGE_BASE64 marker for vision API
 *   - MP3 / WAV — OpenAI Whisper (tiny model) subprocess transcript
 *   - .py source file — returned as UTF-8 text (no execution)
 *
 * For PDF / DOCX / other binary: descriptive stub (PR-4 deferred).
 *
 * IMAGE_BASE64 marker format:
 *   [IMAGE_BASE64:{"mediaType":"image/png","base64":"...","path":"/abs/path"}]
 *
 * The agent loop in gaia-agent.ts must parse this marker when it appears
 * in a tool_result and convert it to an Anthropic vision content block.
 *
 * Maximum file size: 5 MB.  Paths must be absolute.
 *
 * Refs: ADR-133, #2156, iter-53b
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GaiaTool, ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Content-type detection
// ---------------------------------------------------------------------------

const EXT_TO_TYPE: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.py': 'text/x-python',
  '.sh': 'application/x-sh',
  '.bash': 'application/x-sh',
  '.zsh': 'application/x-sh',
  // Handled binary (extraction implemented)
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  // Stub binary (deferred)
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.mp4': 'video/mp4',
};

/** Binary types for which we have extraction logic in iter-53b. */
const HANDLED_BINARY_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/wav',
]);

/** Binary types for which we return a stub (no extraction yet). */
const STUB_BINARY_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4',
]);

function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_TYPE[ext] ?? 'application/octet-stream';
}

/** Quick magic-byte check for common binary signatures. */
function hasBinaryMagic(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true;
  // PNG: \x89PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: \xff\xd8
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  // ZIP (DOCX/XLSX/PPTX): PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

function validatePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('file_read: `path` must be a non-empty string.');
  }
  if (!path.isAbsolute(filePath)) {
    throw new Error(
      `file_read: path must be absolute. Got: "${filePath}". ` +
        'Resolve relative GAIA attachment paths against the cache directory before calling file_read.',
    );
  }
  if (filePath.includes('\0')) {
    throw new Error('file_read: path contains null byte — rejected.');
  }
}

// ---------------------------------------------------------------------------
// Python subprocess helper
// ---------------------------------------------------------------------------

/**
 * Run a Python script passed via stdin, with optional positional args.
 * Uses execFileSync with stdin input to avoid shell-escaping issues.
 */
function runPython(script: string, args: string[], timeoutMs: number): string {
  return execFileSync('python3', ['-', ...args], {
    input: script,
    encoding: 'utf-8',
    timeout: timeoutMs,
  }).trim();
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Map an ARGB/RGB integer or tuple to a human-readable colour name. */
function colorName(r: number, g: number, b: number): string {
  if (r < 40 && g < 40 && b < 40) return 'black';
  if (r > 215 && g > 215 && b > 215) return 'white';
  if (r > 200 && g < 80 && b < 80) return 'red';
  if (r < 80 && g > 150 && b < 80) return 'green';
  if (r < 80 && g < 80 && b > 200) return 'blue';
  if (r > 200 && g > 200 && b < 80) return 'yellow';
  if (r > 200 && g > 100 && b < 80) return 'orange';
  if (r > 130 && g < 80 && b > 130) return 'purple';
  if (r < 80 && g > 150 && b > 150) return 'teal';
  if (r > 150 && g < 100 && b < 100) return 'dark-red';
  if (r > 150 && g > 150 && b > 150) return 'light-gray';
  if (r < 100 && g < 100 && b < 100) return 'dark-gray';
  return `rgb(${r},${g},${b})`;
}

/**
 * Extract XLSX content via openpyxl Python subprocess.
 * Returns cell values + fill colours as structured text.
 */
function extractXlsx(filePath: string): string {
  const script = [
    'import sys, json',
    'from openpyxl import load_workbook',
    'wb = load_workbook(sys.argv[1])',
    'out = []',
    'for ws in wb.worksheets:',
    "    sheet = {'sheet': ws.title, 'cells': []}",
    '    for row in ws.iter_rows():',
    '        for cell in row:',
    '            fill = cell.fill',
    '            color = None',
    "            if fill and fill.fill_type == 'solid':",
    '                fg = fill.fgColor',
    "                if fg.type == 'rgb' and fg.rgb not in ('00000000', 'FFFFFFFF', '00FFFFFF', 'FF000000', 'FFFFFFFF'):",
    '                    color = fg.rgb',
    '            # Include cell if it has a value OR a color',
    '            if cell.value is None and color is None:',
    '                continue',
    "            entry = {'coord': cell.coordinate, 'value': str(cell.value) if cell.value is not None else ''}",
    '            if color:',
    "                entry['color'] = color",
    "            sheet['cells'].append(entry)",
    '    out.append(sheet)',
    'print(json.dumps(out))',
  ].join('\n');

  let raw: string;
  try {
    raw = runPython(script, [filePath], 30_000);
  } catch (err) {
    throw new Error(`XLSX extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: Array<{ sheet: string; cells: Array<{ coord: string; value: string; color?: string }> }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `[XLSX parse error]\nRaw output:\n${raw.slice(0, 2000)}`;
  }

  const lines: string[] = [`[XLSX: ${path.basename(filePath)} — ${parsed.length} sheet(s)]`];
  for (const ws of parsed) {
    lines.push(`\n--- Sheet: ${ws.sheet} ---`);
    for (const cell of ws.cells) {
      const colorPart = cell.color
        ? (() => {
            const hex = cell.color.slice(-6);
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return ` [fill:${colorName(r, g, b)}]`;
          })()
        : '';
      lines.push(`  ${cell.coord}: ${cell.value}${colorPart}`);
    }
  }
  return lines.join('\n');
}

/**
 * Extract PPTX content via python-pptx Python subprocess.
 * Returns per-slide text.
 */
function extractPptx(filePath: string): string {
  const script = [
    'import sys, json',
    'from pptx import Presentation',
    'prs = Presentation(sys.argv[1])',
    'out = []',
    'for i, slide in enumerate(prs.slides):',
    '    texts = []',
    '    for shape in slide.shapes:',
    '        if not shape.has_text_frame:',
    '            continue',
    '        for para in shape.text_frame.paragraphs:',
    "            t = ''.join(run.text for run in para.runs).strip()",
    '            if t:',
    '                texts.append(t)',
    "    out.append({'slide': i + 1, 'texts': texts})",
    'print(json.dumps(out))',
  ].join('\n');

  let raw: string;
  try {
    raw = runPython(script, [filePath], 30_000);
  } catch (err) {
    throw new Error(`PPTX extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: Array<{ slide: number; texts: string[] }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `[PPTX parse error]\nRaw output:\n${raw.slice(0, 2000)}`;
  }

  const lines: string[] = [`[PPTX: ${path.basename(filePath)} — ${parsed.length} slide(s)]`];
  for (const s of parsed) {
    lines.push(`\n--- Slide ${s.slide} ---`);
    for (const t of s.texts) lines.push(`  ${t}`);
  }
  return lines.join('\n');
}

/**
 * Encode image as base64 and return the IMAGE_BASE64 marker.
 * The agent loop will convert this to an Anthropic vision content block.
 */
function extractImage(filePath: string, contentType: string): string {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString('base64');
  const marker = JSON.stringify({ mediaType: contentType, base64: b64, path: filePath });
  return `[IMAGE_BASE64:${marker}]`;
}

/**
 * Transcribe audio via OpenAI Whisper (tiny model) Python subprocess.
 */
function extractAudio(filePath: string): string {
  const script = [
    'import sys',
    'import whisper',
    'model = whisper.load_model("tiny")',
    'result = model.transcribe(sys.argv[1])',
    "print(result['text'].strip())",
  ].join('\n');

  let transcript: string;
  try {
    transcript = runPython(script, [filePath], 120_000);
  } catch (err) {
    throw new Error(`Audio transcription failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return `[Audio transcript: ${path.basename(filePath)}]\n\n${transcript}`;
}

// ---------------------------------------------------------------------------
// GaiaTool implementation
// ---------------------------------------------------------------------------

export class FileReadTool implements GaiaTool {
  readonly name = 'file_read';

  readonly definition: ToolDefinition = {
    name: 'file_read',
    description:
      'Read the contents of a local file and return them as text. ' +
      'The path must be absolute. ' +
      'For XLSX files: returns cell values and fill colours. ' +
      'For PPTX files: returns per-slide text. ' +
      'For image files (PNG/JPEG/GIF/WebP): returns an IMAGE_BASE64 marker for vision API use. ' +
      'For audio files (MP3/WAV): returns a Whisper transcript. ' +
      'For Python source files (.py): returns the source code as text. ' +
      `Maximum file size: ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read.',
        },
      },
      required: ['path'],
    },
  };

  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = String(input['path'] ?? '').trim();
    validatePath(filePath);

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        throw new Error(`file_read: file not found: ${filePath}`);
      }
      throw new Error(`file_read: cannot stat "${filePath}": ${String(e)}`);
    }

    if (!stat.isFile()) {
      throw new Error(`file_read: "${filePath}" is not a regular file.`);
    }

    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `file_read: file too large (${stat.size} bytes > ${MAX_FILE_BYTES} byte limit): ${filePath}`,
      );
    }

    const contentType = detectContentType(filePath);

    // --- HANDLED binary types: extraction implemented ---
    if (HANDLED_BINARY_TYPES.has(contentType)) {
      if (
        contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ) {
        return extractXlsx(filePath);
      }
      if (
        contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) {
        return extractPptx(filePath);
      }
      if (contentType.startsWith('image/')) {
        return extractImage(filePath, contentType);
      }
      if (contentType.startsWith('audio/')) {
        return extractAudio(filePath);
      }
    }

    // --- STUB binary types: no extraction yet ---
    if (STUB_BINARY_TYPES.has(contentType)) {
      return (
        `[Binary file: ${contentType}]\n` +
        `Path: ${filePath}\n` +
        `Size: ${stat.size} bytes\n` +
        `Note: Text extraction for this format is not yet implemented. ` +
        `Describe what you expect the file to contain based on context.`
      );
    }

    // --- Read full file for magic-byte check ---
    const buf = fs.readFileSync(filePath);
    if (hasBinaryMagic(buf)) {
      return (
        `[Binary file — magic bytes detected]\n` +
        `Path: ${filePath}\n` +
        `Size: ${stat.size} bytes\n` +
        `Detected content-type: ${contentType}`
      );
    }

    // --- Plain text ---
    let text: string;
    try {
      text = buf.toString('utf-8');
    } catch {
      text = buf.toString('latin1');
    }

    const header = `[File: ${path.basename(filePath)} | type: ${contentType} | size: ${stat.size} bytes]\n\n`;
    return header + text;
  }
}

// ---------------------------------------------------------------------------
// Convenience factory
// ---------------------------------------------------------------------------

export function createFileReadTool(): FileReadTool {
  return new FileReadTool();
}
