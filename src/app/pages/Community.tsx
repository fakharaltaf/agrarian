import { act, go, useGame } from '../../stores/game';
import { communityOf, familiesHere, HOME_DEFS, homeFamilies, homePrice, population } from '../../simulation/community-state';
import { canStartTown } from '../../simulation/stages/town';
import { townOf } from '../../simulation/town-state';
import { foodDays } from '../../simulation/stages/settlement';
import { CONFIG, GOODS, WORK_HOURS } from '../../simulation/config';
import { marketWage } from '../../simulation/core';
import type { GameState, HomeTier } from '../../simulation/types';
import { Card, PageHead, Bar, Seg, Modal } from '../ui';
import { money, num, pct0 } from '../format';

const STEPS = [0, 0.05, 0.1, 0.15, 0.2];

/** What the settlement costs each day and what the pay cut and housing tax bring back. */
function budget(s: GameState) {
  const c = communityOf(s), fam = c.families ?? {};
  const residents = s.workers.filter((w) => w.resident && fam[w.id] !== undefined);
  const base = residents.reduce((n, w) => n + (w.role === 'manager' ? CONFIG.managerWage * s.macro.cpi : marketWage(s, 'heartland')) * w.wageFactor * WORK_HOURS, 0);
  const cut = base * (c.payCut ?? 0), tax = base * (1 - (c.payCut ?? 0)) * (c.housingTax ?? 0);
  const upkeep = c.homes.reduce((n, h) => n + HOME_DEFS[h.tier].families * h.count * 0.5, 0) * s.macro.cpi;
  const food = (population(s) * 2000 / GOODS.wheat.kcal) * (s.markets.heartland.wheat?.price ?? GOODS.wheat.basePrice);
  return { cost: upkeep + food, back: cut + tax };
}

export default function CommunityPage() {
  const s = useGame(), c = communityOf(s);
  if (!c.active) return <div className="community-page"><Modal title="Your hands miss their families" onClose={() => go('farm')} actions={<button className="btn ghost" onClick={() => go('farm')}>Not yet</button>}>
    <p>Your workers have been away from home for a long time. If you build them a place to live, their families will come and settle on your land.</p>
    <ul className="small">
      <li>Buy and clear land, then zone it <b>residential</b> (🏘 on the map). Homes go there, not fields.</li>
      <li>Each family is one of your workers plus 2–4 relatives. One family per cottage.</li>
      <li>You feed them from your stores. A small pay cut or housing tax can cover the cost.</li>
    </ul>
    <button className="btn primary" onClick={() => act({ type: 'startSettlement' })}>Bring the families</button>
  </Modal></div>;
  const here = familiesHere(s), room = homeFamilies(s), waiting = s.workers.filter((w) => w.region === 'heartland' && (c.families ?? {})[w.id] === undefined).length;
  const b = budget(s), net = b.back - b.cost;
  const tiers: HomeTier[] = ['cottage', 'terrace'];
  return <div className="stack l community-page">
    <PageHead title="Your settlement" sub={`${here} famil${here === 1 ? 'y' : 'ies'} · ${num(population(s))} people`} />
    {(canStartTown(s) || townOf(s).active) && <button className="btn gold community-next" onClick={() => go('town')}>📚 {townOf(s).active ? 'Town hall · services & budget' : 'Newcomers want to settle too · preview Town'}</button>}
    <div className="community-strip">
      <span><b>🏠 {here}/{room}</b><small>families housed</small></span>
      <span><b>⏳ {waiting}</b><small>still waiting</small></span>
      <span><b>🍞 {foodDays(s) >= 99 ? '99+' : num(foodDays(s), 1)}</b><small>food days</small></span>
    </div>
    <Card title="Homes" info="Homes only stand on land zoned residential. Use 🏘 on the map to zone land you own.">
      {waiting > room - here && <p className="small">{waiting - Math.max(0, room - here)} famil{waiting - Math.max(0, room - here) === 1 ? 'y is' : 'ies are'} waiting for a home.</p>}
      <div className="community-homes">{tiers.map((tier) => {
        const d = HOME_DEFS[tier], price = homePrice(s, tier);
        return <article key={tier} className="community-home"><span>{tier === 'cottage' ? '🏠' : '🏘️'}</span><b>{d.name}</b><span>{d.families} famil{d.families === 1 ? 'y' : 'ies'} · {money(price)}</span><button className="btn primary" disabled={price > s.cash} onClick={() => act({ type: 'buildHomes', tier, count: 1 })}>Build</button></article>;
      })}</div>
    </Card>
    <Card title="Paying for it" info="Homes and food cost you money. A pay cut on the workers whose families live here, or a housing tax on them, brings it back. Both cost morale, which a home and a full larder make up.">
      <Seg label="Pay cut" value={c.payCut ?? 0} onChange={(v) => act({ type: 'setSettlementPay', payCut: v })} options={STEPS.map((v) => ({ v, label: pct0(v) }))} />
      <Seg label="Housing tax" value={c.housingTax ?? 0} onChange={(v) => act({ type: 'setSettlementPay', housingTax: v })} options={STEPS.map((v) => ({ v, label: pct0(v) }))} />
      <div className="adv-bars small">
        <span>Costs</span><i className="down" style={{ width: `${(b.cost / Math.max(1, b.cost, b.back)) * 100}%` }} /><b>{money(Math.round(b.cost))}/day</b>
        <span>Recovered</span><i style={{ width: `${(b.back / Math.max(1, b.cost, b.back)) * 100}%` }} /><b>{money(Math.round(b.back))}/day</b>
      </div>
      <p className="small">{Math.abs(net) < Math.max(20, b.cost * 0.1) ? '⚖️ About break-even.' : net < 0 ? `The settlement costs you about ${money(Math.round(-net))} a day.` : `The settlement brings in about ${money(Math.round(net))} a day, at a cost in morale.`}</p>
      <p className="small muted">Morale of settled workers: home +12 · food up to +5 · pay cut −{Math.round((c.payCut ?? 0) * 80)} · housing tax −{Math.round((c.housingTax ?? 0) * 70)}</p>
    </Card>
    {population(s) > 0 && <Card title="Keep the table set" info="Families eat 2,000 kcal per person each day from your stores. Keeping three days of food set aside stops managers selling it.">
      <div className="community-needs">{[['🍞 Food', c.fed], ['🔥 Warmth', c.warm], ['☺ Happiness', c.happiness]].map(([name, value]) => <div key={String(name)}><div className="row between"><b>{name}</b><span>{pct0(Number(value))}</span></div><Bar value={Number(value)} label={String(name)} /></div>)}</div>
      <button className={`btn ${c.autoLarder ? 'primary' : 'ghost'}`} aria-pressed={c.autoLarder} onClick={() => act({ type: 'setLarder', enabled: !c.autoLarder })}>{c.autoLarder ? '✓' : '○'} Keep 3 days of food</button>
    </Card>}
    {c.cohorts.length > 0 && <Card title="Who lives here"><div className="community-families">{c.cohorts.map((g) => <span key={g.id}>🏠 {g.name} · {g.adults + g.children}</span>)}</div></Card>}
  </div>;
}
