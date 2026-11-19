import { nuisanceHappiness, NUISANCE_LOOK } from '../../simulation/nuisance';
import { act, go, startZoning, useGame } from '../../stores/game';
import { communityOf, familiesHere, HOME_DEFS, homeUnits, homeFamilies, homePrice, households, population } from '../../simulation/community-state';
import { canStartTown } from '../../simulation/stages/town';
import { townOf } from '../../simulation/town-state';
import { foodBill, foodDays } from '../../simulation/stages/settlement';
import { facilitiesMorale } from '../../simulation/operations';
import { CONFIG, WORK_HOURS } from '../../simulation/config';
import { marketWage } from '../../simulation/core';
import { worldOf } from '../../simulation/world';
import type { GameState, HomeTier } from '../../simulation/types';
import { portrait } from '../world/portrait';
import { Card, PageHead, Seg, Modal, usePref } from '../ui';
import { money, num, pct0 } from '../format';
import { BuildCard, NextStep, SettingRow, StatTile, toneOf } from './civic';

const STEPS = [0, 0.05, 0.1, 0.15, 0.2];
const UNLOCK: Record<HomeTier, number> = { cottage: 0, terrace: 40, apartment: 200 };

/** What the settlement costs each day and what the pay cut and housing tax bring back. */
function budget(s: GameState) {
  const c = communityOf(s), fam = c.families ?? {};
  const residents = s.workers.filter((w) => w.resident && fam[w.id] !== undefined);
  const base = residents.reduce((n, w) => n + (w.role === 'manager' ? CONFIG.managerWage * s.macro.cpi : marketWage(s, 'heartland')) * w.wageFactor * WORK_HOURS, 0);
  const cut = base * (c.payCut ?? 0), tax = base * (1 - (c.payCut ?? 0)) * (c.housingTax ?? 0);
  const upkeep = c.homes.reduce((n, h) => n + homeUnits(h) * 0.5, 0) * s.macro.cpi;
  return { cost: upkeep + foodBill(s), back: cut + tax + (c.foodPaid ?? 0), food: c.foodPaid ?? 0 };
}

export default function CommunityPage() {
  const s = useGame(), c = communityOf(s);
  if (!c.active) return <div className="community-page"><Modal title="Your hands miss their families" onClose={() => go('farm')} actions={<><button className="btn ghost" onClick={() => go('farm')}>Not yet</button><button className="btn primary" onClick={() => act({ type: 'startSettlement' })}>Bring the families</button></>}>
    <div className="civ-intro"><img src={portrait('home:cottage')} alt="" /><p>Your workers have been away from home a long time. Build them homes and their families will settle on your land.</p></div>
    <ol className="civ-steps">
      <li><b>Zone land</b> as residential with 🏘 on the map.</li>
      <li><b>Place homes</b> there: one family per cottage.</li>
      <li><b>Feed and warm them</b> from your stores. A pay cut or housing tax can cover the cost.</li>
    </ol>
  </Modal></div>;

  const here = familiesHere(s), room = homeFamilies(s), pop = population(s), free = room - households(s);
  const waiting = s.workers.filter((w) => w.region === 'heartland' && (c.families ?? {})[w.id] === undefined).length;
  const food = foodDays(s), cold = s.regions.heartland.temp < 10, zoned = Object.values(worldOf(s, 'heartland').zones).includes('res');
  const b = budget(s), net = b.back - b.cost;
  const tiers: HomeTier[] = townOf(s).active ? ['cottage', 'terrace', 'apartment'] : ['cottage', 'terrace'];
  const [many, setMany] = usePref<number>('homes.count', 1); // build 1, 5 or 10 at a time
  const place = (tier: HomeTier) => act({ type: 'buildHomes', tier, count: many });
  const cottage = homePrice(s, 'cottage');

  const next = !zoned ? <NextStep icon="🏘" title="Zone land for homes" text="Mark some of your cleared land residential. Homes can only stand there." action={<button className="btn primary" onClick={() => startZoning('heartland')}>Zone land</button>} />
    : waiting > free ? <NextStep icon="🏠" title={`${waiting - Math.max(0, free)} famil${waiting - Math.max(0, free) === 1 ? 'y is' : 'ies are'} waiting`} text="Each cottage houses one of your workers' families." action={<button className="btn primary" disabled={cottage > s.cash} onClick={() => place('cottage')}>Place cottage</button>} />
    : cold && c.warm < 0.8 ? <NextStep icon="🔥" tone="bad" title="Homes are cold" text={<>Below 10°C families burn diesel to keep warm.{c.autoLarder ? ' It is bought for them each day while you have the cash.' : ' Turn on stocking and it is bought for them.'}</>} action={!c.autoLarder && <button className="btn primary" onClick={() => act({ type: 'setLarder', enabled: true })}>Stock fuel</button>} />
    : c.fed < 0.9 || food < 2 ? <NextStep icon="🍞" tone="bad" title="The larder is running low" text="Families eat grain, bread, milk, eggs and meat from your stores. Keep some back from the market." action={!c.autoLarder && <button className="btn primary" onClick={() => act({ type: 'setLarder', enabled: true })}>Stock food</button>} />
    : canStartTown(s) ? <NextStep icon="🏛" tone="good" title="Newcomers want to settle" text="Families from outside will move in too once there is a town." action={<button className="btn gold" onClick={() => go('town')}>See the town</button>} />
    : here < 6 && !townOf(s).active ? <NextStep icon="👷" title={`Settle 6 families · ${here}/6`} text="Each farm hand you hire brings a family once there is a home for them." action={<button className="btn ghost" onClick={() => go('workers')}>Hire</button>} />
    : <NextStep icon="✓" tone="good" title="Everyone has a home" text="Hire more hands and their families will follow." />;

  return <div className="stack community-page">
    <PageHead title="Your settlement" sub={`${num(households(s))} famil${households(s) === 1 ? 'y' : 'ies'} · ${num(pop)} people`} />
    <div className="civ-tiles four">
      <StatTile icon="🏠" value={`${households(s)}/${room}`} label="homes filled" tone={waiting > free ? 'ok' : 'good'} />
      <StatTile icon="🍞" value={food >= 99 ? '99+' : num(food, 1)} label="days of food" tone={toneOf(food, 5, 2)} />
      <StatTile icon="🔥" value={cold ? pct0(c.warm) : '—'} label={cold ? 'warmth' : 'mild weather'} tone={cold ? toneOf(c.warm) : 'none'} />
      <StatTile icon="☺" value={pct0(c.happiness)} label="happiness" tone={toneOf(c.happiness, 0.7, 0.5)} />
    </div>
    {c.nuisance && nuisanceHappiness(c.nuisance) > 0.01 && <p className="small muted">{(['smell', 'noise', 'smoke'] as const).filter((k) => c.nuisance![k] > 0.02).map((k) => `${NUISANCE_LOOK[k].icon} ${NUISANCE_LOOK[k].name.toLowerCase()}`).join(' · ')} near the homes costs about {pct0(nuisanceHappiness(c.nuisance))} happiness. Keep pigsties, biogas and big mills away from them.</p>}
    {c.nuisance && c.nuisance.pleasant > 0.05 && nuisanceHappiness(c.nuisance) <= 0.01 && <p className="small muted">🍞 The bakery's fresh bread cheers the homes nearby.</p>}
    {next}
    {townOf(s).active && <button className="btn ghost civ-link" onClick={() => go('town')}>🏛 Town hall: schools, water, clinics →</button>}
    <Card title="Build homes" info="Homes only stand on land zoned residential. Each needs a road; a track is laid for it. Several at once go wherever there is room." actions={<Seg label="How many to build" value={many} onChange={setMany} options={[1, 5, 10].map((v) => ({ v, label: `×${v}` }))} />}>
      <div className="civ-builds">{tiers.map((tier) => {
        const d = HOME_DEFS[tier], price = homePrice(s, tier), lock = pop < UNLOCK[tier] ? `From ${UNLOCK[tier]} residents` : undefined;
        return <BuildCard key={tier} img={portrait(`home:${tier}`)} fallback="🏠" name={d.name} lines={[`${d.families} famil${d.families === 1 ? 'y' : 'ies'}`]} locked={lock}
          action={<button className="btn primary" disabled={price * many > s.cash || !zoned} title={!zoned ? 'Zone land residential first' : undefined} onClick={() => place(tier)}>{many > 1 ? `Place ${many}` : 'Place'} · {money(price * many)}</button>} />;
      })}</div>
    </Card>
    <Card title="Paying for it" info="Homes and food cost money. Families pay for their own food out of their savings (their wages); what they cannot pay, the farm carries. A pay cut, or a housing tax on the workers whose families live here, brings in more. Both cost morale; a home and a full larder make up for it.">
      <SettingRow name="Pay cut" effect={`morale −${Math.round((c.payCut ?? 0) * 80)}`}><Seg label="Pay cut" value={c.payCut ?? 0} onChange={(v) => act({ type: 'setSettlementPay', payCut: v })} options={STEPS.map((v) => ({ v, label: pct0(v) }))} /></SettingRow>
      <SettingRow name="Housing tax" effect={`morale −${Math.round((c.housingTax ?? 0) * 70)}`}><Seg label="Housing tax" value={c.housingTax ?? 0} onChange={(v) => act({ type: 'setSettlementPay', housingTax: v })} options={STEPS.map((v) => ({ v, label: pct0(v) }))} /></SettingRow>
      {townOf(s).active && <SettingRow name="Charge for town services" effect={`${(c.serviceFee ?? 0) > 0 ? `families pay ${money(Math.round(townOf(s).feesPaid ?? 0))}/day · ` : ''}morale −${Math.round((c.serviceFee ?? 0) * 15)}, happiness −${Math.round((c.serviceFee ?? 0) * 8)}`}><Seg label="Service fees" value={c.serviceFee ?? 0} onChange={(v) => act({ type: 'setSettlementPay', serviceFee: v })} options={[0, 0.25, 0.5, 0.75, 1].map((v) => ({ v, label: v ? `${Math.round(v * 100)}%` : 'Free' }))} /></SettingRow>}
      {townOf(s).active && <p className="small">Town facilities lift your settled workers' morale by <b>+{Math.round(facilitiesMorale(s) * 100)}</b>: schools, clinics, water, power, drains and parks in reach, and streets that flow{(townOf(s).jammed ?? 0) > 0.05 ? <>; <span className="down">{pct0(townOf(s).jammed ?? 0)} of families live on jammed streets</span></> : ''}. The better they are, the more tax or fees they will bear.</p>}
      <div className="civ-balance">
        <span>Costs</span><i className="down" style={{ width: `${(b.cost / Math.max(1, b.cost, b.back)) * 100}%` }} /><b>{money(Math.round(b.cost))}/day</b>
        <span>Recovered</span><i className="up" style={{ width: `${(b.back / Math.max(1, b.cost, b.back)) * 100}%` }} /><b>{money(Math.round(b.back))}/day</b>
      </div>
      {b.food > 0 && <p className="small muted">Families paid {money(Math.round(b.food))} for their own food yesterday.</p>}
      <p className={`small ${Math.abs(net) < Math.max(20, b.cost * 0.1) ? '' : net < 0 ? 'down' : 'up'}`}>{Math.abs(net) < Math.max(20, b.cost * 0.1) ? '⚖️ About break-even.' : net < 0 ? `Costs you about ${money(Math.round(-net))} a day. A home is worth +12 morale to each settled worker.` : `Brings in about ${money(Math.round(net))} a day, at a cost in morale.`}</p>
    </Card>
    <Card title="Larder">
      <SettingRow name="Stock food & fuel" effect="Keeps 3 days of food back from the market, and buys grain and heating diesel when short.">
        <button className={`btn ${c.autoLarder ? 'primary' : 'ghost'}`} aria-pressed={c.autoLarder} onClick={() => act({ type: 'setLarder', enabled: !c.autoLarder })}>{c.autoLarder ? 'On' : 'Off'}</button>
      </SettingRow>
    </Card>
    {c.cohorts.length > 0 && <Card title={`Who lives here · ${c.cohorts.length}`}><div className="civ-families">{c.cohorts.map((g) => <span key={g.id}><b>{g.name.replace(/^The | family.*$/g, '')}</b><small>{g.adults + g.children} · {g.name.includes('newcomers') ? 'newcomers' : g.name.includes('factory staff') ? 'factory staff' : 'your worker'}</small></span>)}</div></Card>}
  </div>;
}
