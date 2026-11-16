import { useState } from 'react';
import { act, go, setCrimeMap, startPipes, startZoning, useGame } from '../../stores/game';
import { worldOf } from '../../simulation/world';
import { population } from '../../simulation/community-state';
import { cityOf, POLICE_CHARTERS, shopReach, type PoliceCharter } from '../../simulation/city-state';
import { caseCost, cityTrainingCost, GST_RATES, policeReformCost } from '../../simulation/stages/city';
import { SERVICE_DEFS, SHOP_GOODS, SHOP_TYPES, serviceJobs, servicePrice, serviceRadius, townOf } from '../../simulation/town-state';
import type { ServiceType } from '../../simulation/types';
import { serviceDailyCost } from '../../simulation/stages/town';
import { GOODS } from '../../simulation/config';
import { Bar, Info, Modal, PageHead, Seg } from '../ui';
import { money, num, pct0 } from '../format';
import { portrait } from '../world/portrait';
import { BuildCard, NextStep, SettingRow, StatTile, toneOf } from './civic';

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
  const price = servicePrice(s, 'police'), build = (service: ServiceType) => act({ type: 'buildService', service, district: 'farmgate' }), place = () => build('police');
  const trade = v.trade, shops = t.services.filter((b) => SHOP_TYPES.includes(b.type as never)), gap = trade?.gaps[0];
  const zoned = Object.values(worldOf(s, 'heartland').zones).includes('com');
  const shopNext = !zoned ? <NextStep icon="🏘" title="Zone commercial land for shops" text="Shops and offices stand on commercial land. Mark some of your cleared land near the homes." action={<button className="btn primary" onClick={() => startZoning('heartland', 'com')}>🏪 Zone land</button>} />
    : !shops.length ? <NextStep icon="🏪" title="Open your first shop" text="Families have savings and nowhere to spend them. A shop sells your goods to the homes within its reach, and the GST comes to the farm." />
    : shops.some((b) => b.active && b.staffed < SERVICE_DEFS[b.type].jobs * b.count) ? <NextStep icon="👥" tone="bad" title="Shops are short of staff" text="Shopkeepers come from your own families. Build homes so more adults move in." action={<button className="btn primary" onClick={() => go('community')}>Build homes</button>} />
    : gap && trade!.imports > trade!.ours * 0.25 ? <NextStep icon="🚚" title={`Families import ${GOODS[gap.good].name.toLowerCase()}: ${money(gap.value)} a day leaves the city`} text="The shops buy your stock first. Make or store more of it and that money comes to you instead." action={<button className="btn ghost" onClick={() => go('production')}>Production</button>} />
    : trade && trade.spend > 0 ? <NextStep icon="✓" tone="good" title={`Shops sold ${money(trade.spend)} yesterday`} text={`${pct0(trade.spend ? trade.ours / trade.spend : 0)} of it was your own goods. More kinds of shop and more homes in reach grow it.`} />
    : <NextStep icon="🏪" title="No sales yet" text="Shops need a road, staff and homes within reach. Sales are counted each morning." />;
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
    <h2 className="civ-h">Shops</h2>
    <div className="civ-tiles three" data-coach="city-shops">
      <StatTile icon="🛍" value={money(trade?.spend ?? 0)} label="spent at shops / day" />
      <StatTile icon="🌾" value={pct0(trade?.spend ? trade.ours / trade.spend : 0)} label="was your goods" tone={!trade?.spend ? 'none' : toneOf(trade.ours / trade.spend, 0.7, 0.4)} />
      <StatTile icon="🧾" value={money(trade?.gst ?? 0)} label={`GST / day at ${pct0(v.gst)}`} />
    </div>
    {shopNext}
    <div className="civ-builds">{SHOP_TYPES.map((type) => {
      const d = SERVICE_DEFS[type], n = shops.filter((b) => b.type === type).length, cost = servicePrice(s, type), reach = shopReach(s, type);
      return <BuildCard key={type} img={portrait(`civic:${type}`)} fallback={d.icon} name={<>{d.name}{n > 0 && <small> ×{n}</small>}</>}
        lines={[`Sells ${Object.keys(SHOP_GOODS[type]).map((g) => GOODS[g as keyof typeof GOODS].name.toLowerCase()).join(', ')}`, `Reaches ${Math.round(serviceRadius({ type }))} tiles · ${d.jobs} staff · ${money(Math.round(serviceDailyCost(s, type)))}/day`, <Bar thin key="b" value={reach} label={`Families within a ${d.name.toLowerCase()}'s reach`} color={reach >= 0.7 ? 'var(--up)' : 'var(--gold)'} />]}
        action={<button className="btn primary" disabled={cost > s.cash} onClick={() => build(type)}>Place · {money(cost)}</button>} />;
    })}</div>
    <section className="card stack s">
      <SettingRow name="GST on shop sales" effect={v.gst === 0 ? 'No tax: families keep it all' : v.gst >= 0.1 ? 'More income for the farm · families a little less happy' : 'A modest tax on everything the shops sell'}>
        <Seg label="GST rate" value={v.gst} onChange={(rate) => act({ type: 'setGst', rate })} options={GST_RATES.map((r) => ({ v: r, label: pct0(r) }))} />
      </SettingRow>
    </section>
    {v.neighbourJobs > 0 && <details className="town-budget" data-coach="city-decisions"><summary>👥 Neighbouring employers · {num(v.neighbourJobs)} jobs · {money(v.neighbourPayroll)} paid today</summary><div className="stack">{v.employers.map((e) => <div className="town-cash-flow" key={e.id}><span>{s.competitors.find((b) => b.id === e.id)?.name ?? 'Local employer'}<b>{e.jobs} jobs</b></span><span>Wages to households<b>{money(e.wages)}</b></span></div>)}<Info text="Your factories and public services hire resident adults first; the rest can work for neighbouring farms. A 1.1× offer can win an employed neighbour over to your crew." /></div></details>}
    <p className="small muted civ-foot">{v.solved} case{v.solved === 1 ? '' : 's'} answered · {v.rehabilitated} rehabilitated · prevention {pct0(v.prevention)}. Watchhouses are paid by the farm. <button className="btn ghost sm" onClick={showMap}>🛡 Crime map</button><button className="btn ghost sm" onClick={() => go('town')}>Town services →</button></p>
    {reform && <Modal title="Reform the watch" onClose={() => setReform(false)}><div className="charter-heading"><b>{money(policeReformCost(s))} · 7 days without the extra watch</b><span>Officers stay paid while they retrain.</span></div>{charters(true)}</Modal>}
  </div>;
}
