import { createPortal } from 'react-dom';
import {cityActive,cityOf} from '../simulation/city-state';
import { townOf } from '../simulation/town-state';
import { communityOf } from '../simulation/community-state';
import { regionActive, regionOf } from '../simulation/region-state';
import { nationActive, nationOf } from '../simulation/nation-state';
// First-timer guide: contextual coach marks that point at the real control when it becomes
// relevant, and finish themselves when the player does the thing. One tip at a time.
import { fertility, homePlotPrice, isReady } from '../simulation/engine';
import { stored } from '../simulation/core';
import type { GameState } from '../simulation/types';
import { act, go, useGame, useStore } from '../stores/game';
import { useElementRect } from './ui';
import { useEffect, useState } from 'react';
import { advice } from './Advisor';
import { stageAtLeast } from '../simulation/stages';
import { haulOf, usesCarts } from '../simulation/hauling';
import { hasAccess, worldOf } from '../simulation/world';

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
const chapter = (s: GameState, legacyEra: number, stage: Parameters<typeof stageAtLeast>[1]) => s.legacyProgression ? s.era >= legacyEra : stageAtLeast(s, stage);

export const TIPS: CoachTip[] = [
  {id:'region-route',page:'region',target:'region-map',title:'Trade builds trust',body:'Tap a neighbour, then pick a good they want (★) and a daily load. Caravans sell at their market and every delivery raises trust.',when:regionActive,done:s=>Object.values(regionOf(s).neighbours).some(n=>n.route)},
  {id:'region-defence',page:'region',target:'region-map',title:'Roads need guarding',body:'Bandits hit caravans on the road. City police and a staffed watchtower (Defence tab) protect them; pursuing a raid recovers part of the loss.',when:s=>regionActive(s)&&regionOf(s).raids>0,done:s=>townOf(s).services.some(b=>b.type==='watchtower')},
  {id:'nation-army',page:'nation',target:'nation-main',title:'An army eats',body:'Soldiers are your own residents, paid from the treasury, and eat grain every day. Drill them, keep them fed, and only march when the odds are good.',when:s=>nationActive(s)&&nationOf(s).path==='army',done:s=>nationOf(s).history.length>0},
  {id:'nation-ally',page:'nation',target:'nation-main',title:'Allies expect help',body:'Invite neighbours with trust 60+. They guard your roads; when they ask for grain or cash, answering keeps the league together.',when:s=>nationActive(s)&&nationOf(s).path==='alliance',done:s=>nationOf(s).league.members.length>0},
  {id:'nation-neutral',page:'nation',target:'nation-main',title:'Be indispensable',body:'Feed every neighbour by caravan. If one turns on you, an embargo makes a dependent neighbour back down.',when:s=>nationActive(s)&&nationOf(s).path==='neutrality',done:s=>nationOf(s).neutral.mediated>0},
  {id:'city-utilities',page:'city',target:'city-next',title:'Care before enforcement',body:'Sanitation protects health; lighting makes streets safer. Both need funded local staff from the public treasury.',when:cityActive,done:s=>townOf(s).services.some(b=>b.type==='sanitation')},
  {id:'city-safety',page:'city',target:'city-safety',title:'Prosperity prevents crime',body:'Jobs, schools and happiness lower crime too. Your police charter changes its cost, effectiveness and effect on freedom.',when:s=>cityActive(s)&&townOf(s).services.some(b=>b.type==='sanitation'),done:s=>cityOf(s).police>0||cityOf(s).crime<.05},
  {id:'city-employment',page:'city',target:'city-decisions',title:'A town has more than one employer',body:'Tap District to see neighbouring jobs and real wages. A 1.1× offer can attract an employed neighbour to your crew; wages remain a recurring expense.',when:s=>cityActive(s)&&cityOf(s).neighbourJobs>0&&townOf(s).services.some(b=>b.type==='sanitation')},
  {id:'city-case',page:'city',target:'city-justice',title:'Choose a response',body:'Rehabilitation builds prevention; punishment acts immediately but reduces happiness. The selected default resolves future cases using real public money.',when:s=>cityActive(s)&&!!cityOf(s).case,done:s=>cityOf(s).solved>0},
  // the chapters reworked in Nov 2026: roads, carts, zones, families and the town's reach
  {id:'carts',page:'farm',target:'haul-chip',title:'Goods travel by cart',body:'Market sales ride a cart down the road to the village. You are paid when it arrives. A horse cart or better road makes every trip faster.',when:s=>usesCarts(s,'heartland')&&haulOf(s).trips.length>0,done:s=>haulOf(s).horses>0||s.machines.some(m=>m.type==='truck')},
  {id:'noroad',page:'farm',target:'roads-btn',title:'Every building needs a road',body:'A building with no route to the main road stops working. Open 🛤 and draw a track from its door to any road.',when:s=>Object.keys(worldOf(s,'heartland').pos).some(k=>/^(b:|home:|svc:)/.test(k)&&!hasAccess(s,'heartland',k))},
  {id:'zones',page:'farm',target:'zones-btn',title:'Zone land for homes',body:'Families only live on residential land. Open 🏘, choose Residential, and tap the cleared patches where the homes should go.',when:s=>communityOf(s).active&&!Object.values(worldOf(s,'heartland').zones).includes('res'),done:s=>Object.values(worldOf(s,'heartland').zones).includes('res')},
  {id:'families',page:'community',target:'nav-community',title:'Families follow their workers',body:'Each hand you employ brings a family of 3–5 once there is a home for them. Feed them from your stores; they make your workers happier and steadier.',when:s=>communityOf(s).active&&Object.values(worldOf(s,'heartland').zones).includes('res'),done:s=>Object.keys(communityOf(s).families??{}).length>=2},
  {id:'warmth',page:'community',target:'nav-community',title:'Cold homes',body:'Below 10°C every family burns diesel for heat. With stocking on it is bought for them; cold homes make families unhappy, and unhappy families leave.',when:s=>communityOf(s).active&&communityOf(s).warm<0.8&&s.regions.heartland.temp<10},
  {id:'reach',page:'town',target:'nav-town',title:'Services serve their neighbours',body:'A school, clinic or water tower only serves the homes inside its circle. When you place one, homes turn green if they are covered and red if not.',when:s=>townOf(s).active,done:s=>townOf(s).services.filter(b=>b.type!=='waterTower').length>=2},
  { id: 'plant', page: 'farm', target: 'plant-btn', title: 'Plant your first crop', body: 'This is your one hectare. You own ten wheat seeds — exactly enough. Press Plant (or P).',
    when: () => true, done: (s) => anyField(s, (f) => !!f.crop) || s.stats.harvests > 0 },
  { id: 'time', page: 'farm', target: 'clock', title: 'Time runs by itself', body: 'Each real second is one in-game hour. Wheat needs 12 hours to ripen; the field turns gold when it is ready.',
    when: (s) => anyField(s, (f) => !!f.crop) && s.stats.harvests === 0, done: (s) => anyField(s, (f) => isReady(s, f)) || s.stats.harvests > 0 },
  { id: 'harvest', page: 'farm', target: 'harvest-btn', title: 'Harvest', body: 'Your wheat is ripe. Harvest it before it starts to over-ripen — waiting more than half a day costs yield.',
    when: (s) => anyField(s, (f) => isReady(s, f)) && s.stats.harvests === 0, done: (s) => s.stats.harvests > 0 },
  { id: 'sell', page: 'farm', target: 'trader', title: 'Find a buyer for your harvest', body: 'The village mill pays a fixed wheat price; the open market shows changing prices and selling impact.',
    when: (s) => s.stats.harvests > 0 && s.stats.sales === 0, done: (s) => s.stats.sales > 0 },
  { id: 'impact', page: 'farm', target: 'sell-card', title: 'Big sales move the price', body: 'Each sale pushes the local price down for a while, then it recovers. Selling in smaller batches, or waiting for a good price, earns more.',
    when: (s) => s.stats.sales >= 1 && (s.legacyProgression || stageAtLeast(s, 'market-town')) },
  { id: 'replant', page: 'farm', target: 'plant-btn', title: 'Replant', body: 'Plant again. When you are out of seed, planting buys what you need automatically — the button shows the cost.',
    when: (s) => s.stats.sales >= 1 && s.stats.harvests === 1 && anyField(s, (f) => !f.crop), done: (s) => s.stats.harvests >= 2 || anyField(s, (f) => !!f.crop) },
  { id: 'speed', page: 'farm', target: 'speed', title: 'Speed up time', body: 'Use the speed controls (or keys 1–6, Space to pause). Faster time never changes the economics — just how long you wait.',
    when: (s) => s.stats.sales >= 2 },
  { id: 'land', page: 'farm', target: 'buy-plot', title: 'Expand your farm', body: 'You can afford another hectare. Two fields means two crops growing at once — and your first real decision: what goes where.',
    when: (s) => s.fields.length === 1 && s.cash >= homePlotPrice(s), done: (s) => s.fields.length > 1 },
  { id: 'crops', page: 'farm', target: 'crop-picker', title: 'Faster is not always better', body: 'Corn and potatoes take longer but yield more. The trader offers seed and a barter buyer for your extra crop.',
    when: (s) => s.unlockedCrops.includes('corn') },
  { id: 'advance', page: 'farm', target: 'advance', title: 'A new era is ready', body: 'You have outgrown the homestead. Open the preview to see what the next era brings — and advance whenever you are ready. Nothing changes until you do.',
    when: (s) => s.eraReady, done: (s) => s.era >= 2 },
  { id: 'era2', page: 'overview', target: 'nav', title: 'The village has a market', body: 'Your first market day opens changing prices and more buyers. The village trader stays available for small trades.',
    when: (s) => chapter(s, 2, 'market-town') },
  { id: 'hire', page: 'workers', target: 'nav-workers', title: 'Hire help', body: 'Working every field by hand gets tiring. Farm hands plant and harvest for you — but cost wages every working hour, busy or not.',
    when: (s) => stageAtLeast(s, 'farm-business') && s.workers.length === 0, done: (s) => s.workers.length > 0 },
  { id: 'plan', page: 'farm', target: 'plan-picker', title: 'Give fields a crop plan', body: 'Workers only replant fields that have a plan. Select fields, choose a crop plan, and they will keep them cycling.',
    when: (s) => s.workers.length > 0 && !anyField(s, (f) => !!f.plan), done: (s) => anyField(s, (f) => !!f.plan) },
  { id: 'advisorHire', page: 'workers', target: 'hire-advisor', title: 'Money is draining away', body: 'Your farm has been spending more than it earns these last days. A farm advisor (Workers page) reads your books and tells you exactly what is costing you — for a daily fee.',
    when: (s) => stageAtLeast(s, 'farm-business') && !s.advisor && s.stats.sales > 0 && advice(s).profit < 0, done: (s) => s.advisor },
  { id: 'soil', page: 'farm', target: 'soil-panel', title: 'Your soil is wearing out', body: 'Every harvest removes nutrients. Rotate crops — soybeans put nitrogen back — rest fields, or spread fertiliser (which costs money and can harm soil if overused).',
    when: (s) => stageAtLeast(s, 'farm-business') && anyField(s, (f) => fertility(f) < 0.75) },
  { id: 'storage', page: 'storage', target: 'nav-storage', title: 'Storage is filling up', body: 'Whatever does not fit in storage at harvest is sold on the spot at whatever price the market gives. More storage lets you wait for better prices — but stock slowly spoils.',
    when: (s) => chapter(s, 2, 'market-town') && (() => { const st = stored(s, 'heartland'); return st.dry > st.cap.dry * 0.7; })() },
  { id: 'books', page: 'finance', target: 'nav-finance', title: 'Know your numbers', body: 'Every dollar you earn or spend is recorded. Finance shows where money comes from and goes — use it to see whether workers pay for themselves.',
    when: (s) => stageAtLeast(s, 'farm-business') && s.workers.length > 0 },
  { id: 'era3', page: 'equipment', target: 'nav-equipment', title: 'Mechanization', body: 'A tractor plants 4 ha an hour with one operator. Compare its fuel, servicing and price (or lease) against the wages it saves.',
    when: (s) => chapter(s, 3, 'industry') },
  { id: 'parcels', page: 'fields', target: 'buy-parcel', title: 'Bigger land, bigger operations', body: 'Parcels of 5–500 ha are cheaper per hectare, but too big to work by hand: they need workers, and ideally machines.',
    when: (s) => chapter(s, 3, 'industry') && s.fields.every((f) => f.ha <= 1) },
  { id: 'loans', page: 'finance', target: 'nav-finance', title: 'Banks will lend now', body: 'Loans let you buy machines and land before you can afford them. Interest is charged daily and rates float — debt magnifies both success and mistakes.',
    when: (s) => chapter(s, 3, 'industry') && s.cash < 5000 },
  { id: 'automation', page: 'automation', target: 'nav-automation', title: 'Manage by policy', body: 'Hire a farm manager and set policies: rotate crops automatically, fertilise when soil is low, service machines, keep a cash reserve.',
    when: (s) => chapter(s, 3, 'farm-business') && s.workers.some((w) => w.role === 'manager') },
  { id: 'era4', page: 'production', target: 'nav-production', title: 'Agricultural industry', body: 'Process your crops: wheat into flour, corn into feed and meat. A factory has fixed staff costs, so it only pays when it runs near capacity.',
    when: (s) => chapter(s, 4, 'industry') },
  { id: 'research', page: 'research', target: 'nav-research', title: 'Research', body: 'Build a research station to invest in technology: better seed, soil testing, efficient machines, automation rules, solar power and more.',
    when: (s) => chapter(s, 4, 'industry') && !s.buildings.some((b) => b.type === 'lab') },
  { id: 'era5', page: 'markets', target: 'nav-markets', title: 'Markets and finance', body: 'The commodity exchange is open. Hedge with futures, accept supply contracts at fixed prices, insure crops — and read your full financial statements.',
    when: (s) => chapter(s, 5, 'industry') },
  { id: 'analytics', page: 'analytics', target: 'nav-analytics', title: 'Plan before you leap', body: 'Analytics compares crop profitability, ranks fields, and runs “what if” scenarios through the real simulation.',
    when: (s) => chapter(s, 5, 'industry') },
  { id: 'era6', page: 'farm', target: 'nav-world', title: 'Regional expansion', body: 'Other regions have cheaper land, different climates, wages, tariffs and currencies. Produce where it is cheap, sell where it is dear — freight permitting.',
    when: (s) => chapter(s, 6, 'region') },
  { id: 'era7', page: 'corporation', target: 'nav-corporation', title: 'Agricultural corporation', body: 'Incorporate to hire division heads, issue shares and acquire competitors. Always run due diligence before you buy.',
    when: (s) => chapter(s, 7, 'city') },
  { id: 'era8', page: 'policy', target: 'nav-policy', title: 'The global food system', body: 'You now move world markets. Market power invites antitrust scrutiny; climate keeps shifting. Long-term milestones live on the Policy page.',
    when: (s) => s.legacyProgression && !communityOf(s).active && s.era >= 8 },
];

/** Each kind of problem the advisor spots is taught once, the first time it actually happens on this farm. */
function adviceTip(s: GameState): CoachTip | undefined {
  if (!s.advisor) return undefined;
  const a = advice(s).advice.find((x) => !s.seenTips.includes(`adv:${x.id.split(':')[0]}`));
  return a && { id: `adv:${a.id.split(':')[0]}`, page: a.page, target: 'advisor', title: `${a.icon} ${a.title}`, body: a.proof, when: () => true };
}

export const tipsOff = (s: GameState) => s.seenTips.includes('__off');

export function Coach() {
  const s = useGame();
  const [expanded, setExpanded] = useState(false);
  // The tip lives in the farm HUD's top-left column (under the objective) when that column exists.
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { const find = () => { const el = document.getElementById('coach-slot'); setSlot(cur => cur === el ? cur : el); }; find(); const id = setInterval(find, 250); return () => clearInterval(id); }, []);
  const page = useStore((x) => x.page);
  // tips whose goal is already reached finish themselves
  const finished = TIPS.find((t) => !s.seenTips.includes(t.id) && t.done?.(s));
  useEffect(() => {
    if (finished) act({ type: 'seeTip', tip: finished.id });
  }, [finished]);
  const tip = tipsOff(s) ? undefined : TIPS.find((t) => !s.seenTips.includes(t.id) && !t.done?.(s) && t.when(s)) ?? adviceTip(s);
  const rect = useElementRect(tip ? `[data-coach="${tip.id === 'sell' && s.legacyProgression ? 'sell-card' : tip.target}"]` : null);
  useEffect(()=>setExpanded(false),[tip?.id]);
  if (!tip) return null;
  const idx = TIPS.indexOf(tip); // -1 for advisor lessons
  const dismiss = () => act({ type: 'seeTip', tip: tip.id });
  const off = () => act({ type: 'seeTip', tip: '__off' });
  const visible = rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight;
  // The journal card is docked (never covers the control); a glowing ring marks the control itself.
  return (
    <>
      {visible && <div className="coach-ring" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      {(() => { const card = <aside className={`coach ${slot ? 'slotted' : 'docked'}${expanded ? ' expanded' : ' compact'}`} role="status" aria-label={`Farm journal: ${tip.title}`}>
        <button className="journal-peek" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}>📖 {tip.title} {expanded?'▾':'▸'}</button>
        {expanded && <><span className="step">📖 Farm journal · {idx < 0 ? 'Lesson from your farm' : 'Learning by doing'}</span>

        <p>{tip.body}</p>
        <div className="row between">
          <button className="btn ghost sm" onClick={off} title="You can turn the journal back on in Settings">Hide journal</button>
          <div className="row">
            {!visible && page !== tip.page && <button className="btn ghost sm" onClick={() => go(tip.page)}>Show me</button>}
            <button className="btn primary sm" onClick={dismiss}>Got it</button>
          </div>
        </div>
        </>}
      </aside>; return slot ? createPortal(card, slot) : card; })()}
    </>
  );
}

export const resetTips = () => act({ type: 'seeTip', tip: '__reset' }, 'Tips will replay from the start.');
export const tipsOn = () => act({ type: 'seeTip', tip: '__on' }, 'Tips turned on.');
