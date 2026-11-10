// Farm advisor UI: profit at a glance, then up to three fixes with their $ value and a button that does them.
import { Fragment, useState } from 'react';
import { diagnose, type Diagnosis } from '../simulation/advisor';
import { day } from '../simulation/core';
import type { GameState } from '../simulation/types';
import { act, go } from '../stores/game';
import { money } from './format';
import { Card, Modal } from './ui';

// Re-read once per game day, or straight away when the player changes something the advice is about.
let cache: { key: string; d: Diagnosis } | null = null;
export function advice(s: GameState) {
  const key = [day(s), s.advisor, s.workers.map((w) => w.id).join('.'), s.fields.map((f) => `${f.id}${f.spreading ? 's' : ''}`).join('.'), s.buildings.length, s.machines.length].join('|');
  if (cache?.key !== key) cache = { key, d: diagnose(s) };
  return cache.d;
}

function AdvisorBody({ d, onGo }: { d: Diagnosis; onGo?: () => void }) {
  const max = Math.max(d.revenue, d.costs, 1);
  return (
    <div className="adv">
      <div className="adv-head">
        <b className={d.profit < 0 ? 'down' : 'up'}>{d.profit < 0 ? `Losing ${`$${Math.round(-d.profit).toLocaleString("en-US")}`}/day` : `Making ${`$${Math.round(d.profit).toLocaleString("en-US")}`}/day`}</b>
        <span className="small muted">{d.days ? `last ${d.days} day${d.days === 1 ? '' : 's'}` : 'today so far'}</span>
      </div>
      <div className="adv-bars small">
        <span>Sales</span><i style={{ width: `${(d.revenue / max) * 100}%` }} className="up" /><b>{money(d.revenue)}</b>
        <span>Costs</span><i style={{ width: `${(d.costs / max) * 100}%` }} className="down" /><b>{money(d.costs)}</b>
      </div>
      {Math.abs(d.cash - d.profit) > 1 && (
        <div className="adv-cash small">
          Cash <b className={d.cash < 0 ? 'down' : 'up'}>{d.cash < 0 ? '−' : '+'}{money(Math.abs(Math.round(d.cash)))}/day</b>
          <span className="muted"> after {d.below.filter((x) => x.perDay > 1).map((x) => x.label.toLowerCase()).join(', ') || 'other flows'}</span>
        </div>
      )}
      {d.advice.map((a, i) => (
        <div key={a.id} className="adv-tip">
          <span className="adv-n">{i + 1}</span>
          <div>
            <b>{a.icon} {a.title}</b>
            <div className="small muted">{a.proof}</div>
          </div>
          {a.act
            ? <button className="btn primary sm" onClick={() => (act(a.act!.action, `${a.act!.label}: done.`), onGo?.())}>{a.act.label}{a.gain > 1 && <> +{money(a.gain)}/day</>}</button>
            : <button className="btn ghost sm" onClick={() => (go(a.page), onGo?.())}>Open →</button>}
        </div>
      ))}
      {d.after > d.profit + 1 && <div className="adv-after small">After {d.advice.filter((a) => a.gain > 1).map((_, i) => i + 1).join(' + ')}: about <b className={d.after < 0 ? 'down' : 'up'}>{money(d.after)}/day</b></div>}
      {!d.advice.length && <p className="small muted">Nothing worth changing right now.</p>}
      {d.working.length > 0 && <div className="small muted">✅ {d.working.join(' · ')}</div>}
      {d.costLines.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>Where the money goes (per day)</summary>
          <dl className="facts small" style={{ marginTop: 6 }}>
            {d.costLines.map((c) => <Fragment key={c.label}><dt>{c.label}</dt><dd className="down">−{money(c.perDay)}</dd></Fragment>)}
            {d.below.length > 0 && <><dt className="adv-sep"><b>Outside running the farm</b></dt><dd className="adv-sep" /></>}
            {d.below.map((c) => <Fragment key={c.label}><dt>{c.label}</dt><dd className={c.perDay > 0 ? 'down' : 'up'}>{c.perDay > 0 ? '−' : '+'}{money(Math.abs(c.perDay))}</dd></Fragment>)}
            <dt><b>Cash per day</b></dt><dd className={d.cash < 0 ? 'down' : 'up'}><b>{money(d.cash)}</b></dd>
          </dl>
        </details>
      )}
    </div>
  );
}

export function AdvisorCard({ s }: { s: GameState }) {
  if (!s.advisor) return null;
  return <Card title="Farm advisor" info="Averages your last two weeks and names the changes worth the most money. Rechecks every morning."><AdvisorBody d={advice(s)} /></Card>;
}

/** Floating pill on the farm view: the single most valuable fix. */
export function AdvisorPill({ s }: { s: GameState }) {
  const [open, setOpen] = useState(false);
  if (!s.advisor) return null;
  const d = advice(s), top = d.advice[0];
  if (!top && d.profit >= 0) return null;
  return (
    <>
      <button className={`hud-advisor ${d.profit < 0 ? 'bad' : ''}`} data-coach="advisor" onClick={() => setOpen(true)}>
        {top ? <>{top.icon} {top.title}{top.gain > 1 && <> · +{money(top.gain)}/day</>}</> : `📉 Losing ${money(-d.profit)}/day`}
      </button>
      {open && <Modal title="Farm advisor" onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>Close</button>}>
        <AdvisorBody d={d} onGo={() => setOpen(false)} />
      </Modal>}
    </>
  );
}
