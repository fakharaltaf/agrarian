import { act, go, useGame } from '../../stores/game';
import { money, num, pct0 } from '../format';
import { Bar, Modal, PageHead } from '../ui';
import { communityOf, population } from '../../simulation/community-state';
import { SERVICE_DEFS, SERVICE_RADIUS, servicePrice, townOf } from '../../simulation/town-state';
import { serviceAvailable, serviceDailyCost } from '../../simulation/stages/town';
import type { ServiceType } from '../../simulation/types';

/** What each service does for the homes inside its reach. */
const SERVICES: { type: ServiceType; does: string; cover: 'education' | 'water' | 'medical' | 'sanitation' | 'power' }[] = [
  { type: 'waterTower', does: 'Clean water from the tower', cover: 'water' },
  { type: 'school', does: 'Schooling for the children', cover: 'education' },
  { type: 'clinic', does: 'A doctor nearby', cover: 'medical' },
  { type: 'sanitation', does: 'Drains and waste collection', cover: 'sanitation' },
  { type: 'lighting', does: 'Power to homes and streets', cover: 'power' },
  { type: 'well', does: 'A cheap, short-reach well', cover: 'water' },
];

export default function TownPage() {
  const s = useGame(), t = townOf(s), c = communityOf(s);
  if (!t.active) return <div className="town-page"><Modal title="Newcomers want to settle" onClose={() => go('farm')} actions={<button className="btn ghost" onClick={() => go('farm')}>Not yet</button>}>
    <p>Word has spread about your settlement. Families from outside want to live here too, and they'll pay the housing tax like everyone else.</p>
    <ul className="small">
      <li>Newcomers arrive while there are free homes and the settlement is happy.</li>
      <li>Water towers, schools, clinics, sanitation and power each serve the homes within their reach. You'll see the circle when you place one.</li>
      <li>You pay for them; the settlement's housing tax and pay cut bring the money back.</li>
    </ul>
    <button className="btn primary" onClick={() => act({ type: 'startTown' })}>Welcome newcomers</button>
  </Modal></div>;
  const cover = { education: t.education, water: t.water, medical: t.medical ?? 0, sanitation: t.sanitation ?? 0, power: t.power ?? 0 };
  const upkeep = t.services.filter((b) => b.active).reduce((n, b) => n + serviceDailyCost(s, b.type) * b.count, 0);
  return <div className="stack town-page">
    <PageHead title="Town" sub={`${num(population(s))} people · ☺ ${pct0(c.happiness)}`} />
    <div className="community-strip">
      <span><b>💧 {pct0(cover.water)}</b><small>water</small></span>
      <span><b>📚 {pct0(cover.education)}</b><small>schooling</small></span>
      <span><b>♥ {pct0(cover.medical)}</b><small>clinic</small></span>
      <span><b>🚿 {pct0(cover.sanitation)}</b><small>sanitation</small></span>
      <span><b>⚡ {pct0(cover.power)}</b><small>power</small></span>
    </div>
    <p className="small muted">Share of families whose home is within reach. Upkeep {money(Math.round(upkeep))}/day, paid by the farm. <button className="btn ghost sm" onClick={() => go('community')}>Housing tax & pay cut →</button></p>
    <div className="town-services">{SERVICES.filter((x) => serviceAvailable(s, x.type)).map(({ type, does, cover: key }) => {
      const d = SERVICE_DEFS[type], built = t.services.filter((b) => b.type === type).reduce((n, b) => n + b.count, 0), price = servicePrice(s, type);
      return <article className="town-service" key={type}><div className="town-portrait"><b>{d.icon}</b></div><div className="town-service-body">
        <h3>{d.name} {built > 0 && <small>×{built}</small>}</h3>
        <strong>{does}</strong>
        <span>Reaches {SERVICE_RADIUS[type] ?? 10} tiles · 👥 {d.jobs} staff · {money(Math.round(serviceDailyCost(s, type)))}/day</span>
        <Bar value={cover[key]} label={`${d.name} coverage`} />
        <button className="btn primary" disabled={price > s.cash} onClick={() => act({ type: 'buildService', service: type, district: 'farmgate' })}>Place · {money(price)}</button>
      </div></article>;
    })}</div>
  </div>;
}
