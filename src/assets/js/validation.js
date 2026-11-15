// Shared validation module: runs in the browser (forms) and on the server (API).
// No dependencies, pure functions → easy to test.

export const SERVICES = [
  { id: 'inspection-basic', label: 'Basic tune-up' },
  { id: 'inspection-full', label: 'Full tune-up' },
  { id: 'repair', label: 'Repair' },
  { id: 'ebike', label: 'E-bike service' },
  { id: 'cargo-bike', label: 'Cargo bike service' },
  { id: 'estimate', label: 'Estimate' },
];

export const BIKE_TYPES = [
  { id: 'city', label: 'City or hybrid bike' },
  { id: 'road', label: 'Road or gravel bike' },
  { id: 'mtb', label: 'Mountain bike' },
  { id: 'ebike', label: 'E-bike' },
  { id: 'cargo', label: 'Cargo bike' },
];

export const BOOKING_WINDOW_DAYS = 60;
export const DESCRIPTION_REQUIRED = new Set(['repair', 'estimate']);

// ---------- Dates ----------

/** Today’s date in Berlin as 'YYYY-MM-DD' (independent of the device’s time zone). */
export function berlinToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(now);
}

function parseISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

const toISO = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (iso, n) => {
  const dt = parseISODate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISO(dt);
};
const dayDiff = (a, b) => Math.round((parseISODate(b) - parseISODate(a)) / 86400000);

/** Easter Sunday (Gauss / Anonymous Gregorian algorithm). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Public holidays in Berlin → Map 'YYYY-MM-DD' → name. */
export function berlinHolidays(year) {
  const easter = easterSunday(year);
  const list = [
    [`${year}-01-01`, "New Year’s Day"],
    [`${year}-03-08`, "International Women’s Day"],
    [addDays(easter, -2), 'Good Friday'],
    [addDays(easter, 1), 'Easter Monday'],
    [`${year}-05-01`, 'May Day (Labor Day)'],
    [addDays(easter, 39), 'Ascension Day'],
    [addDays(easter, 50), 'Whit Monday'],
    [`${year}-10-03`, 'German Unity Day'],
    [`${year}-12-25`, 'Christmas Day'],
    [`${year}-12-26`, 'Second Day of Christmas'],
  ];
  return new Map(list);
}

/** Drop-off times for a date (24-hour 'HH:MM' values). Empty array = closed. */
export function slotsFor(iso) {
  const dt = parseISODate(iso);
  if (!dt) return [];
  if (berlinHolidays(dt.getUTCFullYear()).has(iso)) return [];
  const weekday = dt.getUTCDay(); // 0 = Sunday
  if (weekday === 0) return [];
  const [from, to] = weekday === 6 ? [10 * 60, 13 * 60] : [9 * 60, 16 * 60 + 30];
  const slots = [];
  for (let t = from; t <= to; t += 30) {
    slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  }
  return slots;
}

/** Why a date can’t be booked – or null. */
export function dateProblem(iso, now = new Date()) {
  const dt = parseISODate(iso);
  if (!dt) return 'Please choose a valid date.';
  const today = berlinToday(now);
  const diff = dayDiff(today, iso);
  if (diff < 1) return 'The earliest you can book is tomorrow.';
  if (diff > BOOKING_WINDOW_DAYS) return `You can book up to ${BOOKING_WINDOW_DAYS} days in advance.`;
  const holiday = berlinHolidays(dt.getUTCFullYear()).get(iso);
  if (holiday) return `${formatDate(iso)} is a public holiday (${holiday}). The shop is closed.`;
  if (dt.getUTCDay() === 0) return 'The shop is closed on Sundays.';
  return null;
}

/** '2026-03-12' → 'Thursday, March 12, 2026' */
export function formatDate(iso) {
  const dt = parseISODate(iso);
  if (!dt) return iso;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(dt);
}

/** '09:00' → '9:00 am', '16:30' → '4:30 pm' */
export function formatTime(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}

// ---------- Fields ----------

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

export function emailProblem(v) {
  if (!v) return 'Please enter your email address.';
  if (v.length > 254 || !EMAIL_RE.test(v)) return 'Please check your email address (example: name@example.com).';
  return null;
}

export function phoneProblem(v) {
  if (!v) return null; // optional
  if (!/^[+\d][\d\s/()-]*$/.test(v)) return 'Please use only digits, spaces and + / - ( ).';
  const digits = v.replace(/\D/g, '');
  if (digits.length < 6 || digits.length > 16) return 'This phone number looks incomplete.';
  return null;
}

function nameProblem(v) {
  if (!v) return 'Please enter your name.';
  if (v.length < 2) return 'That name is too short.';
  if (v.length > 80) return 'That name is too long (80 characters max).';
  return null;
}

/**
 * Validates a booking. Returns { ok, errors, value }.
 * errors maps field name → error message (plain English, written for people).
 */
export function validateBooking(input = {}, now = new Date()) {
  const value = {
    service: clean(input.service),
    bikeType: clean(input.bikeType),
    date: clean(input.date),
    time: clean(input.time),
    name: clean(input.name),
    email: clean(input.email).toLowerCase(),
    phone: clean(input.phone),
    description: typeof input.description === 'string' ? input.description.trim() : '',
    privacy: input.privacy === true || input.privacy === 'on' || input.privacy === 'true',
  };
  const errors = {};

  if (!SERVICES.some((s) => s.id === value.service)) errors.service = 'Please choose a service.';
  if (!BIKE_TYPES.some((b) => b.id === value.bikeType)) errors.bikeType = 'Please choose your bike type.';

  const dp = dateProblem(value.date, now);
  if (dp) errors.date = dp;
  if (!value.time) errors.time = 'Please choose a drop-off time.';
  else if (!dp && !slotsFor(value.date).includes(value.time)) errors.time = "That time isn’t available on this day.";

  const np = nameProblem(value.name);
  if (np) errors.name = np;
  const ep = emailProblem(value.email);
  if (ep) errors.email = ep;
  const pp = phoneProblem(value.phone);
  if (pp) errors.phone = pp;

  if (DESCRIPTION_REQUIRED.has(value.service) && value.description.length < 10) {
    errors.description = 'Please tell us briefly what needs fixing (at least 10 characters).';
  } else if (value.description.length > 1000) {
    errors.description = 'Please keep it shorter (1,000 characters max).';
  }
  if (!value.privacy) errors.privacy = 'Please confirm that you have read the privacy policy.';

  return { ok: Object.keys(errors).length === 0, errors, value };
}

export function validateContact(input = {}) {
  const value = {
    name: clean(input.name),
    email: clean(input.email).toLowerCase(),
    message: typeof input.message === 'string' ? input.message.trim() : '',
    privacy: input.privacy === true || input.privacy === 'on' || input.privacy === 'true',
  };
  const errors = {};
  const np = nameProblem(value.name);
  if (np) errors.name = np;
  const ep = emailProblem(value.email);
  if (ep) errors.email = ep;
  if (value.message.length < 10) errors.message = 'Please write at least 10 characters.';
  else if (value.message.length > 2000) errors.message = 'Please keep it shorter (2,000 characters max).';
  if (!value.privacy) errors.privacy = 'Please confirm that you have read the privacy policy.';
  return { ok: Object.keys(errors).length === 0, errors, value };
}

export const labelFor = (list, id) => list.find((x) => x.id === id)?.label ?? id;
