import { DEALER_SPREAD } from '../../simulation/markets';
import { RetailQuote } from '../RetailQuote';
// Markets: a simplified commodity trading terminal, revealed as the business grows.
// Era 1–4: prices, selling, buying inputs. Era 5+: the full exchange, supply contracts and futures.
import { useState } from 'react';
import { CONFIG, CROPS, GOODS, REGIONS, TICKS_PER_DAY, TRADEABLE, type CropId, type GoodId, type RegionId } from '../../simulation/config';
import { freeSpace, has, seedCost } from '../../simulation/core';
import { avg30, outlook, quoteBuy, quoteSell, techFactor } from '../../simulation/engine';
import { CONTRACT_SIZE, FUTURES_GOODS, futuresPrice, initialMargin } from '../../simulation/finance';
import type { FuturesPosition, GameState, Market, SupplyContract } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { LineChart, Sparkline, type Series } from '../Chart';
import { duration, money, num, pct, pct0, price, stamp } from '../format';
import { Bar, Card, Confirm, Info, NumberInput, PageHead, Seg, Select, Table, type Col } from '../ui';
import { GoodName, unlockedRegions } from './shared';
import { stageAtLeast } from '../../simulation/stages';
import { HomesteadTraderCard } from './Fields';

const DAY_POINTS = TICKS_PER_DAY / CONFIG.priceHistoryEvery; // history samples per day

const dayChange = (m: Market) => m.price / (m.history[Math.max(0, m.history.length - 1 - DAY_POINTS)] ?? m.price) - 1;

/** Seed cost per unit of output, using the player's own recent yields where they exist. */
function seedCostPerUnit(s: GameState, r: RegionId, c: CropId) {
  const recent = s.fields.filter((f) => f.region === r && f.lastHarvest?.crop === c);
  const perHa = recent.length
    ? recent.reduce((a, f) => a + f.lastHarvest!.units, 0) / recent.reduce((a, f) => a + f.ha, 0)
    : CONFIG.seedsPerHa * CROPS[c].yieldPerSeed * (REGIONS[r].suitability[c] ?? 0) * techFactor(s);
  return { cost: perHa > 0 ? (seedCost(s, c) * CONFIG.seedsPerHa) / perHa : NaN, perHa, own: recent.length > 0 };
}

export default function MarketsPage() {
  const s = useGame();
  if (!s.legacyProgression && !stageAtLeast(s, 'market-town')) return <div className="stack l"><PageHead title="Village trader" sub="A small daily board keeps your first harvest moving." /><HomesteadTraderCard s={s} /></div>;
  const regions = unlockedRegions(s);
  const [region, setRegion] = useState<RegionId>('heartland');
  const r = regions.includes(region) ? region : 'heartland';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const inv = s.regions[r].inventory;

  const goods = TRADEABLE.filter((g) => {
    if (!s.markets[r][g]) return false;
    if (scope === 'all' && s.era >= 5) return true;
    return inv[g] >= 1 || s.unlockedCrops.includes(g as CropId) || (s.stats.produced[g] ?? 0) > 0;
  });
  const [sel, setSel] = useState<GoodId>('wheat');
  const g = goods.includes(sel) ? sel : goods[0];

  return (
    <div className="stack l">
      <PageHead title="Markets" sub={`Stock sets prices · bid/ask ±${(DEALER_SPREAD*100).toFixed(1)}% · orders move the market.`}
        actions={regions.length > 1 && <Select label="Market region" value={r} onChange={setRegion} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />} />

      {!s.legacyProgression && <HomesteadTraderCard s={s} />}

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))' }}>
        <Board s={s} r={r} goods={goods} sel={g} onSel={setSel} scope={scope} setScope={setScope} />
        <div className="stack l">
          {g && <SellPanel key={`${r}-${g}`} s={s} r={r} g={g} />}
          {g && <SupplyCard s={s} r={r} g={g} />}
        </div>
      </div>

      {g && <PriceChart s={s} r={r} g={g} />}

      <div className="grid2">
        {s.era >= 2 && <BuyCard s={s} r={r} />}
        <NewsCard s={s} />
      </div>

      {s.era >= 5 ? (
        <>
          <ContractsCard s={s} />
          <FuturesCard s={s} />
        </>
      ) : <p className="faint small">Supply contracts, futures hedging and the full commodity exchange unlock in Era 5 (Markets & Finance).</p>}
    </div>
  );
}

// ---------------------------------------------------------------- board

function Board({ s, r, goods, sel, onSel, scope, setScope }: { s: GameState; r: RegionId; goods: GoodId[]; sel?: GoodId; onSel: (g: GoodId) => void; scope: 'mine' | 'all'; setScope: (v: 'mine' | 'all') => void }) {
  const ai = has(s, 'marketAI');
  const inv = s.regions[r].inventory;
  const cols: Col<GoodId>[] = [
    { key: 'good', label: 'Good', render: (g) => <GoodName g={g} />, sort: (g) => GOODS[g].name },
    { key: 'price', label: 'Price', align: 'r', render: (g) => <span className="mono">{price(s.markets[r][g]!.price)}</span>, sort: (g) => s.markets[r][g]!.price },
    { key: 'ch', label: '1 day', align: 'r', render: (g) => { const c = dayChange(s.markets[r][g]!); return <span className={`mono ${c >= 0 ? 'up' : 'down'}`}>{pct(c)}</span>; }, sort: (g) => dayChange(s.markets[r][g]!) },
    { key: 'avg', label: '30-day avg', align: 'r', render: (g) => <span className="mono muted">{price(avg30(s, r, g))}</span>, sort: (g) => avg30(s, r, g) },
    { key: 'spark', label: 'Last 30 days', render: (g) => <Sparkline data={s.markets[r][g]!.history} color={GOODS[g].color} w={90} h={24} /> },
    ...(ai ? [{ key: 'out', label: <>10-day outlook</>, align: 'r' as const, render: (g: GoodId) => { const o = outlook(s, r, g); return <span className={`mono ${o >= 0 ? 'up' : 'down'}`}>{pct(o)}</span>; }, sort: (g: GoodId) => outlook(s, r, g) }] : []),
    { key: 'held', label: 'You hold', align: 'r', render: (g) => <span className="mono">{inv[g] >= 1 ? num(inv[g]) : '—'}</span>, sort: (g) => inv[g] },
    { key: 'val', label: 'Worth', align: 'r', render: (g) => <span className="mono">{inv[g] >= 1 ? money(inv[g] * s.markets[r][g]!.price) : '—'}</span>, sort: (g) => inv[g] * s.markets[r][g]!.price },
  ];
  return (
    <Card title={<>Market board <span className="muted">{REGIONS[r].name}</span></>} coach="market-sell"
      info={<>Spot prices in this region. Click a row to trade it and see its chart. {ai ? 'The outlook projects the price 10 days ahead from current supply and demand (Market intelligence). It is a model, not a promise.' : ''}</>}
      actions={s.era >= 5 && <Seg label="Goods shown" value={scope} onChange={setScope} options={[{ v: 'mine', label: 'My goods' }, { v: 'all', label: 'Whole exchange' }]} />}>
      <Table rows={goods} cols={cols} rowKey={(g) => g} onRow={(g) => onSel(g)} selected={(g) => g === sel} initialSort={{ key: 'good', dir: 1 }}
        empty="Harvest something and it will appear here." />
    </Card>
  );
}

// ---------------------------------------------------------------- selling

function SellPanel({ s, r, g }: { s: GameState; r: RegionId; g: GoodId }) {
  const m = s.markets[r][g]!;
  const held = Math.floor(s.regions[r].inventory[g]);
  const [qty, setQty] = useState(held);
  const want = Math.min(qty, held);
  const q = quoteSell(s, r, g, want);
  const frac = held ? want / held : 0;
  const impact = q.qty ? q.priceAfter / m.price - 1 : 0;
  return (
    <Card title={<>Sell <GoodName g={g} /></>}
      info="Each unit you sell adds to the market's stock, so the price slides as your order fills. The quote shows the average you actually receive. The dent fades over about half a day, so selling in smaller lots spread through the day often earns more.">
      <div className="stack">
        <div className="row between wrap">
          <span className="muted small">In {REGIONS[r].name} storage <b className="mono" style={{ color: 'var(--text)' }}>{num(held)}</b></span>
          <span className="mono">{price(m.price)} <span className="faint small">spot</span></span>
        </div>
        <div className="row wrap">
          <Seg label="Share of stock to sell" value={frac === 0.25 || frac === 0.5 || frac === 1 ? frac : -1} onChange={(f) => setQty(Math.floor(held * f))}
            options={[{ v: 0.25, label: '25%' }, { v: 0.5, label: '50%' }, { v: 1, label: '100%' }]} />
          <NumberInput label="Units to sell" value={want} onChange={(n) => setQty(Math.floor(n))} max={held} step={Math.max(1, Math.round(held / 20))} width={110} />
        </div>
        {q.qty > 0 ? (
          <dl className="facts">
            <dt>Gross</dt><dd>{money(q.gross)}</dd>
            <dt>Average price</dt><dd>{price(q.avgPrice)} <span className={q.avgPrice < m.price ? 'down' : 'up'}>({pct(q.avgPrice / m.price - 1)})</span></dd>
            <dt>Price after sale <Info text="Where the spot price will sit right after your order. A big dent means you are selling more than the market can absorb at once." /></dt>
            <dd>{price(q.priceAfter)} <span className="down">({pct(impact)})</span></dd>
            <dt>Haulage to market</dt><dd className="down">−{money(q.haul)}</dd>
            <dt><b>You receive</b></dt><dd><b>{money(q.net)}</b></dd>
          </dl>
        ) : <p className="muted small">{held ? 'Choose how much to sell.' : `No ${GOODS[g].name.toLowerCase()} in storage here.`}</p>}
        <RetailQuote s={s} region={r} good={g} qty={q.qty} retailQty={q.retailQty}/>
        {q.limitedBy && <div className="callout warn">{q.limitedBy}</div>}
        {impact < -0.08 && <div className="callout warn">This order knocks the price down {pct0(-impact)}. Selling half now and half later would likely earn more.</div>}
        <button className="btn primary" disabled={!q.qty} onClick={() => act({ type: 'sell', region: r, good: g, qty: q.qty }, `Sold ${num(q.qty)} ${GOODS[g].name.toLowerCase()}.`)}>
          {q.qty ? `Sell ${num(q.qty)} for ${money(q.net)}` : 'Nothing to sell'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- supply & demand

function SupplyCard({ s, r, g }: { s: GameState; r: RegionId; g: GoodId }) {
  const m = s.markets[r][g]!;
  const ratio = m.inv / m.target;
  const share = m.totalSold > 0 ? m.playerSold / m.totalSold : 0;
  const tone = ratio < 0.8 ? 'up' : ratio > 1.25 ? 'down' : '';
  return (
    <Card title="Supply & demand" info="Prices in this game come from one rule: the less stock the market holds relative to normal, the higher the price. Farms, competitors and imports add stock; consumers take it away.">
      <div className="stack">
        <div className="stack s">
          <div className="row between small">
            <span className="muted">Market supply <Info text="Stock held by traders and stockists in this market, compared with the level they consider normal. Thin stock means buyers compete and prices rise; a glut pushes prices down until demand catches up or supply slows."
              breakdown={[['Market stock', num(m.inv)], ['Normal level', num(m.target)], ['Supply per hour', num(m.bg + m.comp, 1)], ['Demand per hour (base)', num(m.d0, 1)]]} /></span>
            <span className={`mono ${tone}`}>{pct0(ratio)} of normal</span>
          </div>
          <Bar value={ratio / 2} color={ratio < 0.8 ? 'var(--up)' : ratio > 1.25 ? 'var(--down)' : 'var(--accent)'} label="Market supply versus normal" />
          <p className="faint small">{ratio < 0.8 ? 'Stock is thin — a seller’s market.' : ratio > 1.25 ? 'The market is glutted — prices are under pressure.' : 'Supply is near normal.'}</p>
        </div>
        <div className="stack s">
          <div className="row between small">
            <span className="muted">Your 30-day market share <Info text="Your sales as a share of everything consumed in this market over roughly the last 30 days. The bigger your share, the more your own selling moves the price." breakdown={[['Your units', num(m.playerSold)], ['All units consumed', num(m.totalSold)]]} /></span>
            <span className="mono">{share < 0.001 && share > 0 ? '<0.1%' : `${(share * 100).toFixed(1)}%`}</span>
          </div>
          <Bar value={share} thin label="Your market share" />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- chart

function PriceChart({ s, r, g }: { s: GameState; r: RegionId; g: GoodId }) {
  const [range, setRange] = useState<'recent' | 'year'>('recent');
  const m = s.markets[r][g]!;
  const data = range === 'recent' ? m.history : m.daily;
  const isCrop = GOODS[g].kind === 'crop';
  const cost = isCrop ? seedCostPerUnit(s, r, g as CropId) : null;
  const series: Series[] = [{ name: `${GOODS[g].name} price`, color: GOODS[g].color === '#F4F1E8' || GOODS[g].color === '#F7F4EE' || GOODS[g].color === '#EDE7DA' ? 'var(--accent)' : GOODS[g].color, data }];
  if (cost && Number.isFinite(cost.cost)) series.push({ name: 'Seed cost per unit (excludes labour)', color: 'var(--down)', data: data.map(() => cost.cost), dashed: true });
  const xFormat = range === 'recent'
    ? (i: number, n: number) => { const d = ((n - 1 - i) * CONFIG.priceHistoryEvery) / TICKS_PER_DAY; return d < 0.05 ? 'now' : `${d.toFixed(1)} days ago`; }
    : (i: number, n: number) => (n - 1 - i === 0 ? 'today' : `${n - 1 - i} days ago`);
  const lo = Math.min(...data), hi = Math.max(...data);
  return (
    <Card title={<>Price history <span className="muted">{GOODS[g].name} · {REGIONS[r].name}</span></>}
      actions={<Seg label="Chart range" value={range} onChange={setRange} options={[{ v: 'recent', label: 'Last 30 days' }, { v: 'year', label: 'Daily, up to 3 years' }]} />}>
      <div className="stack">
        <LineChart series={series} format={price} xFormat={xFormat} height={220} />
        <div className="row wrap small muted" style={{ gap: 16 }}>
          <span>Range low <b className="mono">{price(lo)}</b></span>
          <span>High <b className="mono">{price(hi)}</b></span>
          <span>Swing <b className="mono">{pct0(hi / Math.max(1e-9, lo) - 1)}</b></span>
          {cost && Number.isFinite(cost.cost) && (
            <span>Seed cost / unit <b className="mono">{price(cost.cost)}</b> <Info text={`Seed for one hectare divided by ${cost.own ? 'your recent harvests per hectare here' : 'the yield a hectare gives under average conditions here'}. Wages, fuel, fertiliser and machinery are not included, so your true break-even is higher.`}
              breakdown={[['Seed per ha', money(seedCost(s, g as CropId) * CONFIG.seedsPerHa)], [cost.own ? 'Your yield per ha' : 'Typical yield per ha', num(cost.perHa)], ['Price ÷ seed cost', `${(m.price / cost.cost).toFixed(1)}×`]]} /></span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- buying

function BuyCard({ s, r }: { s: GameState; r: RegionId }) {
  const options = (s.era >= 5 ? TRADEABLE : (['fertilizer', 'fuel'] as GoodId[])).filter((x) => s.markets[r][x]);
  const [good, setGood] = useState<GoodId>('fertilizer');
  const g = options.includes(good) ? good : options[0];
  const [qty, setQty] = useState(100);
  const m = s.markets[r][g]!;
  const space = Math.floor(freeSpace(s, r, g));
  const want = Math.min(qty, space);
  const q = quoteBuy(s, r, g, want);
  const afford = q.net <= s.cash;
  return (
    <Card title="Buy" info={<>Buying takes stock out of the market, so the price rises as your order fills — the mirror image of selling. Purchases go into your storage here and are limited by free space. {s.era < 5 ? 'Fertiliser and diesel are available now; the full commodity exchange opens in Era 5.' : ''}</>}>
      <div className="stack">
        <div className="row wrap">
          <Select label="Good to buy" value={g} onChange={setGood} options={options.map((x) => ({ v: x, label: GOODS[x].name }))} />
          <NumberInput label="Units to buy" value={qty} onChange={(n) => setQty(Math.floor(n))} step={50} width={110} />
          <span className="mono small muted">{price(m.price)} spot</span>
        </div>
        <div className="row wrap small muted" style={{ gap: 14 }}>
          <span>Held here <b className="mono">{num(s.regions[r].inventory[g])}</b></span>
          <span>Free {GOODS[g].storage === 'cold' ? 'cold + dry' : 'dry'} space <b className="mono">{num(space)}</b></span>
        </div>
        {q.qty > 0 && (
          <dl className="facts">
            <dt>Average price</dt><dd>{price(q.avgPrice)} <span className="down">({pct(q.avgPrice / m.price - 1)})</span></dd>
            <dt>Price after</dt><dd>{price(q.priceAfter)}</dd>
            <dt>Haulage</dt><dd>{money(q.haul)}</dd>
            <dt><b>Total cost</b></dt><dd><b>{money(q.net)}</b></dd>
          </dl>
        )}
        {qty > space && <div className="callout warn">{space > 0 ? `Only ${num(space)} units fit in storage here.` : 'No free storage for this good here. Sell something or build storage.'}</div>}
        {q.limitedBy && <div className="callout warn">{q.limitedBy}</div>}
        {q.qty > 0 && !afford && <p className="small down">This order needs {money(q.net)} in cash, including haulage.</p>}
        <button className="btn primary" disabled={!q.qty || !afford} onClick={() => act({ type: 'buy', region: r, good: g, qty: q.qty }, `Bought ${num(q.qty)} ${GOODS[g].name.toLowerCase()}.`)}>
          {q.qty ? `Buy ${num(q.qty)} for ${money(q.net)}` : 'Buy'}
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- news

function NewsCard({ s }: { s: GameState }) {
  const news = s.log.filter((e) => e.page === 'markets').slice(-10).reverse();
  return (
    <Card title="Market news">
      {news.length ? (
        <ol className="log">
          {news.map((e) => <li key={e.id} className={e.level}><span className="mono">{stamp(e.tick).slice(3)}</span><span>{e.text}</span></li>)}
        </ol>
      ) : <p className="muted small">Big price moves, contract results and futures settlements will be reported here.</p>}
    </Card>
  );
}

// ---------------------------------------------------------------- contracts

function ContractsCard({ s }: { s: GameState }) {
  const offers = s.contracts.filter((c) => !c.accepted);
  const active = s.contracts.filter((c) => c.accepted);
  const spot = (c: SupplyContract) => s.markets[c.region][c.good]!.price;
  const offerCols: Col<SupplyContract>[] = [
    { key: 'buyer', label: 'Buyer', render: (c) => <><b>{c.buyer}</b>{c.minQuality && <> <span className="pill good" title="Premium buyer: only accepts stock of grade A quality (80%+)">Grade A only</span></>}<div className="faint small">{REGIONS[c.region].name}</div></> },
    { key: 'good', label: 'Good', render: (c) => <GoodName g={c.good} /> },
    { key: 'qty', label: 'Qty', align: 'r', render: (c) => <span className="mono">{num(c.qty)}</span> },
    { key: 'price', label: 'Price vs spot', align: 'r', render: (c) => <><span className="mono">{price(c.price)}</span><div className={`small mono ${c.price >= spot(c) ? 'up' : 'down'}`}>{pct(c.price / spot(c) - 1)}</div></>, sort: (c) => c.price / spot(c) },
    { key: 'value', label: 'Value', align: 'r', render: (c) => <span className="mono">{money(c.qty * c.price)}</span>, sort: (c) => c.qty * c.price },
    { key: 'due', label: 'Deliver within', align: 'r', render: (c) => <span className="mono">{duration(c.deadline - s.tick)}</span> },
    { key: 'pen', label: 'Penalty/unit short', align: 'r', render: (c) => <span className="mono down">{price(c.penalty)}</span> },
    { key: 'exp', label: 'Offer ends', align: 'r', render: (c) => <span className="mono faint">{duration(c.expires - s.tick)}</span> },
    { key: 'act', label: '', render: (c) => <Confirm label="Accept" className="btn primary sm" disabled={!s.regions[c.region].unlocked} title={`Supply ${GOODS[c.good].name.toLowerCase()} to ${c.buyer}?`} confirmLabel="Accept contract"
      body={<>You commit to deliver <b>{num(c.qty)} {GOODS[c.good].name.toLowerCase()}</b> in {REGIONS[c.region].name} at <b>{price(c.price)}</b> each ({money(c.qty * c.price)}) within {duration(c.deadline - s.tick)}. Whatever is short at the deadline costs <b>{price(c.penalty)}</b> per unit and some reputation. Stock in that region is delivered automatically at the deadline, or any time you press Deliver.</>}
      onConfirm={() => act({ type: 'acceptContract', contractId: c.id }, 'Contract accepted.')} /> },
  ];
  return (
    <Card title="Supply contracts" info="A supply contract locks in a price for a fixed quantity. You give up any upside if the market rallies, but you are protected if it falls — and buyers pay a premium for reliability. Missing the quantity costs a penalty per unit and reputation.">
      <div className="stack">
        {active.length > 0 && (
          <div className="stack s">
            <h3>Your contracts</h3>
            {active.map((c) => {
              const held = s.regions[c.region].inventory[c.good];
              const left = c.qty - c.delivered;
              return (
                <div key={c.id} className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  <div className="row between wrap">
                    <span><b>{c.buyer}</b> <span className="muted small">· {REGIONS[c.region].name}</span>{c.minQuality && <> <span className="pill good">Grade A only</span></>}</span>
                    <span className="row small"><GoodName g={c.good} /> <span className="mono">{price(c.price)}</span> <span className="faint">due in {duration(c.deadline - s.tick)}</span></span>
                  </div>
                  <Bar value={c.delivered / c.qty} label="Delivered" />
                  <div className="row between wrap small">
                    <span className="muted">{num(c.delivered)} / {num(c.qty)} delivered · {num(held)} in storage{held < left ? <span className="down"> · {num(left - held)} short (penalty {money((left - held) * c.penalty)})</span> : ''}</span>
                    <button className="btn ghost sm" disabled={held < 1} onClick={() => act({ type: 'deliverContract', contractId: c.id })}>Deliver now</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <h3>Offers</h3>
        <Table rows={offers} cols={offerCols} rowKey={(c) => c.id} empty="Buyers send offers every few days for goods you produce." />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- futures

function FuturesCard({ s }: { s: GameState }) {
  const [good, setGood] = useState<GoodId>('wheat');
  const [side, setSide] = useState<1 | -1>(-1);
  const [n, setN] = useState(1);
  const [days, setDays] = useState<30 | 60 | 120>(30);
  const expiry = s.tick + days * TICKS_PER_DAY;
  const fp = futuresPrice(s, good, expiry);
  const margin = initialMargin(s, good, n, expiry);
  const held = Object.values(s.regions).reduce((a, r) => a + r.inventory[good], 0);
  const hedgeN = Math.floor(held / CONTRACT_SIZE);
  const pnl = (p: FuturesPosition) => p.contracts * CONTRACT_SIZE * (futuresPrice(s, p.good, p.expiry) - p.entry);
  const total = s.futures.reduce((a, p) => a + pnl(p), 0);
  const cols: Col<FuturesPosition>[] = [
    { key: 'good', label: 'Contract', render: (p) => <><GoodName g={p.good} /> <span className={`pill ${p.contracts > 0 ? 'good' : 'warn'}`}>{p.contracts > 0 ? 'Long' : 'Short'} {Math.abs(p.contracts)}</span></> },
    { key: 'entry', label: 'Entry', align: 'r', render: (p) => <span className="mono">{price(p.entry)}</span> },
    { key: 'mark', label: 'Now', align: 'r', render: (p) => <span className="mono">{price(futuresPrice(s, p.good, p.expiry))}</span> },
    { key: 'pnl', label: 'P&L since entry', align: 'r', render: (p) => { const v = pnl(p); return <span className={`mono ${v >= 0 ? 'up' : 'down'}`}>{money(v)}</span>; }, sort: pnl },
    { key: 'margin', label: 'Margin held', align: 'r', render: (p) => <span className="mono">{money(p.margin)}</span> },
    { key: 'exp', label: 'Expires in', align: 'r', render: (p) => <span className="mono">{duration(p.expiry - s.tick)}</span>, sort: (p) => p.expiry },
    { key: 'act', label: '', render: (p) => <Confirm label="Close" title="Close this position?" confirmLabel="Close position"
      body={<>Settles at today's futures price of <b>{price(futuresPrice(s, p.good, p.expiry))}</b>. Your {money(p.margin)} margin is returned.</>}
      onConfirm={() => act({ type: 'closeFutures', positionId: p.id }, 'Position closed.')} /> },
  ];
  return (
    <Card title="Futures" info={<>A futures contract is a promise to trade {CONTRACT_SIZE} units at a fixed price on a future date, settled in cash. A <b>short</b> gains when prices fall, a <b>long</b> when they rise. Farmers short futures to <b>hedge</b>: if the crop they will sell later drops in price, the futures gain offsets the loss. Futures trade at the average price across all regions plus a small storage carry.</>}>
      <div className="stack">
        <div className="callout">
          <b>Hedging in one line:</b> you hold {num(held)} {GOODS[good].name.toLowerCase()} (about {hedgeN} contract{hedgeN === 1 ? '' : 's'} of {CONTRACT_SIZE}). Shorting that many locks in roughly {price(fp)} per unit: if prices fall, your stock is worth less but the short gains about the same amount.
        </div>
        <div className="row wrap">
          <Select label="Futures good" value={good} onChange={setGood} options={FUTURES_GOODS.map((x) => ({ v: x, label: GOODS[x].name }))} />
          <Seg label="Direction" value={side} onChange={setSide} options={[{ v: -1, label: 'Short (sell)' }, { v: 1, label: 'Long (buy)' }]} />
          <NumberInput label="Number of contracts" value={n} onChange={(x) => setN(Math.max(1, Math.floor(x)))} min={1} width={80} />
          <Seg label="Expiry" value={days} onChange={setDays} options={[{ v: 30, label: '30 days' }, { v: 60, label: '60 days' }, { v: 120, label: '120 days' }]} />
          {hedgeN > 0 && <button className="btn ghost sm" onClick={() => (setSide(-1), setN(hedgeN))}>Hedge my stock ({hedgeN})</button>}
        </div>
        <dl className="facts">
          <dt>Futures price <Info text="Average spot price across regions plus about 4% a year of storage carry to the expiry date." /></dt><dd>{price(fp)}</dd>
          <dt>Exposure</dt><dd>{num(n * CONTRACT_SIZE)} units · {money(n * CONTRACT_SIZE * fp)}</dd>
          <dt>Initial margin (12%) <Info text="Cash set aside as a deposit while the position is open. Gains and losses are settled into your cash every day; if your cash sinks too far into overdraft, the broker closes the position (a margin call)." /></dt><dd>{money(margin)}</dd>
          <dt>Each $0.10 move</dt><dd>{money(n * CONTRACT_SIZE * 0.1)}</dd>
        </dl>
        <Confirm label={`Open ${side > 0 ? 'long' : 'short'} ${n} · margin ${money(margin)}`} className="btn primary" disabled={margin > s.cash}
          title={`${side > 0 ? 'Buy' : 'Sell'} ${n} ${GOODS[good].name.toLowerCase()} futures?`} confirmLabel="Open position"
          body={<>{side > 0 ? 'Long' : 'Short'} {num(n * CONTRACT_SIZE)} units at {price(fp)}, expiring in {days} days. {money(margin)} moves to your margin account. Every day the position is marked to market and the gain or loss lands in your cash.</>}
          onConfirm={() => act({ type: 'openFutures', good, contracts: side * n, days }, 'Position opened.')} />
        {s.futures.length > 0 && (
          <>
            <div className="row between"><h3>Open positions</h3><span className={`mono ${total >= 0 ? 'up' : 'down'}`}>Total {money(total)} <Info text="Profit or loss since each position was opened. Most of it has already been paid into or taken from your cash through daily settlement." /></span></div>
            <Table rows={s.futures} cols={cols} rowKey={(p) => p.id} />
          </>
        )}
      </div>
    </Card>
  );
}
