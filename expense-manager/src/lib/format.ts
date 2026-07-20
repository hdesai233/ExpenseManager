export function usd(n: number): string {
  const neg = n < 0;
  const v = Math.abs(Math.round(n));
  return (neg ? '-$' : '$') + v.toLocaleString('en-US');
}

export function usd2(n: number): string {
  const neg = n < 0;
  const v = Math.abs(n);
  return (neg ? '-$' : '$') + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function signedUsd2(n: number): string {
  return (n > 0 ? '+' : '') + usd2(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function monthFull(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  return MONTHS_FULL[m - 1];
}

export function monthShort(ym: string): string {
  const [, m] = ym.split('-').map(Number);
  return MONTHS[m - 1];
}

export function toYM(iso: string): string {
  return iso.slice(0, 7);
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentYM(): string {
  return todayISO().slice(0, 7);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

export function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
