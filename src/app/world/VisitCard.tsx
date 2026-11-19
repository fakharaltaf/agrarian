// The card on a visit to a neighbour's town: who leads it, how they feel about you, what they want. Nothing to do there yet.
import { useEffect, useState } from 'react';
import { focusNeighbour, go, leaveTown, useGame, usePageState } from '../../stores/game';
import { attitude, NEIGHBOURS, regionOf, type NeighbourId } from '../../simulation/region-state';
import { GOODS, REGIONS } from '../../simulation/config';
import { num } from '../format';

const TOWN_LINE: Record<NeighbourId, string> = {
  arid: 'A frontier village of mud-brick houses round the Khan’s kasbah, out in the desert at the west end of the main road.',
  coastal: 'The region’s port city: towers in the middle, whitewashed houses by the sea, ships at the quay.',
  river: 'A farming village round its green, downriver from you, its fields running to the horizon.',
  tropics: 'A hamlet of stilt huts round the Queen’s longhouse, cut out of the jungle across the bay.',
};
/** What you see on a visit: who leads the town, how they feel about you, what they want. Nothing to do here yet. */
export function VisitCard({ id }: { id: NeighbourId }) {
  const s = useGame(), v = regionOf(s), n = v.neighbours[id], who = NEIGHBOURS[id], r = n.request;
  const out = s.shipments.filter((x) => x.caravan && x.to === id && s.tick < x.arrives).length;
  const [open, setOpen] = useState(() => typeof matchMedia !== 'function' || !matchMedia('(max-width: 600px)').matches); // folded on a phone, so the town shows
  return <aside className={`visit-card${open ? '' : ' folded'}`} aria-label={`Visiting ${REGIONS[id].name}`}>
    <button className="visit-head" aria-expanded={open} onClick={() => setOpen(!open)}><span className="rv-crest">{who.icon}</span><div><b>{REGIONS[id].name}</b><small>{who.leader}{v.active ? ` · ${attitude(n.trust)}` : ''}</small></div><span className="visit-fold" aria-hidden>{open ? '▾' : '▴'}</span></button>
    <p>{TOWN_LINE[id]}</p>
    {v.active && <div className="visit-trust"><span>{attitude(n.trust)}</span><span className="visit-bar"><i style={{ width: `${Math.max(0, Math.min(100, n.trust))}%` }} /></span><b>{Math.round(n.trust)}</b></div>}
    <ul className="visit-facts">
      <li>💛 Wants <b>{GOODS[who.wants].name.toLowerCase()}</b></li>
      {r && <li>📜 Order: <b>{num(Math.max(0, r.qty - r.done))} {GOODS[r.good].name.toLowerCase()}</b></li>}
      {v.active && <li>🐫 {out ? `${out} caravan${out > 1 ? 's' : ''} on the way` : 'No caravans on the way'}</li>}
    </ul>
    <button className="btn primary" onClick={() => { focusNeighbour(id); go('region'); }}>{v.active ? 'Trade & diplomacy' : 'Choose your border policy'}</button>
  </aside>;
}
/** Back to the region map and the town's name, top left. */
export function VisitBar({ id }: { id: NeighbourId }) {
  const page = usePageState();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && page === 'farm' && !document.querySelector('.modal-bg')) leaveTown(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [page]);
  return <div className="region-top visit-top">
    <button className="btn region-back" onClick={() => leaveTown()}>← Region</button>
    <div className="region-title"><b>Visiting {REGIONS[id].name}</b><span>{NEIGHBOURS[id].icon} {NEIGHBOURS[id].leader}’s town</span></div>
  </div>;
}
