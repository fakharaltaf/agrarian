import { useState } from 'react';
import { act, go, useGame } from '../../stores/game';
import { DRILLS, drillPower, nationOf, RATIONS_PER_SOLDIER, type NationPath, type Stance } from '../../simulation/nation-state';
import { armyStrength, campaignOdds, defenceOf, drillCost, expectedLosses, indemnity, plunder, soldiers, vassalDaily } from '../../simulation/stages/nation';
import { attitude, NEIGHBOUR_IDS, NEIGHBOURS, regionOf, type NeighbourId } from '../../simulation/region-state';
import { plannedServiceCost, serviceDailyCost } from '../../simulation/stages/town';
import { SERVICE_DEFS, servicePrice, townOf } from '../../simulation/town-state';
import { REGIONS } from '../../simulation/config';
import { Bar, Confirm, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0, plural } from '../format';

const PATHS: Record<NationPath, { icon: string; name: string; line: string; detail: string; ready: boolean }> = {
  army: { icon: '⚔', name: 'Army', line: 'Strength through soldiers', detail: 'Barracks, rations, drills and campaigns', ready: true },
  alliance: { icon: '🤝', name: 'Alliance', line: 'A league of neighbours', detail: 'Coming in a later update', ready: false },
  neutrality: { icon: '🕊', name: 'Neutrality', line: 'Indispensable, never armed', detail: 'Coming in a later update', ready: false },
};

export default function NationPage() {
  const s = useGame(), v = nationOf(s), t = townOf(s), r = regionOf(s);
  const [target, setTarget] = useState<NeighbourId>('river'), [stance, setStance] = useState<Stance>('raid');
  if (!v.active) return <Modal title="A nation takes shape" onClose={() => go('farm')}><div className="charter-heading"><b>Choose your path</b><span>Your farm, town and region keep running</span></div>
    <div className="charter-grid">{(Object.keys(PATHS) as NationPath[]).map(id => { const p = PATHS[id]; return <article className="charter-tile" key={id}><div className="charter-crest">{p.icon}</div><h3>{p.name}</h3><strong>{p.line}</strong><span>{p.detail}</span>
      <button className="btn primary" aria-label={`Choose ${p.name}`} disabled={!p.ready} onClick={() => act({ type: 'startNation', path: id })}>{p.ready ? 'Choose' : 'Coming soon'}</button></article>; })}</div></Modal>;

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
