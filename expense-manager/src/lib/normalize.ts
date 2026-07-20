// ---- Merchant + date normalization (requirements §4.2) ----

const US_STATES = 'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC';

const KNOWN_MERCHANTS: Array<[RegExp, string]> = [
  [/AMAZON|AMZN/i, 'Amazon'],
  [/WHOLEFDS|WHOLE\s*FOODS/i, 'Whole Foods Market'],
  [/COSTCO/i, 'Costco Wholesale'],
  [/TARGET/i, 'Target'],
  [/WAL-?MART|WM\s*SUPERCENTER/i, 'Walmart'],
  [/TRADER\s*JOE/i, "Trader Joe's"],
  [/SAFEWAY/i, 'Safeway'],
  [/NETFLIX/i, 'Netflix'],
  [/SPOTIFY/i, 'Spotify'],
  [/HULU/i, 'Hulu'],
  [/UBER\s*EATS/i, 'Uber Eats'],
  [/UBER/i, 'Uber'],
  [/LYFT/i, 'Lyft'],
  [/DOORDASH|DD\s*DOORDASH/i, 'DoorDash'],
  [/SHELL\s*OIL|SHELL\s*SERVICE/i, 'Shell'],
  [/CHEVRON/i, 'Chevron'],
  [/76\s*-?\s*PROPEL|PHILLIPS\s*66/i, 'Phillips 66'],
  [/STARBUCKS/i, 'Starbucks'],
  [/BLUE\s*BOTTLE/i, 'Blue Bottle Coffee'],
  [/PEET'?S/i, "Peet's Coffee"],
  [/CHIPOTLE/i, 'Chipotle'],
  [/MCDONALD/i, "McDonald's"],
  [/APPLE\.COM|APPLECARD|APPLE\s*SERVICES/i, 'Apple'],
  [/GOOGLE\s*\*?/i, 'Google'],
  [/NYTIMES|NY\s*TIMES/i, 'The New York Times'],
  [/ADOBE/i, 'Adobe'],
  [/PELOTON/i, 'Peloton'],
  [/PG&?E\b|PGANDE|PACIFIC\s*GAS/i, 'PG&E'],
  [/COMCAST|XFINITY/i, 'Xfinity'],
  [/VERIZON/i, 'Verizon'],
  [/T-?MOBILE/i, 'T-Mobile'],
  [/CVS/i, 'CVS Pharmacy'],
  [/WALGREENS/i, 'Walgreens'],
  [/HOME\s*DEPOT/i, 'The Home Depot'],
  [/LOWE'?S/i, "Lowe's"],
  [/SOUTHWES/i, 'Southwest Airlines'],
  [/UNITED\s*(AIR|[0-9])/i, 'United Airlines'],
  [/DELTA\s*AIR/i, 'Delta Air Lines'],
  [/AIRBNB/i, 'Airbnb'],
  [/MARRIOTT/i, 'Marriott'],
  [/GEICO/i, 'GEICO'],
  [/STATE\s*FARM/i, 'State Farm'],
  [/VENMO/i, 'Venmo'],
  [/PAYPAL/i, 'PayPal'],
];

/** Normalize a raw bank description into a clean merchant name. */
export function normalizeMerchant(raw: string): string {
  const s = raw.trim();

  for (const [re, name] of KNOWN_MERCHANTS) {
    if (re.test(s)) return name;
  }

  let out = s
    // POS / processor prefixes
    .replace(/^(SQ\s*\*|TST\*?\s*|PAR\*|PY\s*\*|PP\*|PAYPAL\s*\*|CKE\*|IC\*|EB\s*\*|SP\s+|POS\s+|DEBIT\s+CARD\s+PURCHASE\s*-?\s*|CHECKCARD\s+\d*\s*)/i, '')
    // store numbers and reference codes
    .replace(/\s*#\d+/g, '')
    .replace(/\s+\d{4,}/g, ' ')
    .replace(/\*[A-Z0-9]{4,}/gi, '')
    // trailing city/state
    .replace(new RegExp(`\\s+[A-Z .]+\\s+(${US_STATES})\\s*$`), '')
    .replace(/\s+(WWW\.)?[A-Z0-9-]+\.(COM|NET|ORG|CO)[\/A-Z0-9]*\s*$/i, '')
    .replace(/[*_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!out) out = s;

  // Title-case ALL-CAPS strings
  if (out === out.toUpperCase()) {
    out = out.toLowerCase().replace(/(^|[\s\-'/&(])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }
  return out;
}

/** Parse a source date in common bank formats into ISO 8601 (YYYY-MM-DD). Returns null if unparseable. */
export function parseDate(raw: string): string | null {
  const s = String(raw).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);       // ISO already
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); // MM/DD/YYYY
  if (m) return iso(+m[3], +m[1], +m[2]);

  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/); // MM/DD/YY
  if (m) return iso(2000 + +m[3], +m[1], +m[2]);

  const d = new Date(s);                                  // e.g. "Jul 18, 2026"
  if (!isNaN(d.getTime())) return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parse an amount string ("$1,234.56", "(45.00)", "-45.00") into a number. */
export function parseAmount(raw: string | number): number | null {
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  const v = parseFloat(s);
  if (isNaN(v)) return null;
  return neg ? -v : v;
}
