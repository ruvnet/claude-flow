// @ts-check
/**
 * ruOS auto-stop window (ADR-405 §Cost and auto-stop).
 *
 * The fleet stops cloud desktops at 23:00 America/Toronto every weekday
 * (Mon–Fri); `desktop_keepawake` only blocks idle autosleep and does NOT
 * override this. A run whose deadline crosses the next stop would be killed
 * mid-flight, so the adapter refuses it unless the caller opts in.
 * Zero dependencies: Intl does the time-zone arithmetic (DST included).
 */
export const AUTOSTOP_TZ = 'America/Toronto';
export const AUTOSTOP_HOUR = 23;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: AUTOSTOP_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

/**
 * @param {number} ms
 * @returns {{ y: number, m: number, d: number, hour: number, minute: number, weekday: string }}
 */
function torontoParts(ms) {
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of fmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: p.weekday,
  };
}

const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

/**
 * The UTC instant of 23:00 Toronto on the given Toronto calendar date.
 * Toronto is UTC-4 (EDT) or UTC-5 (EST); pick the offset that round-trips.
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @returns {number}
 */
function torontoElevenPm(y, m, d) {
  for (const offsetH of [4, 5]) {
    const ms = Date.UTC(y, m - 1, d, AUTOSTOP_HOUR + offsetH, 0, 0);
    const p = torontoParts(ms);
    if (p.y === y && p.m === m && p.d === d && p.hour === AUTOSTOP_HOUR && p.minute === 0) return ms;
  }
  throw new Error('unreachable: no Toronto offset round-trips');
}

/**
 * Next auto-stop instant strictly after `nowMs`.
 * @param {number} nowMs
 * @returns {number}
 */
export function nextAutoStop(nowMs) {
  for (let day = 0; day <= 7; day++) {
    // Noon-anchored stepping keeps us on the intended calendar day across DST.
    const p = torontoParts(nowMs + day * 86_400_000);
    if (!WEEKDAYS.has(p.weekday)) continue;
    const stop = torontoElevenPm(p.y, p.m, p.d);
    if (stop > nowMs) return stop;
  }
  throw new Error('unreachable: no weekday within 8 days');
}

/**
 * @typedef {object} WindowCheck
 * @property {boolean} ok
 * @property {number} nextStopMs
 * @property {number} minutesUntilStop
 */

/**
 * Does a run that may last `timeoutSecs` finish before the next auto-stop?
 * @param {number} nowMs
 * @param {number} timeoutSecs
 * @returns {WindowCheck}
 */
export function checkWindow(nowMs, timeoutSecs) {
  const nextStopMs = nextAutoStop(nowMs);
  return {
    ok: nowMs + timeoutSecs * 1000 < nextStopMs,
    nextStopMs,
    minutesUntilStop: Math.floor((nextStopMs - nowMs) / 60_000),
  };
}
