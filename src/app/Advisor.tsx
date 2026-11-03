// Farm advisor UI: the numbers behind profit or loss, and plain-words tips that link to the fix.
import { Fragment, useState } from 'react';
import { diagnose, type Diagnosis } from '../simulation/advisor';
import type { GameState } from '../simulation/types';
import { go } from '../stores/game';
import { money } from './format';
import { Card, Modal } from './ui';

function AdvisorBody({ d, onGo }: { d: Diagnosis; onGo?: () => void }) {
  const stockBuilding = d.profit < 0 && d.realProfit >= 0;
  return (
    <div className="stack s">
      <p>
        {d.realProfit < 0 ? <>The farm is <b className="down">losing about {money(-d.realProfit)} a day</b>.</>
          : stockBuilding ? <>Cash is going down <b className="down">{money(-d.profit)} a day</b>, but the farm is <b className="up">gaining about {money(d.realProfit)} a day</b> in value — what you grow is piling up in storage instead of being sold.</>
          : <>The farm is <b className="up">making about {money(d.realProfit)} a day</b>.</>}
        <span className="small muted"> Sales {money(d.revenue)}/day · running costs {money(d.costs)}/day.</span>
      </p>
      {d.advice.length > 0 && (
        <div className="stack s">
          <b className="small">{d.advice.length > 1 ? 'Do these, in order' : 'Do this'}</b>
          {d.advice.map((a, i) => (
            <div key={a.id} className={`callout small ${i === 0 ? 'bad' : 'warn'}`}>
              <b>{i + 1}. {a.icon} {a.title}</b>{a.perDay > 1 && <span className="muted"> · about {money(a.perDay)}/day</span>}
              <p>{a.body}</p>
              <button className="btn ghost sm" onClick={() => (go(a.page), onGo?.())}>Fix it →</button>
            </div>
          ))}
        </div>
      )}
      {d.working.length > 0 && (
        <div className="callout small good">
          <b>✅ What's working — leave it alone</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.working.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {!d.advice.length && <p className="explain">Nothing worrying. Tips appear here when something is costing you money.</p>}
      {d.costLines.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Where the money goes (per day)</summary>
          <dl className="facts small" style={{ marginTop: 6 }}>
            <dt>Sales</dt><dd className="up">+{money(d.revenue)}</dd>
            {d.costLines.map((c) => <Fragment key={c.label}><dt>{c.label}</dt><dd className="down">−{money(c.perDay)}</dd></Fragment>)}
            <dt><b>Cash from running the farm</b></dt><dd className={d.profit < 0 ? 'down' : 'up'}><b>{money(d.profit)}</b></dd>
            <dt>Counting stock & assets</dt><dd className={d.realProfit < 0 ? 'down' : 'up'}>{money(d.realProfit)}</dd>
          </dl>
        </details>
      )}
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
  const losing = d.realProfit < 0 && s.era >= 2;
  const cashDown = !losing && d.profit < 0 && s.era >= 2;
  if (!losing && !cashDown && !d.advice.length) return null;
  return (
    <>
      <button className={`hud-advisor ${losing ? 'bad' : ''}`} data-coach="advisor" onClick={() => setOpen(true)}>
        {losing ? `📉 Losing ${money(-d.realProfit)}/day — why?` : cashDown ? `📦 Cash −${money(-d.profit)}/day, stock piling up — why?` : `💡 ${d.advice.length} farm tip${d.advice.length > 1 ? 's' : ''}`}
      </button>
      {open && <Modal title="Farm advisor" onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>Thanks</button>}>
        <AdvisorBody d={d} onGo={() => setOpen(false)} />
      </Modal>}
    </>
  );
}
