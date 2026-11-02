// Farm advisor UI: the numbers behind profit or loss, and plain-words tips that link to the fix.
import { useState } from 'react';
import { diagnose, type Diagnosis } from '../simulation/advisor';
import type { GameState } from '../simulation/types';
import { go } from '../stores/game';
import { money } from './format';
import { Card, Modal } from './ui';

function AdvisorBody({ d, onGo }: { d: Diagnosis; onGo?: () => void }) {
  return (
    <div className="stack s">
      <p className="small">
        Per day lately: earning <b className="up">{money(d.revenue)}</b>, spending <b className="down">{money(d.costs)}</b> →{' '}
        <b className={d.profit < 0 ? 'down' : 'up'}>{d.profit < 0 ? 'losing' : 'making'} {money(Math.abs(d.profit))}</b>
        {d.topCosts.length > 0 && <span className="muted"> · biggest costs: {d.topCosts.map((c) => `${c.label} ${money(c.perDay)}`).join(', ')}</span>}
      </p>
      {d.advice.length ? d.advice.map((a) => (
        <div key={a.id} className={`callout small ${a.perDay > 0 ? 'bad' : 'warn'}`}>
          <b>{a.icon} {a.title}</b>{a.perDay > 1 && <span className="muted"> · about {money(a.perDay)}/day</span>}
          <p>{a.body}</p>
          <button className="btn ghost sm" onClick={() => (go(a.page), onGo?.())}>Fix it →</button>
        </div>
      )) : <p className="explain">Nothing worrying. Tips appear here when something is costing you money.</p>}
    </div>
  );
}

export function AdvisorCard({ s }: { s: GameState }) {
  if (!s.advisor) return null;
  return <Card title="Farm advisor" info="Reads your books from the last few days and points out what is costing you money."><AdvisorBody d={diagnose(s)} /></Card>;
}

/** Floating pill on the farm view, only when something needs attention. */
export function AdvisorPill({ s }: { s: GameState }) {
  const [open, setOpen] = useState(false);
  if (!s.advisor) return null;
  const d = diagnose(s);
  const losing = d.profit < 0 && s.era >= 2;
  if (!losing && !d.advice.length) return null;
  return (
    <>
      <button className={`hud-advisor ${losing ? 'bad' : ''}`} data-coach="advisor" onClick={() => setOpen(true)}>
        {losing ? `📉 Losing ${money(-d.profit)}/day — why?` : `💡 ${d.advice.length} farm tip${d.advice.length > 1 ? 's' : ''}`}
      </button>
      {open && <Modal title="Farm advisor" onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>Thanks</button>}>
        <AdvisorBody d={d} onGo={() => setOpen(false)} />
      </Modal>}
    </>
  );
}
