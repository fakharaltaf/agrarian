import { DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, TICKS_PER_DAY } from '../simulation/config';

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $12.34 below $100, $1,234 below $1M, then $1.23M / $4.5B. */
export function money(n: number, compact = true) {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) < 0.005) n = 0; // never show "−$0.00"
  const a = Math.abs(n);
  if (compact && a >= 1e9) return `${n < 0 ? '−' : ''}$${(a / 1e9).toFixed(2)}B`;
  if (compact && a >= 1e6) return `${n < 0 ? '−' : ''}$${(a / 1e6).toFixed(2)}M`;
  return (a >= 100 ? usd0 : usd2).format(n).replace('-', '−');
}
/** Unit prices always keep cents. */
export const price = (n: number) => (Number.isFinite(n) ? usd2.format(n) : '—');
export function num(n: number, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
export const pct = (n: number, digits = 1) => (Number.isFinite(n) ? `${n >= 0 ? '+' : '−'}${Math.abs(n * 100).toFixed(digits)}%` : '—');
export const pct0 = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');

export function clock(tick: number) {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const dy = ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  return {
    hour: String(((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY).padStart(2, '0') + ':00',
    day: (dy % DAYS_PER_SEASON) + 1,
    season: SEASONS[Math.floor(dy / DAYS_PER_SEASON)],
    year: Math.floor(day / DAYS_PER_YEAR) + 1,
  };
}
export const stamp = (tick: number) => {
  const c = clock(tick);
  return `Y${c.year} ${c.season.slice(0, 3)} ${c.day} ${c.hour}`;
};
export const duration = (ticks: number) => (ticks >= 48 ? `${(ticks / 24).toFixed(1)} days` : ticks >= 24 ? `1 day` : `${Math.max(1, Math.ceil(ticks))}h`);
export const plural = (n: number, w: string) => `${num(n)} ${w}${Math.round(n) === 1 ? '' : 's'}`;
