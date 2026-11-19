import { useState } from 'react';
import { act, go, takeNeighbourFocus, useGame } from '../../stores/game';
import { attitude, NEIGHBOUR_IDS, NEIGHBOURS, regionOf, ROUTE_SIDE, SIDE_NAME, type BorderCharter, type NeighbourId } from '../../simulation/region-state';
import { borderChangeCost, giftValue, militiaEscort, protection, pursuitCost, raidRisk, TOWER_REACH, tollIncome, towersOn, treatyCost, TREATY_TRUST } from '../../simulation/stages/region';
import { exportGain } from '../../simulation/logistics';
import { serviceDailyCost } from '../../simulation/stages/town';
import { levelOf, SERVICE_DEFS, servicePrice, townOf } from '../../simulation/town-state';
import { GOOD_IDS, GOODS, REGIONS, type GoodId } from '../../simulation/config';
import { priceUsd, reservedStock } from '../../simulation/core';
import { Bar, Confirm, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0, price } from '../format';

// The region as it lies round your land (viewBox 0 0 360 220): the main road runs west–east through your city, the river south.
const POS: Record<NeighbourId | 'home', [number, number]> = { home: [180, 92], arid: [42, 92], coastal: [318, 92], river: [118, 196], tropics: [248, 200] };
const QTY = [100, 500, 2000, 10000];
const BORDERS: Record<BorderCharter, { icon: string; name: string; line: string; detail: string }> = {
  open: { icon: '🕊', name: 'Open borders', line: 'Trust grows 1.5× faster', detail: 'Caravans earn more goodwill · higher raid risk · an arch where the road leaves' },
  walls: { icon: '🧱', name: 'Walls & tolls', line: 'Raids 30% less likely', detail: 'Towers 1.5× stronger, tolls paid to you · neighbours cool · a gatehouse on the road' },
};
const days = (ticks: number) => Math.max(0, Math.ceil(ticks / 24));

export default function RegionPage() {
  const s = useGame(), v = regionOf(s), t = townOf(s);
  const [sel, setSel] = useState<NeighbourId>(() => (takeNeighbourFocus() as NeighbourId | null) ?? 'river'), [tab, setTab] = useState<'trade' | 'diplomacy' | 'defence'>('trade');
  const borders = (changing = false) => <div className="charter-grid">{(Object.keys(BORDERS) as BorderCharter[]).map(id => { const d = BORDERS[id]; return <article className="charter-tile" key={id}><div className="charter-crest">{d.icon}</div><h3>{d.name}</h3><strong>{d.line}</strong><span>{d.detail}</span>
    <button className="btn primary" aria-label={`${changing ? 'Switch to' : 'Choose'} ${d.name}`} disabled={changing && (v.border === id || s.cash < borderChangeCost(s))} onClick={() => act(changing ? { type: 'setBorder', border: id } : { type: 'startRegion', border: id })}>{changing ? `Switch · ${money(borderChangeCost(s))}` : 'Choose'}</button></article>; })}</div>;
  if (!v.active) return <Modal title="Neighbours at the gate" onClose={() => go('farm')}><div className="charter-heading"><b>Your border policy</b><span>Changeable later · {money(borderChangeCost(s))} border works</span></div>{borders()}<p className="muted">Four towns lie beyond your land: two along the main road, two down the river. They trade with you by caravan and barge, place orders, and some will test you. Your farm, town and city keep running.</p></Modal>;

  const n = v.neighbours[sel], who = NEIGHBOURS[sel], side = ROUTE_SIDE[sel], spare = (g: GoodId) => Math.max(0, s.regions.heartland.inventory[g] - reservedStock(s, 'heartland', g));
  const goods = GOOD_IDS.filter(g => GOODS[g].kind !== 'input' && s.markets[sel][g] && (spare(g) >= 1 || n.route?.good === g || n.request?.good === g))
    .sort((a, b) => (b === n.request?.good ? 2 : b === who.wants ? 1 : 0) - (a === n.request?.good ? 2 : a === who.wants ? 1 : 0) || exportGain(s, b, 'heartland', sel) - exportGain(s, a, 'heartland', sel));
  const routeGood = n.route?.good ?? goods[0];
  const giftQty = Math.ceil(giftValue(s) / Math.max(.01, priceUsd(s, 'heartland', who.wants)));
  const towers = t.services.filter(b => b.type === 'watchtower'), halls = t.services.filter(b => b.type === 'militia');
  const orders = NEIGHBOUR_IDS.filter(id => v.neighbours[id].request);
  const sendFor = (id: NeighbourId) => { const r = v.neighbours[id].request!, left = r.qty - r.done; return Math.min(10000, Math.max(100, Math.ceil(left / 3 / 100) * 100)); };
  return <div className="stack town-page region-page"><PageHead title="Region" />
    <div className="town-purse"><b>🪙 {money(s.cash)}</b><span>🛡 {pct0(protection(s))} escort</span><Info text={`How well your caravans are guarded, on average over your routes: the city's police, your militia hall's escorts and the watchtowers on each road. Daily raid risk per caravan: ${pct0(raidRisk(s))}.`} /></div>
    {v.demand && <article className="city-case region-alert"><h3>{NEIGHBOURS[v.demand.from].icon} {NEIGHBOURS[v.demand.from].leader} demands tribute</h3><strong>{money(v.demand.amount)} · {days(v.demand.deadline - s.tick)} days to answer</strong><span>Refusing means 50% more raids for 60 days.</span>
      <div className="row wrap"><button className="btn primary" disabled={s.cash < v.demand.amount} onClick={() => act({ type: 'answerDemand', answer: 'pay' })}>Pay · +25 trust</button><button className="btn ghost" onClick={() => act({ type: 'answerDemand', answer: 'refuse' })}>Refuse</button></div></article>}
    {v.raid && <article className="city-case region-alert"><h3>🏴 Caravan raided</h3><strong>{num(v.raid.lost)} {GOODS[v.raid.good].name.toLowerCase()} lost on {SIDE_NAME[ROUTE_SIDE[v.raid.to]]} to {REGIONS[v.raid.to].name}</strong><span>Pursuit recovers about {pct0(.3 + .7 * protection(s, v.raid.to))} · {days(v.raid.deadline - s.tick)} days</span>
      <div className="row wrap"><button className="btn primary" disabled={s.cash < pursuitCost(s)} onClick={() => act({ type: 'resolveRaid', answer: 'pursue' })}>Pursue · {money(pursuitCost(s))}</button><button className="btn ghost" onClick={() => act({ type: 'resolveRaid', answer: 'absorb' })}>Let it go</button></div></article>}
    {orders.map(id => { const r = v.neighbours[id].request!, routed = v.neighbours[id].route?.good === r.good; return <article key={id} className="region-order"><div className="region-order-head"><b>📜 {NEIGHBOURS[id].icon} {NEIGHBOURS[id].leader}</b><span>{days(r.deadline - s.tick)} days left</span></div>
      <strong>{num(r.qty)} {GOODS[r.good].name.toLowerCase()} · +{money(r.bonus)} bonus · +10 trust</strong>
      <Bar value={r.done / r.qty} label={`${num(r.done)} of ${num(r.qty)} delivered`} color="var(--gold)" /><small className="muted">{num(r.done)} of {num(r.qty)} delivered{routed ? ` · caravan sends ${num(v.neighbours[id].route!.qty)} a day` : ''}</small>
      {!routed && <button className="btn primary" disabled={!s.markets[id][r.good]} onClick={() => { act({ type: 'setRoute', to: id, good: r.good, qty: sendFor(id) }); setSel(id); setTab('trade'); }}>🐫 Send {num(sendFor(id))} a day</button>}</article>; })}
    <svg className="region-map" data-coach="region-map" viewBox="0 0 360 220" role="group" aria-label="Region map">
      <path className="region-river" d="M150 0 C 160 40, 140 70, 150 100 S 170 170, 150 220" />
      <line className="region-mainroad" x1="0" y1={POS.home[1]} x2="360" y2={POS.home[1]} />
      {NEIGHBOUR_IDS.map(id => { const [x, y] = POS[id], [hx, hy] = POS.home, road = !!v.neighbours[id].route; return <line key={id} x1={hx} y1={hy} x2={x} y2={y} className={`region-road${road ? ' live' : ''}${v.neighbours[id].treaty ? ' treaty' : ''}`} />; })}
      {NEIGHBOUR_IDS.filter(id => v.neighbours[id].route).map(id => { const [x, y] = POS[id], [hx, hy] = POS.home, p = protection(s, id); return <text key={id} className={`region-guard${p < .3 ? ' weak' : ''}`} x={hx + (x - hx) * .62} y={hy + (y - hy) * .62 - 9} textAnchor="middle">🛡{Math.round(p * 100)}%</text>; })}
      {s.shipments.filter(x => x.caravan && s.tick < x.arrives && (NEIGHBOUR_IDS as readonly string[]).includes(x.to)).slice(0, 8).map(x => { const [hx, hy] = POS.home, [tx, ty] = POS[x.to as NeighbourId], dep = ((x.batchDay ?? 0) + 1) * 24, f = Math.min(.9, Math.max(.1, (s.tick - dep) / Math.max(1, x.arrives - dep))); return <text key={x.id} className="region-caravan" x={hx + (tx - hx) * f} y={hy + (ty - hy) * f + 5} textAnchor="middle">{ROUTE_SIDE[x.to as NeighbourId] === 'south' ? '⛵' : '🐫'}</text>; })}
      <g className="region-home"><circle cx={POS.home[0]} cy={POS.home[1]} r="24" /><text x={POS.home[0]} y={POS.home[1] + 8} textAnchor="middle">🏙</text></g>
      {NEIGHBOUR_IDS.map(id => { const [x, y] = POS[id], nb = v.neighbours[id], mood = attitude(nb.trust); return <g key={id} className={`region-banner ${mood.toLowerCase()}${id === sel ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${REGIONS[id].name}, ${mood}${nb.request ? ', has an order' : ''}`} aria-pressed={id === sel} onClick={() => setSel(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSel(id); }}>
        <rect x={x - 42} y={y - 21} width="84" height="42" rx="12" /><text x={x - 28} y={y + 7} textAnchor="middle" className="region-icon">{NEIGHBOURS[id].icon}</text><text x={x + 8} y={y - 3} textAnchor="middle" className="region-name">{REGIONS[id].name.split(' ')[0]}{nb.request ? ' 📜' : ''}</text><text x={x + 8} y={y + 13} textAnchor="middle" className="region-trust">{mood} {Math.round(nb.trust)}</text></g>; })}
    </svg>
    <div className="region-who"><b>{who.icon} {who.leader}</b><span>{REGIONS[sel].name} · by {SIDE_NAME[side]} · wants {GOODS[who.wants].name.toLowerCase()}{n.treaty ? ' · 🤝 treaty' : ''}</span><Bar value={n.trust / 100} label={`Trust with ${REGIONS[sel].name}`} /></div>
    <Seg label="Region decisions" value={tab} onChange={setTab} options={[{ v: 'trade', label: 'Trade' }, { v: 'diplomacy', label: 'Diplomacy' }, { v: 'defence', label: 'Defence' }]} />
    {tab === 'trade' && <div className="stack">
      {n.route ? <div className="town-service-status"><span>{side === 'south' ? '⛵' : '🐫'} Daily: {num(n.route.qty)} {GOODS[n.route.good].name.toLowerCase()}{n.note ? ` · ${n.note}` : ''}</span><button className="btn ghost" onClick={() => act({ type: 'setRoute', to: sel, good: null, qty: 0 })}>Stop</button></div> : <span className="muted">No {side === 'south' ? 'barge' : 'caravan'} yet. Pick a good and a daily load.</span>}
      {goods.length ? <div className="region-goods">{goods.slice(0, 4).map(g => { const gain = exportGain(s, g, 'heartland', sel); return <button key={g} className={`btn ${g === routeGood ? 'gold' : 'ghost'}`} aria-pressed={g === routeGood} onClick={() => n.route ? act({ type: 'setRoute', to: sel, good: g, qty: n.route.qty }) : act({ type: 'setRoute', to: sel, good: g, qty: 500 })}><span>{GOODS[g].name}{g === n.request?.good ? ' 📜' : g === who.wants ? ' ★' : ''}</span><small className={gain >= 0 ? 'good' : 'bad'}>{gain >= 0 ? '+' : ''}{price(gain)}/u</small></button>; })}</div> : <span className="muted">Nothing spare to send. Grow or process more goods first.</span>}
      {n.route && <Seg label="Daily load" value={n.route.qty} onChange={qty => act({ type: 'setRoute', to: sel, good: n.route!.good, qty })} options={QTY.map(q => ({ v: q, label: num(q) }))} />}
      <div className="community-strip"><span><b>🏴 {pct0(raidRisk(s, sel))}</b><small>raid risk a day</small></span><span><b>🛡 {pct0(protection(s, sel))}</b><small>guarded</small></span><span><b>🪙 {money(n.delivered)}</b><small>sold here</small></span></div>
      <Info text="Caravans leave at dawn with spare stock (factory inputs and the larder are kept), pay freight and tariffs up front, and sell at the neighbour's market over the following hours. The per-unit figure is the extra you earn versus selling at home after freight and tariff. ★ the good they want: double trust. 📜 the good of an open order: it counts toward the order as it sells." />
    </div>}
    {tab === 'diplomacy' && <div className="stack">
      <div className="row wrap"><button className="btn primary" disabled={Math.floor(s.tick / 24) - n.giftDay < 7 || spare(who.wants) < giftQty} onClick={() => act({ type: 'giftNeighbour', to: sel, kind: 'goods' })}>🎁 {num(giftQty)} {GOODS[who.wants].name.toLowerCase()} · +8</button>
        <button className="btn" disabled={Math.floor(s.tick / 24) - n.giftDay < 7 || s.cash < giftValue(s)} onClick={() => act({ type: 'giftNeighbour', to: sel, kind: 'cash' })}>🪙 {money(giftValue(s))} · +5</button></div>
      <Confirm label={n.treaty ? '🤝 Treaty signed · no tariffs' : `🤝 Trade treaty · ${money(treatyCost(s))}`} title={`Sign a treaty with ${REGIONS[sel].name}?`} body={<>{money(treatyCost(s))} from company cash. Tariffs on your goods to {REGIONS[sel].name} are waived. If trust falls below {TREATY_TRUST - 20}, they tear it up.</>} disabled={n.treaty || n.trust < TREATY_TRUST || s.cash < treatyCost(s)} className="btn" onConfirm={() => act({ type: 'signTreaty', to: sel })} />
      {!n.treaty && n.trust < TREATY_TRUST && <small className="muted">Treaty needs trust {TREATY_TRUST}.</small>}
      <div className="community-strip"><span><b>📜 {v.filled ?? 0}</b><small>orders filled</small></span><span><b>✗ {v.missed ?? 0}</b><small>missed</small></span><span><b>🐫 {num(v.caravans)}</b><small>caravans</small></span></div>
      <Info text="One gift per neighbour per week. Trust drifts slowly back toward each leader's natural attitude; a leader who fears your border policy settles 15 points lower. Filling their orders is worth +10 trust and a bonus; missing one costs 6." />
    </div>}
    {tab === 'defence' && <div className="stack">
      <div className="community-strip"><span><b>🛡 {pct0(protection(s, sel))}</b><small>{REGIONS[sel].name.split(' ')[0]} route</small></span><span><b>🏴 {pct0(raidRisk(s, sel))}</b><small>raid risk a day</small></span><span><b>⚔ {v.raids}</b><small>raids so far</small></span></div>
      <article className="town-service"><div className="town-portrait"><b>🗼</b></div><div className="town-service-body"><h3>Watchtowers on {SIDE_NAME[side]} <small>{towersOn(s, side) > 0 ? `${num(towersOn(s, side), 1)} on watch` : 'none yet'}</small></h3><strong>Guard caravans to {NEIGHBOUR_IDS.filter(id => ROUTE_SIDE[id] === side).map(id => REGIONS[id].name).join(' and ')}</strong><span>Place within {TOWER_REACH} tiles of {side === 'south' ? 'the river, south of the main road' : `the main road, ${side} of your farmhouse`} · 👥 {SERVICE_DEFS.watchtower.jobs} · {money(serviceDailyCost(s, 'watchtower'))}/day · upgrade for more{v.border === 'walls' ? ` · tolls ${money(tollIncome(s))}/day` : ''}</span>
        <button className="btn primary" disabled={servicePrice(s, 'watchtower') > s.cash} onClick={() => act({ type: 'buildService', service: 'watchtower', district: 'farmgate' })}>Place a tower · {money(servicePrice(s, 'watchtower'))}</button></div>
        {towers.length > 0 && <div className="town-service-status"><span>{towers.length} tower{towers.length === 1 ? '' : 's'} in all · {towers.filter(b => b.funded && b.active).reduce((a, b) => a + b.staffed, 0)} on watch</span></div>}</article>
      <article className="town-service"><div className="town-portrait"><b>🛡</b></div><div className="town-service-body"><h3>{SERVICE_DEFS.militia.name} {halls.length > 0 && <small>×{halls.length}</small>}</h3><strong>Escorts every caravan · +{pct0(militiaEscort(s))} on all routes</strong><span>👥 {SERVICE_DEFS.militia.jobs} volunteers · {money(serviceDailyCost(s, 'militia'))}/day · upgrade for +18%, then +25%</span>
        <button className="btn primary" disabled={servicePrice(s, 'militia') > s.cash} onClick={() => act({ type: 'buildService', service: 'militia', district: 'farmgate' })}>Build · {money(servicePrice(s, 'militia'))}</button></div>
        {halls.length > 0 && <div className="town-service-status"><span>{halls.map(b => `level ${levelOf(b)} · ${b.funded && b.active ? `${b.staffed}/${SERVICE_DEFS.militia.jobs}` : 'paused'}`).join(' · ')}</span></div>}</article>
      <h3>{BORDERS[v.border!].icon} {BORDERS[v.border!].name}</h3>{borders(true)}
      <button className="btn ghost" onClick={() => go('city')}>🛡 City watch & police</button>
      {(regionOf(s).answered !== null) && <button className="btn ghost" onClick={() => go('nation')}>⚔ Nation</button>}
    </div>}
  </div>;
}
