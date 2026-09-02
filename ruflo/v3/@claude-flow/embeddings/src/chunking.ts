/**
 * Document Chunking Utilities
 *
 * Features:
 * - Configurable chunk size and overlap
 * - Sentence-aware splitting
 * - Paragraph-aware splitting
 * - Token-based chunking (approximate)
 * - Metadata tracking for reconstruction
 */

/**
 * Chunking configuration
 */
export interface ChunkingConfig {
  /** Maximum chunk size in characters (default: 512) */
  maxChunkSize?: number;
  /** Overlap between chunks in characters (default: 50) */
  overlap?: number;
  /** Strategy for splitting (default: 'sentence') */
  strategy?: 'character' | 'sentence' | 'paragraph' | 'token';
  /** Minimum chunk size (default: 100) */
  minChunkSize?: number;
  /** Include metadata with chunks */
  includeMetadata?: boolean;
}

/**
 * Chunk result with metadata
 */
export interface Chunk {
  /** Chunk text content */
  text: string;
  /** Original index in document */
  index: number;
  /** Start position in original text */
  startPos: number;
  /** End position in original text */
  endPos: number;
  /** Character count */
  length: number;
  /** Approximate token count (chars / 4) */
  tokenCount: number;
}

/**
 * Chunked document result
 */
export interface ChunkedDocument {
  /** Array of chunks */
  chunks: Chunk[];
  /** Original text length */
  originalLength: number;
  /** Total chunks created */
  totalChunks: number;
  /** Configuration used */
  config: Required<ChunkingConfig>;
}

// Sentence boundary patterns
const SENTENCE_ENDINGS = /(?<=[.!?])\s+(?=[A-Z])/g;
const PARAGRAPH_BREAKS = /\n\n+/g;

/**
 * Split text into chunks with overlap
 */
export function chunkText(
  text: string,
  config: ChunkingConfig = {}
): ChunkedDocument {
  const finalConfig: Required<ChunkingConfig> = {
    maxChunkSize: config.maxChunkSize ?? 512,
    overlap: config.overlap ?? 50,
    strategy: config.strategy ?? 'sentence',
    minChunkSize: config.minChunkSize ?? 100,
    includeMetadata: config.includeMetadata ?? true,
  };

  // Normalize whitespace
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  let chunks: Chunk[];

  switch (finalConfig.strategy) {
    case 'character':
      chunks = chunkByCharacter(normalizedText, finalConfig);
      break;
    case 'sentence':
      chunks = chunkBySentence(normalizedText, finalConfig);
      break;
    case 'paragraph':
      chunks = chunkByParagraph(text, finalConfig); // Keep original for paragraphs
      break;
    case 'token':
      chunks = chunkByToken(normalizedText, finalConfig);
      break;
    default:
      chunks = chunkBySentence(normalizedText, finalConfig);
  }

  return {
    chunks,
    originalLength: text.length,
    totalChunks: chunks.length,
    config: finalConfig,
  };
}

/**
 * Simple character-based chunking with overlap
 */
function chunkByCharacter(
  text: string,
  config: Required<ChunkingConfig>
): Chunk[] {
  const chunks: Chunk[] = [];
  const { maxChunkSize, overlap } = config;

  let pos = 0;
  let index = 0;

  while (pos < text.length) {
    const endPos = Math.min(pos + maxChunkSize, text.length);
    const chunkText = text.slice(pos, endPos);

    chunks.push({
      text: chunkText,
      index,
      startPos: pos,
      endPos,
      length: chunkText.length,
      tokenCount: Math.ceil(chunkText.length / 4),
    });

    // Move position with overlap
    pos = endPos - overlap;
    if (pos >= text.length - overlap) {
      break;
    }
    index++;
  }

  return chunks;
}

/**
 * Sentence-aware chunking - keeps sentences intact
 */
function chunkBySentence(
  text: string,
  config: Required<ChunkingConfig>
): Chunk[] {
  const { maxChunkSize, overlap, minChunkSize } = config;

  // Split into sentences
  const sentences = text.split(SENTENCE_ENDINGS).filter(s => s.trim().length > 0);

  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStart = 0;
  let index = 0;
  let textPos = 0;

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    // If adding this sentence exceeds max size, save current chunk
    if (currentChunk.length + trimmedSentence.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      chunks.push({
        text: currentChunk.trim(),
        index,
        startPos: currentStart,
        endPos: textPos,
        length: currentChunk.length,
        tokenCount: Math.ceil(currentChunk.length / 4),
      });

      // Start new chunk with overlap (last part of previous chunk)
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + ' ' + trimmedSentence;
      currentStart = textPos - overlap;
      index++;
    } else {
      currentChunk += (currentChunk.length > 0 ? ' ' : '') + trimmedSentence;
    }

    textPos += trimmedSentence.length + 1;
  }

  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      startPos: currentStart,
      endPos: text.length,
      length: currentChunk.length,
      tokenCount: Math.ceil(currentChunk.length / 4),
    });
  }

  return chunks;
}

/**
 * Paragraph-aware chunking
 */
function chunkByParagraph(
  text: string,
  config: Required<ChunkingConfig>
): Chunk[] {
  const { maxChunkSize, minChunkSize } = config;

  // Split by paragraph breaks
  const paragraphs = text.split(PARAGRAPH_BREAKS).filter(p => p.trim().length > 0);

  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStart = 0;
  let index = 0;
  let textPos = 0;

  for (const paragraph of paragraphs) {
    const trimmedPara = paragraph.trim();

    // If single paragraph exceeds max, fall back to sentence chunking
    if (trimmedPara.length > maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push({
          text: currentChunk.trim(),
          index,
          startPos: currentStart,
          endPos: textPos,
          length: currentChunk.length,
          tokenCount: Math.ceil(currentChunk.length / 4),
        });
        index++;
      }

      // Chunk the large paragraph by sentence
      const subChunks = chunkBySentence(trimmedPara, config);
      for (const subChunk of subChunks) {
        chunks.push({
          ...subChunk,
          index,
          startPos: textPos + subChunk.startPos,
          endPos: textPos + subChunk.endPos,
        });
        index++;
      }

      currentChunk = '';
      currentStart = textPos + trimmedPara.length;
    } else if (currentChunk.length + trimmedPara.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      chunks.push({
        text: currentChunk.trim(),
        index,
        startPos: currentStart,
        endPos: textPos,
        length: currentChunk.length,
        tokenCount: Math.ceil(currentChunk.length / 4),
      });

      currentChunk = trimmedPara;
      currentStart = textPos;
      index++;
    } else {
      currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmedPara;
    }

    textPos += trimmedPara.length + 2; // +2 for paragraph break
  }

  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      text: currentChunk.trim(),
      index,
      startPos: currentStart,
      endPos: text.length,
      length: currentChunk.length,
      tokenCount: Math.ceil(currentChunk.length / 4),
    });
  }

  return chunks;
}

/**
 * Token-based chunking (approximate - uses chars/4 as estimate)
 */
function chunkByToken(
  text: string,
  config: Required<ChunkingConfig>
): Chunk[] {
  // Convert token limits to character limits (rough estimate: 1 token ≈ 4 chars)
  const charConfig: Required<ChunkingConfig> = {
    ...config,
    maxChunkSize: config.maxChunkSize * 4,
    overlap: config.overlap * 4,
    minChunkSize: config.minChunkSize * 4,
  };

  // Use sentence-aware chunking with converted limits
  return chunkBySentence(text, charConfig);
}

/**
 * Estimate token count for text
 */
export function estimateTokens(text: string): number {
  // Simple estimation: ~4 characters per token on average
  return Math.ceil(text.length / 4);
}

/**
 * Reconstruct original text from chunks (approximate)
 */
export function reconstructFromChunks(chunks: Chunk[]): string {
  if (chunks.length === 0) return '';
  if (chunks.length === 1) return chunks[0].text;

  // Sort by index
  const sorted = [...chunks].sort((a, b) => a.index - b.index);

  // Simple concatenation (overlap removal is approximate)
  let result = sorted[0].text;

  for (let i = 1; i < sorted.length; i++) {
    const chunk = sorted[i];
    const prevChunk = sorted[i - 1];

    // Find overlap by looking for common suffix/prefix
    const overlapSize = Math.min(100, prevChunk.text.length, chunk.text.length);
    const prevSuffix = prevChunk.text.slice(-overlapSize);
    const currPrefix = chunk.text.slice(0, overlapSize);

    // Find longest common overlap
    let overlap = 0;
    for (let len = overlapSize; len > 0; len--) {
      if (currPrefix.startsWith(prevSuffix.slice(-len))) {
        overlap = len;
        break;
      }
    }

    result += ' ' + chunk.text.slice(overlap);
  }

  return result.replace(/\s+/g, ' ').trim();
}
