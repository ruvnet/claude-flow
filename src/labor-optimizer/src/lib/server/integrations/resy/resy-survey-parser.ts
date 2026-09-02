/**
 * Resy guest survey CSV parser.
 *
 * Parses CSV exports from Resy's survey system. Expected columns:
 *   Date, Guest Name, Guest Email, Server, Recommend (0-10),
 *   Food (1-5), Service (1-5), Ambiance (1-5), Value (1-5),
 *   Overall (1-5), Comments
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedSurveyRow {
  survey_date: string;
  guest_name: string | null;
  guest_email: string | null;
  server_name: string | null;
  recommend_score: number | null;
  food_score: number | null;
  service_score: number | null;
  ambiance_score: number | null;
  value_score: number | null;
  overall_score: number | null;
  comment: string | null;
}

export interface ParseResult {
  rows: ParsedSurveyRow[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a Resy survey CSV string into structured rows.
 *
 * Handles common variations in column naming and is lenient with
 * missing optional fields.
 */
export function parseResySurveyCsv(csvText: string): ParseResult {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must have at least a header row and one data row'] };
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => h.toLowerCase().trim());

  // Map headers to column indices
  const colMap = {
    date: findCol(headers, ['date', 'survey_date', 'visit_date']),
    guestName: findCol(headers, ['guest name', 'guest_name', 'name']),
    guestEmail: findCol(headers, ['guest email', 'guest_email', 'email']),
    server: findCol(headers, ['server', 'server_name', 'staff']),
    recommend: findCol(headers, ['recommend', 'recommend_score', 'nps', 'recommendation']),
    food: findCol(headers, ['food', 'food_score', 'food quality']),
    service: findCol(headers, ['service', 'service_score', 'service quality']),
    ambiance: findCol(headers, ['ambiance', 'ambiance_score', 'atmosphere']),
    value: findCol(headers, ['value', 'value_score']),
    overall: findCol(headers, ['overall', 'overall_score', 'overall rating']),
    comment: findCol(headers, ['comments', 'comment', 'feedback', 'notes']),
  };

  if (colMap.date === -1) {
    return { rows: [], errors: ['Could not find a "Date" column in the CSV header'] };
  }

  const rows: ParsedSurveyRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    try {
      const cols = parseCSVLine(line);
      const dateStr = parseDate(cols[colMap.date] ?? '');

      if (!dateStr) {
        errors.push(`Row ${i + 1}: Invalid or missing date`);
        continue;
      }

      rows.push({
        survey_date: dateStr,
        guest_name: getStr(cols, colMap.guestName),
        guest_email: getStr(cols, colMap.guestEmail),
        server_name: getStr(cols, colMap.server),
        recommend_score: getInt(cols, colMap.recommend, 0, 10),
        food_score: getInt(cols, colMap.food, 1, 5),
        service_score: getInt(cols, colMap.service, 1, 5),
        ambiance_score: getInt(cols, colMap.ambiance, 1, 5),
        value_score: getInt(cols, colMap.value, 1, 5),
        overall_score: getInt(cols, colMap.overall, 1, 5),
        comment: getStr(cols, colMap.comment),
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: ${(err as Error).message}`);
    }
  }

  return { rows, errors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findCol(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = headers.indexOf(c);
    if (idx !== -1) return idx;
  }
  return -1;
}

function getStr(cols: string[], idx: number): string | null {
  if (idx === -1 || idx >= cols.length) return null;
  const v = cols[idx].trim();
  return v || null;
}

function getInt(cols: string[], idx: number, min: number, max: number): number | null {
  if (idx === -1 || idx >= cols.length) return null;
  const raw = cols[idx].trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Try MM/DD/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Try parsing with Date constructor as fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

/**
 * Parse a single CSV line, respecting quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}
