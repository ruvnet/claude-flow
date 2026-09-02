/**
 * Dolce TeamWork Schedule Sync Script
 *
 * Scrapes the Schedules page from Dolce Clock for all Method Co locations,
 * parses individual employee shifts and the Daily Analytics Summary,
 * maps Dolce roles to dashboard positions, and upserts daily
 * per-position scheduled labor into scheduled_labor.
 *
 * Env vars required:
 *   DOLCE_USERNAME, DOLCE_PASSWORD
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * Usage:
 *   npx ts-node scripts/dolce-sync.ts                    # all locations
 *   npx ts-node scripts/dolce-sync.ts --week 2026-03-23
 *   npx ts-node scripts/dolce-sync.ts --location lowland # single location
 */

import { chromium, type Page } from 'playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config — Multi-location
// ---------------------------------------------------------------------------

const DOLCE_LOGIN_URL =
  'https://www.dolceclock.com/public/login.php?company_id=3243';
const DOLCE_SCHEDULES_URL =
  'https://www.dolceclock.com/public/?_company_id=3243';

interface DolceLocation {
  slug: string;               // CLI-friendly name
  name: string;               // Display name
  locationId: string;         // Supabase location_id
  /** Prefixes used to match schedule group names (case-insensitive) */
  groupPrefixes: string[];
  /** Primary Dolce schedule group label (matches <option> text in #loc_id) */
  primaryGroup: string;
}

// [slug, name, locationId, groupPrefixes[], primaryGroup]
const LOCATION_DATA: [string, string, string, string[], string][] = [
  ['lowland',      'Lowland',               'f36fdb18-a97b-48af-8456-7374dea4b0f9', ['lowland', 'contract'],                  'Lowland FOH'],
  ['le-supreme',   'Le Supreme',            'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce', ['lsd', 'le supreme'],                    'LSD FOH'],
  ['mulherins',    "Wm. Mulherin's Sons",   '23c02a8e-1425-441e-9650-73ae93fa68cc', ['wm. mulherin', 'wm mulherin'],          'Mulherins FOH'],
  ['quoin',        'The Quoin Restaurant',  '0eefcab2-d68d-4a2f-ae30-009b999258c7', ['the quoin'],                            'Quoin FOH'],
  ['hiroki-san',   'HIROKI-SAN Detroit',    'b4035001-0928-4ada-a0f0-f2a272393147', ['hs ', 'sakazuki', 'aladdin', 'hiroki-san'], 'HS FOH'],
  ['kampers',      "Kamper's",              'b7d3e1a4-5f2c-4a8b-9e6d-1c3f5a7b9d2e', ['kampers'],                             'Kampers FOH'],
  ['hiroki-philly','HIROKI Philadelphia',   'c21aa6c1-411e-4ed1-9b84-e9d9d143abf9', ['hiroki'],                               'Hiroki Philly FOH'],
  ['little-wing',  'Little Wing',           '574118d5-8511-41ce-8ae8-14f921fb021a', ['little wing'],                          'Little Wing FOH'],
  ['vessel',       'Vessel',                'd201e1aa-a2a7-420d-8112-91160d0bc1bc', ['vessel'],                               'Vessel FOH'],
  ['anthology',    'Anthology',             '84f4ea7f-722d-4296-894b-6ecfe389b2d5', ['anthology'],                            'Anthology FOH'],
  ['rosemary-rose','Rosemary Rose',         '757c51f9-ae4a-4dd2-9609-e231f21df72a', ['rosemary rose', 'rr '],                 'Rosemary Rose FOH'],
];

const LOCATIONS: DolceLocation[] = LOCATION_DATA.map(
  ([slug, name, locationId, groupPrefixes, primaryGroup]) => ({ slug, name, locationId, groupPrefixes, primaryGroup }),
);

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function getSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  return createClient(url, key);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getWeekBounds(referenceDate?: string): {
  monday: string;
  sunday: string;
  weekDates: string[];
} {
  const target = referenceDate
    ? new Date(referenceDate + 'T12:00:00')
    : new Date();
  const dow = target.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(target);
  monday.setDate(monday.getDate() + mondayOffset);

  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }

  return {
    monday: weekDates[0],
    sunday: weekDates[6],
    weekDates,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DolceMapping {
  dolce_role_name: string;
  dashboard_position: string;
}

/** Per-day totals from the Daily Analytics Summary */
interface DailyAnalytics {
  date: string; // YYYY-MM-DD
  schedHours: number;
  schedHrlyDollars: number;
  schedSalaryDollars: number;
}

/** A single employee shift parsed from the schedule grid */
interface ParsedShift {
  employeeName: string;
  date: string; // YYYY-MM-DD
  startTime: string; // e.g. "5:00pm"
  endTime: string; // e.g. "11:00pm"
  hours: number;
  dolceRole: string; // e.g. "Lowland server"
}

/** Aggregated hours per role per day */
interface RoleDayHours {
  date: string;
  dolceRole: string;
  totalHours: number;
}

// ---------------------------------------------------------------------------
// Time parsing
// ---------------------------------------------------------------------------

function parseTimeToMinutes(timeStr: string): number {
  const match = timeStr
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!match) return -1;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3];

  if (ampm === 'am' && hours === 12) hours = 0;
  if (ampm === 'pm' && hours !== 12) hours += 12;

  return hours * 60 + minutes;
}

function calcShiftHours(startStr: string, endStr: string): number {
  const startMin = parseTimeToMinutes(startStr);
  const endMin = parseTimeToMinutes(endStr);
  if (startMin < 0 || endMin < 0) return 0;

  let diff = endMin - startMin;
  if (diff < 0) diff += 24 * 60; // overnight shift
  return Math.round((diff / 60) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Page text parsing: Daily Analytics Summary
// ---------------------------------------------------------------------------

/**
 * Parses the Daily Analytics Summary from the page text.
 *
 * Expected text patterns:
 *   Daily Analytics Summary
 *   Location - Lowland
 *   Mar 23, 2026
 *   ...
 *   Hours  170.5  153.5
 *   $ Hrly  $2,268  $2,286
 *   Salary  $350  $350
 *   ...
 *   Mar 24, 2026
 *   ...
 */
function parseDailyAnalytics(
  text: string,
  weekDates: string[],
  extraEndMarkers?: string[],
): DailyAnalytics[] {
  const results: DailyAnalytics[] = [];

  // Extract the Daily Analytics Summary section
  const summaryStart = text.indexOf('Daily Analytics Summary');
  if (summaryStart < 0) {
    console.warn('[Parse] Daily Analytics Summary not found in page text');
    return results;
  }

  // The summary ends before schedule sections or Weekly Analytics
  // Build end markers dynamically from all known group prefixes
  const defaultEndMarkers = ['Weekly Analytics'];
  for (const loc of LOCATIONS) {
    for (const pfx of loc.groupPrefixes) {
      defaultEndMarkers.push(pfx.trim());
    }
  }
  const endMarkers = extraEndMarkers ? [...defaultEndMarkers, ...extraEndMarkers] : defaultEndMarkers;
  let summaryEnd = text.length;
  for (const marker of endMarkers) {
    const idx = text.indexOf(marker, summaryStart);
    if (idx > summaryStart && idx < summaryEnd) {
      summaryEnd = idx;
    }
  }

  const summaryText = text.substring(summaryStart, summaryEnd);
  const lines = summaryText.split('\n').map((l) => l.trim());

  // Build a year reference from weekDates
  const yearRef = weekDates[0].substring(0, 4);

  // Months for parsing "Mar 23, 2026" or "Mar 23"
  const monthMap: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04',
    may: '05', jun: '06', jul: '07', aug: '08',
    sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // Date header regex: "Mar 23, 2026" or "Mar 23"
  const dateHeaderRegex =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:,?\s*(\d{4}))?$/i;

  let currentDate: string | null = null;
  let currentAnalytics: Partial<DailyAnalytics> = {};

  for (const line of lines) {
    // Check for date header
    const dateMatch = line.match(dateHeaderRegex);
    if (dateMatch) {
      // Save previous day if we have one
      if (currentDate && currentAnalytics.schedHours !== undefined) {
        results.push({
          date: currentDate,
          schedHours: currentAnalytics.schedHours ?? 0,
          schedHrlyDollars: currentAnalytics.schedHrlyDollars ?? 0,
          schedSalaryDollars: currentAnalytics.schedSalaryDollars ?? 0,
        });
      }

      const month = monthMap[dateMatch[1].toLowerCase()];
      const day = dateMatch[2].padStart(2, '0');
      const year = dateMatch[3] || yearRef;
      currentDate = `${year}-${month}-${day}`;
      currentAnalytics = {};
      continue;
    }

    if (!currentDate) continue;

    // Parse "Hours  170.5  153.5" -> first number is scheduled
    const hoursMatch = line.match(
      /^hours?\s+([\d,.]+)\s+([\d,.]+)/i,
    );
    if (hoursMatch) {
      currentAnalytics.schedHours = parseFloat(
        hoursMatch[1].replace(/,/g, ''),
      );
      continue;
    }

    // Parse "$ Hrly  $2,268  $2,286" -> first dollar amount is scheduled
    const hrlyMatch = line.match(
      /^\$?\s*hrly\s+\$?([\d,.]+)\s+\$?([\d,.]+)/i,
    );
    if (hrlyMatch) {
      currentAnalytics.schedHrlyDollars = parseFloat(
        hrlyMatch[1].replace(/,/g, ''),
      );
      continue;
    }

    // Parse "Salary  $350  $350"
    const salaryMatch = line.match(
      /^salary\s+\$?([\d,.]+)\s+\$?([\d,.]+)/i,
    );
    if (salaryMatch) {
      currentAnalytics.schedSalaryDollars = parseFloat(
        salaryMatch[1].replace(/,/g, ''),
      );
      continue;
    }
  }

  // Don't forget the last day
  if (currentDate && currentAnalytics.schedHours !== undefined) {
    results.push({
      date: currentDate,
      schedHours: currentAnalytics.schedHours ?? 0,
      schedHrlyDollars: currentAnalytics.schedHrlyDollars ?? 0,
      schedSalaryDollars: currentAnalytics.schedSalaryDollars ?? 0,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Page text parsing: Individual Shifts
// ---------------------------------------------------------------------------

/**
 * Parses individual shifts from the schedule grid text.
 *
 * Structure:
 *   Lowland FOH
 *   Published on Mar 20th by S Stresing
 *
 *   Bar-Nadav, Jay
 *   Hrs: Shifts:
 *   Tue  4:55pm - 9:49pm Lowland support
 *   Wed  5:00pm - 11:00pm Lowland support
 *   ...
 *
 *   Bizzozero, Jacob
 *   ...
 *
 *   Lowland BOH
 *   ...
 */
function parseShifts(
  text: string,
  weekDates: string[],
  groupPrefixes?: string[],
): ParsedShift[] {
  const shifts: ParsedShift[] = [];

  // Build a day-of-week to date map for this week
  const dayNames = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayToDate = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    dayToDate.set(dayNames[i], weekDates[i]);
  }

  // Find schedule sections matching the location's group prefixes
  const prefixes = groupPrefixes || ['lowland', 'contract labor'];
  const prefixLower = prefixes.map(p => p.toLowerCase());

  // Find the earliest schedule section that matches our prefixes
  let schedStart = text.length;
  const lines_all = text.split('\n');
  for (let i = 0; i < lines_all.length; i++) {
    const lineLower = lines_all[i].trim().toLowerCase();
    if (prefixLower.some(p => lineLower.startsWith(p)) &&
        (lineLower.includes('foh') || lineLower.includes('boh') || lineLower.includes('mgt') ||
         lineLower.includes('server') || lineLower.includes('bartender') || lineLower.includes('host') ||
         lineLower.includes('cook') || lineLower.includes('dishwasher') || lineLower.includes('prep') ||
         lineLower.includes('support') || lineLower.includes('training') || lineLower.includes('pastry') ||
         lineLower.includes('runner') || lineLower.includes('bar') || lineLower.includes('s.a.') ||
         lineLower.includes('sushi') || lineLower.includes('cleaner') || lineLower.includes('keeping'))) {
      const idx = text.indexOf(lines_all[i].trim());
      if (idx >= 0 && idx < schedStart) {
        schedStart = idx;
      }
    }
  }

  if (schedStart >= text.length) {
    console.warn(`[Parse] No schedule sections found for prefixes: ${prefixes.join(', ')}`);
    return shifts;
  }

  const schedText = text.substring(schedStart);
  const lines = schedText.split('\n').map((l) => l.trim());

  // Dolce format can be EITHER:
  // Format A: "Tue  4:55pm - 9:49pm Lowland support" (one line)
  // Format B: "2:00pm - 10:45pm" (time line) then "Cook" (role on next line)
  // We also need to track which day of the week we're in based on "Hrs: NN.NN Shifts: N" headers
  const shiftLineRegexA =
    /^(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2}:\d{2}(?:am|pm))\s*-\s*(\d{1,2}:\d{2}(?:am|pm))\s+(.+)$/i;
  const timeOnlyRegex =
    /^(\d{1,2}:\d{2}(?:am|pm))\s*-\s*(\d{1,2}:\d{2}(?:am|pm))$/i;
  // Known generic role names (from Dolce — location prefixes stripped)
  const knownRoles = new Set([
    'cook', 'dishwasher', 'prep', 'server', 'bartender', 'host', 'support',
    'training', 'line cook', 'prep cook', 'pastry cook', 'food runner',
    'bar prep', 'sushi cook', 'cleaner', 'house keeping', 'polisher',
    'maitre\'d', 'lead bar admin', 'key holder', 'general manager',
    'ghost bartender', 'contract dish', 'foh training', 'boh training',
    'server assistant', 's.a.', 'bar rotunda', 'barista',
  ]);

  /** Check if a role line belongs to our location based on group prefixes */
  const matchesLocation = (line: string): boolean => {
    const lower = line.toLowerCase();
    if (prefixLower.some(p => lower.startsWith(p))) return true;
    if (knownRoles.has(lower)) return true;
    // Strip any known location prefix and check generic role
    const stripped = lower.replace(
      /^(lowland|lsd|le supreme|the quoin( restaurant)?|wm\.?\s*mulherin\S*|hiroki-san|hiroki|hs|kampers|little wing|vessel|anthology|rosemary rose|rr)\s+[-]?\s*/i,
      '',
    ).trim();
    return stripped !== lower && knownRoles.has(stripped);
  };

  const nameExclusions =
    /^(lowland\s+(foh|boh|mgt)|lsd\s+\w|the quoin|wm\.?\s*mulherin|contract\s+labor|hs\s+(server|support|bar|host|line|sushi|prep|dish)|sakazuki|aladdin|hiroki|kampers|little wing|vessel|anthology|rosemary rose|rr\s*\+|published|hrs:|shifts:|daily|weekly|location|sched|act|hours|\$|salary|overtime|total|regular|filter|all|ready)/i;
  const namePattern = /^[A-Z][a-z'-]+,\s+[A-Z]/;

  let currentEmployee = 'Unknown';
  let currentDay = 0; // index into weekDates, tracked by "Hrs:" blocks
  let pendingTime: { start: string; end: string } | null = null;

  // Track which day we're on by counting employee "Hrs:" headers per section
  // The schedule shows Mon employees first, then Tue, etc.
  // We detect day changes from explicit day headers or Hrs blocks
  const dayHeaderRegex = /^(mon|tue|wed|thu|fri|sat|sun)(?:day)?$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Check for day header
    const dayHeaderMatch = line.match(dayHeaderRegex);
    if (dayHeaderMatch) {
      const dayIdx = dayNames.indexOf(dayHeaderMatch[1].toLowerCase().substring(0, 3));
      if (dayIdx >= 0) currentDay = dayIdx;
      continue;
    }

    // Check if this is an employee name line
    if (namePattern.test(line) && !nameExclusions.test(line)) {
      currentEmployee = line.split('\n')[0].trim();
      const hrsIdx = currentEmployee.indexOf('Hrs:');
      if (hrsIdx > 0) {
        currentEmployee = currentEmployee.substring(0, hrsIdx).trim();
      }
      pendingTime = null;
      continue;
    }

    // Format A: "Tue 4:55pm - 9:49pm Lowland support"
    const shiftMatchA = line.match(shiftLineRegexA);
    if (shiftMatchA) {
      const dayAbbrev = shiftMatchA[1].toLowerCase();
      const startTime = shiftMatchA[2].toLowerCase();
      const endTime = shiftMatchA[3].toLowerCase();
      const roleName = shiftMatchA[4].trim();

      const date = dayToDate.get(dayAbbrev);
      if (!date) continue;

      const hours = calcShiftHours(startTime, endTime);

      shifts.push({
        employeeName: currentEmployee,
        date,
        startTime,
        endTime,
        hours,
        dolceRole: roleName,
      });
      pendingTime = null;
      continue;
    }

    // Format B: time-only line "2:00pm - 10:45pm"
    const timeMatch = line.match(timeOnlyRegex);
    if (timeMatch) {
      pendingTime = {
        start: timeMatch[1].toLowerCase(),
        end: timeMatch[2].toLowerCase(),
      };
      continue;
    }

    // If previous line was a time, this line might be the role name
    if (pendingTime) {
      const normalizedLine = line.toLowerCase().trim();
      if (matchesLocation(normalizedLine)) {
        const date = weekDates[currentDay] || weekDates[0];
        const hours = calcShiftHours(pendingTime.start, pendingTime.end);

        shifts.push({
          employeeName: currentEmployee,
          date,
          startTime: pendingTime.start,
          endTime: pendingTime.end,
          hours,
          dolceRole: line.trim(),
        });
        pendingTime = null;
        continue;
      }
      // Not a role name — reset pending time
      pendingTime = null;
    }

    // Track day from "Hrs: XX.XX Shifts: N" blocks — each employee has one per day
    if (/^Hrs:\s*[\d.]+\s+Shifts:\s*\d+/i.test(line)) {
      // This indicates the start of a new day's shifts for the current employee
      // We'll detect the day from the lines around it
    }
  }

  return shifts;
}

// ---------------------------------------------------------------------------
// Aggregate shifts by date + role
// ---------------------------------------------------------------------------

function aggregateShiftsByDateRole(shifts: ParsedShift[]): RoleDayHours[] {
  const agg = new Map<string, number>();

  for (const shift of shifts) {
    const key = `${shift.date}|${shift.dolceRole.toLowerCase()}`;
    agg.set(key, (agg.get(key) ?? 0) + shift.hours);
  }

  const results: RoleDayHours[] = [];
  for (const [key, totalHours] of agg) {
    const [date, dolceRole] = key.split('|');
    results.push({ date, dolceRole, totalHours });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Calculate per-position daily scheduled dollars
// ---------------------------------------------------------------------------

interface PositionDayRecord {
  date: string;
  position: string;
  scheduledDollars: number;
  scheduledHours: number;
}

function calculatePositionDayRecords(
  roleDayHours: RoleDayHours[],
  dailyAnalytics: DailyAnalytics[],
  mappingLookup: Map<string, string>,
): PositionDayRecord[] {
  const records: PositionDayRecord[] = [];

  // Build a per-date total hours from shifts (only mapped, non-excluded roles)
  const dateTotalHours = new Map<string, number>();
  const datePositionHours = new Map<string, Map<string, number>>();

  for (const rdh of roleDayHours) {
    const dashPos = findMapping(rdh.dolceRole, mappingLookup);
    if (!dashPos || dashPos === 'EXCLUDE') continue;

    dateTotalHours.set(
      rdh.date,
      (dateTotalHours.get(rdh.date) ?? 0) + rdh.totalHours,
    );

    if (!datePositionHours.has(rdh.date)) {
      datePositionHours.set(rdh.date, new Map());
    }
    const posMap = datePositionHours.get(rdh.date)!;
    posMap.set(dashPos, (posMap.get(dashPos) ?? 0) + rdh.totalHours);
  }

  // Build analytics lookup by date
  const analyticsMap = new Map<string, DailyAnalytics>();
  for (const da of dailyAnalytics) {
    analyticsMap.set(da.date, da);
  }

  // For each date, distribute the daily $ Hrly proportionally across positions
  for (const [date, posMap] of datePositionHours) {
    const totalHrs = dateTotalHours.get(date) ?? 0;
    const analytics = analyticsMap.get(date);
    const dailyDollars = analytics?.schedHrlyDollars ?? 0;

    for (const [position, posHours] of posMap) {
      let dollars: number;
      if (totalHrs > 0 && dailyDollars > 0) {
        // Distribute daily $ Hrly proportionally by hours
        dollars = Math.round((posHours / totalHrs) * dailyDollars * 100) / 100;
      } else {
        // Fallback: no analytics data, estimate at $15/hr average
        dollars = Math.round(posHours * 15 * 100) / 100;
      }

      records.push({
        date,
        position,
        scheduledDollars: dollars,
        scheduledHours: Math.round(posHours * 100) / 100,
      });
    }
  }

  return records;
}

/**
 * Find the dashboard position for a Dolce role name.
 * Tries exact match first, then strips known location prefixes, then partial matching.
 */
function findMapping(
  dolceRole: string,
  mappingLookup: Map<string, string>,
): string | undefined {
  const lower = dolceRole.toLowerCase().trim();

  // Exact match
  if (mappingLookup.has(lower)) {
    return mappingLookup.get(lower);
  }

  // Strip known location prefixes and try again
  // Longer prefixes first to avoid partial matches (hiroki-san before hiroki)
  const prefixPattern = /^(lowland|lsd|le supreme|the quoin( restaurant)?|wm\.?\s*mulherin'?s?\s*(sons)?|hiroki-san|hiroki|hs|kampers|little wing|vessel|anthology|rosemary rose|rr)\s+[-]?\s*/i;
  const withoutPrefix = lower.replace(prefixPattern, '').trim();
  if (withoutPrefix !== lower && mappingLookup.has(withoutPrefix)) {
    return mappingLookup.get(withoutPrefix);
  }

  // Try with various prefixes added back
  const allPrefixes = LOCATIONS.flatMap(l => l.groupPrefixes.map(p => p.trim().toLowerCase()));
  for (const prefix of allPrefixes) {
    const withPrefix = `${prefix} ${withoutPrefix}`.replace(/\s+/g, ' ');
    if (mappingLookup.has(withPrefix)) {
      return mappingLookup.get(withPrefix);
    }
  }

  // Partial match: check if any mapping key is contained in the role
  for (const [key, value] of mappingLookup) {
    if (lower.includes(key) || key.includes(lower)) {
      return value;
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Playwright: Login + Scrape Schedules Page
// ---------------------------------------------------------------------------

async function loginToDolce(page: Page): Promise<void> {
  const username = process.env.DOLCE_USERNAME;
  const password = process.env.DOLCE_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing DOLCE_USERNAME or DOLCE_PASSWORD');
  }

  console.log('[Dolce] Navigating to login page...');
  await page.goto(DOLCE_LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  console.log('[Dolce] Current URL:', page.url());
  console.log('[Dolce] Page title:', await page.title());

  // Fill credentials using placeholder text matching
  console.log('[Dolce] Entering credentials...');
  await page.waitForSelector('input[placeholder*="Username"]', {
    timeout: 15000,
  });

  // Type credentials using keyboard (more reliable than fill for some forms)
  await page.click('input[placeholder*="Username"]');
  await page.keyboard.type(username, { delay: 30 });
  await page.keyboard.press('Tab');
  await page.keyboard.type(password, { delay: 30 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log('[Dolce] Logged in successfully');
}

async function navigateToSchedules(page: Page): Promise<void> {
  console.log('[Dolce] Navigating to Schedules page...');
  // After login, navigate using the same domain origin to preserve cookies
  // Try clicking the Schedules link first, fall back to direct navigation
  try {
    const schedLink = await page.$('a[href*="schedule"], a:has-text("Schedule"), a:has-text("Schedules")');
    if (schedLink) {
      console.log('[Dolce] Found Schedules link, clicking...');
      await schedLink.click();
      await page.waitForTimeout(3000);
    } else {
      // Use evaluate to navigate within the same context (preserves session)
      console.log('[Dolce] No link found, navigating via location.href...');
      await page.evaluate((url) => { window.location.href = url; }, DOLCE_SCHEDULES_URL);
      await page.waitForTimeout(5000);
    }
  } catch {
    // Last resort: direct goto
    await page.goto(DOLCE_SCHEDULES_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
  }
  console.log('[Dolce] Schedules URL:', page.url());

  // Check for login redirect (error=header_info means session lost)
  if (page.url().includes('error=header_info') || page.url().includes('login.php')) {
    console.warn('[Dolce] Session lost during navigation, re-logging in...');
    // Re-enter credentials on the redirected login page
    await page.waitForTimeout(1000);
    const passField = await page.$('input[type="password"]');
    if (passField) {
      const userField = await page.$('input[name="user_email"], input[name="email"], input[type="email"], input[type="text"]');
      if (userField) {
        await userField.click({ clickCount: 3 });
        await page.keyboard.type(process.env.DOLCE_USERNAME || '');
      }
      await passField.click({ clickCount: 3 });
      await page.keyboard.type(process.env.DOLCE_PASSWORD || '');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(5000);
      // Try navigating again after re-login
      await page.evaluate((url) => { window.location.href = url; }, DOLCE_SCHEDULES_URL);
      await page.waitForTimeout(5000);
      console.log('[Dolce] After re-login URL:', page.url());
    }
  }

  // Wait for schedule content
  try {
    await page.waitForSelector('text=Daily Analytics Summary', { timeout: 20000 });
    console.log('[Dolce] Schedule page loaded');
  } catch {
    console.warn('[Dolce] Warning: schedule content not found on page');
  }
}

async function getPageText(page: Page): Promise<string> {
  console.log('[Dolce] Extracting page text...');
  const text = await page.evaluate(() => document.body.innerText);
  console.log(`[Dolce] Extracted ${text.length} characters of text`);
  return text;
}

/**
 * Extract text for a specific schedule group by selecting it in the view selector.
 * Returns null if no group selector exists on the page.
 */
async function getGroupPageText(page: Page, groupLabel: string): Promise<string | null> {
  // Look for a schedule group/location selector on the view page
  // Dolce may use a select with id containing "group", "loc", "location", or "schedule"
  const selectorIds = ['#scheduleGroupSelect', '#group_id', '#location_select', '#schedule_select', '#view_group'];
  let selectorFound = false;

  for (const sel of selectorIds) {
    const exists = await page.$(sel).then(el => !!el).catch(() => false);
    if (exists) {
      await page.selectOption(sel, { label: groupLabel });
      await page.waitForTimeout(3000);
      selectorFound = true;
      break;
    }
  }

  // Also try any select element with schedule-related options
  if (!selectorFound) {
    const selects = await page.$$('select');
    for (const sel of selects) {
      const options = await sel.$$eval('option', (opts) => opts.map(o => o.textContent?.trim()));
      if (options.some(o => o && (o.includes('FOH') || o.includes('BOH') || o.toLowerCase().includes('lowland')))) {
        // Found a schedule group selector
        try {
          await sel.selectOption({ label: groupLabel });
          await page.waitForTimeout(3000);
          selectorFound = true;
          console.log(`[Dolce] Selected group "${groupLabel}" via schedule selector`);
          break;
        } catch {
          // Label not found in this select, try next
        }
      }
    }
  }

  if (!selectorFound) {
    console.log(`[Dolce] No group selector found on page — single-group view`);
    return null;
  }

  const text = await page.evaluate(() => document.body.innerText);
  console.log(`[Dolce] Group "${groupLabel}": ${text.length} chars`);
  return text;
}

// ---------------------------------------------------------------------------
// Supabase: Fetch mappings, upsert scheduled_labor
// ---------------------------------------------------------------------------

async function fetchDolceMappings(
  sb: SupabaseClient,
  locationId: string,
): Promise<DolceMapping[]> {
  const { data, error } = await sb
    .from('dolce_job_mapping')
    .select('dolce_role_name, dashboard_position')
    .eq('location_id', locationId);

  if (error) {
    console.error('[Dolce] Error fetching mappings:', error.message);
    return [];
  }

  return data || [];
}

async function upsertScheduledLabor(
  sb: SupabaseClient,
  records: PositionDayRecord[],
  locationId: string,
): Promise<number> {
  let upserted = 0;
  for (const rec of records) {
    if (rec.scheduledDollars === 0 && rec.scheduledHours === 0) continue;

    const { error } = await sb.from('scheduled_labor').upsert(
      {
        location_id: locationId,
        business_date: rec.date,
        position: rec.position,
        scheduled_dollars: rec.scheduledDollars,
        scheduled_hours: rec.scheduledHours,
        source: 'dolce',
      },
      { onConflict: 'location_id,business_date,position' },
    );

    if (error) {
      console.error(
        `[Dolce] Upsert error for ${rec.position} on ${rec.date}:`,
        error.message,
      );
    } else {
      upserted++;
    }
  }
  return upserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Process a single location's data from the full page text */
async function syncLocation(
  loc: DolceLocation,
  pageText: string,
  weekDates: string[],
  sb: SupabaseClient,
): Promise<number> {
  console.log(`\n--- Syncing ${loc.name} (${loc.slug}) ---`);

  // Fetch role mappings for this location
  const mappings = await fetchDolceMappings(sb, loc.locationId);
  console.log(`[${loc.slug}] Loaded ${mappings.length} role mappings`);
  if (mappings.length === 0) {
    console.warn(`[${loc.slug}] No role mappings found — skipping`);
    return 0;
  }

  const mappingLookup = new Map<string, string>();
  for (const m of mappings) {
    mappingLookup.set(m.dolce_role_name.toLowerCase(), m.dashboard_position);
  }

  // 1. Parse Daily Analytics Summary
  const dailyAnalytics = parseDailyAnalytics(pageText, weekDates);
  console.log(`[${loc.slug}] Daily Analytics: ${dailyAnalytics.length} days`);

  // 2. Parse role summary totals (tab-delimited lines)
  const roleWeeklyTotals = new Map<string, number>();
  const roleSummaryRegex = /^(.+?)\t\$([\d,]+\.\d{2})\t[\d.]+%/gm;
  let match;
  while ((match = roleSummaryRegex.exec(pageText)) !== null) {
    const roleName = match[1].trim();
    const dollars = parseFloat(match[2].replace(/,/g, ''));
    if (dollars > 0 && !roleName.match(/^(total|overtime|regular|salary|hourly)/i)) {
      // Filter: only include roles that match this location's prefixes
      const lower = roleName.toLowerCase();
      const belongsHere = loc.groupPrefixes.some(p => lower.startsWith(p.toLowerCase()));
      if (belongsHere) {
        roleWeeklyTotals.set(roleName, (roleWeeklyTotals.get(roleName) ?? 0) + dollars);
      }
    }
  }

  // 2b. Try individual shift parsing
  const shifts = parseShifts(pageText, weekDates, loc.groupPrefixes);
  console.log(`[${loc.slug}] Shifts: ${shifts.length}, Role summaries: ${roleWeeklyTotals.size}`);

  const uniqueDays = new Set(shifts.map(s => s.date));
  const useRoleSummaryFallback = roleWeeklyTotals.size > 0 &&
    (shifts.length === 0 || uniqueDays.size <= 1);

  if (shifts.length === 0 && roleWeeklyTotals.size === 0) {
    if (dailyAnalytics.length === 0) {
      console.warn(`[${loc.slug}] No data found — skipping`);
      return 0;
    }
    console.warn(`[${loc.slug}] No shifts/roles — falling back to analytics totals`);
  }

  // 3. Build per-position daily records
  let positionRecords: PositionDayRecord[];

  if (useRoleSummaryFallback) {
    const totalWeekHrs = dailyAnalytics.reduce((s, d) => s + d.schedHours, 0);
    const dayWeights = dailyAnalytics.map(d => totalWeekHrs > 0 ? d.schedHours / totalWeekHrs : 1/7);
    const direct: PositionDayRecord[] = [];
    for (const [roleName, weeklyTotal] of roleWeeklyTotals) {
      const dashPos = findMapping(roleName, mappingLookup);
      if (!dashPos || dashPos === 'EXCLUDE') continue;
      for (let i = 0; i < dailyAnalytics.length; i++) {
        direct.push({
          date: dailyAnalytics[i].date,
          position: dashPos,
          scheduledDollars: Math.round(weeklyTotal * (dayWeights[i] || 0) * 100) / 100,
          scheduledHours: Math.round(dailyAnalytics[i].schedHours * (dayWeights[i] || 0) * 100) / 100,
        });
      }
    }
    // Aggregate duplicates
    const aggMap = new Map<string, PositionDayRecord>();
    for (const rec of direct) {
      const key = `${rec.date}|${rec.position}`;
      const existing = aggMap.get(key);
      if (existing) { existing.scheduledDollars += rec.scheduledDollars; existing.scheduledHours += rec.scheduledHours; }
      else aggMap.set(key, { ...rec });
    }
    positionRecords = Array.from(aggMap.values());
  } else {
    const roleDayHours = aggregateShiftsByDateRole(shifts);
    positionRecords = calculatePositionDayRecords(roleDayHours, dailyAnalytics, mappingLookup);
  }

  console.log(`[${loc.slug}] ${positionRecords.length} position records to upsert`);
  const upserted = await upsertScheduledLabor(sb, positionRecords, loc.locationId);
  console.log(`[${loc.slug}] Upserted ${upserted} records`);
  return upserted;
}

async function main(): Promise<void> {
  console.log('=== Dolce Schedule Sync (Multi-Location) ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Parse CLI arguments
  const weekArgIdx = process.argv.indexOf('--week');
  const weekDate = weekArgIdx >= 0 ? process.argv[weekArgIdx + 1] : undefined;
  const locArgIdx = process.argv.indexOf('--location');
  const locationFilter = locArgIdx >= 0 ? process.argv[locArgIdx + 1]?.toLowerCase() : undefined;

  const { monday, sunday, weekDates } = getWeekBounds(weekDate);
  console.log(`Week: ${monday} to ${sunday}`);

  // Determine which locations to sync
  const targetLocations = locationFilter
    ? LOCATIONS.filter(l => l.slug === locationFilter || l.name.toLowerCase() === locationFilter)
    : LOCATIONS;

  if (targetLocations.length === 0) {
    const slugs = LOCATIONS.map(l => l.slug).join(', ');
    console.error(`[Dolce] Unknown location "${locationFilter}". Available: ${slugs}`);
    process.exit(1);
  }

  console.log(`Locations: ${targetLocations.map(l => l.name).join(', ')}`);

  const sb = getSupabase();

  // Launch browser and scrape (single login, single page load)
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const page = await context.newPage();

  try {
    await loginToDolce(page);
    await navigateToSchedules(page);
    const defaultPageText = await getPageText(page);

    // Always save debug artifacts for inspection
    try {
      const fs = await import('fs');
      fs.writeFileSync('/tmp/dolce-page-text.txt', defaultPageText);
      await page.screenshot({ path: '/tmp/dolce-schedule.png', fullPage: true });
      // Log all links on the page that might be schedule group navigation
      const links = await page.$$eval('a', (els) =>
        els.map(e => ({ text: e.textContent?.trim().substring(0, 60), href: e.getAttribute('href')?.substring(0, 80) }))
          .filter(l => l.text && l.text.length > 0)
      );
      const selects = await page.$$eval('select', (els) =>
        els.map(e => ({ id: e.id, name: e.name, options: Array.from(e.options).map(o => o.text.trim()) }))
      );
      console.log('[Debug] All selects:', JSON.stringify(selects.slice(0, 5)));
      console.log('[Debug] Links count:', links.length);
      // Show links that might be location/group navigation
      const groupLinks = links.filter(l => l.text && (l.text.includes('FOH') || l.text.includes('BOH') || l.text.includes('Lowland') || l.text.includes('LSD') || l.text.includes('Quoin') || l.text.includes('Mulherin')));
      console.log('[Debug] Group-like links:', JSON.stringify(groupLinks.slice(0, 10)));
      console.log('[Debug] Page screenshots saved to /tmp/dolce-schedule.png');
    } catch (e) {
      console.warn('[Debug] Could not save debug artifacts:', (e as Error).message);
    }

    // Test if group selector navigation works (try switching to second location)
    const testLoc = targetLocations.find(l => l.slug !== 'lowland') ?? targetLocations[1];
    const hasGroupNav = testLoc
      ? (await getGroupPageText(page, testLoc.primaryGroup)) !== null
      : false;
    console.log(`[Dolce] Group navigation: ${hasGroupNav ? 'available' : 'not available — using full page text for all'}`);

    // If group nav works, re-navigate to first location's group to get its text fresh
    let totalUpserted = 0;
    for (const loc of targetLocations) {
      try {
        let pageText = defaultPageText;
        if (hasGroupNav) {
          const groupText = await getGroupPageText(page, loc.primaryGroup);
          if (groupText) pageText = groupText;
        }
        totalUpserted += await syncLocation(loc, pageText, weekDates, sb);
      } catch (err) {
        console.error(`[${loc.slug}] Error:`, err);
      }
    }

    console.log(`\n=== Dolce Sync Complete: ${totalUpserted} total records ===`);
  } catch (err) {
    console.error('[Dolce] Fatal error:', err);
    try {
      await page.screenshot({ path: '/tmp/dolce-error.png', fullPage: true });
    } catch { /* ignore */ }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
