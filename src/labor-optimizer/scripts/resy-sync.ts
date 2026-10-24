/**
 * Resy Reservation Sync Script
 *
 * Scrapes the Resy OS portal for all Method Co venues to pull:
 *   1. Upcoming Covers (forward-looking booked covers from Home page)
 *   2. Daily Covers Report (historical covers from Analytics > Covers)
 *
 * Upserts all data into the daily_reservations table in Supabase.
 *
 * Env vars required:
 *   RESY_USERNAME, RESY_PASSWORD
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * Usage:
 *   npx tsx scripts/resy-sync.ts                       # all venues
 *   npx tsx scripts/resy-sync.ts --month 2026-03
 *   npx tsx scripts/resy-sync.ts --venue lowland       # single venue
 */

import { chromium, type Page, type BrowserContext } from 'playwright';

// ---------------------------------------------------------------------------
// Config — Multi-venue
// ---------------------------------------------------------------------------

const RESY_LOGIN_URL = 'https://os.resy.com/portal';

interface ResyVenue {
  slug: string;              // CLI-friendly name
  name: string;              // Display name (matches Resy OS)
  locationId: string;        // Supabase location_id
  /** Resy OS URL path segment, e.g. "chs/lowland" */
  urlPath: string;
}

// NOTE: urlPath values below use {city_code}/{venue_slug} format from Resy OS.
// Verify exact slugs against the live portal on first run; adjust if needed.
const VENUES: ResyVenue[] = [
  {
    slug: 'lowland',
    name: 'Lowland',
    locationId: 'f36fdb18-a97b-48af-8456-7374dea4b0f9',
    urlPath: 'chs/lowland',
  },
  {
    slug: 'le-supreme',
    name: 'Le Suprême',
    locationId: 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce',
    urlPath: 'dtw/le-supreme',
  },
  {
    slug: 'mulherins',
    name: "Wm. Mulherin's Sons",
    locationId: '23c02a8e-1425-441e-9650-73ae93fa68cc',
    urlPath: 'phi/wm-mulherins-sons',
  },
  {
    slug: 'the-quoin',
    name: 'The Quoin Restaurant',
    locationId: '0eefcab2-d68d-4a2f-ae30-009b999258c7',
    urlPath: 'wil/the-quoin-restaurant',
  },
  {
    slug: 'hiroki-san',
    name: 'HIROKI-SAN Detroit',
    locationId: 'b4035001-0928-4ada-a0f0-f2a272393147',
    urlPath: 'dtw/hiroki-san-detroit',
  },
  {
    slug: 'hiroki-philly',
    name: 'HIROKI Philadelphia',
    locationId: 'c21aa6c1-411e-4ed1-9b84-e9d9d143abf9',
    urlPath: 'phi/hiroki-philadelphia',
  },
  {
    slug: 'kampers',
    name: "Kamper's",
    locationId: 'b7d3e1a4-5f2c-4a8b-9e6d-1c3f5a7b9d2e',
    urlPath: 'dtw/kampers',
  },
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ---------------------------------------------------------------------------
// Supabase REST helpers (no SDK dependency for standalone script)
// ---------------------------------------------------------------------------

async function supabaseUpsert(
  table: string,
  row: Record<string, unknown>,
  onConflict: string,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': `resolution=merge-duplicates`,
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed (${res.status}): ${body}`);
  }
}

async function supabaseInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UpcomingCover {
  date: string;       // YYYY-MM-DD
  covers: number;
}

interface DailyCoverRow {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;
  service: string;
  totalCovers: number;
  coversVsPrevWeek: number | null;
  reservedCovers: number;
  walkinCovers: number;
  waitlistCovers: number;
  noShowCovers: number;
  noShowParties: number;
  noShowResRate: number | null;
}

interface HomeSummary {
  coversBooked: number;
  firstTimeGuests: number;
  returningGuests: number;
  vips: number;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getCurrentMonthStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Parse "Thu Mar 26" or "Fri Mar 27" relative to the current year into YYYY-MM-DD */
function parseUpcomingDate(text: string): string | null {
  // Remove the day-of-week prefix if present, e.g., "Thu Mar 26" -> "Mar 26"
  const cleaned = text.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i, '').trim();

  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };

  const match = cleaned.match(/^(\w{3})\s+(\d{1,2})$/);
  if (!match) return null;

  const monthNum = months[match[1]];
  if (monthNum === undefined) return null;

  const day = parseInt(match[2], 10);
  const year = new Date().getFullYear();

  const d = new Date(year, monthNum, day);
  return d.toISOString().split('T')[0];
}

/** Convert month arg "2026-03" to display format "Mar 2026" for Resy dropdown */
function monthArgToDisplay(monthArg: string): string {
  const [year, month] = monthArg.split('-');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[parseInt(month, 10) - 1]} ${year}`;
}

// ---------------------------------------------------------------------------
// Playwright: Login
// ---------------------------------------------------------------------------

async function loginToResy(page: Page): Promise<void> {
  const username = process.env.RESY_USERNAME;
  const password = process.env.RESY_PASSWORD;
  if (!username || !password) {
    throw new Error('Missing RESY_USERNAME or RESY_PASSWORD');
  }

  console.log('[Resy] Navigating to login page...');
  await page.goto(RESY_LOGIN_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Check if we're already logged in — must be on a venue page, NOT the login page
  const currentUrl = page.url();
  if (currentUrl.includes('/portal/') && !currentUrl.includes('/login')) {
    console.log('[Resy] Already logged in');
    return;
  }

  // Resy OS login: single form with Email Address + Password + Log In button
  console.log('[Resy] Entering credentials...');

  const emailInput = page.locator('input[placeholder="Email Address"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });
  await emailInput.fill(username);

  const passwordInput = page.locator('input[placeholder="Password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 5000 });
  await passwordInput.fill(password);

  const loginBtn = page.locator('button:has-text("Log In")').first();

  // Take pre-login screenshot for debugging
  await page.screenshot({ path: '/tmp/resy-pre-login.png', fullPage: true });
  console.log('[Resy] Pre-login screenshot saved');

  // Click and wait for navigation
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
    loginBtn.click(),
  ]);
  await page.waitForTimeout(3000);

  // Take post-login screenshot
  await page.screenshot({ path: '/tmp/resy-post-login.png', fullPage: true });
  console.log('[Resy] Post-login screenshot saved');

  // Wait for navigation after login
  console.log('[Resy] Waiting for post-login navigation...');
  await page.waitForTimeout(5000);

  // Verify we're past the login page
  const postLoginUrl = page.url();
  if (!postLoginUrl.includes('/portal/') && !postLoginUrl.includes('/venues')) {
    // Might need to handle MFA or additional auth steps
    console.warn(`[Resy] Unexpected URL after login: ${postLoginUrl}`);
    await page.screenshot({ path: '/tmp/resy-login-debug.png', fullPage: true });
    console.log('[Resy] Debug screenshot saved to /tmp/resy-login-debug.png');
  }

  console.log('[Resy] Login successful');
  console.log('[Resy] Post-login URL:', page.url());
  // Debug: dump page text after login to see venue list
  const postLoginText = await page.evaluate('document.body.innerText') as string;
  console.log('[Resy] Post-login page text (first 500 chars):', postLoginText.substring(0, 500));
}

// ---------------------------------------------------------------------------
// Playwright: Navigate to a venue
// ---------------------------------------------------------------------------

function venueHomeUrl(venue: ResyVenue): string {
  return `https://os.resy.com/portal/${venue.urlPath}/Home`;
}

function venueCoversUrl(venue: ResyVenue): string {
  return `https://os.resy.com/portal/${venue.urlPath}/analytics/Covers`;
}

async function navigateToVenue(page: Page, venue: ResyVenue): Promise<void> {
  const currentUrl = page.url();
  const homeUrl = venueHomeUrl(venue);

  // If already on this venue, skip
  if (currentUrl.includes(`/${venue.urlPath}/`)) {
    console.log(`[Resy] Already on ${venue.name}`);
    return;
  }

  // Navigate directly to the venue Home page
  console.log(`[Resy] Navigating to ${venue.name}...`);
  await page.goto(homeUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log(`[Resy] On venue page: ${page.url()}`);
}

// ---------------------------------------------------------------------------
// Scrape: Home page — Upcoming Covers + Today Summary
// ---------------------------------------------------------------------------

async function scrapeUpcomingCovers(page: Page, venue: ResyVenue): Promise<UpcomingCover[]> {
  console.log(`[Resy] Scraping Upcoming Covers for ${venue.name}...`);

  // Make sure we're on the Home page
  if (!page.url().includes('/Home')) {
    await page.goto(venueHomeUrl(venue), { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  // Scroll down to ensure "Upcoming Covers" section is visible
  await page.evaluate('window.scrollBy(0, 500)');
  await page.waitForTimeout(1000);

  // Extract innerText in Node.js to avoid esbuild __name issue in page.evaluate
  const homeText = await page.evaluate('document.body.innerText');

  const covers: Array<{ dateText: string; covers: number }> = [];
  const upcomingIdx = homeText.indexOf('Upcoming Covers');
  if (upcomingIdx >= 0) {
    const afterText = homeText.substring(upcomingIdx + 'Upcoming Covers'.length, upcomingIdx + 2000);
    const lines = afterText.split('\n').map((l: string) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const combinedMatch = line.match(/^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w{3}\s+\d{1,2})[:\s]+(\d+)/i);
      if (combinedMatch) {
        covers.push({ dateText: combinedMatch[1], covers: parseInt(combinedMatch[2], 10) });
        continue;
      }
      const dateMatch = line.match(/^((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\w{3}\s+\d{1,2})$/i);
      if (dateMatch && i + 1 < lines.length) {
        const numMatch = lines[i + 1].match(/^(\d+)$/);
        if (numMatch) {
          covers.push({ dateText: dateMatch[1], covers: parseInt(numMatch[1], 10) });
          i++;
        }
      }
    }
  }

  const parsed: UpcomingCover[] = [];
  for (const c of covers) {
    const date = parseUpcomingDateInBrowser(c.dateText);
    if (date) {
      parsed.push({ date, covers: c.covers });
    }
  }

  console.log(`[Resy] Found ${parsed.length} upcoming cover entries`);
  for (const c of parsed) {
    console.log(`  ${c.date}: ${c.covers} covers`);
  }

  return parsed;
}

/** Browser-safe version of parseUpcomingDate (duplicated for evaluate context) */
function parseUpcomingDateInBrowser(text: string): string | null {
  return parseUpcomingDate(text);
}

async function scrapeHomeSummary(page: Page, venue: ResyVenue): Promise<HomeSummary | null> {
  console.log(`[Resy] Scraping today summary for ${venue.name}...`);

  if (!page.url().includes('/Home')) {
    await page.goto(venueHomeUrl(venue), { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
  }

  // Extract text in Node.js to avoid esbuild __name issue
  const summaryText = await page.evaluate('document.body.innerText') as string;

  function extractNum(text: string, label: string): number {
    const pattern = new RegExp(label + '[:\\s]*(\\d+)', 'i');
    const match = text.match(pattern);
    return match ? parseInt(match[1], 10) : 0;
  }

  const coversBooked = extractNum(summaryText, 'Covers booked') || extractNum(summaryText, 'Covers');
  const firstTimeGuests = extractNum(summaryText, 'First.time guests') || extractNum(summaryText, 'First time');
  const returningGuests = extractNum(summaryText, 'Returning guests') || extractNum(summaryText, 'Returning');
  const vips = extractNum(summaryText, 'VIPs') || extractNum(summaryText, 'VIP');

  const summary = (coversBooked === 0 && firstTimeGuests === 0 && returningGuests === 0 && vips === 0)
    ? null
    : { coversBooked, firstTimeGuests, returningGuests, vips };

  if (summary) {
    console.log(`[Resy] Today summary: ${summary.coversBooked} covers booked, ` +
      `${summary.firstTimeGuests} first-time, ${summary.returningGuests} returning, ${summary.vips} VIPs`);
  } else {
    console.log('[Resy] Could not parse today summary cards');
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Scrape: Analytics > Covers page — historical daily data
// ---------------------------------------------------------------------------

async function scrapeDailyCovers(page: Page, venue: ResyVenue, targetMonth?: string): Promise<DailyCoverRow[]> {
  console.log(`[Resy] Navigating to Covers report for ${venue.name}...`);
  await page.goto(venueCoversUrl(venue), { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Select month if specified
  if (targetMonth) {
    const displayMonth = monthArgToDisplay(targetMonth);
    console.log(`[Resy] Selecting month: ${displayMonth}`);

    // Try dropdown/select for month
    const monthSelector = page.locator(
      'select:near(:text("Month")), select[class*="month"], ' +
      '[data-testid*="month"], button:has-text("Mar 2026")'
    ).first();

    try {
      if (await monthSelector.isVisible({ timeout: 5000 })) {
        const tagName = await monthSelector.evaluate(el => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await monthSelector.selectOption({ label: displayMonth });
        } else {
          // It's a button/dropdown — click and select
          await monthSelector.click();
          await page.waitForTimeout(500);
          const option = page.locator(`text="${displayMonth}"`).first();
          if (await option.isVisible({ timeout: 3000 })) {
            await option.click();
          }
        }
        await page.waitForTimeout(2000);
      }
    } catch {
      console.warn('[Resy] Could not select month via dropdown, trying other methods...');

      // Try clicking text that matches the month
      try {
        const monthLink = page.locator(`text="${displayMonth}"`).first();
        if (await monthLink.isVisible({ timeout: 3000 })) {
          await monthLink.click();
          await page.waitForTimeout(2000);
        }
      } catch {
        console.warn('[Resy] Month selection failed, proceeding with default month');
      }
    }
  }

  // Wait for table to load
  await page.waitForTimeout(2000);

  console.log('[Resy] Parsing daily covers table...');

  // Extract page text in Node.js to avoid esbuild __name issue in page.evaluate
  const coversPageText = await page.evaluate('document.body.innerText') as string;

  const rows: Array<{
    dateText: string;
    dayOfWeek: string;
    service: string;
    totalCovers: number;
      coversVsPrevWeek: number | null;
      reservedCovers: number;
      walkinCovers: number;
      waitlistCovers: number;
      noShowCovers: number;
      noShowParties: number;
      noShowResRate: number | null;
    }> = [];

  function parseNum(text: string): number {
    if (!text) return 0;
    const cleaned = text.replace(/[,\s%$]/g, '');
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  // Text-based parsing of cover data (Node.js side)
  const coversLines = coversPageText.split('\n').map((l: string) => l.trim()).filter(Boolean);
  for (const line of coversLines) {
    const parts = line.split(/\t+/);
    if (parts.length >= 5) {
      const dateText = parts[0];
      if (/\w{3}\s+\d{1,2}/.test(dateText) || /\d{1,2}\/\d{1,2}/.test(dateText)) {
        if (dateText.toLowerCase().includes('total')) continue;
        rows.push({
          dateText,
          dayOfWeek: parts[1] || '',
          service: parts[2] || 'Dinner',
          totalCovers: parseNum(parts[3] || '0'),
          coversVsPrevWeek: parts[4] ? parseNum(parts[4]) : null,
          reservedCovers: parseNum(parts[5] || '0'),
          walkinCovers: parseNum(parts[6] || '0'),
          waitlistCovers: parseNum(parts[7] || '0'),
          noShowCovers: parseNum(parts[8] || '0'),
          noShowParties: parseNum(parts[8] || '0'),
          noShowResRate: parts[9] ? parseNum(parts[9]) : null,
        });
      }
    }
  }

  // Convert date texts to YYYY-MM-DD
  const month = targetMonth || getCurrentMonthStr();
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);

  const parsed: DailyCoverRow[] = [];
  for (const row of rows) {
    const date = parseCoverDate(row.dateText, year, monthNum);
    if (date) {
      parsed.push({
        ...row,
        date,
      });
    }
  }

  console.log(`[Resy] Parsed ${parsed.length} daily cover rows`);
  for (const r of parsed) {
    console.log(`  ${r.date} (${r.dayOfWeek}): total=${r.totalCovers}, reserved=${r.reservedCovers}, ` +
      `walkin=${r.walkinCovers}, noshow=${r.noShowCovers}`);
  }

  return parsed;
}

/** Parse date text from the covers table (e.g., "Mar 1", "3/1", "2026-03-01") */
function parseCoverDate(text: string, year: number, month: number): string | null {
  if (!text) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // "Mar 1" or "Mar 01"
  const monthNames: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  };
  const mNameMatch = text.match(/^(\w{3})\s+(\d{1,2})$/);
  if (mNameMatch) {
    const m = monthNames[mNameMatch[1]];
    if (m) {
      const d = parseInt(mNameMatch[2], 10);
      return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  // "3/1" or "03/01"
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const m = parseInt(slashMatch[1], 10);
    const d = parseInt(slashMatch[2], 10);
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // Just a day number? Use the target month
  const dayOnly = text.match(/^(\d{1,2})$/);
  if (dayOnly) {
    const d = parseInt(dayOnly[1], 10);
    if (d >= 1 && d <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Upsert to Supabase
// ---------------------------------------------------------------------------

async function upsertDailyReservations(
  historicalRows: DailyCoverRow[],
  upcomingCovers: UpcomingCover[],
  locationId: string,
): Promise<number> {
  const now = new Date().toISOString();
  let upserted = 0;

  // Upsert historical data (full detail)
  for (const row of historicalRows) {
    try {
      await supabaseUpsert('daily_reservations', {
        location_id: locationId,
        business_date: row.date,
        total_covers: row.totalCovers,
        booked_covers: row.reservedCovers,
        walkin_covers: row.walkinCovers,
        no_show_count: row.noShowCovers || row.noShowParties,
        synced_at: now,
        source: 'resy_scraper',
      }, 'location_id,business_date');
      upserted++;
    } catch (err: any) {
      console.error(`[Resy] Upsert error for ${row.date}:`, err.message);
    }
  }

  // Upsert upcoming (future) covers — only booked_covers since these are forward-looking
  const historicalDates = new Set(historicalRows.map(r => r.date));
  const today = new Date().toISOString().split('T')[0];

  for (const uc of upcomingCovers) {
    // Skip if we already have historical data for this date (more complete)
    if (historicalDates.has(uc.date)) continue;

    try {
      await supabaseUpsert('daily_reservations', {
        location_id: locationId,
        business_date: uc.date,
        booked_covers: uc.covers,
        synced_at: now,
      }, 'location_id,business_date');
      upserted++;
    } catch (err: any) {
      console.error(`[Resy] Upsert error for upcoming ${uc.date}:`, err.message);
    }

    // Track pickup: insert snapshot (NOT upsert — preserve time series)
    const targetDate = new Date(uc.date + 'T12:00:00');
    const todayDate = new Date(today + 'T12:00:00');
    const daysOut = Math.round((targetDate.getTime() - todayDate.getTime()) / 86400000);
    try {
      await supabaseInsert('reservation_pickup', {
        location_id: locationId,
        business_date: uc.date,
        days_out: daysOut,
        booked_covers: uc.covers,
      });
    } catch (_) { /* ignore — duplicate snapshots in same run are fine */ }
  }

  return upserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Sync a single venue: navigate, scrape, upsert */
async function syncVenue(
  page: Page,
  venue: ResyVenue,
  targetMonth?: string,
): Promise<number> {
  console.log(`\n--- Syncing ${venue.name} (${venue.slug}) ---`);

  await navigateToVenue(page, venue);

  // Scrape upcoming covers from Home page
  let upcomingCovers: UpcomingCover[] = [];
  let homeSummary: HomeSummary | null = null;
  try {
    upcomingCovers = await scrapeUpcomingCovers(page, venue);
    homeSummary = await scrapeHomeSummary(page, venue);
  } catch (err: any) {
    console.warn(`[${venue.slug}] Could not scrape Home page: ${err.message}`);
    await page.screenshot({ path: `/tmp/resy-${venue.slug}-home-debug.png`, fullPage: true });
  }

  // Scrape daily covers from Analytics > Covers
  let dailyCoverRows: DailyCoverRow[] = [];
  try {
    dailyCoverRows = await scrapeDailyCovers(page, venue, targetMonth);
  } catch (err: any) {
    console.warn(`[${venue.slug}] Could not scrape Covers report: ${err.message}`);
    await page.screenshot({ path: `/tmp/resy-${venue.slug}-covers-debug.png`, fullPage: true });
  }

  if (dailyCoverRows.length === 0 && upcomingCovers.length === 0) {
    console.warn(`[${venue.slug}] No data scraped — skipping`);
    return 0;
  }

  // Upsert to Supabase
  const upserted = await upsertDailyReservations(dailyCoverRows, upcomingCovers, venue.locationId);
  console.log(`[${venue.slug}] Upserted ${upserted} records (${dailyCoverRows.length} historical + ${upcomingCovers.length} upcoming)`);
  if (homeSummary) {
    console.log(`[${venue.slug}] Today: ${homeSummary.coversBooked} covers, ${homeSummary.firstTimeGuests} first-time, ${homeSummary.returningGuests} returning, ${homeSummary.vips} VIPs`);
  }
  return upserted;
}

async function main(): Promise<void> {
  console.log('=== Resy Reservation Sync (Multi-Venue) ===');
  console.log(`Time: ${new Date().toISOString()}`);

  // Validate env vars
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  }
  if (!process.env.RESY_USERNAME || !process.env.RESY_PASSWORD) {
    throw new Error('Missing RESY_USERNAME or RESY_PASSWORD');
  }

  // Parse CLI arguments
  const monthArgIdx = process.argv.indexOf('--month');
  const targetMonth = monthArgIdx >= 0 ? process.argv[monthArgIdx + 1] : undefined;
  const venueArgIdx = process.argv.indexOf('--venue');
  const venueFilter = venueArgIdx >= 0 ? process.argv[venueArgIdx + 1]?.toLowerCase() : undefined;

  if (targetMonth) {
    if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new Error(`Invalid --month format: ${targetMonth}. Expected YYYY-MM`);
    }
    console.log(`Target month: ${targetMonth}`);
  } else {
    console.log(`Target month: ${getCurrentMonthStr()} (current)`);
  }

  // Determine which venues to sync
  const targetVenues = venueFilter
    ? VENUES.filter(v => v.slug === venueFilter || v.name.toLowerCase() === venueFilter)
    : VENUES;

  if (targetVenues.length === 0) {
    const slugs = VENUES.map(v => v.slug).join(', ');
    console.error(`[Resy] Unknown venue "${venueFilter}". Available: ${slugs}`);
    process.exit(1);
  }

  console.log(`Venues: ${targetVenues.map(v => v.name).join(', ')}`);

  // Launch browser (single login, then iterate venues)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await loginToResy(page);

    let totalUpserted = 0;
    for (const venue of targetVenues) {
      try {
        totalUpserted += await syncVenue(page, venue, targetMonth);
      } catch (err: any) {
        console.error(`[${venue.slug}] Error: ${err.message}`);
        await page.screenshot({ path: `/tmp/resy-${venue.slug}-error.png`, fullPage: true }).catch(() => {});
      }
    }

    console.log(`\n=== Resy Sync Complete: ${totalUpserted} total records across ${targetVenues.length} venue(s) ===`);
  } catch (err) {
    console.error('[Resy] Fatal error:', err);
    try {
      await page.screenshot({ path: '/tmp/resy-error.png', fullPage: true });
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
