// First-timer guide: contextual coach marks that point at the real control when it becomes
// relevant, and finish themselves when the player does the thing. One tip at a time.
import { fertility, homePlotPrice, isReady } from '../simulation/engine';
import { stored } from '../simulation/core';
import type { GameState } from '../simulation/types';
import { act, go, useGame, useStore } from '../stores/game';
import { useElementRect } from './ui';
import { useEffect } from 'react';
import { diagnose } from '../simulation/advisor';

export interface CoachTip {
  id: string;
  title: string;
  body: string;
  target: string; // data-coach value
  page: string;
  when: (s: GameState) => boolean;
  done?: (s: GameState) => boolean; // finishes the tip without a click
}

const anyField = (s: GameState, f: (x: GameState['fields'][number]) => boolean) => s.fields.some(f);

export const TIPS: CoachTip[] = [
  { id: 'plant', page: 'farm', target: 'plant-btn', title: 'Plant your first crop', body: 'This is your one hectare. You own ten wheat seeds — exactly enough. Press Plant (or P).',
    when: () => true, done: (s) => anyField(s, (f) => !!f.crop) || s.stats.harvests > 0 },
  { id: 'time', page: 'farm', target: 'clock', title: 'Time runs by itself', body: 'Each real second is one in-game hour. Wheat needs 12 hours to ripen; the field turns gold when it is ready.',
    when: (s) => anyField(s, (f) => !!f.crop) && s.stats.harvests === 0, done: (s) => anyField(s, (f) => isReady(s, f)) || s.stats.harvests > 0 },
  { id: 'harvest', page: 'farm', target: 'harvest-btn', title: 'Harvest', body: 'Your wheat is ripe. Harvest it before it starts to over-ripen — waiting more than half a day costs yield.',
    when: (s) => anyField(s, (f) => isReady(s, f)) && s.stats.harvests === 0, done: (s) => s.stats.harvests > 0 },
  { id: 'sell', page: 'farm', target: 'sell-card', title: 'Sell at the market', body: 'Your grain sits in the barn. Prices move with supply and demand. The quote shows exactly what you will receive.',
    when: (s) => s.stats.harvests > 0 && s.stats.sales === 0, done: (s) => s.stats.sales > 0 },
  { id: 'impact', page: 'farm', target: 'sell-card', title: 'Big sales move the price', body: 'Each sale pushes the local price down for a while, then it recovers. Selling in smaller batches, or waiting for a good price, earns more.',
    when: (s) => s.stats.sales >= 1 },
  { id: 'replant', page: 'farm', target: 'plant-btn', title: 'Replant', body: 'Plant again. When you are out of seed, planting buys what you need automatically — the button shows the cost.',
    when: (s) => s.stats.sales >= 1 && s.stats.harvests === 1 && anyField(s, (f) => !f.crop), done: (s) => s.stats.harvests >= 2 || anyField(s, (f) => !!f.crop) },
  { id: 'speed', page: 'farm', target: 'speed', title: 'Speed up time', body: 'Use the speed controls (or keys 1–6, Space to pause). Faster time never changes the economics — just how long you wait.',
    when: (s) => s.stats.sales >= 2 },
  { id: 'land', page: 'farm', target: 'buy-plot', title: 'Expand your farm', body: 'You can afford another hectare. Two fields means two crops growing at once — and your first real decision: what goes where.',
    when: (s) => s.fields.length === 1 && s.cash >= homePlotPrice(s), done: (s) => s.fields.length > 1 },
  { id: 'crops', page: 'farm', target: 'crop-picker', title: 'Faster is not always better', body: 'Corn and potatoes grow slower but yield far more per hectare and need less tending. Compare “Profit/h” and remember each crop has its own market.',
    when: (s) => s.unlockedCrops.includes('corn') },
  { id: 'advance', page: 'farm', target: 'advance', title: 'A new era is ready', body: 'You have outgrown the homestead. Open the preview to see what the next era brings — and advance whenever you are ready. Nothing changes until you do.',
    when: (s) => s.eraReady, done: (s) => s.era >= 2 },
  { id: 'era2', page: 'overview', target: 'nav', title: 'Welcome to the farm business', body: 'New pages now appear in the sidebar as your business grows. A gold dot marks something new. Each page solves a problem you are about to have.',
    when: (s) => s.era >= 2 },
  { id: 'hire', page: 'workers', target: 'nav-workers', title: 'Hire help', body: 'Working every field by hand gets tiring. Farm hands plant and harvest for you — but cost wages every working hour, busy or not.',
    when: (s) => s.era >= 2 && s.workers.length === 0, done: (s) => s.workers.length > 0 },
  { id: 'plan', page: 'farm', target: 'plan-picker', title: 'Give fields a crop plan', body: 'Workers only replant fields that have a plan. Select fields, choose a crop plan, and they will keep them cycling.',
    when: (s) => s.workers.length > 0 && !anyField(s, (f) => !!f.plan), done: (s) => anyField(s, (f) => !!f.plan) },
  { id: 'advisorHire', page: 'workers', target: 'hire-advisor', title: 'Money is draining away', body: 'Your farm has been spending more than it earns these last days. A farm advisor (Workers page) reads your books and tells you exactly what is costing you — for a daily fee.',
    when: (s) => s.era >= 2 && !s.advisor && s.stats.sales > 0 && diagnose(s).realProfit < 0, done: (s) => s.advisor },
  { id: 'soil', page: 'farm', target: 'soil-panel', title: 'Your soil is wearing out', body: 'Every harvest removes nutrients. Rotate crops — soybeans put nitrogen back — rest fields, or spread fertiliser (which costs money and can harm soil if overused).',
    when: (s) => s.era >= 2 && anyField(s, (f) => fertility(f) < 0.75) },
  { id: 'storage', page: 'storage', target: 'nav-storage', title: 'Storage is filling up', body: 'Whatever does not fit in storage at harvest is sold on the spot at whatever price the market gives. More storage lets you wait for better prices — but stock slowly spoils.',
    when: (s) => { const st = stored(s, 'heartland'); return st.dry > st.cap.dry * 0.7; } },
  { id: 'books', page: 'finance', target: 'nav-finance', title: 'Know your numbers', body: 'Every dollar you earn or spend is recorded. Finance shows where money comes from and goes — use it to see whether workers pay for themselves.',
    when: (s) => s.era >= 2 && s.workers.length > 0 },
  { id: 'era3', page: 'equipment', target: 'nav-equipment', title: 'Mechanization', body: 'A tractor plants 4 ha an hour with one operator. Compare its fuel, servicing and price (or lease) against the wages it saves.',
    when: (s) => s.era >= 3 },
  { id: 'parcels', page: 'fields', target: 'buy-parcel', title: 'Bigger land, bigger operations', body: 'Parcels of 5–500 ha are cheaper per hectare, but too big to work by hand: they need workers, and ideally machines.',
    when: (s) => s.era >= 3 && s.fields.every((f) => f.ha <= 1) },
  { id: 'loans', page: 'finance', target: 'nav-finance', title: 'Banks will lend now', body: 'Loans let you buy machines and land before you can afford them. Interest is charged daily and rates float — debt magnifies both success and mistakes.',
    when: (s) => s.era >= 3 && s.cash < 5000 },
  { id: 'automation', page: 'automation', target: 'nav-automation', title: 'Manage by policy', body: 'Hire a farm manager and set policies: rotate crops automatically, fertilise when soil is low, service machines, keep a cash reserve.',
    when: (s) => s.era >= 3 && s.workers.some((w) => w.role === 'manager') },
  { id: 'era4', page: 'production', target: 'nav-production', title: 'Agricultural industry', body: 'Process your crops: wheat into flour, corn into feed and meat. A factory has fixed staff costs, so it only pays when it runs near capacity.',
    when: (s) => s.era >= 4 },
  { id: 'research', page: 'research', target: 'nav-research', title: 'Research', body: 'Build a research station to invest in technology: better seed, soil testing, efficient machines, automation rules, solar power and more.',
    when: (s) => s.era >= 4 && !s.buildings.some((b) => b.type === 'lab') },
  { id: 'era5', page: 'markets', target: 'nav-markets', title: 'Markets and finance', body: 'The commodity exchange is open. Hedge with futures, accept supply contracts at fixed prices, insure crops — and read your full financial statements.',
    when: (s) => s.era >= 5 },
  { id: 'analytics', page: 'analytics', target: 'nav-analytics', title: 'Plan before you leap', body: 'Analytics compares crop profitability, ranks fields, and runs “what if” scenarios through the real simulation.',
    when: (s) => s.era >= 5 },
  { id: 'era6', page: 'farm', target: 'nav-world', title: 'Regional expansion', body: 'Other regions have cheaper land, different climates, wages, tariffs and currencies. Produce where it is cheap, sell where it is dear — freight permitting.',
    when: (s) => s.era >= 6 },
  { id: 'era7', page: 'corporation', target: 'nav-corporation', title: 'Agricultural corporation', body: 'Incorporate to hire division heads, issue shares and acquire competitors. Always run due diligence before you buy.',
    when: (s) => s.era >= 7 },
  { id: 'era8', page: 'policy', target: 'nav-policy', title: 'The global food system', body: 'You now move world markets. Market power invites antitrust scrutiny; climate keeps shifting. Long-term milestones live on the Policy page.',
    when: (s) => s.era >= 8 },
];

/** Each kind of problem the advisor spots is taught once, the first time it actually happens on this farm. */
function adviceTip(s: GameState): CoachTip | undefined {
  if (!s.advisor) return undefined;
  const a = diagnose(s).advice.find((x) => !s.seenTips.includes(`adv:${x.id.split(':')[0]}`));
  return a && { id: `adv:${a.id.split(':')[0]}`, page: a.page, target: 'advisor', title: `${a.icon} ${a.title}`, body: a.body, when: () => true };
}

export const tipsOff = (s: GameState) => s.seenTips.includes('__off');

export function Coach() {
  const s = useGame();
  const page = useStore((x) => x.page);
  // tips whose goal is already reached finish themselves
  const finished = TIPS.find((t) => !s.seenTips.includes(t.id) && t.done?.(s));
  useEffect(() => {
    if (finished) act({ type: 'seeTip', tip: finished.id });
  }, [finished]);
  const tip = tipsOff(s) ? undefined : TIPS.find((t) => !s.seenTips.includes(t.id) && !t.done?.(s) && t.when(s)) ?? adviceTip(s);
  const rect = useElementRect(tip ? `[data-coach="${tip.target}"]` : null);
  if (!tip) return null;
  const idx = TIPS.indexOf(tip); // -1 for advisor lessons
  const dismiss = () => act({ type: 'seeTip', tip: tip.id });
  const off = () => act({ type: 'seeTip', tip: '__off' });
  const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
  // The journal card is docked (never covers the control); a glowing ring marks the control itself.
  return (
    <>
      {visible && <div className="coach-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <aside className="coach docked" role="status" aria-label={`Farm journal: ${tip.title}`}>
        <span className="step">📖 Farm journal · {idx < 0 ? 'Lesson from your farm' : `${idx + 1} of ${TIPS.length}`}</span>
        <h3>{tip.title}</h3>
        <p>{tip.body}</p>
        <div className="row between">
          <button className="btn ghost sm" onClick={off} title="You can turn the journal back on in Settings">Hide journal</button>
          <div className="row">
            {!visible && page !== tip.page && <button className="btn ghost sm" onClick={() => go(tip.page)}>Show me</button>}
            <button className="btn primary sm" onClick={dismiss}>Got it</button>
          </div>
        </div>
      </aside>
    </>
  );
}

export const resetTips = () => act({ type: 'seeTip', tip: '__reset' }, 'Tips will replay from the start.');
export const tipsOn = () => act({ type: 'seeTip', tip: '__on' }, 'Tips turned on.');
