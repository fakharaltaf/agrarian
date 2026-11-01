// Events change underlying state (rain, energy, supply, demand, rates, tariffs) — never
// hand out flat bonuses. Each one's effect is read by the system it disrupts.
import { CROPS, GOODS, REGIONS, REGION_IDS, SAME_COUNTRY, TICKS_PER_DAY, TRADEABLE, type CropId, type RegionId } from './config';
import { activeEvents, clamp, equity, has, log, nextId, pick, post, random, sumBooks } from './core';
import type { EventKind, GameEvent, GameState } from './types';

const D = TICKS_PER_DAY;

function add(s: GameState, e: Omit<GameEvent, 'id' | 'announced'> & { lead?: number }) {
  if (s.events.some((x) => x.kind === e.kind && x.region === e.region && x.good === e.good && x.end > s.tick)) return;
  const ev: GameEvent = { ...e, id: nextId(s), announced: e.start - (e.lead ?? 0) };
  delete (ev as { lead?: number }).lead;
  s.events.push(ev);
  return ev;
}

const exposed = (s: GameState, r: RegionId) => s.regions[r].unlocked;

export function eventsDaily(s: GameState) {
  const t = s.tick;
  const era = s.era;
  const climate = s.macro.climate;
  if (era >= 2) {
    for (const r of REGION_IDS) {
      const def = REGIONS[r];
      if (random(s) < 0.0035 * (1.5 - def.rain) * (1 + 0.35 * climate)) {
        const lead = has(s, 'climateForecast') ? 10 * D : 0;
        add(s, { kind: 'drought', region: r, start: t + lead, end: t + lead + (10 + Math.floor(random(s) * 15)) * D, severity: 0.5 + random(s) * 0.5, lead,
          title: `Drought in ${def.name}`, text: 'Rainfall collapses for weeks. Unirrigated yields fall; regional crop supply shrinks and prices climb.' });
      }
      if (random(s) < 0.0018 * def.rain * (1 + 0.25 * climate)) {
        const lead = has(s, 'climateForecast') ? 10 * D : 0;
        add(s, { kind: 'flood', region: r, start: t + lead, end: t + lead + 2 * D, severity: 0.6 + random(s) * 0.4, lead,
          title: `Flooding in ${def.name}`, text: 'Standing crops may be lost; supply in the region drops for a few days.' });
      }
      const crops = s.fields.filter((f) => f.region === r && f.crop);
      if (crops.length) {
        const crop = pick(s, crops).crop!;
        const share = crops.filter((f) => f.crop === crop).length / crops.length;
        if (random(s) < 0.002 * (1 + 3 * share * share) * (has(s, 'pestResistant') ? 0.4 : 1))
          add(s, { kind: 'pests', region: r, good: crop, start: t, end: t + (10 + Math.floor(random(s) * 10)) * D, severity: 0.5 + random(s) * 0.5,
            title: `${GOODS[crop].name} pest outbreak in ${def.name}`, text: 'Pest pressure rises fast in fields of this crop — monocultures are hit hardest.' });
      }
      const hands = s.workers.filter((w) => w.region === r && w.role === 'hand');
      const morale = hands.reduce((a, w) => a + w.morale, 0) / Math.max(1, hands.length);
      if (hands.length >= 5 && morale < 0.35 && random(s) < 0.08)
        add(s, { kind: 'strike', region: r, start: t, end: t + 3 * D, severity: 1, title: `Labour strike in ${def.name}`, text: 'Workers walk out over pay and conditions. No field work, and hired haulage is disrupted.' });
      if (s.buildings.some((b) => b.region === r && (b.type === 'ranch' || b.type === 'dairy')) && random(s) < 0.0025)
        add(s, { kind: 'livestockDisease', region: r, start: t, end: t + 5 * D, severity: 1, title: `Livestock disease in ${def.name}`, text: 'Ranches and dairies are quarantined for five days.' });
    }
    if (random(s) < 0.002) {
      const g = pick(s, TRADEABLE.filter((x) => GOODS[x].kind !== 'input'));
      const r = pick(s, REGION_IDS);
      add(s, { kind: 'demandSurge', region: r, good: g, start: t, end: t + (10 + Math.floor(random(s) * 10)) * D, severity: 0.5 + random(s) * 0.5,
        title: `Demand surge: ${GOODS[g].name} in ${REGIONS[r].name}`, text: 'Buyers want more than local supply can deliver. Prices there will rise.' });
    }
  }
  if (era >= 3) {
    if (random(s) < 0.002) add(s, { kind: 'energyShock', start: t, end: t + (30 + Math.floor(random(s) * 30)) * D, severity: 0.6 + random(s) * 0.4,
      title: 'Energy price shock', text: 'Natural gas spikes. Fuel, fertiliser and electricity costs rise across the world; heavily mechanised and fertilised farms feel it most.' });
    if (random(s) < 0.0012) add(s, { kind: 'creditCrunch', start: t, end: t + 60 * D, severity: 1,
      title: 'Credit crunch', text: 'Interest rates jump and banks cut lending limits. Variable-rate loans cost more; leveraged competitors may stumble.' });
    if (random(s) < 0.0012) add(s, { kind: 'recession', start: t, end: t + (60 + Math.floor(random(s) * 60)) * D, severity: 0.6 + random(s) * 0.4,
      title: 'Economic recession', text: 'Incomes fall. Demand for meat, cheese, coffee and other premium goods drops more than for staples.' });
  }
  if (era >= 5) {
    if (random(s) < 0.002) {
      const r = pick(s, REGION_IDS.filter((x) => !exposed(s, x) || x !== 'heartland'));
      add(s, { kind: 'cropFailureAbroad', region: r, start: t, end: t + 30 * D, severity: 0.6 + random(s) * 0.4,
        title: `Crop failure in ${REGIONS[r].name}`, text: 'Local harvests fail. Import demand soars: an export opportunity if you can ship there.' });
    }
    if (!s.research.licensed.includes('droughtLicense') && !has(s, 'droughtResistant') && random(s) < 0.004 && !s.events.some((e) => e.kind === 'breakthrough'))
      add(s, { kind: 'breakthrough', start: t, end: t + 10 * D, severity: 1, title: 'Breakthrough: drought-tolerant seed',
        text: 'A university licenses a drought-tolerant variety. Pay up front plus a 5% royalty on every harvest using it.',
        choice: { options: [{ id: 'license', label: `License for $${Math.round(40000 * s.macro.cpi).toLocaleString()}`, detail: 'Water stress never cuts yields below 70% and yields +3%, but every harvest pays a 5% royalty.' }, { id: 'decline', label: 'Decline', detail: 'Keep your cash; you can research drought resistance yourself.' }], deadline: t + 10 * D } });
  }
  if (era >= 6) {
    if (random(s) < 0.0015) add(s, { kind: 'portClosure', start: t, end: t + (5 + Math.floor(random(s) * 6)) * D, severity: 1, title: 'Port closures', text: 'Sea freight to and from the Tropical Highlands is suspended. Shipments wait at port.' });
    if (random(s) < 0.0012) {
      const a = pick(s, REGION_IDS), b = pick(s, REGION_IDS.filter((x) => x !== a && !SAME_COUNTRY.some((c) => c.includes(a) && c.includes(x))));
      add(s, { kind: 'embargo', region: a, region2: b, start: t, end: t + (30 + Math.floor(random(s) * 30)) * D, severity: 1,
        title: `Trade embargo: ${REGIONS[a].name} ↔ ${REGIONS[b].name}`, text: 'Trade between the two is blocked. Prices diverge as arbitrage stops.' });
    }
  }
  if (era >= 8 && !s.events.some((e) => e.kind === 'foodCrisis') && random(s) < 0.004)
    add(s, { kind: 'foodCrisis', start: t, end: t + 60 * D, severity: 1, title: 'Global food crisis', text: 'Simultaneous failures cut world crop supply by a third for two months. Survive it with positive equity.' });

  for (const e of s.events) {
    if (e.announced === t - (t % D) && e.start > t) log(s, 'warning', `Forecast: ${e.title} expected in ${Math.round((e.start - t) / D)} days.`, 'world');
    if (e.start <= t && e.start > t - D) onStart(s, e);
    if (e.end <= t && e.end > t - D) onEnd(s, e);
  }
  s.events = s.events.filter((e) => e.end > t - 30 * D || (e.choice && !e.choice.chosen && e.choice.deadline > t));
}

function onStart(s: GameState, e: GameEvent) {
  const level = e.kind === 'cropFailureAbroad' || e.kind === 'demandSurge' || e.kind === 'breakthrough' ? 'opportunity' : ['foodCrisis', 'strike', 'antitrust'].includes(e.kind) ? 'critical' : 'warning';
  if (e.region && !exposed(s, e.region) && ['drought', 'flood', 'pests', 'strike', 'livestockDisease'].includes(e.kind)) return;
  log(s, level, `${e.title}. ${e.text}`, e.kind === 'breakthrough' || e.kind === 'antitrust' ? 'events' : 'world');
  if (e.kind === 'flood') {
    for (const f of s.fields) {
      if (f.region !== e.region || !f.crop || random(s) > 0.5 * e.severity) continue;
      log(s, 'warning', `Flood destroyed the ${GOODS[f.crop].name.toLowerCase()} on field ${f.id}.`, 'fields');
      f.crop = null;
      f.work = 0;
    }
  }
}

function onEnd(s: GameState, e: GameEvent) {
  if (e.kind === 'foodCrisis' && equity(s) > 0) {
    s.stats.crisisSurvived = true;
    log(s, 'opportunity', 'You came through the global food crisis solvent.', 'policy');
  }
}

export function chooseEvent(s: GameState, id: number, option: string): string | null {
  const e = s.events.find((x) => x.id === id);
  if (!e?.choice || e.choice.chosen) return 'Nothing to decide.';
  if (e.kind === 'breakthrough' && option === 'license') {
    const cost = 40000 * s.macro.cpi;
    if (cost > s.cash) return 'Not enough cash for the licence.';
    post(s, 'royalties', -cost, 'Drought-tolerant seed licence', 'heartland', 'corporate');
    s.research.licensed.push('droughtLicense');
  }
  if (e.kind === 'antitrust') {
    if (option === 'settle') {
      const fine = Math.max(10000, sumBooks(s, 120, ['sale']) * 0.03);
      post(s, 'fines', -fine, 'Antitrust settlement', e.region, 'corporate');
    } else {
      const fs = s.fields.filter((f) => f.region === e.region).sort((a, b) => b.ha - a.ha);
      const targetHa = fs.reduce((a, f) => a + f.ha, 0) * 0.2;
      let sold = 0;
      for (const f of fs) {
        if (sold >= targetHa) break;
        post(s, 'assetSale', f.cost * 0.8, `Divested field ${f.id}`, f.region);
        s.fields.splice(s.fields.indexOf(f), 1);
        sold += f.ha;
      }
    }
    s.corp.reputation = clamp(s.corp.reputation + (option === 'settle' ? -3 : 2), 0, 100);
  }
  e.choice.chosen = option;
  e.end = Math.min(e.end, s.tick + 1);
  return null;
}

export function antitrustCheck(s: GameState, shareOf: (r: RegionId, g: CropId) => number) {
  if (s.era < 7) return;
  for (const r of REGION_IDS)
    for (const c of Object.keys(CROPS) as CropId[]) {
      const sh = shareOf(r, c);
      if (sh < 0.35 || activeEvents(s, 'antitrust', r).length || random(s) > 0.05 * (1 + (50 - s.corp.reputation) / 50)) continue;
      add(s, { kind: 'antitrust', region: r, good: c, start: s.tick, end: s.tick + 15 * D, severity: 1,
        title: `Antitrust probe: ${GOODS[c].name} in ${REGIONS[r].name}`,
        text: `Regulators say you control ${Math.round(sh * 100)}% of the regional ${GOODS[c].name.toLowerCase()} market.`,
        choice: { options: [{ id: 'settle', label: 'Settle', detail: 'Pay a fine of 3% of recent sales. Reputation −3.' }, { id: 'divest', label: 'Divest 20% of land', detail: 'Sell a fifth of your land in the region at 80% of book value. Reputation +2.' }], deadline: s.tick + 15 * D } });
    }
}

/** Unanswered decisions resolve to the cautious default at their deadline. */
export function expireChoices(s: GameState) {
  for (const e of s.events) if (e.choice && !e.choice.chosen && s.tick >= e.choice.deadline) chooseEvent(s, e.id, e.kind === 'antitrust' ? 'settle' : 'decline');
}

export const EVENT_KINDS: EventKind[] = ['drought', 'flood', 'pests', 'energyShock', 'strike', 'portClosure', 'embargo', 'recession', 'demandSurge', 'creditCrunch', 'breakthrough', 'livestockDisease', 'antitrust', 'foodCrisis', 'cropFailureAbroad'];
