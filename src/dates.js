/**
 * Deterministic due-date resolver. Language models are unreliable at calendar math
 * ("next Friday" said on a Tuesday), so the model returns the spoken phrase and this
 * code turns it into a date relative to the day the note was recorded.
 *
 * Conventions (documented in the README):
 *  - "Friday" / "by Friday"  -> the next Friday after the recording day
 *  - "this Friday"           -> Friday of the current week (or the next one if it has passed)
 *  - "next Friday"           -> Friday of next week
 *  - "next week"             -> Monday of next week; "end of next week" -> its Friday
 *  - "end of week" / EOW     -> Friday of this week
 *  - "end of month" / EOM, "end of quarter", "end of year", "next month" (the 1st)
 *  - "in 3 days", "in two weeks", "in a couple of days", "within a week"
 *  - "November 15", "15 Nov", "the 15th" (next occurrence), ISO dates
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, couple: 2, 'a couple of': 2, few: 3, 'a few': 3 };

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (isoDate, n) => {
  const d = toDate(isoDate);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
export const weekdayOf = (isoDate) => toDate(isoDate).getUTCDay();
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function dayIndex(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (DAYS.includes(w)) return DAYS.indexOf(w);
  if (w.endsWith('s') && DAYS.includes(w.slice(0, -1))) return DAYS.indexOf(w.slice(0, -1));
  return DAY_ABBR[w] ?? -1;
}

function monthIndex(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m.startsWith(w) && (w.length >= 3));
}

/** Monday of the week that contains `isoDate` (weeks start on Monday). */
const mondayOf = (isoDate) => addDays(isoDate, -((weekdayOf(isoDate) + 6) % 7));

function nextWeekday(ref, target, { strictlyAfter = true } = {}) {
  let diff = (target - weekdayOf(ref) + 7) % 7;
  if (diff === 0 && strictlyAfter) diff = 7;
  return addDays(ref, diff);
}

function parseCount(s) {
  const t = s.trim().toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NUMBERS[t] ?? NUMBERS[t.replace(/ of$/, '')] ?? null;
}

/**
 * @param {string} phrase  e.g. "by next Friday", "end of the month", "tomorrow morning"
 * @param {string} ref     recording date YYYY-MM-DD
 * @returns {string|null}  YYYY-MM-DD
 */
export function resolveDuePhrase(phrase, ref) {
  if (!phrase || !ref) return null;
  let p = ` ${String(phrase).toLowerCase().replace(/[’']/g, "'").replace(/[,.!?;]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  // Time-of-day words do not change the date.
  p = p.replace(/\b(morning|afternoon|evening|night|noon|midday|first thing|latest|at the latest|close of play|cop|\d{1,2}(:\d{2})?\s?(am|pm)|o'clock)\b/g, ' ');
  p = p.replace(/\bend-of\b/g, 'end of').replace(/\s+/g, ' ');

  const isoMatch = p.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return iso(toDate(isoMatch[0])) === isoMatch[0] ? isoMatch[0] : null;

  if (/\b(today|tonight|eod|end of (the )?day|close of business|cob|this afternoon)\b/.test(p)) return ref;
  if (/\bday after tomorrow\b/.test(p)) return addDays(ref, 2);
  if (/\btomorrow\b/.test(p)) return addDays(ref, 1);

  const inN = p.match(/\b(?:in|within)\s+(\d+|a couple of|a few|couple|few|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty)\s+(business days?|working days?|days?|weeks?|months?)\b/);
  if (inN) {
    const n = parseCount(inN[1]);
    if (n) {
      const unit = inN[2];
      if (/business|working/.test(unit)) return addBusinessDays(ref, n);
      if (unit.startsWith('day')) return addDays(ref, n);
      if (unit.startsWith('week')) return addDays(ref, 7 * n);
      return addMonths(ref, n);
    }
  }

  const monday = mondayOf(ref);
  // "Wednesday next week"
  const dayNextWeek = p.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(?:of\s+)?next week\b/);
  if (dayNextWeek) return addDays(monday, 7 + ((dayIndex(dayNextWeek[1]) + 6) % 7));
  if (/\b(end of next week|next week's end)\b/.test(p)) return addDays(monday, 11);
  if (/\b(eow|end of (the |this )?week|this week|by the weekend|before the weekend)\b/.test(p)) {
    const friday = addDays(monday, 4);
    return friday >= ref ? friday : ref;
  }
  if (/\b(early next week|beginning of next week|start of next week)\b/.test(p) || /\bnext week\b/.test(p)) return addDays(monday, 7);

  const [y, m] = ref.split('-').map(Number);
  if (/\b(eom|end of (the |this )?month|month end|month-end)\b/.test(p)) return `${ref.slice(0, 8)}${String(lastDayOfMonth(y, m - 1)).padStart(2, '0')}`;
  if (/\bend of next month\b/.test(p)) {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 0 : m;
    return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(lastDayOfMonth(ny, nm)).padStart(2, '0')}`;
  }
  if (/\bnext month\b/.test(p)) return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  if (/\b(eoq|end of (the |this )?quarter|quarter end|quarter-end)\b/.test(p)) {
    const qm = Math.ceil(m / 3) * 3;
    return `${y}-${String(qm).padStart(2, '0')}-${String(lastDayOfMonth(y, qm - 1)).padStart(2, '0')}`;
  }
  if (/\b(eoy|end of (the |this )?year|year end|year-end)\b/.test(p)) return `${y}-12-31`;

  // "next Friday", "this Friday", "Friday", "Fri"
  const dayWord = p.match(/\b(next|this|coming|following)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sundays|mondays|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/);
  if (dayWord) {
    const target = dayIndex(dayWord[2]);
    if (target >= 0) {
      const mod = dayWord[1];
      if (mod === 'next' || mod === 'following') return addDays(monday, 7 + ((target + 6) % 7));
      if (mod === 'this') {
        const inWeek = addDays(monday, (target + 6) % 7);
        return inWeek >= ref ? inWeek : nextWeekday(ref, target);
      }
      return nextWeekday(ref, target);
    }
  }

  // "November 15", "Nov 15th", "15 November", "15th of November"
  const md = p.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\b/) || null;
  const dm = p.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/) || null;
  for (const [month, day] of [md && [md[1], md[2]], dm && [dm[2], dm[1]]].filter(Boolean)) {
    const mi = monthIndex(month);
    const d = Number(day);
    if (mi < 0 || d < 1 || d > 31) continue;
    let year = y;
    let candidate = `${year}-${String(mi + 1).padStart(2, '0')}-${String(Math.min(d, lastDayOfMonth(year, mi))).padStart(2, '0')}`;
    if (candidate < ref) {
      year += 1;
      candidate = `${year}-${String(mi + 1).padStart(2, '0')}-${String(Math.min(d, lastDayOfMonth(year, mi))).padStart(2, '0')}`;
    }
    return candidate;
  }

  // "the 15th" -> this month, or next month if already past
  const nth = p.match(/\b(\d{1,2})(st|nd|rd|th)\b/);
  if (nth) {
    const d = Number(nth[1]);
    if (d >= 1 && d <= 31) {
      let yy = y;
      let mm = m - 1;
      let candidate = `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, lastDayOfMonth(yy, mm))).padStart(2, '0')}`;
      if (candidate < ref) {
        mm += 1;
        if (mm > 11) {
          mm = 0;
          yy += 1;
        }
        candidate = `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, lastDayOfMonth(yy, mm))).padStart(2, '0')}`;
      }
      return candidate;
    }
  }
  return null;
}

function addBusinessDays(ref, n) {
  let d = ref;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    const wd = weekdayOf(d);
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

function addMonths(ref, n) {
  const [y, m, d] = ref.split('-').map(Number);
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12);
  const nm = total % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, lastDayOfMonth(ny, nm))).padStart(2, '0')}`;
}

/** Find a due-date phrase inside a sentence (used by the rule-based extractor). */
const PHRASE_PATTERNS = [
  /\b(?:by|before|on|until|no later than|due)?\s*(?:the\s+)?end of (?:the |this |next )?(?:day|week|month|quarter|year)\b/i,
  /\b(?:by|before)?\s*(?:eod|eow|eom|eoq|eoy|cob|close of business)\b/i,
  /\b(?:by|before|on)?\s*(?:the\s+)?day after tomorrow\b/i,
  /\b(?:by|before)?\s*(?:today|tonight|tomorrow)(?:\s+(?:morning|afternoon|evening|night))?\b/i,
  /\b(?:in|within)\s+(?:\d+|a couple of|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|thirty)\s+(?:business days?|working days?|days?|weeks?|months?)\b/i,
  /\b(?:by|before|on|until)?\s*(?:early |the start of |the beginning of )?(?:next|this) (?:week|month)\b/i,
  /\b(?:by|before|on|until)?\s*(?:next|this|coming)?\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+(?:morning|afternoon|evening))?\b/i,
  /\b(?:by|before|on|until)?\s*(?:the\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/i,
  /\b(?:by|before|on|until)?\s*(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i,
  /\b(?:by|before|on)\s+the\s+\d{1,2}(?:st|nd|rd|th)\b/i,
];

export function findDuePhrase(sentence, ref) {
  for (const re of PHRASE_PATTERNS) {
    const m = String(sentence).match(re);
    if (m) {
      const phrase = m[0].trim();
      const date = resolveDuePhrase(phrase, ref);
      if (date) return { phrase, date };
    }
  }
  return null;
}

export function formatDue(isoDate) {
  if (!isoDate) return '';
  const d = toDate(isoDate);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) + (isoDate.slice(0, 4) !== new Date().toISOString().slice(0, 4) ? ` ${isoDate.slice(0, 4)}` : '');
}

export function daysBetween(fromIso, toIso) {
  return Math.round((toDate(toIso) - toDate(fromIso)) / 86_400_000);
}
