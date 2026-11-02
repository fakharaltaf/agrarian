import { BUILDINGS, BUILDING_TYPES, CONFIG, GOODS, GOOD_IDS, REGIONS, TECH, type GoodId, type RegionId } from '../../simulation/config';
import { buildingsIn, has, priceUsd, stored } from '../../simulation/core';
import type { GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Info, Kpi, PageHead, Select, Table, usePref } from '../ui';
import { BuildMany, GoodName, unlockedRegions } from './shared';

const STORAGE = BUILDING_TYPES.filter((t) => BUILDINGS[t].category === 'storage');

/** Daily spoilage rate per good, mirroring agriculture.spoilageDaily. */
function spoilRate(s: GameState, r: RegionId, g: GoodId, improperShare: number) {
  const d = GOODS[g];
  if (d.storage === 'cold') return (1 - improperShare) * d.spoilProper * (has(s, 'coldChain') ? 0.5 : 1) + improperShare * d.spoilImproper;
  return d.spoilProper * (d.kind === 'crop' && buildingsIn(s, r, 'silo').length ? 0.5 : 1);
}

const tone = (u: number) => (u > 0.95 ? 'var(--down)' : u > 0.8 ? 'var(--warn)' : undefined);

export default function StoragePage() {
  const s = useGame();
  const regions = unlockedRegions(s);
  const [pref, setRegion] = usePref<RegionId>('storage.region', 'heartland');
  const r = regions.includes(pref) ? pref : 'heartland';

  return (
    <div className="stack l">
      <PageHead title="Storage" sub="What you hold, where, and what it costs to keep it. Harvests that don't fit are sold the moment they come in." />

      <div className="kpis">
        <Kpi label="Spoiled (lifetime)" value={money(s.stats.spoiled)} tone={s.stats.spoiled > 0 ? 'down' : undefined} info="Market value of everything that rotted in storage, valued at the price on the day it was lost." />
        <Kpi label="Forced sales" value={num(s.stats.forcedSales)} info="Times a harvest or factory output didn't fit and was dumped on the market immediately, at whatever price the order book gave." />
        <Kpi label="Units lost to overflow" value={num(s.stats.overflowLost)} tone={s.stats.overflowLost > 0 ? 'down' : undefined} info="Units that neither fit in storage nor found a buyer (market too thin, or no market for that good) and were thrown away." />
      </div>

      <Card title="Capacity by region" info="Cold goods use cold-store space first; the excess spills into dry space and spoils at the much faster improper rate.">
        <div className="stack">
          {regions.map((x) => {
            const st = stored(s, x);
            const du = st.cap.dry ? st.dry / st.cap.dry : st.dry ? 1 : 0;
            const cu = st.cap.cold ? st.cold / st.cap.cold : 0;
            return (
              <div key={x} className="stack s">
                <div className="row between">
                  <b>{REGIONS[x].name}</b>
                  {regions.length > 1 && x !== r && <button className="btn ghost sm" onClick={() => setRegion(x)}>Details</button>}
                </div>
                <div className="grid2" style={{ gap: 10 }}>
                  <div className="stack s">
                    <div className="row between small"><span className="muted">Dry</span><span className="mono">{num(st.dry)} / {num(st.cap.dry)}</span></div>
                    <Bar value={du} color={tone(du)} label={`${REGIONS[x].name} dry storage`} />
                  </div>
                  <div className="stack s">
                    <div className="row between small"><span className="muted">Cold</span><span className="mono">{st.cap.cold ? `${num(st.cold)} / ${num(st.cap.cold)}` : 'none'}</span></div>
                    <Bar value={cu} color={tone(cu)} label={`${REGIONS[x].name} cold storage`} />
                  </div>
                </div>
                {st.coldOverflow > 0 && <div className="callout warn">{num(st.coldOverflow)} units of cold goods are sitting in dry storage and spoiling fast. Build a cold store or sell them.</div>}
              </div>
            );
          })}
        </div>
      </Card>

      {regions.length > 1 && (
        <div className="row wrap">
          <span className="muted small">Region</span>
          <Select label="Region" value={r} onChange={setRegion} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />
        </div>
      )}

      <Inventory s={s} r={r} />
      <div className="grid2">
        <BuildCard s={s} r={r} />
        <Buildings s={s} r={r} />
      </div>
    </div>
  );
}

interface Row { g: GoodId; qty: number; rate: number; value: number; loss: number }

function Inventory({ s, r }: { s: GameState; r: RegionId }) {
  const st = stored(s, r);
  const coldTotal = st.cold + st.coldOverflow;
  const improper = coldTotal > 0 ? st.coldOverflow / coldTotal : 0;
  const rows: Row[] = [];
  for (const g of GOOD_IDS) {
    const qty = s.regions[r].inventory[g];
    if (qty < 0.5) continue;
    const rate = spoilRate(s, r, g, improper);
    const p = priceUsd(s, r, g);
    rows.push({ g, qty, rate, value: qty * p, loss: qty * rate * p });
  }
  const total = rows.reduce((a, x) => a + x.value, 0);
  const loss = rows.reduce((a, x) => a + x.loss, 0);
  const silo = buildingsIn(s, r, 'silo').length > 0;
  return (
    <Card title={<>Inventory <span className="muted">{REGIONS[r].name} · {money(total)}</span></>}
      actions={loss > 0 ? <span className="pill bad">Losing {money(loss)}/day</span> : undefined}
      info="Valued at today's market price in this region. Spoilage is charged once a day.">
      <Table rows={rows} rowKey={(x) => x.g} initialSort={{ key: 'value', dir: -1 }} empty="Nothing in storage here. Harvests and factory output land here first." cols={[
        { key: 'g', label: 'Good', sort: (x) => GOODS[x.g].name, render: (x) => <GoodName g={x.g} /> },
        { key: 'q', label: 'Quantity', align: 'r', sort: (x) => x.qty, render: (x) => num(x.qty) },
        { key: 'c', label: 'Storage', render: (x) => <span className={`pill ${GOODS[x.g].storage === 'cold' ? 'accent' : ''}`}>{GOODS[x.g].storage === 'cold' ? 'Cold' : 'Dry'}</span> },
        { key: 'r', label: 'Spoilage / day', align: 'r', sort: (x) => x.rate, render: (x) => {
          const d = GOODS[x.g];
          const bd: [string, string][] = d.storage === 'cold'
            ? [['In cold store', `${(d.spoilProper * 100).toFixed(2)}%`], ['Cold chain', has(s, 'coldChain') ? '× 0.5' : 'not researched'], ['In dry storage', `${(d.spoilImproper * 100).toFixed(2)}%`], ['Share overflowing', pct0(improper)]]
            : [['Base', `${(d.spoilProper * 100).toFixed(2)}%`], ['Grain silo', d.kind === 'crop' ? (silo ? '× 0.5' : 'none in region') : 'n/a']];
          return <span className={x.rate >= 0.02 ? 'down' : ''}>{(x.rate * 100).toFixed(2)}%<Info text={d.storage === 'cold' ? 'Cold goods spoil slowly in a cold store and much faster when they overflow into dry space.' : 'A grain silo anywhere in the region halves spoilage of stored crops.'} breakdown={bd} /></span>;
        } },
        { key: 'p', label: 'Price', align: 'r', sort: (x) => x.value / x.qty, render: (x) => price(priceUsd(s, r, x.g)) },
        { key: 'value', label: 'Value', align: 'r', sort: (x) => x.value, render: (x) => money(x.value) },
        { key: 'l', label: 'Lost / day', align: 'r', sort: (x) => x.loss, render: (x) => (x.loss >= 0.01 ? <span className="down">{money(x.loss)}</span> : <span className="faint">—</span>) },
      ]} />
      <p className="explain" style={{ marginTop: 10 }}>
        Overflow rule: when a harvest or factory batch doesn't fit, the excess is sold immediately at the market — usually at a poor price, because a large sale moves the order book. If nobody buys it, it is lost.
      </p>
    </Card>
  );
}

function BuildCard({ s, r }: { s: GameState; r: RegionId }) {
  const avail = STORAGE.filter((t) => s.era >= BUILDINGS[t].minEra && (!BUILDINGS[t].research || has(s, BUILDINGS[t].research!)));
  const locked = STORAGE.filter((t) => !avail.includes(t));
  return (
    <Card title="Build storage" info="Running costs are charged every hour the building stands, full or empty.">
      <div className="stack">
        {avail.map((t) => {
          const d = BUILDINGS[t];
          return (
            <div key={t} className="row between wrap" style={{ gap: 10 }}>
              <div className="stack s" style={{ flex: '1 1 200px' }}>
                <b>{d.name} <span className="muted small">+{num(d.dry ?? d.cold ?? 0)} {d.cold ? 'cold' : 'dry'}</span></b>
                <span className="small muted">{d.blurb}{d.staffPerHour ? ` Staff ${price(d.staffPerHour * s.macro.cpi)}/h.` : ''}{d.coldKwh ? ` ${d.coldKwh} kWh/h of power.` : ''}</span>
              </div>
              <BuildMany s={s} r={r} t={t} />
            </div>
          );
        })}
        {locked.map((t) => (
          <p key={t} className="muted small">{BUILDINGS[t].name} unlocks {s.era < BUILDINGS[t].minEra ? `in Era ${BUILDINGS[t].minEra}` : `with ${TECH[BUILDINGS[t].research!].name}`}.</p>
        ))}
      </div>
    </Card>
  );
}

function Buildings({ s, r }: { s: GameState; r: RegionId }) {
  const groups = STORAGE.map((t) => ({ t, list: buildingsIn(s, r, t) })).filter((x) => x.list.length);
  const base = r === 'heartland';
  return (
    <Card title="Your storage" info="Demolishing returns 50% of the building's book value. Anything that no longer fits goes through the overflow rule.">
      {!groups.length && !base ? <p className="muted">No storage buildings in {REGIONS[r].name} yet. Without storage every harvest here is sold on the spot.</p> : (
        <div className="stack">
          {base && <div className="row between small"><span>Farmyard</span><span className="mono muted">{num(CONFIG.baseDryStorage)} dry (built in)</span></div>}
          {groups.map(({ t, list }) => {
            const d = BUILDINGS[t];
            // demolish the most worn one first
            const b = list.reduce((a, x) => (x.cost - x.depreciated < a.cost - a.depreciated ? x : a));
            const refund = Math.round(Math.max(0, b.cost - b.depreciated) * 0.5);
            return (
              <div key={t} className="row between wrap">
                <span><b>{list.length} × {d.name}</b> <span className="muted small">{num(list.length * (d.dry ?? d.cold ?? 0))} {d.cold ? 'cold' : 'dry'}</span></span>
                <Confirm label="Demolish one" className="btn danger sm" title={`Demolish a ${d.name.toLowerCase()}?`} confirmLabel="Demolish"
                  body={<>You get back {money(refund)} (half its book value). Capacity drops by {num(d.dry ?? d.cold ?? 0)} {d.cold ? 'cold' : 'dry'} units; anything that no longer fits is force-sold at market or lost.</>}
                  onConfirm={() => act({ type: 'demolish', buildingId: b.id }, `${d.name} demolished.`)} />
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

