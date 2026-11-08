import { useState } from 'react';
import { act, go, useGame } from '../../stores/game';
import { attitude, NEIGHBOUR_IDS, NEIGHBOURS, regionOf, type BorderCharter, type NeighbourId } from '../../simulation/region-state';
import { borderChangeCost, giftValue, protection, pursuitCost, raidRisk, staffedTowers, tollIncome, treatyCost, TREATY_TRUST } from '../../simulation/stages/region';
import { exportGain } from '../../simulation/logistics';
import { plannedServiceCost, serviceDailyCost } from '../../simulation/stages/town';
import { SERVICE_DEFS, servicePrice, townOf } from '../../simulation/town-state';
import { GOOD_IDS, GOODS, REGIONS, type GoodId } from '../../simulation/config';
import { priceUsd, reservedStock } from '../../simulation/core';
import { Bar, Confirm, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0, price } from '../format';

// Fixed map positions (viewBox 0 0 360 220): your city in the middle, neighbours around it.
const POS: Record<NeighbourId | 'home', [number, number]> = { home: [180, 110], river: [180, 26], arid: [50, 110], coastal: [310, 110], tropics: [180, 194] };
const QTY = [100, 500, 2000, 10000];
const BORDERS: Record<BorderCharter, { icon: string; name: string; line: string; detail: string }> = {
  open: { icon: '🕊', name: 'Open borders', line: 'Trust grows 1.5× faster', detail: 'Caravans earn more goodwill · higher raid risk' },
  walls: { icon: '🧱', name: 'Walls & tolls', line: 'Raids 30% less likely', detail: 'Towers 1.5× stronger, collect tolls · neighbours cool' },
};

export default function RegionPage() {
  const s = useGame(), v = regionOf(s), t = townOf(s);
  const [sel, setSel] = useState<NeighbourId>('river'), [tab, setTab] = useState<'trade' | 'diplomacy' | 'defence'>('trade');
  const borders = (changing = false) => <div className="charter-grid">{(Object.keys(BORDERS) as BorderCharter[]).map(id => { const d = BORDERS[id]; return <article className="charter-tile" key={id}><div className="charter-crest">{d.icon}</div><h3>{d.name}</h3><strong>{d.line}</strong><span>{d.detail}</span>
    <button className="btn primary" aria-label={`${changing ? 'Switch to' : 'Choose'} ${d.name}`} disabled={changing && (v.border === id || t.cash < borderChangeCost(s))} onClick={() => act(changing ? { type: 'setBorder', border: id } : { type: 'startRegion', border: id })}>{changing ? `Switch · ${money(borderChangeCost(s))}` : 'Choose'}</button></article>; })}</div>;
  if (!v.active) return <Modal title="Neighbours at the gate" onClose={() => go('farm')}><div className="charter-heading"><b>Your border policy</b><span>Changeable later · {money(borderChangeCost(s))} public works</span></div>{borders()}<p className="muted">Four settlements trade with you by caravan. Your farm, town and city keep running.</p></Modal>;

  const n = v.neighbours[sel], who = NEIGHBOURS[sel], spare = (g: GoodId) => Math.max(0, s.regions.heartland.inventory[g] - reservedStock(s, 'heartland', g));
  const goods = GOOD_IDS.filter(g => GOODS[g].kind !== 'input' && s.markets[sel][g] && (spare(g) >= 1 || n.route?.good === g))
    .sort((a, b) => (b === who.wants ? 1 : 0) - (a === who.wants ? 1 : 0) || exportGain(s, b, 'heartland', sel) - exportGain(s, a, 'heartland', sel));
  const routeGood = n.route?.good ?? goods[0];
  const giftQty = Math.ceil(giftValue(s) / Math.max(.01, priceUsd(s, 'heartland', who.wants)));
  const towers = t.services.find(b => b.type === 'watchtower');
  const upkeep = plannedServiceCost(s), topUp = Math.ceil(Math.max(0, upkeep * 14 - t.cash) / 100) * 100;
  return <div className="stack town-page region-page"><PageHead title="Region" />
    <div className="town-purse"><b>🪙 {money(t.cash)}</b><span>🛡 {pct0(protection(s))} escort</span><Info text={`Daily chance a caravan on the road is raided: ${pct0(raidRisk(s))}. City watch coverage and staffed watchtowers protect the roads. Public costs come from the town treasury; trade, gifts and treaties from company cash.`} /></div>
    {t.cash < upkeep * 7 && <button className="btn primary community-next" onClick={() => topUp > s.cash ? go(s.corp.incorporated ? 'corporation' : 'finance') : act({ type: 'fundTown', amount: topUp, direction: 'toTown' })}><span>🪙 {t.cash < upkeep ? 'Treasury empty: towers and police stop' : 'Fund two weeks of public services'}</span><b>{money(topUp)}</b></button>}
    {v.demand && <article className="city-case region-alert"><h3>{NEIGHBOURS[v.demand.from].icon} {NEIGHBOURS[v.demand.from].leader} demands tribute</h3><strong>{money(v.demand.amount)} · {Math.max(0, Math.ceil((v.demand.deadline - s.tick) / 24))} days to answer</strong><span>Refusing means 50% more raids for 60 days.</span>
      <div className="row wrap"><button className="btn primary" disabled={s.cash < v.demand.amount} onClick={() => act({ type: 'answerDemand', answer: 'pay' })}>Pay · +25 trust</button><button className="btn ghost" onClick={() => act({ type: 'answerDemand', answer: 'refuse' })}>Refuse</button></div></article>}
    {v.raid && <article className="city-case region-alert"><h3>🏴 Caravan raided</h3><strong>{num(v.raid.lost)} {GOODS[v.raid.good].name.toLowerCase()} lost on the road to {REGIONS[v.raid.to].name}</strong><span>Pursuit recovers about {pct0(.3 + .7 * protection(s))} · {Math.max(0, Math.ceil((v.raid.deadline - s.tick) / 24))} days</span>
      <div className="row wrap"><button className="btn primary" disabled={t.cash < pursuitCost(s)} onClick={() => act({ type: 'resolveRaid', answer: 'pursue' })}>Pursue · {money(pursuitCost(s))}</button><button className="btn ghost" onClick={() => act({ type: 'resolveRaid', answer: 'absorb' })}>Let it go</button></div></article>}
    <svg className="region-map" data-coach="region-map" viewBox="0 0 360 220" role="group" aria-label="Region map">
      {NEIGHBOUR_IDS.map(id => { const [x, y] = POS[id], [hx, hy] = POS.home, road = !!v.neighbours[id].route; return <line key={id} x1={hx} y1={hy} x2={x} y2={y} className={`region-road${road ? ' live' : ''}${v.neighbours[id].treaty ? ' treaty' : ''}`} />; })}
      {s.shipments.filter(x => x.caravan && s.tick < x.arrives).slice(0, 8).map(x => { const [hx, hy] = POS.home, [tx, ty] = POS[x.to as NeighbourId], f = Math.min(.85, Math.max(.15, 1 - (x.arrives - s.tick) / 48)); return <text key={x.id} className="region-caravan" x={hx + (tx - hx) * f} y={hy + (ty - hy) * f + 5} textAnchor="middle">🐫</text>; })}
      <g className="region-home"><circle cx={POS.home[0]} cy={POS.home[1]} r="26" /><text x={POS.home[0]} y={POS.home[1] + 8} textAnchor="middle">🏙</text></g>
      {NEIGHBOUR_IDS.map(id => { const [x, y] = POS[id], nb = v.neighbours[id], mood = attitude(nb.trust); return <g key={id} className={`region-banner ${mood.toLowerCase()}${id === sel ? ' selected' : ''}`} role="button" tabIndex={0} aria-label={`${REGIONS[id].name}, ${mood}`} aria-pressed={id === sel} onClick={() => setSel(id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSel(id); }}>
        <rect x={x - 44} y={y - 22} width="88" height="44" rx="12" /><text x={x - 30} y={y + 7} textAnchor="middle" className="region-icon">{NEIGHBOURS[id].icon}</text><text x={x + 8} y={y - 3} textAnchor="middle" className="region-name">{REGIONS[id].name.split(' ')[0]}</text><text x={x + 8} y={y + 13} textAnchor="middle" className="region-trust">{mood} {Math.round(nb.trust)}</text></g>; })}
    </svg>
    <div className="region-who"><b>{who.icon} {who.leader}</b><span>{REGIONS[sel].name} · wants {GOODS[who.wants].name.toLowerCase()}{n.treaty ? ' · 🤝 treaty' : ''}</span><Bar value={n.trust / 100} label={`Trust with ${REGIONS[sel].name}`} /></div>
    <Seg label="Region decisions" value={tab} onChange={setTab} options={[{ v: 'trade', label: 'Trade' }, { v: 'diplomacy', label: 'Diplomacy' }, { v: 'defence', label: 'Defence' }]} />
    {tab === 'trade' && <div className="stack">
      {n.route ? <div className="town-service-status"><span>🐫 Daily: {num(n.route.qty)} {GOODS[n.route.good].name.toLowerCase()}{n.note ? ` · ${n.note}` : ''}</span><button className="btn ghost" onClick={() => act({ type: 'setRoute', to: sel, good: null, qty: 0 })}>Stop</button></div> : <span className="muted">No caravan yet. Pick a good and a daily load.</span>}
      {goods.length ? <div className="region-goods">{goods.slice(0, 4).map(g => { const gain = exportGain(s, g, 'heartland', sel); return <button key={g} className={`btn ${g === routeGood ? 'gold' : 'ghost'}`} aria-pressed={g === routeGood} onClick={() => n.route ? act({ type: 'setRoute', to: sel, good: g, qty: n.route.qty }) : act({ type: 'setRoute', to: sel, good: g, qty: 500 })}><span>{GOODS[g].name}{g === who.wants ? ' ★' : ''}</span><small className={gain >= 0 ? 'good' : 'bad'}>{gain >= 0 ? '+' : ''}{price(gain)}/u</small></button>; })}</div> : <span className="muted">Nothing spare to send. Grow or process more goods first.</span>}
      {n.route && <Seg label="Daily load" value={n.route.qty} onChange={qty => act({ type: 'setRoute', to: sel, good: n.route!.good, qty })} options={QTY.map(q => ({ v: q, label: num(q) }))} />}
      <Info text="Caravans leave at dawn with spare stock (factory inputs and the larder are kept), pay freight and tariffs up front, and sell at the neighbour's market over the following hours. The per-unit figure is the extra you earn versus selling at home after freight and tariff. ★ marks the good they want: it earns double trust." />
    </div>}
    {tab === 'diplomacy' && <div className="stack">
      <div className="row wrap"><button className="btn primary" disabled={Math.floor(s.tick / 24) - n.giftDay < 7 || spare(who.wants) < giftQty} onClick={() => act({ type: 'giftNeighbour', to: sel, kind: 'goods' })}>🎁 {num(giftQty)} {GOODS[who.wants].name.toLowerCase()} · +8</button>
        <button className="btn" disabled={Math.floor(s.tick / 24) - n.giftDay < 7 || s.cash < giftValue(s)} onClick={() => act({ type: 'giftNeighbour', to: sel, kind: 'cash' })}>🪙 {money(giftValue(s))} · +5</button></div>
      <Confirm label={n.treaty ? '🤝 Treaty signed · no tariffs' : `🤝 Trade treaty · ${money(treatyCost(s))}`} title={`Sign a treaty with ${REGIONS[sel].name}?`} body={<>{money(treatyCost(s))} from company cash. Tariffs on your goods to {REGIONS[sel].name} are waived. If trust falls below {TREATY_TRUST - 20}, they tear it up.</>} disabled={n.treaty || n.trust < TREATY_TRUST || s.cash < treatyCost(s)} className="btn" onConfirm={() => act({ type: 'signTreaty', to: sel })} />
      {!n.treaty && n.trust < TREATY_TRUST && <small className="muted">Treaty needs trust {TREATY_TRUST}.</small>}
      <Info text="One gift per neighbour per week. Trust drifts slowly back toward each leader's natural attitude; a leader who fears your border policy settles 15 points lower. Delivered caravans are the steadiest way to earn trust." />
    </div>}
    {tab === 'defence' && <div className="stack">
      <article className="town-service"><div className="town-portrait"><b>🗼</b></div><div className="town-service-body"><h3>{SERVICE_DEFS.watchtower.name} {towers && <small>×{towers.count}</small>}</h3><strong>{num(staffedTowers(s), 1)} staffed · escort {pct0(protection(s))}</strong><span>👥 {SERVICE_DEFS.watchtower.jobs} militia jobs · {money(serviceDailyCost(s, 'watchtower'))}/day{v.border === 'walls' ? ` · tolls ${money(tollIncome(s))}/day` : ''}</span>
        <button className="btn primary" disabled={servicePrice(s, 'watchtower') > t.cash} onClick={() => act({ type: 'buildService', service: 'watchtower', district: 'farmgate' })}>Build · {money(servicePrice(s, 'watchtower'))}</button></div>
        {towers && <div className="town-service-status"><span>{!towers.active ? 'Paused' : towers.funded ? `${towers.staffed}/${SERVICE_DEFS.watchtower.jobs * towers.count} militia` : 'Needs funding or staff'}</span><button className="btn ghost" onClick={() => act({ type: 'toggleService', serviceId: towers.id })}>{towers.active ? 'Pause' : 'Resume'}</button></div>}</article>
      <div className="community-strip"><span><b>🏴 {pct0(raidRisk(s))}</b><small>raid risk</small></span><span><b>⚔ {v.raids}</b><small>raids</small></span><span><b>🐫 {num(v.caravans)}</b><small>caravans</small></span></div>
      <h3>{BORDERS[v.border!].icon} {BORDERS[v.border!].name}</h3>{borders(true)}
      <button className="btn ghost" onClick={() => go('city')}>🛡 City watch & police</button>
      {(regionOf(s).answered !== null) && <button className="btn ghost" onClick={() => go('nation')}>⚔ Nation</button>}
    </div>}
  </div>;
}
