// Labour and machinery. Every field operation needs labour-hours; machines multiply what one
// operator can do but burn fuel, wear out and depreciate. Workers cost wages whether busy or not.
import { CONFIG, CROPS, MACHINES, REGIONS, WORK_END, WORK_START, type RegionId } from './config';
import { clamp, execOn, fuelPrice, has, hour, log, marketWage, nextId, pick, post, random, severity } from './core';
import { harvestField, isReady, plantField, warnOnce } from './agriculture';
import { overdraftLimit } from './finance';
import type { Field, GameState, Machine, Worker } from './types';

const FIRST = ['Ana', 'Ben', 'Chen', 'Dara', 'Eli', 'Femi', 'Gus', 'Hana', 'Ivo', 'Jo', 'Kai', 'Lena', 'Mo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Ravi', 'Sol', 'Tess', 'Uma', 'Vic', 'Wren', 'Yara', 'Zed'];
const LAST = ['Alvarez', 'Brook', 'Costa', 'Dlamini', 'Evans', 'Fischer', 'Grant', 'Haddad', 'Ito', 'Jensen', 'Kowal', 'Lopez', 'Moreau', 'Nakamura', 'Okafor', 'Park', 'Reyes', 'Silva', 'Tan', 'Varga'];

export const wageOf = (s: GameState, w: Worker) => (w.role === 'manager' ? CONFIG.managerWage * s.macro.cpi : marketWage(s, w.region)) * w.wageFactor;
export const productivity = (s: GameState, w: Worker) => w.skill * (0.6 + 0.4 * w.morale) * spanPenalty(s, w.region);

/** Management overhead: each manager coordinates 20 hands; beyond that everyone slows down. */
export function spanPenalty(s: GameState, r: RegionId) {
  const hands = s.workers.filter((w) => w.region === r && w.role === 'hand').length;
  const managers = s.workers.filter((w) => w.region === r && w.role === 'manager').length + (execOn(s, 'crops') ? 2 : 0);
  const span = 8 + 20 * managers; // the owner can personally oversee 8
  return hands <= span ? 1 : clamp(span / hands, 0.5, 1) ** 0.5;
}

export function hire(s: GameState, region: RegionId, role: 'hand' | 'manager', wageFactor: number): Worker {
  const w: Worker = {
    id: nextId(s), name: `${pick(s, FIRST)} ${pick(s, LAST)}`, region, role, wageFactor: clamp(wageFactor, 0.7, 1.6),
    skill: role === 'manager' ? 1 : 0.75 + random(s) * 0.35, morale: 0.7, lowDays: 0, trainingUntil: 0, hours: 0, task: 0, perk: null,
  };
  s.workers.push(w);
  return w;
}

// ---------------------------------------------------------------- hourly labour

interface Task { f: Field; kind: 'plant' | 'harvest'; done?: boolean; taken?: boolean }

export function laborTick(s: GameState) {
  const h = hour(s);
  const working = h >= WORK_START && h < WORK_END;
  for (const m of s.machines) {
    m.util = m.util * 0.98 + (m.usedThisTick ? 0.02 : 0);
    m.usedThisTick = false;
    m.task = 0;
  }
  const regions = new Set<RegionId>([...s.workers.map((w) => w.region), ...s.machines.filter((m) => MACHINES[m.type].autonomous).map((m) => m.region)]);
  for (const r of regions) {
    const strike = severity(s, 'strike', r) > 0;
    const tasks = buildTasks(s, r);
    // autonomous machines run around the clock
    for (const m of s.machines) {
      const d = MACHINES[m.type];
      if (m.region !== r || !d.autonomous || m.broken) continue;
      const t = tasks.find((x) => !x.done && !x.taken && fits(x, m));
      if (t) machineHour(s, m, tasks, t, machineRate(s, m));
    }
    if (!working) {
      for (const w of s.workers) if (w.region === r) w.task = 0;
      continue;
    }
    const riders = new Map<number, number>(); // platform id → pickers aboard this hour
    for (const w of s.workers) {
      if (w.region !== r || w.role !== 'hand') continue;
      w.task = 0;
      post(s, 'wages', -wageOf(s, w), 'Farm hands', r);
      if (strike || w.trainingUntil > s.tick) continue;
      w.hours++;
      w.skill = Math.max(w.skill, Math.min(1.3, w.skill + 0.0002)); // learning by doing, up to 1.3
      const p = productivity(s, w);
      const perkFor = (kind: Task['kind']) => (kind === 'plant' && w.perk === 'planter') || (kind === 'harvest' && w.perk === 'harvester') ? 1.3 : 1;
      // a free machine with work waiting gets a driver first
      const m = s.machines.find((x) => x.region === r && !x.usedThisTick && !x.broken && !MACHINES[x.type].autonomous && tasks.some((t) => !t.done && !t.taken && fits(t, x)));
      if (m) {
        const t = tasks.find((x) => !x.done && !x.taken && fits(x, m))!;
        w.task = t.f.id;
        machineHour(s, m, tasks, t, machineRate(s, m) * (0.7 + 0.3 * p) * perkFor(t.kind));
        continue;
      }
      // spread out: each hand takes the next field nobody is on; only when every field is covered do they double up
      const t = tasks.find((x) => !x.done && !x.taken) ?? tasks.find((x) => !x.done);
      if (!t) continue;
      t.taken = true;
      w.task = t.f.id;
      // a free spot on an orchard platform makes fruit-picking several times faster
      const plat = t.kind === 'harvest' ? s.machines.find((x) => x.region === r && !x.broken && MACHINES[x.type].assist && MACHINES[x.type].crops!.includes(t.f.crop!) && (riders.get(x.id) ?? 0) < MACHINES[x.type].riders!) : undefined;
      if (plat) {
        if (!riders.has(plat.id)) runMachine(s, plat);
        riders.set(plat.id, (riders.get(plat.id) ?? 0) + 1);
        plat.task = t.f.id;
      }
      work(s, t, (p * perkFor(t.kind) * (plat ? MACHINES[plat.type].assist! : 1)) / (t.f.ha * (t.kind === 'plant' ? CONFIG.plantHours : CROPS[t.f.crop!].harvestHours)), null);
    }
    if (tasks.some((t) => !t.done)) s.regions[r].backlog++;
  }
  for (const w of s.workers) if (w.role === 'manager' && working) post(s, 'salaries', -wageOf(s, w), 'Farm managers', w.region);
  if (s.advisor && working) post(s, 'advisor', -CONFIG.advisorFee * s.macro.cpi, 'Farm advisor', 'heartland');
}

function buildTasks(s: GameState, r: RegionId): Task[] {
  const harvest: Task[] = [];
  const plant: Task[] = [];
  const budget = essentialBudget(s);
  for (const f of s.fields) {
    if (f.region !== r) continue;
    if (isReady(s, f)) harvest.push({ f, kind: 'harvest' });
    else if (!f.crop && f.plan) {
      if (budget > 0) plant.push({ f, kind: 'plant' });
      else warnOnce(s, `noplant-${r}`, 'warning', `Workers can't buy seed: your overdraft is exhausted. Sell stock or assets — wages keep running.`, 'finance', 48);
    }
  }
  harvest.sort((a, b) => a.f.plantedAt + CROPS[a.f.crop!].growthTicks - (b.f.plantedAt + CROPS[b.f.crop!].growthTicks));
  return [...harvest, ...plant];
}

const fits = (t: Task, m: Machine) => {
  const d = MACHINES[m.type];
  if (!d.haPerHour || t.kind !== d.task) return false; // platforms carry pickers rather than working a field themselves
  return d.crops ? d.crops.includes(t.f.crop!) : t.kind !== 'harvest' || CROPS[t.f.crop!].machineHarvest;
};

/** A machine works the whole hour: when one field is done it moves straight on (a 4 ha/h tractor plants four 1 ha plots). */
function machineHour(s: GameState, m: Machine, tasks: Task[], first: Task, haPerHour: number) {
  runMachine(s, m);
  m.task = first.f.id;
  let left = 1;
  for (let t: Task | undefined = first; t && left > 1e-6; t = tasks.find((x) => !x.done && !x.taken && fits(x, m))) {
    const rate = haPerHour / t.f.ha; // share of this field per hour
    const use = Math.min(left, (1 - t.f.work) / rate);
    t.taken = true;
    work(s, t, use * rate + 1e-9, m);
    left -= use;
  }
}

export const machineRate = (s: GameState, m: Machine) => (MACHINES[m.type].haPerHour ?? 0) * (has(s, 'mech2') ? 1.3 : 1) * (1 + 0.25 * ((m.tier || 1) - 1));

/** Adds progress to a task; `by` is the machine that picked it (fruit machines can bruise the crop). */
function work(s: GameState, t: Task, progress: number, by: Machine | null) {
  t.f.work += progress;
  if (t.f.work < 1) return;
  t.done = true;
  if (t.kind === 'harvest') harvestField(s, t.f, by ? MACHINES[by.type].qualityHit : 0);
  else {
    const err = plantField(s, t.f, t.f.plan!, essentialBudget(s));
    if (err) t.f.work = 0;
  }
  t.f.work = 0;
}

export function runMachine(s: GameState, m: Machine) {
  const d = MACHINES[m.type];
  m.usedThisTick = true;
  m.hours++;
  const litres = d.fuelPerHour * (has(s, 'mech2') ? 0.8 : 1) * (1 - 0.1 * ((m.tier || 1) - 1));
  const stock = s.regions[m.region].inventory;
  const fromStock = Math.min(stock.fuel, litres);
  stock.fuel -= fromStock;
  if (litres - fromStock > 0) post(s, 'fuel', -(litres - fromStock) * fuelPrice(s, m.region), 'Machine fuel', m.region);
  s.macro.emissions += litres * 2.7;
  const mechanic = s.workers.some((w) => w.region === m.region && w.perk === 'mechanic');
  m.condition = Math.max(0, m.condition - (mechanic ? 0.7 : 1) / d.servicePerHours);
  if (!m.leased) {
    const dep = m.cost / d.life;
    m.depreciated = Math.min(m.cost, m.depreciated + dep);
    post(s, 'depreciation', -dep, 'Machinery depreciation', m.region);
  }
  const p = (0.0004 + 0.03 * (1 - m.condition) ** 2) * (has(s, 'predictiveMaintenance') ? 0.3 : 1) * (1 - 0.25 * ((m.tier || 1) - 1));
  if (random(s) < p) {
    m.broken = true;
    log(s, 'warning', `${d.name} #${m.id} in ${REGIONS[m.region].name} broke down. Repair it on the Equipment page.`, 'equipment');
  }
}

export const serviceCost = (s: GameState, m: Machine) => MACHINES[m.type].serviceCost * s.macro.cpi * (has(s, 'mech2') ? 1.25 : 1) * (m.broken ? 3 : 1);

export function service(s: GameState, m: Machine) {
  post(s, 'maintenance', -serviceCost(s, m), m.broken ? `Repair ${MACHINES[m.type].name}` : `Service ${MACHINES[m.type].name}`, m.region);
  m.condition = 1;
  m.broken = false;
}

// ---------------------------------------------------------------- daily

export function workforceDaily(s: GameState) {
  const quit: Worker[] = [];
  for (const w of s.workers) {
    const backlog = s.regions[w.region].backlog / (WORK_END - WORK_START);
    const target = clamp(0.62 + (w.wageFactor - 1) * 1.3 - 0.2 * Math.min(1, backlog) + 0.15 * (s.corp.reputation - 50) / 50, 0, 1);
    w.morale = clamp(w.morale + (target - w.morale) * 0.2, 0, 1);
    w.lowDays = w.morale < 0.25 ? w.lowDays + 1 : 0;
    if (w.lowDays >= 5) quit.push(w);
  }
  for (const w of quit) {
    s.workers.splice(s.workers.indexOf(w), 1);
    log(s, 'warning', `${w.name} quit: morale stayed too low (pay or overwork).`, 'workers');
  }
  for (const r of Object.values(s.regions)) r.backlog = 0;
  // trucks wear by calendar; leases bill daily
  for (const m of s.machines) {
    const d = MACHINES[m.type];
    if (m.leased) post(s, 'lease', -d.leasePerDay * s.macro.cpi, `${d.name} lease`, m.region);
    if (m.type === 'truck' && !m.leased) {
      const dep = m.cost / (d.life / 24);
      m.depreciated = Math.min(m.cost, m.depreciated + dep);
      post(s, 'depreciation', -dep, 'Truck depreciation', m.region, 'logistics');
      if (s.regions[m.region].truckToday > 0) m.condition = Math.max(0, m.condition - 0.01);
    }
  }
}

/** Seed is financed on the operating line like on a real farm: workers may plant into half the overdraft, never below the reserve. */
export const autoBudget = (s: GameState) => (s.automation.policies.cashReserve > 0 ? s.cash - s.automation.policies.cashReserve : s.cash + overdraftLimit(s) * 0.5);
/** Seed and feed ignore the cash reserve: idle hands and hungry animals cost more than they save. */
export const essentialBudget = (s: GameState) => s.cash + overdraftLimit(s) * 0.5;

export const isWorkHour = (s: GameState) => hour(s) >= WORK_START && hour(s) < WORK_END;
