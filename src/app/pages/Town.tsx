import { act, go, useGame } from '../../stores/game';
import { money, num, pct0 } from '../format';
import { Bar, Modal, PageHead } from '../ui';
import { communityOf, familiesHere, homeFamilies, population } from '../../simulation/community-state';
import { SERVICE_DEFS, SERVICE_RADIUS, servicePrice, townOf } from '../../simulation/town-state';
import { serviceAvailable, serviceDailyCost } from '../../simulation/stages/town';
import type { ServiceType } from '../../simulation/types';
import { portrait } from '../world/portrait';
import { BuildCard, NextStep, StatTile, toneOf } from './civic';

type Cover = 'education' | 'water' | 'medical' | 'sanitation' | 'power';
/** What each service does for the homes inside its reach. */
const SERVICES: { type: ServiceType; does: string; cover: Cover }[] = [
  { type: 'waterTower', does: 'Clean water', cover: 'water' },
  { type: 'school', does: 'Lessons for the children', cover: 'education' },
  { type: 'clinic', does: 'A doctor nearby', cover: 'medical' },
  { type: 'sanitation', does: 'Drains and waste collection', cover: 'sanitation' },
  { type: 'lighting', does: 'Power for homes and streets', cover: 'power' },
  { type: 'well', does: 'Cheap water, short reach', cover: 'water' },
];
const TILES: { cover: Cover; icon: string; label: string }[] = [
  { cover: 'water', icon: '💧', label: 'water' }, { cover: 'education', icon: '📚', label: 'schooling' }, { cover: 'medical', icon: '♥', label: 'clinic' },
  { cover: 'sanitation', icon: '🚿', label: 'drains' }, { cover: 'power', icon: '⚡', label: 'power' },
];

export default function TownPage() {
  const s = useGame(), t = townOf(s), c = communityOf(s);
  if (!t.active) return <div className="town-page"><Modal title="Newcomers want to settle" onClose={() => go('farm')} actions={<><button className="btn ghost" onClick={() => go('farm')}>Not yet</button><button className="btn primary" onClick={() => act({ type: 'startTown' })}>Welcome newcomers</button></>}>
    <div className="civ-intro"><img src={portrait('civic:school')} alt="" /><p>Word has spread about your settlement. Families from outside want to live here too, and they pay the housing tax like everyone else.</p></div>
    <ol className="civ-steps">
      <li><b>Free homes and a happy settlement</b> bring a newcomer family each day.</li>
      <li><b>Water towers, schools, clinics, drains and power</b> each serve the homes within their reach. You see the circle as you place one.</li>
      <li><b>The farm pays</b> for them; the housing tax and pay cut bring money back.</li>
    </ol>
  </Modal></div>;

  const cover: Record<Cover, number> = { education: t.education, water: t.water, medical: t.medical ?? 0, sanitation: t.sanitation ?? 0, power: t.power ?? 0 };
  const upkeep = t.services.filter((b) => b.active).reduce((n, b) => n + serviceDailyCost(s, b.type) * b.count, 0);
  const newcomers = c.cohorts.filter((g) => g.name.includes('newcomers')).length, free = homeFamilies(s) - c.cohorts.length;
  const open = SERVICES.filter((x) => serviceAvailable(s, x.type));
  const place = (type: ServiceType) => act({ type: 'buildService', service: type, district: 'farmgate' });
  // the weakest service the player can do something about
  const weakest = open.filter((x) => x.type !== 'well').map((x) => ({ ...x, v: cover[x.cover] })).sort((a, b) => a.v - b.v)[0];
  const next = free <= 0 ? <NextStep icon="🏠" title="Newcomers need free homes" text="A family moves in each day while there is a free home and the town is happy." action={<button className="btn primary" onClick={() => go('community')}>Build homes</button>} />
    : c.happiness < 0.6 ? <NextStep icon="☹" tone="bad" title="Newcomers stay away" text={`Happiness is ${pct0(c.happiness)}; families come from 60%. Food, warmth and homes lift it.`} action={<button className="btn ghost" onClick={() => go('community')}>Settlement</button>} />
    : weakest && weakest.v < 0.6 ? <NextStep icon={SERVICE_DEFS[weakest.type].icon} title={`Only ${pct0(weakest.v)} of homes have ${weakest.cover === 'education' ? 'a school' : weakest.cover === 'medical' ? 'a clinic' : weakest.cover === 'water' ? 'clean water' : weakest.cover === 'sanitation' ? 'drains' : 'power'} in reach`} text={`Place a ${SERVICE_DEFS[weakest.type].name.toLowerCase()} among the homes: it serves those within ${SERVICE_RADIUS[weakest.type] ?? 10} tiles.`} action={<button className="btn primary" disabled={servicePrice(s, weakest.type) > s.cash} onClick={() => place(weakest.type)}>Place</button>} />
    : <NextStep icon="✓" tone="good" title="The town is well served" text={`${free} free home${free === 1 ? '' : 's'} · a newcomer family arrives each day.`} />;

  return <div className="stack town-page">
    <PageHead title="Town" sub={`${num(population(s))} people · ${familiesHere(s)} worker families · ${newcomers} newcomer${newcomers === 1 ? '' : 's'}`} />
    <div className="civ-tiles five">{TILES.map((x) => <StatTile key={x.cover} icon={x.icon} value={pct0(cover[x.cover])} label={x.label} tone={toneOf(cover[x.cover], 0.7, 0.4)} />)}</div>
    {next}
    <div className="civ-builds">{open.map(({ type, does, cover: key }) => {
      const d = SERVICE_DEFS[type], built = t.services.filter((b) => b.type === type).reduce((n, b) => n + b.count, 0), price = servicePrice(s, type);
      return <BuildCard key={type} img={portrait(`civic:${type}`)} fallback={d.icon} name={<>{d.name}{built > 0 && <small> ×{built}</small>}</>}
        lines={[does, `Reaches ${SERVICE_RADIUS[type] ?? 10} tiles · ${d.jobs} staff · ${money(Math.round(serviceDailyCost(s, type)))}/day`, <Bar thin key="b" value={cover[key]} label={`${d.name} coverage`} color={cover[key] >= 0.7 ? 'var(--up)' : 'var(--gold)'} />]}
        action={<button className="btn primary" disabled={price > s.cash} onClick={() => place(type)}>Place · {money(price)}</button>} />;
    })}</div>
    <p className="small muted civ-foot">Coverage is the share of families whose home is in reach. Services cost {money(Math.round(upkeep))}/day, paid by the farm. <button className="btn ghost sm" onClick={() => go('community')}>Housing tax & pay cut →</button></p>
  </div>;
}
