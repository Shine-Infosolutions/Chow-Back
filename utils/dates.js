// IST (Asia/Kolkata, UTC+05:30, no DST) date helpers.
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = 'Asia/Kolkata';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' for the IST calendar day containing `date`.
const istDateString = (date = new Date()) => new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// UTC instant of IST midnight for 'YYYY-MM-DD' (null when invalid).
const istStartOfDay = (ymd) => {
  if (typeof ymd !== 'string' || !DATE_RE.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00+05:30`);
  return isNaN(d.getTime()) ? null : d;
};

const addDaysYmd = (ymd, n) => istDateString(new Date(istStartOfDay(ymd).getTime() + n * DAY_MS));

// [start, end) for "today" in IST.
const istTodayRange = () => {
  const start = istStartOfDay(istDateString());
  return { start, end: new Date(start.getTime() + DAY_MS) };
};

// Inclusive IST date range → { start, end } with `end` exclusive (to + 1 day). Either side optional.
const istRangeFromQuery = (from, to) => {
  const start = from ? istStartOfDay(from) : null;
  const toStart = to ? istStartOfDay(to) : null;
  return { start, end: toStart ? new Date(toStart.getTime() + DAY_MS) : null };
};

const daysBetweenInclusive = (fromYmd, toYmd) => Math.round((istStartOfDay(toYmd) - istStartOfDay(fromYmd)) / DAY_MS) + 1;

module.exports = {
  TZ,
  DAY_MS,
  DATE_RE,
  istDateString,
  istStartOfDay,
  addDaysYmd,
  istTodayRange,
  istRangeFromQuery,
  daysBetweenInclusive,
};
