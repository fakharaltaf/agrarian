import { CROP_IDS, DISTANCE, GOODS, REGIONS, REGION_IDS, SEA_ROUTE, type RegionId } from '../../simulation/config';
import { landPricePerHa, marketWage } from '../../simulation/core';
import { regionEntryCost } from '../../simulation/engine';
import { tariffRate } from '../../simulation/markets';
import { portCapacity } from '../../simulation/logistics';
import type { GameEvent, GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { Bars } from '../Chart';
import { duration, money, num, pct, pct0, price } from '../format';
import { Card, Confirm, Info, Kpi, PageHead, usePref } from '../ui';

const MX = 6, MY = 4.5; // REGIONS x,y are 0..100; the map is 600×380

const GOOD_KINDS = new Set(['demandSurge', 'cropFailureAbroad', 'breakthrough']);
const eventRegions = (e: GameEvent) => [e.region, e.region2].filter(Boolean) as RegionId[];

export default function WorldPage() {
  const s = useGame();
  const [sel, setSel] = usePref<RegionId>('world.region', 'heartland');
  const active = s.events.filter((e) => e.start <= s.tick && e.end > s.tick);
  const forecast = s.events.filter((e) => e.announced <= s.tick && e.start > s.tick);
  return (
    <div className="stack l">
      <PageHead title="World" sub="Regions, climate, the economy and the events that move them." />
      {s.era >= 5 && (
        <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)' }}>
          <Card title="World map" info="Click a region for its details. Dashed lines are trade routes; gold ones have your shipments in transit. Routes to the Tropical Highlands go by sea.">
            <WorldMap s={s} sel={sel} onSelect={setSel} />
          </Card>
          <RegionCard s={s} r={sel} events={active.filter((e) => !e.region || eventRegions(e).includes(sel))} />
        </div>
      )}
      <div className="grid2">
        <EventsCard s={s} active={active} forecast={forecast} />
        <div className="stack l">
          <Climate s={s} />
          <Macro s={s} />
        </div>
      </div>
    </div>
  );
}

function WorldMap({ s, sel, onSelect }: { s: GameState; sel: RegionId; onSelect: (r: RegionId) => void }) {
  const P = (r: RegionId) => ({ x: REGIONS[r].x * MX, y: REGIONS[r].y * MY });
  const routes = REGION_IDS.flatMap((a) => (Object.keys(DISTANCE[a]) as RegionId[]).map((b) => [a, b] as const));
  const shipping = (a: RegionId, b: RegionId) => s.shipments.some((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
  return (
    <svg className="map" viewBox="0 0 600 380" role="group" aria-label="World map">
      <path className="land" d="M40 120 Q60 70 160 80 Q300 60 470 90 Q540 100 520 170 Q500 250 380 270 Q260 300 180 360 Q80 370 50 300 Q20 220 40 120 Z" />
      <path className="land" d="M360 300 Q420 290 470 310 Q500 340 470 372 Q400 380 360 360 Q340 330 360 300 Z" />
      {routes.map(([a, b]) => {
        const p = P(a), q = P(b);
        const on = shipping(a, b);
        const d = SEA_ROUTE(a, b) ? `M${p.x} ${p.y} Q${(p.x + q.x) / 2 + 40} ${(p.y + q.y) / 2} ${q.x} ${q.y}` : `M${p.x} ${p.y} L${q.x} ${q.y}`;
        return <path key={`${a}${b}`} className={`route${on ? ' active' : ''}`} d={d}><title>{`${REGIONS[a].name} – ${REGIONS[b].name}: ${num(DISTANCE[a][b]!)} km`}</title></path>;
      })}
      {REGION_IDS.map((r) => {
        const { x, y } = P(r);
        const open = s.regions[r].unlocked;
        const ha = s.fields.reduce((a, f) => a + (f.region === r ? f.ha : 0), 0);
        const hit = s.events.some((e) => e.start <= s.tick && e.end > s.tick && e.region === r && !GOOD_KINDS.has(e.kind));
        const pick = () => onSelect(r);
        return (
          <g key={r} className={`region${sel === r ? ' on' : ''}`} transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-pressed={sel === r}
            aria-label={`${REGIONS[r].name}${open ? `, you operate here, ${num(ha)} hectares` : ', not entered'}`} onClick={pick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick())}>
            <circle r={open ? 14 : 10} fill={open ? 'var(--accent)' : 'var(--faint)'} />
            {hit && <circle r={20} fill="none" stroke="var(--down)" strokeDasharray="3 3" />}
            <text y={30} textAnchor="middle">{REGIONS[r].name}</text>
            {open && ha > 0 && <text y={44} textAnchor="middle" style={{ fontWeight: 400, fill: 'var(--muted)' }}>{num(ha)} ha</text>}
          </g>
        );
      })}
    </svg>
  );
}

function RegionCard({ s, r, events }: { s: GameState; r: RegionId; events: GameEvent[] }) {
  const d = REGIONS[r];
  const st = s.regions[r];
  const open = st.unlocked;
  const cost = regionEntryCost(s);
  const rainVs = st.rain30 / d.rain - 1;
  const suit = CROP_IDS.filter((c) => (d.suitability[c] ?? 0) > 0).map((c) => ({ label: GOODS[c].name, value: d.suitability[c]!, color: GOODS[c].color }));
  return (
    <Card title={d.name} actions={open ? <span className="pill good">Operating</span> : s.era >= 6
      ? <Confirm label={`Enter · ${money(cost)}`} className="btn primary sm" disabled={cost > s.cash} title={`Expand into ${d.name}?`} confirmLabel="Enter region"
          body={<>Permits, an office and a local bank account cost <b>{money(cost)}</b>. You can then buy land, hire locally, build and trade there.</>}
          onConfirm={() => act({ type: 'unlockRegion', region: r }, `You now operate in ${d.name}.`)} />
      : <span className="pill">Expansion in Era 6</span>}>
      <div className="stack">
        <p className="explain">{d.blurb}</p>
        <dl className="facts">
          <dt>Land</dt><dd>{money(landPricePerHa(s, r))}/ha</dd>
          <dt>Temperature</dt><dd>{st.temp.toFixed(1)}°C <span className="faint">(norm {d.temp}°C)</span></dd>
          <dt>Rain, 30 days <Info text="Rolling 30-day rainfall index against the region's long-run mean. Well below normal means drought stress for unirrigated crops." /></dt>
          <dd className={rainVs < -0.25 ? 'down' : ''}>{st.rain30.toFixed(2)} <span className="faint">({pct(rainVs, 0)} vs normal)</span></dd>
          <dt>Farm wage</dt><dd>{price(marketWage(s, r))}/h</dd>
          <dt>Profit tax</dt><dd>{pct0(d.tax)}</dd>
          <dt>Import tariff</dt><dd>{pct0(tariffRate(s, 'heartland', r))}</dd>
          <dt>Infrastructure <Info text="Above 1 means cheaper, higher-capacity haulage." /></dt><dd>{d.infra.toFixed(2)}</dd>
          <dt>Port</dt><dd>{d.port ? `${num(portCapacity(s, r))} units/day` : 'Landlocked'}</dd>
          <dt>Stability <Info text="Lower stability means a more volatile currency and more disruption." /></dt><dd>{pct0(d.stability)}</dd>
          <dt>Currency</dt><dd>{d.currency}{d.currency !== 'USD' ? ` · $${st.fx.toPrecision(3)} (${pct(st.fx / d.fx0 - 1, 0)} since start)` : ''}</dd>
          <dt>Water</dt><dd>{price(d.waterPrice)}/unit{Number.isFinite(d.waterCap) ? ` · capped ${d.waterCap}/ha/day` : ''}</dd>
        </dl>
        <div className="stack s">
          <h3>Crop suitability <Info text="Yield multiplier for each crop here. Zero means it cannot be grown." /></h3>
          <Bars rows={suit} format={(n) => `×${n.toFixed(2)}`} />
        </div>
        {events.length > 0 && <div className="stack s">{events.map((e) => <EventLine key={e.id} s={s} e={e} />)}</div>}
      </div>
    </Card>
  );
}

function EventLine({ s, e, forecast }: { s: GameState; e: GameEvent; forecast?: boolean }) {
  return (
    <div className={`callout small ${forecast ? 'warn' : GOOD_KINDS.has(e.kind) ? 'good' : 'bad'}`}>
      <div className="row between wrap"><b>{e.title}</b><span className="muted">{forecast ? `starts in ${duration(e.start - s.tick)}` : `${duration(e.end - s.tick)} left`}</span></div>
      <p>{e.text}</p>
      {e.choice && !e.choice.chosen && <p className="warn">Awaiting your decision — the choice dialog is open.</p>}
      {e.choice?.chosen && <p className="muted">You chose: {e.choice.options.find((o) => o.id === e.choice!.chosen)?.label}</p>}
    </div>
  );
}

function EventsCard({ s, active, forecast }: { s: GameState; active: GameEvent[]; forecast: GameEvent[] }) {
  return (
    <Card title="Events" info="Events change real conditions — rainfall, energy prices, supply, demand, interest rates, trade routes. Their effects show up through the systems they touch, never as flat bonuses.">
      {active.length + forecast.length ? (
        <div className="stack s">
          {forecast.map((e) => <EventLine key={e.id} s={s} e={e} forecast />)}
          {active.map((e) => <EventLine key={e.id} s={s} e={e} />)}
        </div>
      ) : <p className="explain">Nothing unusual is happening. {s.research.done.includes('climateForecast') ? 'Your climate forecasting will warn you of droughts and floods ten days ahead.' : 'Research climate forecasting to see droughts and floods ten days ahead.'}</p>}
    </Card>
  );
}

function Climate({ s }: { s: GameState }) {
  const c = s.macro.climate;
  return (
    <Card title="Climate" info="The world warms a little every year, faster with the greenhouse emissions from fuel burned by machines — including yours.">
      <div className="stack">
        <div className="kpis">
          <Kpi label="Warming" value={`+${c.toFixed(2)}°C`} tone={c > 1 ? 'warn' : undefined} info="Temperature anomaly since the game began. It is added to every region's temperature." />
          <Kpi label="Drought odds" value={`×${(1 + 0.35 * c).toFixed(2)}`} info="Multiplier on the daily chance of drought in every region." />
          <Kpi label="Flood odds" value={`×${(1 + 0.25 * c).toFixed(2)}`} info="Multiplier on the daily chance of floods." />
        </div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Rainfall is more erratic: day-to-day variability is up {pct0((0.05 * c) / 0.35)}.</li>
          <li>Dry regions get drier: mean rainfall in the Arid Frontier is down {pct0(0.03 * c)}.</li>
          <li>Warmer fields suit heat-loving crops (cotton, cane, rice) and stress cool ones (wheat, potatoes); pests also build faster in heat.</li>
        </ul>
      </div>
    </Card>
  );
}

function Macro({ s }: { s: GameState }) {
  const m = s.macro;
  return (
    <Card title="Economy" info="Global conditions that drive prices, wages, interest and demand.">
      <div className="kpis">
        <Kpi label="Inflation" value={pct(m.inflation)} tone={m.inflation > 0.06 ? 'warn' : undefined} info="Annual rate. Pushes up wages, land and input prices — and the central bank's rate." />
        <Kpi label="Base rate" value={pct0(m.baseRate)} info="Central bank rate. Your loans pay this plus a credit spread, and it floats." breakdown={[['From inflation', pct(1.4 * m.inflation)], ['Credit crunch', pct(m.crunch)]]} />
        <Kpi label="Energy index" value={m.energy.toFixed(2)} tone={m.energy > 1.4 ? 'warn' : undefined} info="1.00 = normal. Drives fuel, fertiliser and electricity prices." />
        <Kpi label="Income index" value={m.income.toFixed(2)} tone={m.income < 0.95 ? 'down' : undefined} info="Consumer incomes. Premium goods (meat, cheese, coffee) sell more when it rises and less in a recession." />
        <Kpi label="Price level" value={m.cpi.toFixed(2)} info="Consumer price index since the start (1.00). Costs and base prices are indexed to it." />
      </div>
    </Card>
  );
}
