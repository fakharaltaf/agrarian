import { useState } from 'react';
import { CONFIG, GOODS, REGIONS, REGION_IDS, TRADEABLE, type GoodId, type RegionId } from '../../simulation/config';
import { activeEvents, fuelPrice, has, priceUsd, severity } from '../../simulation/core';
import { machinePrice } from '../../simulation/engine';
import { portCapacity, shipQuote } from '../../simulation/logistics';
import { closedPort, tariffRate } from '../../simulation/markets';
import type { GameState, Shipment } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { duration, money, num, pct, pct0, price, stamp } from '../format';
import { Bar, Card, Confirm, Info, Kpi, NumberInput, PageHead, Select, Table, type Col } from '../ui';
import { GoodName, unlockedRegions } from './shared';

const TRUCK_CAP = 1500;

function haulage(s: GameState, r: RegionId) {
  const reg = s.regions[r];
  const trucks = s.machines.filter((m) => m.region === r && m.type === 'truck' && !m.broken).length;
  const strike = severity(s, 'strike', r);
  const hiredCap = CONFIG.haulCapacityPerDay * REGIONS[r].infra * (1 - 0.8 * strike);
  const fuel = fuelPrice(s, r);
  return {
    trucks, ownCap: trucks * TRUCK_CAP, ownUsed: reg.truckToday, hiredCap, hiredUsed: reg.haulToday, strike,
    ownUnit: 0.015 * fuel, hiredUnit: (CONFIG.haulPerUnit / REGIONS[r].infra) * fuel * (has(s, 'routeOptimization') ? 0.8 : 1),
  };
}

export default function LogisticsPage() {
  const s = useGame();
  const regs = unlockedRegions(s);
  const transit = s.shipments.reduce((a, x) => a + x.qty * priceUsd(s, x.to, x.good), 0);
  return (
    <div className="stack l">
      <PageHead title="Logistics" sub="Every unit you buy or sell has to be hauled. Own trucks are cheap per unit; regular hired haulage is limited by local roads, and beyond it short-notice lorries cost 3×." />
      <div className="kpis">
        <Kpi label="Trucks" value={num(s.machines.filter((m) => m.type === 'truck').length)} sub={`${num(s.machines.filter((m) => m.type === 'truck' && !m.broken).length * TRUCK_CAP)} units/day`} />
        <Kpi label="Haulage yesterday" value={money(-(dayKind(s, 'haulage')))} info="Loading and delivery cost for market trades and shipments over the last full day." />
        {s.era >= 6 && <Kpi label="In transit" value={num(s.shipments.length)} sub={`${money(transit)} at destination prices`} />}
        {s.era >= 6 && <Kpi label="Freight & tariffs yesterday" value={money(-dayKind(s, 'shipping'))} />}
      </div>
      <HaulCard s={s} regs={regs} />
      {s.era >= 6 ? (
        <>
          <div className="grid2">
            <ShipCard s={s} regs={regs} />
            <DisruptionCard s={s} />
          </div>
          <TransitCard s={s} />
          <div className="grid2">
            <TariffCard s={s} />
            <FxCard s={s} />
          </div>
        </>
      ) : <p className="muted small">Shipping between regions, tariffs and currencies unlock in Era 6.</p>}
    </div>
  );
}

const dayKind = (s: GameState, k: 'haulage' | 'shipping') => {
  const d = Math.floor(s.tick / 24) - 1;
  return s.books.find((b) => b.day === d)?.kinds[k] ?? 0;
};

// ---------------------------------------------------------------- haulage

function HaulCard({ s, regs }: { s: GameState; regs: RegionId[] }) {
  const truckCost = machinePrice(s, 'truck');
  return (
    <Card title="Haulage today" info="Capacity resets at midnight. Trades use your own trucks first, then hired haulage. When both are used up, extra loads go by short-notice lorry at 3× the hired rate — buy trucks if that happens often.">
      <div className="grid3">
        {regs.map((r) => {
          const h = haulage(s, r);
          const saving = h.hiredUnit - h.ownUnit;
          return (
            <div key={r} className="stack s" style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
              <div className="row between"><b>{REGIONS[r].name}</b>{h.strike > 0 && <span className="pill bad">Strike</span>}</div>
              <div className="row between small"><span className="muted">Own trucks ({h.trucks})</span><span className="mono">{num(h.ownUsed)} / {num(h.ownCap)}</span></div>
              <Bar thin value={h.ownCap ? h.ownUsed / h.ownCap : 0} label="Own truck capacity used" />
              <div className="row between small"><span className="muted">Hired haulage</span><span className="mono">{num(h.hiredUsed)} / {num(h.hiredCap)}</span></div>
              <Bar thin value={h.hiredCap ? h.hiredUsed / h.hiredCap : 1} label="Hired capacity used" color={h.hiredUsed >= h.hiredCap * 0.9 ? 'var(--down)' : undefined} />
              <dl className="facts small">
                <dt>Cost per unit, own</dt><dd>{price(h.ownUnit)}</dd>
                <dt>Cost per unit, hired <Info text="Hired haulage price scales with fuel and falls with better regional roads." breakdown={[['Base', price(CONFIG.haulPerUnit)], ['÷ Road quality', REGIONS[r].infra.toFixed(2)], ['× Fuel', price(fuelPrice(s, r))], ['× Route optimisation', has(s, 'routeOptimization') ? '0.80' : '1.00']]} /></dt><dd>{price(h.hiredUnit)}</dd>
              </dl>
              {saving > 0 && <p className="small muted">A truck saves {money(saving * TRUCK_CAP)} per full day of use ({num(truckCost / (saving * TRUCK_CAP), 0)} days to pay back).</p>}
              <Confirm className="btn ghost sm" disabled={truckCost > s.cash} label={`Buy truck · ${money(truckCost)}`} title={`Buy a truck in ${REGIONS[r].name}?`} confirmLabel={`Pay ${money(truckCost)}`}
                body={<>Adds {num(TRUCK_CAP)} units/day of own haulage in {REGIONS[r].name} at {price(h.ownUnit)} per unit.</>}
                onConfirm={() => act({ type: 'buyMachine', region: r, machine: 'truck', lease: false }, 'Truck bought.')} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- shipping

function ShipCard({ s, regs }: { s: GameState; regs: RegionId[] }) {
  const [from, setFrom] = useState<RegionId>(regs[0]);
  const [to, setTo] = useState<RegionId>(regs[1] ?? regs[0]);
  const [good, setGood] = useState<GoodId>('wheat');
  const [qty, setQty] = useState(1000);
  if (regs.length < 2) return <Card title="Ship goods"><p className="explain">Open a second region on the World page to move goods between regions.</p></Card>;
  const f = regs.includes(from) ? from : regs[0];
  const t = regs.includes(to) && to !== f ? to : regs.find((x) => x !== f)!;
  const stock = s.regions[f].inventory[good] ?? 0;
  const goods = TRADEABLE.filter((g) => (s.regions[f].inventory[g] ?? 0) >= 1 || g === good);
  const q = shipQuote(s, good, qty, f, t);
  const perUnit = qty > 0 ? q.total / qty : 0;
  const pFrom = priceUsd(s, f, good), pTo = priceUsd(s, t, good);
  const gain = pTo - pFrom - perUnit;
  const closed = closedPort(s, f, t);
  const port = q.portFrom ? { cap: portCapacity(s, q.portFrom), used: s.regions[q.portFrom].portToday } : null;
  const portFull = port && port.used + qty > port.cap;
  const block = qty <= 0 ? 'Enter a quantity.' : qty > stock ? `Only ${num(stock)} in stock.` : closed ? 'Route closed by an embargo or port closure.' : !q.haulOk ? 'Not enough haulage left today to load this.' : portFull ? `Port at ${REGIONS[q.portFrom!].name} is full today.` : q.total > s.cash ? `Costs ${money(q.total)}.` : null;
  return (
    <Card title="Ship goods" info="Freight, tariff and loading are paid up front. Goods leave your inventory now and arrive after transit and customs.">
      <div className="stack">
        <div className="row wrap">
          <Select label="Good" value={good} onChange={setGood} options={goods.map((g) => ({ v: g, label: `${GOODS[g].name} (${num(s.regions[f].inventory[g] ?? 0)})` }))} />
          <NumberInput label="Quantity" value={qty} onChange={(n) => setQty(Math.floor(n))} step={100} width={110} />
          <button className="btn ghost sm" onClick={() => setQty(Math.floor(stock))}>All</button>
        </div>
        <div className="row wrap">
          <Select label="From" value={f} onChange={setFrom} options={regs.map((r) => ({ v: r, label: `From ${REGIONS[r].name}` }))} />
          <Select label="To" value={t} onChange={setTo} options={regs.filter((r) => r !== f).map((r) => ({ v: r, label: `To ${REGIONS[r].name}` }))} />
        </div>
        <dl className="facts">
          <dt>Freight</dt><dd>{money(q.freight)}</dd>
          <dt>Tariff ({pct0(tariffRate(s, f, t))} of value)</dt><dd>{money(q.tariff)}</dd>
          <dt>Loading haulage</dt><dd>{money(q.haul)}</dd>
          <dt><b>Total</b></dt><dd><b>{money(q.total)}</b> · {price(perUnit)}/unit</dd>
          <dt>Transit</dt><dd>{duration(q.ticks)}{q.sea ? ` · sea via ${REGIONS[q.portFrom!].name}` : ' · road'}</dd>
          {port && <><dt>Port capacity left today</dt><dd>{num(Math.max(0, port.cap - port.used))}</dd></>}
        </dl>
        <div className={`callout ${gain > 0 ? 'good' : 'bad'}`}>
          <Info text="Destination price minus origin price minus shipping cost per unit. Prices can move while goods are in transit, and selling a large lot pushes the destination price down." breakdown={[[`${REGIONS[t].name} price`, price(pTo)], [`− ${REGIONS[f].name} price`, price(pFrom)], ['− Shipping per unit', price(perUnit)], ['= Gain per unit', price(gain)]]} />{' '}
          {gain > 0 ? <>Worth it at today's prices: about <b>{price(gain)}</b>/unit, {money(gain * qty)} on this lot.</> : <>Not worth it today: you would lose {price(-gain)}/unit versus selling in {REGIONS[f].name}.</>}
        </div>
        <button className="btn primary" disabled={!!block} title={block ?? undefined} onClick={() => act({ type: 'ship', good, qty, from: f, to: t }, `Shipping ${num(qty)} ${GOODS[good].name.toLowerCase()} to ${REGIONS[t].name}.`)}>
          {block ?? `Ship ${num(qty)} ${GOODS[good].name.toLowerCase()} · ${money(q.total)}`}
        </button>
      </div>
    </Card>
  );
}

function TransitCard({ s }: { s: GameState }) {
  const cols: Col<Shipment>[] = [
    { key: 'good', label: 'Good', sort: (x) => GOODS[x.good].name, render: (x) => <GoodName g={x.good} /> },
    { key: 'qty', label: 'Qty', align: 'r', sort: (x) => x.qty, render: (x) => <span className="mono">{num(x.qty)}</span> },
    { key: 'route', label: 'Route', render: (x) => <span>{REGIONS[x.from].name} → {REGIONS[x.to].name}</span> },
    { key: 'cost', label: 'Cost', align: 'r', sort: (x) => x.cost, render: (x) => <span className="mono">{money(x.cost)}</span> },
    { key: 'arr', label: 'Arrives', sort: (x) => x.arrives, render: (x) => <span className="mono small">{stamp(x.arrives)}</span> },
    { key: 'left', label: 'Time left', align: 'r', sort: (x) => x.arrives, render: (x) => <span className={closedPort(s, x.from, x.to) ? 'warn' : ''}>{closedPort(s, x.from, x.to) ? 'Held at port' : duration(x.arrives - s.tick)}</span> },
  ];
  return (
    <Card title="In transit">
      <Table rows={s.shipments} cols={cols} rowKey={(x) => x.id} initialSort={{ key: 'arr', dir: 1 }} empty="Nothing on the move. Shipments you send appear here until they arrive." />
    </Card>
  );
}

// ---------------------------------------------------------------- trade environment

function TariffCard({ s }: { s: GameState }) {
  return (
    <Card title="Import tariffs" info="Charged on the value of goods at the destination price. Heartland Valley and River Plains share a country, so trade between them is tariff-free. An embargo raises the tariff to 100% and closes the route.">
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>From ↓ / To →</th>{REGION_IDS.map((r) => <th key={r} className="r" style={{ opacity: s.regions[r].unlocked ? 1 : 0.55 }}>{REGIONS[r].name.split(' ')[0]}</th>)}</tr></thead>
          <tbody>
            {REGION_IDS.map((a) => (
              <tr key={a} style={{ opacity: s.regions[a].unlocked ? 1 : 0.55 }}>
                <td>{REGIONS[a].name}</td>
                {REGION_IDS.map((b) => {
                  const x = tariffRate(s, a, b);
                  return <td key={b} className={`r mono ${x >= 1 ? 'down' : ''}`}>{a === b ? '—' : x >= 1 ? 'Embargo' : pct0(x)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Faded regions are ones you don't operate in yet.</p>
    </Card>
  );
}

function FxCard({ s }: { s: GameState }) {
  return (
    <Card title="Exchange rates" info="Prices, cash and books are in USD. Wages and land in each region are set in local currency, so when a currency strengthens against the dollar your costs there rise in USD terms, and when it weakens they fall.">
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>Region</th><th>Currency</th><th className="r">USD per unit</th><th className="r">Since start</th><th className="r">Local inflation</th></tr></thead>
          <tbody>
            {REGION_IDS.map((r) => {
              const reg = s.regions[r], d = REGIONS[r];
              const ch = reg.fx / d.fx0 - 1;
              return (
                <tr key={r} style={{ opacity: reg.unlocked ? 1 : 0.55 }}>
                  <td>{d.name}</td>
                  <td className="mono">{d.currency}</td>
                  <td className="r mono">{reg.fx.toFixed(reg.fx < 0.1 ? 4 : 3)}</td>
                  <td className={`r mono ${d.currency === 'USD' ? '' : ch < 0 ? 'down' : 'up'}`}>{d.currency === 'USD' ? '—' : pct(ch)}</td>
                  <td className="r mono">{pct(reg.cpi - 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="explain" style={{ marginTop: 8 }}>Currency exposure: a weaker local currency makes that region's workers and land cheaper for you, but volatile currencies (Tropical Highlands, Arid Frontier) can swing those costs quickly. Goods prices are quoted in USD everywhere.</p>
    </Card>
  );
}

function DisruptionCard({ s }: { s: GameState }) {
  const closures = activeEvents(s, 'portClosure');
  const embargoes = activeEvents(s, 'embargo');
  const strikes = activeEvents(s, 'strike');
  const ports = REGION_IDS.filter((r) => REGIONS[r].port > 0);
  const all = [...closures, ...embargoes, ...strikes];
  return (
    <Card title="Ports & disruptions" info="Sea routes (anything to or from Tropical Highlands) load through a port: the origin's own port, or Coastal Trade Hub for landlocked regions. Each port takes a limited number of your units per day.">
      <div className="stack">
        {ports.map((r) => {
          const cap = portCapacity(s, r);
          const used = s.regions[r].portToday;
          return (
            <div key={r} className="stack s">
              <div className="row between small"><span>{REGIONS[r].name} port{has(s, 'portLogistics') ? ' (Port logistics ×2)' : ''}</span><span className="mono">{num(used)} / {num(cap)} today</span></div>
              <Bar thin value={used / cap} label={`${REGIONS[r].name} port use`} />
            </div>
          );
        })}
        {all.length ? all.map((e) => (
          <div key={e.id} className="callout bad">
            <b>{e.title}</b> <span className="muted small">until {stamp(e.end)}</span>
            <div className="small">{e.text}</div>
          </div>
        )) : <div className="callout good">All routes and ports are open.</div>}
      </div>
    </Card>
  );
}
