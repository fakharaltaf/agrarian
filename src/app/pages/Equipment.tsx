import { useState } from 'react';
import { CONFIG, CROPS, GOODS, MACHINES, REGIONS, TECH, WORK_END, WORK_START, type MachineType, type RegionId } from '../../simulation/config';
import { fuelPrice, has, known, marketWage } from '../../simulation/core';
import { machineUpgradeCost, machinePrice } from '../../simulation/engine';
import { serviceCost } from '../../simulation/operations';
import type { GameState, Machine } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Info, Kpi, PageHead, Seg, Select, Table } from '../ui';
import { regionOptions, unlockedRegions } from './shared';

const TYPES = Object.keys(MACHINES) as MachineType[];
const HOURS = WORK_END - WORK_START;
const DUE = 0.6; // service before condition drops below this; breakdown risk climbs fast past it

const available = (s: GameState, t: MachineType) => s.era >= MACHINES[t].minEra && (!MACHINES[t].research || has(s, MACHINES[t].research!)) && (!MACHINES[t].crops || MACHINES[t].crops!.some((c) => s.unlockedCrops.includes(c)));
const breakRisk = (s: GameState, cond: number) => (0.0004 + 0.03 * (1 - cond) ** 2) * (has(s, 'predictiveMaintenance') ? 0.3 : 1);
const rateOf = (s: GameState, t: MachineType) => (MACHINES[t].haPerHour ?? 0) * (has(s, 'mech2') ? 1.3 : 1);
const fuelOf = (s: GameState, t: MachineType) => MACHINES[t].fuelPerHour * (has(s, 'mech2') ? 0.8 : 1);
const serviceOf = (s: GameState, t: MachineType) => MACHINES[t].serviceCost * s.macro.cpi * (has(s, 'mech2') ? 1.25 : 1);
const leaseDay = (s: GameState, t: MachineType) => MACHINES[t].leasePerDay * s.macro.cpi;
/** Running cost per operating hour excluding the operator: fuel + depreciation + service wear. */
const hourly = (s: GameState, t: MachineType, r: RegionId) => fuelOf(s, t) * fuelPrice(s, r) + machinePrice(s, t) / MACHINES[t].life + serviceOf(s, t) / MACHINES[t].servicePerHours;

export default function EquipmentPage() {
  const s = useGame();
  const opts = regionOptions(s);
  const [region, setRegion] = useState<RegionId>('heartland');
  const r = opts.some((o) => o.v === region) ? region : 'heartland';
  const owned = s.machines.filter((m) => !m.leased);
  const book = owned.reduce((a, m) => a + Math.max(0, m.cost - m.depreciated), 0);
  const broken = s.machines.filter((m) => m.broken).length;
  const leaseCost = s.machines.filter((m) => m.leased).reduce((a, m) => a + leaseDay(s, m.type), 0);

  return (
    <div className="stack l">
      <PageHead title="Equipment" sub="Machines multiply what each hand can do. They burn fuel, wear out and lose value with every hour they work."
        actions={opts.length > 1 ? <Select label="Region" value={r} onChange={setRegion} options={opts} /> : undefined} />

      <div className="kpis">
        <Kpi label="Machines" value={num(s.machines.length)} sub={`${num(owned.length)} owned · ${num(s.machines.length - owned.length)} leased`} />
        <Kpi label="Fleet book value" value={money(book)} info="Purchase price minus depreciation for owned machines. Leased machines are not your assets." />
        <Kpi label="Leases / day" value={money(leaseCost)} />
        <Kpi label="Broken down" value={num(broken)} tone={broken ? 'down' : undefined} info="Broken machines do no work until repaired. A repair costs 3× a routine service." />
      </div>

      <Card title={`Buy or lease in ${REGIONS[r].name}`} info="Leasing needs a 3-day deposit, then bills daily. Owned machines depreciate per operating hour and can be sold for 80% of book value.">
        <div className="grid3">
          {TYPES.filter((t) => available(s, t)).map((t) => <MachineCard key={t} s={s} t={t} r={r} />)}
        </div>
        {TYPES.filter((t) => !available(s, t)).map((t) => (
          <p key={t} className="muted small" style={{ marginTop: 8 }}>{MACHINES[t].name}: unlocks {s.era < MACHINES[t].minEra ? `in Era ${MACHINES[t].minEra}` : MACHINES[t].research && !has(s, MACHINES[t].research!) ? `with ${TECH[MACHINES[t].research!].name} research` : `when you can grow ${MACHINES[t].crops!.map((c) => GOODS[c].name.toLowerCase()).join(' or ')}`}.</p>
        ))}
      </Card>

      <div className="grid2">
        <Calculator s={s} r={r} />
        <TruckCard s={s} r={r} />
      </div>

      <Fleet s={s} />
    </div>
  );
}

function MachineCard({ s, t, r }: { s: GameState; t: MachineType; r: RegionId }) {
  const d = MACHINES[t];
  const buy = machinePrice(s, t);
  const deposit = Math.round(leaseDay(s, t) * 3);
  const isTruck = t === 'truck';
  return (
    <div className="kpi" style={{ gap: 8 }}>
      <div className="row between">
        <b>{d.name}</b>
        {d.autonomous && <span className="pill accent">Autonomous</span>}
      </div>
      <dl className="facts">
        {isTruck ? <><dt>Haulage</dt><dd>{num(d.capacity!)} units/day</dd></>
          : d.assist ? <><dt>Pickers</dt><dd>carries {d.riders} hands · they pick {d.assist}× faster</dd></>
          : <><dt>Work rate</dt><dd>{rateOf(s, t).toFixed(1)} ha/h {d.task === 'plant' ? 'planting' : 'harvesting'}</dd></>}
        {d.crops && <><dt>Crops</dt><dd>{d.crops.map((c) => GOODS[c].name).join(', ')} only{d.qualityHit ? ' · machine-picked fruit is one grade step lower' : ' · no quality loss'}</dd></>}
        {!isTruck && <><dt>Fuel</dt><dd>{num(fuelOf(s, t), 1)} L/h · {price(fuelOf(s, t) * fuelPrice(s, r))}/h</dd></>}
        <dt>Service</dt><dd>{isTruck ? 'by wear' : `every ${num(d.servicePerHours)} h`} · {money(serviceOf(s, t))}</dd>
        <dt>Life</dt><dd>{num(d.life)} h · {price(buy / d.life)}/h</dd>
        <dt>Operator</dt><dd>{d.autonomous ? 'none, runs 24h' : isTruck ? 'none' : d.assist ? 'your hands drive it while they pick' : '1 hand'}</dd>
        <dt>Lease</dt><dd>{money(leaseDay(s, t))}/day</dd>
      </dl>
      <div className="row wrap">
        <button className="btn primary sm" disabled={buy > s.cash} onClick={() => act({ type: 'buyMachine', region: r, machine: t, lease: false }, `${d.name} bought.`)}>Buy {money(buy)}</button>
        <button className="btn ghost sm" disabled={deposit > s.cash} onClick={() => act({ type: 'buyMachine', region: r, machine: t, lease: true }, `${d.name} leased.`)}>Lease · {money(deposit)} deposit</button>
      </div>
    </div>
  );
}

/** Rough daily economics of one machine of a type against doing the same work by hand. */
function Calculator({ s, r }: { s: GameState; r: RegionId }) {
  const kinds = TYPES.filter((t) => available(s, t) && MACHINES[t].task && MACHINES[t].haPerHour);
  const [pick, setPick] = useState<MachineType>('tractor');
  const t = kinds.includes(pick) ? pick : kinds[0];
  if (!t) return null;
  const d = MACHINES[t];
  // Area that needs this task per day at current plans: each field cycles once per growth period.
  let haDay = 0, handHrsPerHa = 0;
  for (const f of s.fields) {
    const c = f.crop ?? f.plan;
    if (f.region !== r || !c || (d.crops ? !d.crops.includes(c) : d.task === 'harvest' && !CROPS[c].machineHarvest)) continue;
    const per = (f.ha * 24) / CROPS[c].growthTicks;
    haDay += per;
    handHrsPerHa += per * (d.task === 'plant' ? CONFIG.plantHours : CROPS[c].harvestHours);
  }
  const avgHand = haDay ? handHrsPerHa / haDay : 0;
  const rate = rateOf(s, t);
  const opHours = d.autonomous ? 24 : HOURS;
  // what the machines you already own cover first; a new one only gets the rest, and only if someone can drive it
  const fleet = s.machines.filter((m) => m.region === r && m.type === t && !m.broken).length;
  const hands = s.workers.filter((w) => w.region === r && w.role === 'hand').length;
  const drivable = s.machines.filter((m) => m.region === r && MACHINES[m.type].haPerHour && !MACHINES[m.type].autonomous && !m.broken).length;
  const noDriver = !d.autonomous && hands <= drivable;
  const owned = Math.min(haDay, fleet * rate * opHours);
  const covered = noDriver ? 0 : Math.min(haDay - owned, rate * opHours);
  const machineHrs = covered / Math.max(rate, 1e-9);
  const handSaved = covered * avgHand - (d.autonomous ? 0 : machineHrs);
  const wage = marketWage(s, r);
  const wageSaved = handSaved * wage;
  const runCost = machineHrs * hourly(s, t, r);
  const net = wageSaved - runCost;
  const planted = s.fields.filter((f) => f.region === r && (f.crop || f.plan)).reduce((a, f) => a + f.ha, 0);
  return (
    <Card title="Machine vs hand labour" info="Estimate for one extra machine in this region at today's crop plans, wages and fuel price. Each field needs the task once per growing cycle.">
      <div className="stack">
        <Seg label="Machine" value={t} onChange={setPick} options={kinds.map((k) => ({ v: k, label: MACHINES[k].name }))} />
        {!haDay ? <p className="muted">No {d.task === 'plant' ? 'planned' : 'machine-harvestable'} fields in {REGIONS[r].name} yet. Give fields a crop plan to see the comparison.</p> : (
          <>
            <dl className="facts">
              <dt>Planted / planned area</dt><dd>{num(planted)} ha</dd>
              <dt>{d.task === 'plant' ? 'Planting' : 'Harvesting'} needed</dt><dd>{num(haDay, 1)} ha/day</dd>
              {fleet > 0 && <><dt>Your {fleet} already cover{fleet === 1 ? 's' : ''}</dt><dd>{num(owned, 1)} ha/day ({pct0(owned / haDay)})</dd></>}
              <dt>One more covers</dt><dd>{num(covered, 1)} ha/day ({pct0(covered / haDay)})</dd>
              <dt>Hand labour saved</dt><dd>{num(handSaved, 1)} h/day</dd>
              <dt>Wages saved <Info text={`At the market wage of ${price(wage)}/h. ${d.autonomous ? 'No operator needed.' : 'One hand still drives the machine; that time is netted off.'}`} /></dt><dd className="up">{money(wageSaved)}/day</dd>
              <dt>Fuel + depreciation + service <Info text="Per operating hour" breakdown={[['Fuel', price(fuelOf(s, t) * fuelPrice(s, r))], ['Depreciation', price(machinePrice(s, t) / d.life)], ['Service wear', price(serviceOf(s, t) / d.servicePerHours)], ['Operating hours/day', num(machineHrs, 1)]]} /></dt><dd className="down">−{money(runCost)}/day</dd>
              <dt><b>Net</b></dt><dd className={net >= 0 ? 'up' : 'down'}><b>{money(net)}/day</b></dd>
            </dl>
            {noDriver && <p className="warn small">No spare hand to drive another one: you have {hands} hand{hands === 1 ? '' : 's'} for {drivable} machine{drivable === 1 ? '' : 's'}. Hire a hand first — a machine without a driver does nothing.</p>}
            <p className="explain">{net > 0 ? `Worth it only if you also let ${num(handSaved / HOURS, 1)} hands go or redeploy them — wages are paid whether they work or not.` : 'At this scale hand labour is cheaper. Machines pay off on bigger acreage or where wages are high.'} Leasing instead costs {money(leaseDay(s, t))}/day with no depreciation.</p>
          </>
        )}
      </div>
    </Card>
  );
}

function TruckCard({ s, r }: { s: GameState; r: RegionId }) {
  if (!available(s, 'truck')) return null;
  const fp = fuelPrice(s, r);
  const own = 0.015 * fp;
  const hired = (CONFIG.haulPerUnit / REGIONS[r].infra) * fp * (has(s, 'routeOptimization') ? 0.8 : 1);
  const trucks = s.machines.filter((m) => m.region === r && m.type === 'truck' && !m.broken).length;
  const cap = MACHINES.truck.capacity!;
  const dep = machinePrice(s, 'truck') / (MACHINES.truck.life / 24);
  return (
    <Card title="Trucks" info="Every sale or purchase is hauled. Your own trucks are used first; the rest goes by hired haulage, which is dearer; past its daily regional limit, short-notice lorries cost 3× more.">
      <dl className="facts">
        <dt>Own trucks here</dt><dd>{num(trucks)} · {num(trucks * cap)} units/day</dd>
        <dt>Used today</dt><dd>{num(s.regions[r].truckToday)}</dd>
        <dt>Own truck haulage</dt><dd>{price(own)}/unit</dd>
        <dt>Hired haulage</dt><dd>{price(hired)}/unit</dd>
        <dt>Hired capacity</dt><dd>{num(CONFIG.haulCapacityPerDay * REGIONS[r].infra)} units/day, then 3× rate</dd>
        <dt>Saving per full truck</dt><dd className="up">{money(cap * (hired - own))}/day</dd>
        <dt>Truck depreciation</dt><dd>{money(dep)}/day</dd>
      </dl>
      <p className="explain" style={{ marginTop: 8 }}>Each truck adds {num(cap)} units a day of cheap haulage. Worth it once you move more than about {num(dep / Math.max(1e-9, hired - own))} units a day here.</p>
    </Card>
  );
}

/** Assign a hand to a machine: they run it whenever it has work and work by hand otherwise. */
function DriverPicker({ s, m }: { s: GameState; m: Machine }) {
  const d = MACHINES[m.type];
  if (!d.haPerHour || d.autonomous) return <span className="faint small">{d.autonomous ? 'Self-driving' : '—'}</span>;
  const hands = s.workers.filter((w) => w.role === 'hand' && w.region === m.region);
  const busy = (id: number) => s.machines.find((x) => x.driver === id && x !== m);
  return (
    <select className="input" aria-label={`Driver for ${d.name} #${m.id}`} value={m.driver ?? ''} title="An assigned hand runs this machine whenever it has work, and works by hand when it doesn't. Unassigned machines are driven by whoever is free."
      onChange={(e) => act({ type: 'assignDriver', machineId: m.id, workerId: e.target.value ? Number(e.target.value) : null })}>
      <option value="">Anyone free</option>
      {hands.map((w) => <option key={w.id} value={w.id}>{w.name}{busy(w.id) ? ` (moves from ${MACHINES[busy(w.id)!.type].name} #${busy(w.id)!.id})` : ''}</option>)}
    </select>
  );
}

function Fleet({ s }: { s: GameState }) {
  const multi = unlockedRegions(s).length > 1;
  const pm = has(s, 'predictiveMaintenance');
  return (
    <Card title={`Fleet (${s.machines.length})`} info={`Breakdown risk per operating hour = 0.04% + 3% × (1 − condition)². It rises sharply as condition falls: about 0.1% at 85%, 0.5% at 60%, 1.7% at 25%.${pm ? ' Predictive maintenance cuts it by 70%.' : ' Predictive maintenance research cuts it by 70%.'}`}>
      <Table rows={s.machines} rowKey={(m) => m.id} search={(m) => `${MACHINES[m.type].name} ${REGIONS[m.region].name}`} initialSort={{ key: 'cond', dir: 1 }}
        empty="No machines yet. A tractor plants 4 ha an hour with one hand at the wheel." cols={[
          { key: 'type', label: 'Machine', sort: (m) => m.type, render: (m) => <>{MACHINES[m.type].name} <span className="faint small">#{m.id}</span></> },
          { key: 'driver', label: 'Driver', sort: (m) => m.driver ?? 0, render: (m) => <DriverPicker s={s} m={m} /> },
          ...(multi ? [{ key: 'region', label: 'Region', sort: (m: Machine) => m.region, render: (m: Machine) => REGIONS[m.region].name }] : []),
          { key: 'cond', label: 'Condition', width: 120, sort: (m) => (m.broken ? -1 : m.condition), render: (m) => m.broken ? <span className="pill bad">Broken</span> : (
            <div className="stack s"><Bar thin value={m.condition} color={m.condition < DUE ? 'var(--warn)' : undefined} label="Condition" /><span className="small mono">{pct0(m.condition)}</span></div>
          ) },
          { key: 'risk', label: 'Risk / h', align: 'r', sort: (m) => breakRisk(s, m.condition), render: (m) => m.broken || m.type === 'truck' ? <span className="faint">—</span> : <span className={breakRisk(s, m.condition) > 0.004 ? 'warn' : ''}>{(breakRisk(s, m.condition) * 100).toFixed(2)}%</span> },
          { key: 'use', label: 'In use', align: 'r', sort: (m) => m.util, render: (m) => <span className={m.util < 0.05 ? 'faint' : ''} title="Share of recent hours this machine was working (about the last two days)">{pct0(m.util)}</span> },
          { key: 'hours', label: 'Hours', align: 'r', sort: (m) => m.hours, render: (m) => num(m.hours) },
          { key: 'own', label: 'Terms', render: (m) => <span className={`pill ${m.leased ? 'accent' : ''}`}>{m.leased ? `Leased ${money(leaseDay(s, m.type))}/d` : 'Owned'}</span> },
          { key: 'book', label: 'Book value', align: 'r', sort: (m) => m.cost - m.depreciated, render: (m) => m.leased ? <span className="faint">—</span> : money(Math.max(0, m.cost - m.depreciated)) },
          { key: 'due', label: 'Service due', align: 'r', render: (m) => {
            if (m.broken || m.condition < DUE) return <span className="warn">now</span>;
            const left = m.type === 'truck' ? `~${Math.ceil((m.condition - DUE) / 0.01)} days` : `in ${num((m.condition - DUE) * MACHINES[m.type].servicePerHours)} h`;
            return <span className="muted">{left}</span>;
          } },
          { key: 'act', label: '', render: (m) => {
            const c = serviceCost(s, m);
            const value = m.leased ? 0 : Math.round(Math.max(0, m.cost - m.depreciated) * 0.8 * (m.broken ? 0.5 : 1));
            return (
              <div className="row">
                <button className={`btn sm ${m.broken ? 'primary' : 'ghost'}`} disabled={c > s.cash || (!m.broken && m.condition > 0.995)} onClick={() => act({ type: 'service', machineId: m.id }, m.broken ? 'Repaired.' : 'Serviced.')}>
                  {m.broken ? 'Repair' : 'Service'} {money(c)}
                </button>
                {known(s, 'machineUpgrades') && !m.leased && m.tier < 3 && (
                  <Confirm label={`Tier ${m.tier + 1} · ${money(machineUpgradeCost(s, m))}`} className="btn ghost sm" disabled={machineUpgradeCost(s, m) > s.cash} confirmLabel="Upgrade"
                    title={`Upgrade ${MACHINES[m.type].name} #${m.id} to tier ${m.tier + 1}?`} body="Works 25% faster, burns 10% less fuel and breaks down a quarter less often than the tier below."
                    onConfirm={() => act({ type: 'upgradeMachine', machineId: m.id }, 'Upgraded.')} />
                )}
                <Confirm label={m.leased ? 'Return' : 'Sell'} className="btn danger sm" confirmLabel={m.leased ? 'Return' : 'Sell'} title={`${m.leased ? 'Return' : 'Sell'} ${MACHINES[m.type].name} #${m.id}?`}
                  body={m.leased ? 'The lease ends now. The deposit is not refunded.' : <>You receive {money(value)} — 80% of book value{m.broken ? ', halved because it is broken' : ''}.</>}
                  onConfirm={() => act({ type: 'sellMachine', machineId: m.id }, m.leased ? undefined : `Sold for ${money(value)}.`)} />
              </div>
            );
          } },
        ]} />
    </Card>
  );
}
