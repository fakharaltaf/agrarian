import { useState } from 'react';
import { act, go, setCrimeMap, startPipes, useGame } from '../../stores/game';
import { population } from '../../simulation/community-state';
import { cityOf, POLICE_CHARTERS, type PoliceCharter } from '../../simulation/city-state';
import { caseCost, cityTrainingCost, policeReformCost } from '../../simulation/stages/city';
import { OFFICE_JOBS, PARKING_SHARE, serviceJobs, servicePrice, serviceRadius, townOf } from '../../simulation/town-state';
import { serviceDailyCost } from '../../simulation/stages/town';
import { GOODS } from '../../simulation/config';
import { Bar, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0 } from '../format';
import { portrait } from '../world/portrait';
import { BuildCard, NextStep, SettingRow, StatTile, toneOf } from './civic';
import { ShopsSection } from './Shops';

const CHARTER_LINE: Record<PoliceCharter, [string, string]> = {
  watch: ['3 staff a watchhouse · neighbours keep watch', 'Works best in a happy, schooled town'],
  professional: ['6 staff a watchhouse · trained officers', 'Balanced cost and freedom'],
  strict: ['9 staff a watchhouse · firm control', 'Cuts the most crime · families less happy'],
};
const CASE_LOOK = { theft: ['📦', 'Theft'], smuggling: ['🚚', 'Smuggling'], gang: ['⚠', 'A gang moved in'] } as const;

export default function CityPage() {
  const s = useGame(), v = cityOf(s), t = townOf(s);
  const [reform, setReform] = useState(false);
  const charters = (changing: boolean) => <div className="charter-grid city-charters">{(Object.keys(POLICE_CHARTERS) as PoliceCharter[]).map((id) => {
    const d = POLICE_CHARTERS[id];
    return <article className="charter-tile" key={id}><div className="charter-crest">{d.icon}</div><h3>{d.name}</h3><strong>{CHARTER_LINE[id][0]}</strong><span>{CHARTER_LINE[id][1]}</span>
      <button className="btn primary" aria-label={`${changing ? 'Reform to' : 'Choose'} ${d.name}`} disabled={changing && (v.charter === id || s.cash < policeReformCost(s))} onClick={() => { if (act(changing ? { type: 'changePolice', charter: id } : { type: 'startCity', charter: id })) setReform(false); }}>{changing ? (v.charter === id ? 'Current' : `Reform · ${money(policeReformCost(s))}`) : 'Choose'}</button></article>;
  })}</div>;

  if (!v.active) return <div className="town-page"><Modal title="A city worth protecting" onClose={() => go('farm')}>
    <div className="civ-intro"><img src={portrait('civic:police')} alt="" /><p>Your town is becoming a city. More people and more wealth bring crime: thefts from your stores, smugglers, even gangs.</p></div>
    <ol className="civ-steps">
      <li><b>Lit streets are safer:</b> homes on your power lines see less crime.</li>
      <li><b>A watchhouse</b> cuts crime on the streets within its reach. Place it where the 🛡 crime map shows red.</li>
      <li><b>Jobs, schools and happy homes</b> prevent crime before it starts. The farm pays for the watch.</li>
    </ol>
    <div className="charter-heading"><b>How will your city keep order?</b><span>You can reform it later · {money(policeReformCost(s))}</span></div>
    {charters(false)}
  </Modal></div>;

  const pop = population(s), homes = v.homes ?? [], families = homes.reduce((n, h) => n + h.families, 0);
  const unsafe = families ? homes.filter((h) => (v.homeCrime?.[h.id] ?? 0) > 0.2).reduce((n, h) => n + h.families, 0) / families : 0;
  const lit = t.power ?? 0, stations = t.services.filter((b) => b.type === 'police'), charter = POLICE_CHARTERS[v.charter ?? 'watch'];
  const idle = stations.find((b) => b.active && b.staffed < serviceJobs(s, 'police') * b.count), paused = stations.find((b) => !b.active);
  const price = servicePrice(s, 'police'), place = () => act({ type: 'buildService', service: 'police', district: 'farmgate' });
  const offices = t.services.filter((b) => b.type === 'office'), parkings = t.services.filter((b) => b.type === 'parking').length, slowTiles = Object.keys(t.traffic ?? {}).length;
  const showMap = () => { setCrimeMap(true); go('farm'); };
  const days = v.case ? Math.max(0, Math.ceil((v.case.deadline - s.tick) / 24)) : 0;

  const next = v.case
    ? <NextStep icon={CASE_LOOK[v.case.kind][0]} tone="bad" title={`${CASE_LOOK[v.case.kind][1]} · ${num(v.case.lost)} ${GOODS[v.case.good].name.toLowerCase()} stolen`}
      text={<>{v.case.kind === 'gang' ? 'Families grow unhappier each day until you answer. ' : v.case.kind === 'smuggling' ? 'Town shops buy 30% less from you until you answer. ' : ''}{days} day{days === 1 ? '' : 's'} left, then your default ({v.justice === 'rehabilitate' ? 'rehabilitate' : 'punish'}) applies.</>}
      action={<div className="row wrap civ-case-acts">{(['rehabilitate', 'punish'] as const).map((answer) => <button key={answer} className={`btn ${answer === 'rehabilitate' ? 'primary' : 'ghost'}`} disabled={s.cash < caseCost(s, answer)} title={answer === 'rehabilitate' ? 'Builds lasting prevention' : 'Crime drops now; families a little less happy'} onClick={() => act({ type: 'resolveCityCase', answer })}>{answer === 'rehabilitate' ? 'Rehabilitate' : 'Punish'} · {money(caseCost(s, answer))}</button>)}</div>} />
    : paused ? <NextStep icon="⏸" tone="bad" title="A watchhouse is closed" text="Its streets have no watch until you reopen it." action={<button className="btn primary" onClick={() => act({ type: 'toggleService', serviceId: paused.id })}>Reopen</button>} />
    : !stations.length ? <NextStep icon="🛡" title={v.crime > 0.1 ? `Crime is ${pct0(v.crime)}: place your first watchhouse` : 'Place your first watchhouse'} text={`It cuts crime on the streets within ${Math.round(serviceRadius({ type: 'police' }))} tiles. Put it among the homes.`} action={<button className="btn primary" disabled={price > s.cash} onClick={place}>Place · {money(price)}</button>} />
    : idle ? <NextStep icon="👥" tone="bad" title="Watchhouses are short of officers" text="Officers come from your own families. Build homes so more adults move in." action={<button className="btn primary" onClick={() => go('community')}>Build homes</button>} />
    : v.crime <= 0.2 ? <NextStep icon="✓" tone="good" title={`Streets are safe · ${pct0(v.crime)} crime`} text={unsafe > 0 ? `${pct0(unsafe)} of families still live on a rough street.` : 'Keep the watch and lights reaching new homes as the city grows.'} action={unsafe > 0 ? <button className="btn ghost" onClick={showMap}>🛡 Crime map</button> : undefined} />
    : lit < 0.7 ? <NextStep icon="💡" title={`Only ${pct0(lit)} of homes have lit streets`} text="Dark streets draw crime. Run power lines from the power station to the homes." action={<button className="btn primary" onClick={() => startPipes('heartland', 'power')}>🔌 Lay lines</button>} />
    : v.police < 0.8 ? <NextStep icon="🛡" title={`${pct0(unsafe)} of families live on rough streets`} text="Place a watchhouse where the crime map shows red." action={<div className="row wrap civ-case-acts"><button className="btn primary" disabled={price > s.cash} onClick={place}>Place · {money(price)}</button><button className="btn ghost" onClick={showMap}>🛡 Map</button></div>} />
    : <NextStep icon="👥" title="Crime comes from idle hands and unhappy homes" text="Every street is lit and watched. More jobs, schooling and happiness lower it further; officer training helps too." action={<button className="btn ghost" onClick={() => go('community')}>Settlement</button>} />;

  return <div className="stack town-page city-page">
    <PageHead title="City" sub={`${num(pop)} people · ${charter.icon} ${charter.name}`} />
    <h2 className="civ-h">Watch</h2>
    <div className="civ-tiles four" data-coach="city-safety">
      <StatTile icon="🛡" value={pct0(v.crime)} label="crime" tone={v.crime <= 0.2 ? 'good' : v.crime <= 0.35 ? 'ok' : 'bad'} />
      <StatTile icon="💡" value={pct0(lit)} label="lit streets" tone={toneOf(lit, 0.7, 0.4)} />
      <StatTile icon="👮" value={pct0(v.police)} label="watched" tone={toneOf(v.police, 0.7, 0.4)} />
      <StatTile icon="🚿" value={pct0(t.sanitation ?? 0)} label="drains" tone={toneOf(t.sanitation ?? 0, 0.7, 0.4)} />
    </div>
    <div data-coach="city-next">{next}</div>
    <div className="civ-builds">
      <BuildCard img={portrait('civic:police')} fallback="🛡" name={<>Watchhouse{stations.length > 0 && <small> ×{stations.reduce((n, b) => n + b.count, 0)}</small>}</>}
        lines={[`Cuts crime within ${Math.round(serviceRadius({ type: 'police' }))} tiles · upgrade for more`, `${serviceJobs(s, 'police')} officers · ${money(Math.round(serviceDailyCost(s, 'police')))}/day`, <Bar thin key="b" value={v.police} label="Families within a watchhouse's reach" color={v.police >= 0.7 ? 'var(--up)' : 'var(--gold)'} />]}
        action={<button className="btn primary" disabled={price > s.cash} onClick={place}>Place · {money(price)}</button>} />
    </div>
    <section className="card stack s" data-coach="city-justice">
      <SettingRow name={`${charter.icon} ${charter.name}`} effect={s.tick < v.reformUntil ? `Reforming: no extra watch for ${Math.ceil((v.reformUntil - s.tick) / 24)} more days` : CHARTER_LINE[v.charter ?? 'watch'][1]}>
        <button className="btn ghost sm" disabled={s.tick < v.reformUntil} onClick={() => setReform(true)}>Change</button>
      </SettingRow>
      <SettingRow name={`Officer training · ${pct0(v.training)}`} effect={v.trainingUntil >= 0 ? `${Math.ceil((v.trainingUntil - s.tick) / 24)} days to go` : v.training >= 1.5 ? 'Fully trained' : `30 days · each watchhouse cuts more crime`}>
        {v.training < 1.5 && v.trainingUntil < 0 && <button className="btn ghost sm" disabled={!stations.length || s.cash < cityTrainingCost(s)} onClick={() => act({ type: 'trainPolice' })}>Train · {money(cityTrainingCost(s))}</button>}
      </SettingRow>
      <SettingRow name="If a case goes unanswered" effect={v.justice === 'rehabilitate' ? `After 7 days · ${money(caseCost(s, 'rehabilitate'))}, lasting prevention` : `After 7 days · ${money(caseCost(s, 'punish'))}, crime falls now, families less happy`}>
        <Seg label="Default response" value={v.justice} onChange={(policy) => act({ type: 'setJustice', policy })} options={[{ v: 'rehabilitate', label: 'Rehab' }, { v: 'punish', label: 'Punish' }]} />
      </SettingRow>
    </section>
    <ShopsSection />
    <h2 className="civ-h">Traffic</h2>
    <div className="civ-builds">
      <BuildCard img={portrait('civic:parking')} fallback="🅿" name={<>Parking complex{parkings > 0 && <small> ×{parkings}</small>}</>}
        lines={['Town buildings reach homes by road: busy streets slow everyone down, so they reach less far. A car park takes cars off the streets around it.', `${slowTiles} street tile${slowTiles === 1 ? '' : 's'} slowed by traffic · see them on the 🚦 map`, `Takes ${PARKING_SHARE.map((x) => `${Math.round(x * 100)}%`).join(' / ')} of cars off the streets at levels 1–3`]}
        action={<button className="btn primary" disabled={servicePrice(s, 'parking') > s.cash} onClick={() => act({ type: 'buildService', service: 'parking', district: 'farmgate' })}>Place · {money(servicePrice(s, 'parking'))}</button>} />
    </div>
    <h2 className="civ-h">Offices</h2>
    <div className="civ-builds">
      <BuildCard img={portrait('civic:office')} fallback="🏢" name={<>Office{offices.length > 0 && <small> ×{offices.length}</small>}</>}
        lines={['Outside firms hire your residents and pay their wages, which come back through the shops and GST.', `${OFFICE_JOBS.join(' / ')} desks at levels 1–3 · the tower needs 800 residents · stands on commercial land`, t.officePay ? `Firms paid residents ${money(t.officePay)} yesterday` : 'No office wages yet']}
        action={<button className="btn primary" disabled={servicePrice(s, 'office') > s.cash} onClick={() => act({ type: 'buildService', service: 'office', district: 'farmgate' })}>Place · {money(servicePrice(s, 'office'))}</button>} />
    </div>
    {v.neighbourJobs > 0 && <details className="town-budget" data-coach="city-decisions"><summary>👥 Neighbouring employers · {num(v.neighbourJobs)} jobs · {money(v.neighbourPayroll)} paid today</summary><div className="stack">{v.employers.map((e) => <div className="town-cash-flow" key={e.id}><span>{s.competitors.find((b) => b.id === e.id)?.name ?? 'Local employer'}<b>{e.jobs} jobs</b></span><span>Wages to households<b>{money(e.wages)}</b></span></div>)}<Info text="Your factories and public services hire resident adults first; the rest can work for neighbouring farms. A 1.1× offer can win an employed neighbour over to your crew." /></div></details>}
    <p className="small muted civ-foot">{v.solved} case{v.solved === 1 ? '' : 's'} answered · {v.rehabilitated} rehabilitated · prevention {pct0(v.prevention)}. Watchhouses are paid by the farm. <button className="btn ghost sm" onClick={showMap}>🛡 Crime map</button><button className="btn ghost sm" onClick={() => go('town')}>Town services →</button></p>
    {reform && <Modal title="Reform the watch" onClose={() => setReform(false)}><div className="charter-heading"><b>{money(policeReformCost(s))} · 7 days without the extra watch</b><span>Officers stay paid while they retrain.</span></div>{charters(true)}</Modal>}
  </div>;
}
