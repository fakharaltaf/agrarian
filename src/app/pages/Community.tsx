import { useState } from 'react';
import { act, go, useGame } from '../../stores/game';
import { communityOf, HOME_DEFS, homePrice, homeCapacity, households, population, availableResidents } from '../../simulation/community-state';
import { foodDays } from '../../simulation/stages/settlement';
import type { HomeTier } from '../../simulation/types';
import { Card, PageHead, Bar, Seg, Info, Modal } from '../ui';
import { money, num, pct0 } from '../format';
import { portrait } from '../world/portrait';

export default function CommunityPage() {
  const s = useGame(), c = communityOf(s);
  const [count, setCount] = useState(1);
  if (!c.active) return <div className="community-page"><Modal title="A place for families" onClose={() => go('farm')} actions={<button className="btn ghost" onClick={() => go('farm')}>Not yet</button>}>
    <p>Your workers want to build a life here.</p>
    <div className="charter-heading"><b>Choose your settlement charter</b><span>Permanent · existing staff keep their jobs</span></div>
    <div className="charter-grid">
      <article className="charter-tile"><div className="charter-crest">🏘️</div><h3>Company town</h3><p>You own the homes.</p><strong>Rent income · full building cost</strong><span>Happiness −4 points; rent uses residents’ earned savings.</span><button className="btn primary" onClick={() => act({ type: 'startSettlement', charter: 'company' })}>Found company town</button></article>
      <article className="charter-tile"><div className="charter-crest">🌳</div><h3>Free settlement</h3><p>Families put down roots.</p><strong>40% lower housing cost · no rent</strong><span>Happiness +4 points; you fund common land and services.</span><button className="btn gold" onClick={() => act({ type: 'startSettlement', charter: 'free' })}>Found free settlement</button></article>
    </div>
  </Modal></div>;
  const image = portrait('house');
  const nextTier: HomeTier = population(s) >= 200 ? 'apartment' : population(s) >= 40 ? 'terrace' : 'cottage';
  const nextHome = HOME_DEFS[nextTier];
  const nextPrice = homePrice(s, nextTier);
  return <div className="stack l community-page">
    <PageHead title="Your settlement" sub={c.charter === 'company' ? 'Company town' : 'Free settlement'} />
    {homeCapacity(s) - population(s) < 4 && <button className="btn primary community-next" disabled={nextPrice > s.cash} onClick={() => act({ type: 'buildHomes', tier: nextTier, count: 1 })}><span>🏠 Build 1 {nextHome.name.toLowerCase()} · +{nextHome.families * 4} places</span><b>{money(nextPrice)}</b></button>}
    {population(s) > 0 && <div className="community-strip"><span><b>🏘️ {population(s) >= 100000 ? `${num(population(s) / 1000)}k` : num(population(s))}</b><small>people</small></span><span><b>☺ {pct0(c.happiness)}</b><small>happiness</small></span><span><b>🍞 {foodDays(s) >= 99 ? '99+' : num(foodDays(s), 1)}</b><small>food days</small></span></div>}
    {c.homes.length > 0 && <Card title="Room to belong" coach="community-build" info="Each family has four people and two working adults. Existing employees remain commuters; new Heartland hires come from residents.">
      {population(s) > 0 && <div className="community-home-summary">{image ? <img src={image} alt="A cottage in your community" /> : <span>🏠</span>}<div><strong>{num(population(s))} / {num(homeCapacity(s))} places</strong><span>{num(availableResidents(s))} adults ready for work</span></div></div>}
      {c.homes.length > 0 && <Seg label="Homes to build" value={count} onChange={setCount} options={[1, 5, 10].map(v => ({ v, label: `×${v}` }))} />}
      <div className="community-homes">{(Object.keys(HOME_DEFS) as HomeTier[]).filter(t => t === 'cottage' || (t === 'terrace' ? population(s) >= 40 : population(s) >= 200)).map(tier => {
        const d = HOME_DEFS[tier], price = homePrice(s, tier) * count;
        return <article key={tier} className="community-home"><span>{tier === 'cottage' ? '🏠' : tier === 'terrace' ? '🏘️' : '🏢'}</span><b>{d.name}</b><span>{d.families * 4 * count} places · {money(price)}</span><button className="btn primary" disabled={price > s.cash} onClick={() => act({ type: 'buildHomes', tier, count })}>Build {count > 1 ? count : ''}</button></article>;
      })}</div>
    </Card>}
    {population(s) > 0 && <Card title="Keep the table set" coach="community-larder" info="Families eat 2,000 kcal per person each day. The larder policy protects three days of food against automated sales and buys affordable food or winter fuel when needed.">
      <div className="community-needs">{[['🍞 Food', c.fed], ['🔥 Warmth', c.warm], ['☺ Happiness', c.happiness]].map(([name, value]) => <div key={String(name)}><div className="row between"><b>{name}</b><span>{pct0(Number(value))}</span></div><Bar value={Number(value)} label={String(name)} /></div>)}</div>
      <button className={`btn ${c.autoLarder ? 'primary' : 'ghost'}`} aria-pressed={c.autoLarder} onClick={() => act({ type: 'setLarder', enabled: !c.autoLarder })}>{c.autoLarder ? '✓' : '○'} Keep 3 days of food</button>
    </Card>}
    {population(s) > 0 && <Card title={<>Your neighbours · {num(households(s))} families <Info text="The first 50 families are named. Later arrivals are grouped so large towns stay responsive." /></>}>
      <details className="field-details"><summary>Meet the families</summary><div className="community-families">{c.cohorts.slice(0, 50).map(group => <span key={group.id}>🏠 {group.name}{group.households > 1 ? ` · ${num(group.households)} families` : ''}</span>)}</div></details>
      {!c.cohorts.length && <p className="muted">Build the first cottage. A family will arrive if there is room and life is good.</p>}
      {c.cohorts.length > 50 && <p className="muted">+ {num(c.cohorts.slice(50).reduce((n,g)=>n+g.households,0))} families in the growing neighbourhood</p>}
    </Card>}
  </div>;
}
