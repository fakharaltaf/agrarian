import { useState } from 'react';
import { act, go, useGame } from '../../stores/game';
import { DRILLS, drillPower, nationOf, RATIONS_PER_SOLDIER, type NationPath, type Stance } from '../../simulation/nation-state';
import { ALLY_TRUST, allyCharterCost, armyStrength, campaignOdds, defenceOf, drillCost, expectedLosses, indemnity, mediationCost, mercenaryCost, pathGuard, plunder, soldiers, spyCost, vassalDaily } from '../../simulation/stages/nation';
import { raidRisk } from '../../simulation/stages/region';
import { attitude, NEIGHBOUR_IDS, NEIGHBOURS, regionOf, type NeighbourId } from '../../simulation/region-state';
import { plannedServiceCost, serviceDailyCost } from '../../simulation/stages/town';
import { SERVICE_DEFS, servicePrice, townOf } from '../../simulation/town-state';
import { REGIONS } from '../../simulation/config';
import { Bar, Confirm, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0, plural } from '../format';

const PATHS: Record<NationPath, { icon: string; name: string; line: string; detail: string; ready: boolean }> = {
  army: { icon: '⚔', name: 'Army', line: 'Strength through soldiers', detail: 'Barracks, rations, drills and campaigns', ready: true },
  alliance: { icon: '🤝', name: 'Alliance', line: 'A league of neighbours', detail: 'Allies guard your roads · you answer their calls', ready: true },
  neutrality: { icon: '🕊', name: 'Neutrality', line: 'Indispensable, never armed', detail: 'Feed the region · embargo, spies, mediation', ready: true },
};

export default function NationPage() {
  const s = useGame(), v = nationOf(s), t = townOf(s), r = regionOf(s);
  const [target, setTarget] = useState<NeighbourId>('river'), [stance, setStance] = useState<Stance>('raid');
  if (!v.active) return <Modal title="A nation takes shape" onClose={() => go('farm')}><div className="charter-heading"><b>Choose your path</b><span>Your farm, town and region keep running</span></div>
    <div className="charter-grid">{(Object.keys(PATHS) as NationPath[]).map(id => { const p = PATHS[id]; return <article className="charter-tile" key={id}><div className="charter-crest">{p.icon}</div><h3>{p.name}</h3><strong>{p.line}</strong><span>{p.detail}</span>
      <button className="btn primary" aria-label={`Choose ${p.name}`} disabled={!p.ready} onClick={() => act({ type: 'startNation', path: id })}>{p.ready ? 'Choose' : 'Coming soon'}</button></article>; })}</div></Modal>;

  if (v.path === 'alliance') return <LeagueRoom />;
  if (v.path === 'neutrality') return <EmbassyRoom />;
  const men = soldiers(s), strength = armyStrength(s), barracks = t.services.find(b => b.type === 'barracks');
  const upkeep = plannedServiceCost(s), topUp = Math.ceil(Math.max(0, upkeep * 14 - t.cash) / 100) * 100;
  const odds = campaignOdds(s, target, stance), next = DRILLS[v.drill], war = v.campaign;
  return <div className="stack town-page nation-page"><PageHead title="War room" />
    <div className="town-purse"><b>🪙 {money(t.cash)}</b><span>⚔ {num(strength)} strength</span><Info text={`Strength = soldiers × drill (${drillPower(v.drill)}×) × morale × rations. Soldiers are local adults paid from the town treasury; each eats ${RATIONS_PER_SOLDIER} units of grain or bread a day from spare stock.`} /></div>
    {t.cash < upkeep * 7 && <button className="btn primary community-next" onClick={() => topUp > s.cash ? go(s.corp.incorporated ? 'corporation' : 'finance') : act({ type: 'fundTown', amount: topUp, direction: 'toTown' })}><span>🪙 {t.cash < upkeep ? 'Treasury empty: soldiers go unpaid' : 'Fund two weeks of public services'}</span><b>{money(topUp)}</b></button>}
    <div className="community-strip"><span><b>🪖 {num(men)}</b><small>soldiers</small></span><span><b>🍞 {pct0(v.supply)}</b><small>rations</small></span><span><b>☺ {pct0(v.morale)}</b><small>morale</small></span></div>
    {war ? <article className="city-case region-alert"><h3>⚔ {war.stance === 'siege' ? 'Siege of' : 'Raid on'} {REGIONS[war.target].name}</h3><strong>{num(war.soldiers)} soldiers · {Math.max(0, Math.ceil((war.ends - s.tick) / 24))} days to go</strong>
      <Bar value={(s.tick - war.started) / Math.max(1, war.ends - war.started)} label="Campaign progress" /><span>Odds today {pct0(campaignOdds(s, war.target, war.stance))}. Keep rations flowing: hungry soldiers lose.</span></article>
      : <article className="city-case"><h3>🗺 Plan a campaign</h3>
        <div className="nation-targets" role="radiogroup" aria-label="Campaign target">{NEIGHBOUR_IDS.map(id => <button key={id} role="radio" aria-checked={id === target} className={`btn ${id === target ? 'gold' : 'ghost'}`} disabled={v.vassal?.from === id} onClick={() => setTarget(id)}>
          <span>{NEIGHBOURS[id].icon} {REGIONS[id].name.split(' ')[0]}</span><small>🛡 {num(defenceOf(s, id))} · {attitude(r.neighbours[id].trust)}</small></button>)}</div>
        <Seg label="Stance" value={stance} onChange={setStance} options={[{ v: 'raid', label: 'Raid · 7 days' }, { v: 'siege', label: 'Siege · 14 days' }]} />
        <div className="nation-odds"><b className={odds >= .6 ? 'good' : odds >= .4 ? '' : 'bad'}>{pct0(odds)}</b><span>chance to win</span></div>
        <span>Win: {stance === 'raid' ? `${money(plunder(s, target))} plunder` : `${money(vassalDaily(s, target))}/day tribute for 90 days, no tariffs`} · lose ~{plural(expectedLosses(s, stance, true), 'soldier')}</span>
        <span>Lose: {money(indemnity(s, target))} indemnity · lose ~{plural(expectedLosses(s, stance, false), 'soldier')}</span>
        <Confirm label={`⚔ March on ${REGIONS[target].name}`} title={`${stance === 'siege' ? 'Besiege' : 'Raid'} ${REGIONS[target].name}?`} body={<>{pct0(odds)} chance to win. Casualties are residents you lose. Every other neighbour's trust falls; caravans to {REGIONS[target].name} halt until the army returns. War weariness lowers happiness.</>}
          disabled={men < 1 || v.vassal?.from === target} className="btn primary" confirmLabel="March" onConfirm={() => act({ type: 'launchCampaign', target, stance })} />
        {men < 1 && <small className="muted">Build and staff barracks first.</small>}
      </article>}
    <article className="town-service"><div className="town-portrait"><b>⚔</b></div><div className="town-service-body"><h3>{SERVICE_DEFS.barracks.name} {barracks && <small>×{barracks.count}</small>}</h3><strong>{SERVICE_DEFS.barracks.jobs} soldiers each · {money(serviceDailyCost(s, 'barracks'))}/day</strong>
      <button className="btn primary" disabled={servicePrice(s, 'barracks') > t.cash} onClick={() => act({ type: 'buildService', service: 'barracks', district: 'farmgate' })}>Build · {money(servicePrice(s, 'barracks'))}</button></div>
      {barracks && <div className="town-service-status"><span>{!barracks.active ? 'Stood down' : barracks.funded ? `${barracks.staffed}/${SERVICE_DEFS.barracks.jobs * barracks.count} soldiers` : 'Needs funding or recruits'}</span><button className="btn ghost" onClick={() => act({ type: 'toggleService', serviceId: barracks.id })}>{barracks.active ? 'Stand down' : 'Muster'}</button></div>}</article>
    <div className="row wrap">{next ? <Confirm label={v.drillUntil >= 0 ? `${next.icon} ${next.name} · ${Math.ceil((v.drillUntil - s.tick) / 24)} days` : `${next.icon} ${next.name} · ${money(drillCost(s))}`} title={`Begin ${next.name}?`} body={<>{money(drillCost(s))} from the treasury · {next.days} days. Army strength {drillPower(v.drill)}× → {next.power}×.</>} disabled={v.drillUntil >= 0 || t.cash < drillCost(s)} className="btn" onConfirm={() => act({ type: 'trainArmy' })} /> : <span className="pill">🎖 Fully drilled · {drillPower(v.drill)}×</span>}</div>
    {v.vassal && <div className="town-service-status"><span>👑 {REGIONS[v.vassal.from].name} pays {money(v.vassal.daily)}/day · {Math.ceil((v.vassal.until - s.tick) / 24)} days left</span></div>}
    <div className="community-strip"><span><b>🏆 {v.wins}</b><small>won</small></span><span><b>✝ {num(v.casualties)}</b><small>fallen</small></span><span><b>😩 {pct0(v.weariness)}</b><small>weariness</small></span></div>
    {v.history.length > 0 && <details className="town-budget"><summary>📜 Campaigns · {v.history.length}</summary><div className="stack">{[...v.history].reverse().map((h, i) => <div className="town-cash-flow" key={i}><span>{h.won ? '🏆' : '✖'} {h.stance} · {REGIONS[h.target].name}<b>{h.lost} fallen</b></span><span>{h.spoils >= 0 ? 'Spoils' : 'Indemnity'}<b>{money(Math.abs(h.spoils))}</b></span></div>)}</div></details>}
    <button className="btn ghost" onClick={() => go('region')}>🗺 Region map & caravans</button>
  </div>;
}

function Purse() {
  const s = useGame(), t = townOf(s), upkeep = plannedServiceCost(s), topUp = Math.ceil(Math.max(0, upkeep * 14 - t.cash) / 100) * 100;
  return <>
    <div className="town-purse"><b>🪙 {money(t.cash)}</b><span>🛡 {pct0(pathGuard(s))} path guard</span><Info text={`Extra road protection from your path. Today's daily raid risk per caravan: ${pct0(raidRisk(s))}.`} /></div>
    {t.cash < upkeep * 7 && <button className="btn primary community-next" onClick={() => topUp > s.cash ? go(s.corp.incorporated ? 'corporation' : 'finance') : act({ type: 'fundTown', amount: topUp, direction: 'toTown' })}><span>🪙 Fund two weeks of public services</span><b>{money(topUp)}</b></button>}
  </>;
}
const days = (s: ReturnType<typeof useGame>, until: number) => Math.max(0, Math.ceil((until - s.tick) / 24));

function LeagueRoom() {
  const s = useGame(), L = nationOf(s).league, r = regionOf(s);
  return <div className="stack town-page nation-page"><PageHead title="League hall" /><Purse />
    <div className="community-strip"><span><b>🤝 {L.members.length}</b><small>members</small></span><span><b>🔗 {pct0(L.cohesion)}</b><small>cohesion</small></span><span><b>🎁 {money(L.aid)}</b><small>aid sent</small></span></div>
    {L.request && <article className="city-case region-alert"><h3>{NEIGHBOURS[L.request.from].icon} {NEIGHBOURS[L.request.from].leader} asks for help</h3><strong>{L.request.kind === 'grain' ? `${num(L.request.amount)} grain or bread` : money(L.request.amount)} · {days(s, L.request.deadline)} days</strong><span>Answering: +10 trust, cohesion up. Refusing: −20 trust; members may leave.</span>
      <div className="row wrap"><button className="btn primary" onClick={() => act({ type: 'answerAid', send: true })}>Send aid</button><button className="btn ghost" onClick={() => act({ type: 'answerAid', send: false })}>Refuse</button></div></article>}
    {L.vote && <article className="city-case region-alert"><h3>🗳 Sanctions on {REGIONS[L.vote.target].name}?</h3><span>Yes: their caravans close for 60 days, fewer bandits, they resent you. No: cohesion falls.</span>
      <div className="row wrap"><button className="btn primary" onClick={() => act({ type: 'castVote', yes: true })}>Vote yes</button><button className="btn ghost" onClick={() => act({ type: 'castVote', yes: false })}>Vote no</button></div></article>}
    {L.sanction && <div className="town-service-status"><span>🚫 {REGIONS[L.sanction.target].name} under sanctions · {days(s, L.sanction.until)} days</span></div>}
    <div className="stack">{NEIGHBOUR_IDS.map(id => { const n = r.neighbours[id], member = L.members.includes(id); return <div className="town-service-status" key={id}>
      <span>{NEIGHBOURS[id].icon} {REGIONS[id].name} · {attitude(n.trust)} {Math.round(n.trust)}{member ? ' · 🤝 member' : ''}</span>
      {!member && <Confirm label={`Invite · ${money(allyCharterCost(s))}`} title={`Invite ${REGIONS[id].name} into the league?`} body={<>{money(allyCharterCost(s))} charter. Members trade tariff-free and patrol your roads; they will ask you for grain or cash when in trouble.</>} disabled={n.trust < ALLY_TRUST || s.cash < allyCharterCost(s)} onConfirm={() => act({ type: 'inviteAlly', to: id })} />}
    </div>; })}</div>
    <small className="muted">Invites need trust {ALLY_TRUST}. Trade and gifts on the Region map build it.</small>
    <button className="btn ghost" onClick={() => go('region')}>🗺 Region map & caravans</button>
  </div>;
}

function EmbassyRoom() {
  const s = useGame(), N = nationOf(s).neutral, r = regionOf(s), t = townOf(s), intel = s.tick < N.intelUntil;
  const [target, setTarget] = useState<NeighbourId>('arid');
  const fed = NEIGHBOUR_IDS.filter(id => r.neighbours[id].route && N.embargo?.target !== id).length;
  return <div className="stack town-page nation-page"><PageHead title="Embassy" /><Purse />
    <div className="community-strip"><span><b>🌾 {fed}/4</b><small>fed by you</small></span><span><b>🕊 {N.mediated}</b><small>mediated</small></span><span><b>🏴 {intel ? pct0(raidRisk(s)) : '?'}</b><small>raid risk</small></span></div>
    {N.dispute && <article className="city-case region-alert"><h3>⚖ {REGIONS[N.dispute.a].name} vs {REGIONS[N.dispute.b].name}</h3><span>Mediate: both +10 trust. Ignore: bandits rise when they fight · {days(s, N.dispute.deadline)} days</span>
      <button className="btn primary" disabled={s.cash < mediationCost(s)} onClick={() => act({ type: 'mediate' })}>Mediate · {money(mediationCost(s))}</button></article>}
    <article className="city-case"><h3>🌾 Food embargo</h3>
      {N.embargo ? <><strong>{REGIONS[N.embargo.target].name} · day {Math.floor((s.tick - N.embargo.since) / 24)}</strong><span>They concede faster the more they rely on your caravans.</span><button className="btn ghost" onClick={() => act({ type: 'setEmbargo', target: null })}>Lift embargo</button></>
        : <><div className="nation-targets" role="radiogroup" aria-label="Embargo target">{NEIGHBOUR_IDS.map(id => <button key={id} role="radio" aria-checked={id === target} className={`btn ${id === target ? 'gold' : 'ghost'}`} onClick={() => setTarget(id)}><span>{NEIGHBOURS[id].icon} {REGIONS[id].name.split(' ')[0]}</span><small>{attitude(r.neighbours[id].trust)} · {r.neighbours[id].delivered > 0 ? 'relies on you' : 'not fed'}</small></button>)}</div>
          <Confirm label={`Embargo ${REGIONS[target].name}`} title={`Embargo ${REGIONS[target].name}?`} body={<>Your caravans stop. Their trust falls daily. After {r.neighbours[target].delivered > 0 ? 20 : 40} days they concede: their raiders stand down and any tribute demand is dropped.</>} className="btn" onConfirm={() => act({ type: 'setEmbargo', target })} /></>}
    </article>
    <div className="row wrap">
      <Confirm label={intel ? `🕵 Spies · ${days(s, N.intelUntil)} days` : `🕵 Spies · ${money(spyCost(s))}`} title="Fund an intelligence network?" body={<>{money(spyCost(s))} from the treasury for 60 days. Reveals raid risk and warns of demands early.</>} disabled={t.cash < spyCost(s)} className="btn" onConfirm={() => act({ type: 'hireSpies' })} />
      <Confirm label={s.tick < N.mercenariesUntil ? `🗡 Mercenaries · ${days(s, N.mercenariesUntil)} days` : `🗡 Mercenaries · ${money(mercenaryCost(s))}`} title="Hire mercenaries?" body={<>{money(mercenaryCost(s))} for 30 days of armed escorts: +30% road protection. Expensive by design: neutrality's safety is supposed to come from goodwill.</>} disabled={s.cash < mercenaryCost(s)} className="btn" onConfirm={() => act({ type: 'hireMercenaries' })} />
    </div>
    <small className="muted">Each neighbour you supply by caravan adds 6% road protection.</small>
    <button className="btn ghost" onClick={() => go('region')}>🗺 Region map & caravans</button>
  </div>;
}
