import { CONFIG, CROP_IDS, DAYS_PER_YEAR, REGION_IDS, WORK_END, WORK_START, type CropId, type RegionId } from './config';
import { clamp, equity, hour, post, sumBooks } from './core';
import type { Division, GameState } from './types';

export const DIVISIONS: { id: Division; name: string; blurb: string }[] = [
  { id: 'crops', name: 'Crop Production', blurb: 'Fields, seed, fertiliser, water and farm labour. A head of crops manages every region (rotation, fertiliser, selling) and supervises 40 hands.' },
  { id: 'livestock', name: 'Livestock', blurb: 'Ranches and dairies. A head cuts staff costs 8%.' },
  { id: 'processing', name: 'Food Processing', blurb: 'Mills, bakeries, presses and creameries. A head cuts staff costs 8%.' },
  { id: 'logistics', name: 'Logistics', blurb: 'Storage, haulage and freight.' },
  { id: 'energy', name: 'Energy', blurb: 'Electricity bought and generated. A head cuts energy-plant staff costs 8%.' },
  { id: 'trading', name: 'Commodity Trading', blurb: 'Futures, contracts and hedging. A head runs your hedge policy.' },
  { id: 'corporate', name: 'Corporate', blurb: 'Finance, tax, research, legal and executive costs.' },
];

export function execTick(s: GameState) {
  const h = hour(s);
  if (h < WORK_START || h >= WORK_END) return;
  for (const d of s.corp.execs) post(s, 'salaries', -CONFIG.execSalary * s.macro.cpi, `Head of ${DIVISIONS.find((x) => x.id === d)!.name}`, 'heartland', d);
}

/** Valuation: book equity plus six years of trailing profit (never below book). */
export function companyValue(s: GameState) {
  const net = netIncome(s, DAYS_PER_YEAR);
  return Math.max(equity(s), equity(s) + 6 * net);
}
export const sharePrice = (s: GameState) => Math.max(0.01, companyValue(s) / s.corp.shares);
export const ownership = (s: GameState) => s.corp.playerShares / s.corp.shares;

export function netIncome(s: GameState, days: number) {
  const ex = ['loanIn', 'loanRepay', 'sharesIssued', 'dividends', 'buyback', 'land', 'machine', 'building', 'acquisition', 'irrigation', 'margin', 'assetSale'] as const;
  return sumBooks(s, days) - sumBooks(s, days, [...ex]);
}

export function issueShares(s: GameState, pct: number) {
  const n = Math.round(s.corp.shares * pct);
  const proceeds = n * sharePrice(s) * 0.95; // underwriting discount
  s.corp.shares += n;
  post(s, 'sharesIssued', proceeds, `Issued ${n.toLocaleString()} shares`, 'heartland', 'corporate');
  return proceeds;
}

export function buyback(s: GameState, pct: number): string | null {
  const publicShares = s.corp.shares - s.corp.playerShares;
  const n = Math.min(publicShares, Math.round(s.corp.shares * pct));
  if (n <= 0) return 'There are no public shares to buy back.';
  const cost = n * sharePrice(s) * 1.05;
  if (cost > s.cash) return `A buyback of ${n.toLocaleString()} shares costs $${Math.round(cost).toLocaleString()}.`;
  post(s, 'buyback', -cost, `Bought back ${n.toLocaleString()} shares`, 'heartland', 'corporate');
  s.corp.shares -= n;
  return null;
}

export function payDividend(s: GameState, amount: number) {
  post(s, 'dividends', -amount, 'Dividend', 'heartland', 'corporate');
  s.corp.dividends += amount;
  // steady payouts build investor and lender confidence
  s.corp.reputation = clamp(s.corp.reputation + Math.min(5, (amount / Math.max(1, equity(s))) * 100), 0, 100);
}

/** Your share of a regional market's consumption over the last ~30 days. */
export function marketShare(s: GameState, r: RegionId, c: CropId) {
  const m = s.markets[r][c];
  return m && m.totalSold > 0 ? m.playerSold / m.totalSold : 0;
}

export function globalShare(s: GameState, c: CropId) {
  let p = 0, t = 0;
  for (const r of REGION_IDS) {
    const m = s.markets[r][c]!;
    p += m.playerSold;
    t += m.totalSold;
  }
  return t ? p / t : 0;
}
export const topShare = (s: GameState) => Math.max(0, ...CROP_IDS.map((c) => globalShare(s, c)));
