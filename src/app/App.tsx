import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { equity, sumBooks } from '../simulation/core';
import { backlogHours, fleet, haulOf, marketCut, onTheWay, oneWay, usesCarts, VEHICLES } from '../simulation/hauling';
import { ACHIEVEMENTS, PAGES } from '../simulation/engine';
import {
  act, deleteSlot, getGame, offlineOn, dismissAway, toast, exportSave, go, importSave, loadFrom, newGame, saveTo, setSpeed, slotInfo, slotLabel, SLOTS, SPEEDS, useGame, useStore, type Slot, type Speed,
} from '../stores/game';
import { Coach, resetTips, tipsOff, tipsOn } from './Coach';
import { clock, money, stamp } from './format';
import { Icon } from './icons';
import { LogoMark } from './Logo';
import { Bar, Modal, usePref } from './ui';
import { FieldsPage } from './pages/Fields';
import { Hud } from './world/Hud';
import { setVolume, sfx, volumes } from './audio';
import { graphicsQuality } from './world/Scene3D';
import { restructurePreview } from './pages/shared';

const PAGE_COMPONENTS: Record<string, React.ComponentType> = {
  fields: FieldsPage,
  overview: lazy(() => import('./pages/Overview')),
  markets: lazy(() => import('./pages/Markets')),
  livestock: lazy(() => import('./pages/Livestock')),
  workers: lazy(() => import('./pages/Workers')),
  storage: lazy(() => import('./pages/Storage')),
  finance: lazy(() => import('./pages/Finance')),
  equipment: lazy(() => import('./pages/Equipment')),
  automation: lazy(() => import('./pages/Automation')),
  production: lazy(() => import('./pages/Production')),
  research: lazy(() => import('./pages/Research')),
  logistics: lazy(() => import('./pages/Logistics')),
  analytics: lazy(() => import('./pages/Analytics')),
  competitors: lazy(() => import('./pages/Competitors')),
  world: lazy(() => import('./pages/World')),
  corporation: lazy(() => import('./pages/Corporation')),
  policy: lazy(() => import('./pages/Policy')),
  city: lazy(() => import('./pages/City')),
  region: lazy(() => import('./pages/Region')),
  nation: lazy(() => import('./pages/Nation')),
  town: lazy(() => import('./pages/Town')),
  community: lazy(() => import('./pages/Community')),
};

export function App() {
  const s = useGame();
  const page = useStore((x) => x.page);
  const ready = useStore((x) => x.ready);
  const [theme, setTheme] = usePref<'auto' | 'light' | 'dark'>('theme', 'auto');
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [ledger, setLedger] = useState(false);
  const [title, setTitle] = useState(true);
  const unlocked = PAGES.filter((p) => p.unlocked(s));
  const current = unlocked.some((p) => p.id === page) ? page : 'farm';
  const bare = s.era < 2;

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  // visiting a page clears its "new" marker
  useEffect(() => {
    if (current !== 'farm' && !s.seenTips.includes(`page:${current}`)) act({ type: 'seeTip', tip: `page:${current}` });
  }, [current, s.seenTips]);
  useEffect(() => {
    if (current === 'farm') return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-bg') && go('farm');
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [current]);

  useShortcuts({ help: () => setHelp(true), log: () => setDrawer(true) });
  const Page = current === 'farm' ? null : PAGE_COMPONENTS[current] ?? FieldsPage;
  const warnings = s.log.filter((l) => (l.level === 'critical' || l.level === 'warning') && l.tick > s.tick - 48).length;

  return (
    <div className={`shell${bare ? ' bare' : ''}`}>

      <div className="main">
        <TopBar onLedger={() => setLedger(true)} onLog={() => setDrawer(true)} onSettings={() => setSettings(true)} onHelp={() => setHelp(true)} warnings={warnings} bare={bare} />
        <div className="stage">
          <Hud />
          {Page && (
            <section className="page-drawer" role="dialog" aria-label={PAGES.find((p) => p.id === current)?.label}>
              {(current === 'community' || current === 'town' || current === 'city' || current === 'region' || current === 'nation') && <SheetGrip />}
              <button className="icon-btn page-close" onClick={() => go('farm')} aria-label="Back to the farm (Esc)" title="Back to the farm (Esc)">✕</button>
              <PageGuard key={current}>
                <Suspense fallback={<div className="empty">Loading…</div>}>
                  <Page />
                </Suspense>
              </PageGuard>
            </section>
          )}
        </div>
      </div>
      {ledger && <Modal title="Ledger" onClose={() => setLedger(false)}><div className="ledger-grid" data-coach="nav">
        <button className="btn" onClick={() => {go('farm');setLedger(false);}}>🌾 Farm</button>
        {unlocked.map(p=><button className="btn" key={p.id} data-coach={`nav-${p.id}`} onClick={()=>{go(p.id);setLedger(false);}}><Icon name={p.id}/>{p.label}</button>)}
      </div></Modal>}
      {drawer && <LogDrawer onClose={() => setDrawer(false)} />}
      {settings && <Settings onClose={() => setSettings(false)} theme={theme} setTheme={setTheme} />}
      {help && <Help onClose={() => setHelp(false)} />}
      <Decisions />
      <Bankrupt />
      <Away />
      <CatchUp />
      <Toasts />
      {ready && !title && <Celebrations />}
      {ready && !title && <Coach />}
      {ready && title && <TitleScreen onPlay={() => setTitle(false)} onHelp={() => setHelp(true)} />}
    </div>
  );
}

function TitleScreen({ onPlay, onHelp }: { onPlay: () => void; onHelp: () => void }) {
  const s = useGame();
  const returning = s.stats.harvests > 0 || s.tick > 48;
  const fresh = () => confirm('Start a brand-new farm? Your current farm will be replaced (export it from the menu first if you want to keep it).') && (newGame(), onPlay());
  return (
    <div className="title-screen" role="dialog" aria-modal="true" aria-label="Welcome to Agrarian">
      <div className="title-card">
        <LogoMark size={104} />
        <h1 className="title-name">Agrarian</h1>
        <p className="title-tag">Grow a little farm into a farming empire.</p>
        <ul className="title-points">
          <li><span>🌱</span>Plant, harvest and sell — one field at a time</li>
          <li><span>🐔</span>Raise animals, plant orchards, beat the frost</li>
          <li><span>🏭</span>Build mills and markets, then take on the world</li>
        </ul>
        <div className="title-actions">
          <button className="btn primary lg" autoFocus onClick={onPlay}>{returning ? 'Continue your farm' : 'Start farming'}</button>
          {returning && <button className="btn ghost" onClick={fresh}>Start a new farm</button>}
          <button className="btn ghost" onClick={onHelp}>How to play</button>
        </div>
        <p className="faint small">{returning ? `Year ${Math.floor(s.tick / 2880) + 1} · ${s.fields.length} field${s.fields.length === 1 ? '' : 's'} · saved in this browser` : 'Your farm saves automatically in this browser.'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sidebar & top bar

function Trophies() {
  const s = useGame();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Achievements" title="Achievements">🏆</button>
      {open && (
        <Modal title={`Achievements · ${s.achievements.length} of ${ACHIEVEMENTS.length}`} wide onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>Close</button>}>
          <div className="badges">
            {ACHIEVEMENTS.map((a) => {
              const got = s.achievements.includes(a.id);
              return (
                <div key={a.id} className={`badge${got ? ' got' : ''}`} title={a.text}>
                  <span className="badge-icon">{got ? a.icon : '🔒'}</span>
                  <b>{a.name}</b>
                  <span className="small muted">{a.text}</span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

/** Cash with a little celebration: it pulses and shows "+$X" whenever sales come in. */
/** Goods on their way to the village market: a chip by the cash that opens the fleet. */
function HaulChip() {
  const s = useGame(), [open, setOpen] = useState(false);
  if (!usesCarts(s, 'heartland')) return null;
  const o = onTheWay(s), H = haulOf(s), wait = backlogHours(s), price = Math.round(VEHICLES.horse.price * s.macro.cpi);
  if (!H.trips.length && !H.pending.length && !open) return null;
  const total = o.waiting + o.moving, cut = marketCut(s), slow = cut || wait > 24;
  return <>
    <button type="button" data-coach="haul-chip" className={`haul-chip${slow ? ' slow' : ''}`} onClick={() => setOpen(true)} title="Goods on their way to the village market">
      🛒<span className="haul-word"> {money(Math.round(total))}</span>{cut ? ' · no road!' : Number.isFinite(o.next) ? ` · ${o.next}h` : ''}
    </button>
    {open && <Modal title="Carts to market" onClose={() => setOpen(false)} actions={<button className="btn primary" onClick={() => setOpen(false)}>Close</button>}>
      <div className="stack s">
        {cut && <div className="callout bad small">No road leads from your store to the main road, so nothing can leave. Draw one with 🛤 on the map.</div>}
        <p className="small muted">Market sales travel to the village market by road. You're paid when the goods arrive. Better roads and faster vehicles shorten every trip.</p>
        <div className="haul-fleet">{fleet(s).map((v) => { const trip = H.trips.find((t) => t.vehicle === v.id); return <div key={v.id} className="haul-row"><span>{VEHICLES[v.kind].icon} {VEHICLES[v.kind].name}</span><span className="muted small">{VEHICLES[v.kind].cap} a trip · {oneWay(s, v.kind)}h each way</span><b className="small">{trip ? (trip.arrive > s.tick ? `to market · ${trip.arrive - s.tick}h` : `coming back · ${trip.back - s.tick}h`) : 'in the yard'}</b></div>; })}</div>
        <dl className="facts small"><dt>On the road</dt><dd>{money(Math.round(o.moving))}</dd><dt>Waiting at the gate</dt><dd className={slow ? 'down' : ''}>{money(Math.round(o.waiting))}{o.waitingQty ? ` · ${Math.round(o.waitingQty)} units` : ''}</dd>{wait > 0 && <><dt>Cleared in</dt><dd className={slow ? 'down' : ''}>about {wait < 48 ? `${Math.ceil(wait)} hours` : `${Math.ceil(wait / 24)} days`}</dd></>}</dl>
        <button className="btn primary" disabled={price > s.cash} onClick={() => act({ type: 'buyHorseCart' })}>🐴 Buy a horse cart · {money(price)}</button>
        <span className="small muted">Horses eat about {money(12 * s.macro.cpi)} a day each. Trucks (Equipment page) carry {VEHICLES.truck.cap} at a time.</span>
      </div>
    </Modal>}
  </>;
}

function CashCounter() {
  const s = useGame();
  const earned = (s.lifetime.sale ?? 0) + (s.lifetime.contract ?? 0) + (s.lifetime.prize ?? 0);
  const prev = useRef(earned);
  const [pops, setPops] = useState<{ id: number; v: number }[]>([]);
  useEffect(() => {
    const d = earned - prev.current;
    prev.current = earned;
    if (d < 0.5) return;
    const id = Date.now() + Math.random();
    setPops((p) => [...p.slice(-3), { id, v: d }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1400);
  }, [earned]);
  return (
    <div className="top-stat big cash-counter" data-coach="cash">
      <span>Cash</span>
      <strong key={pops[pops.length - 1]?.id ?? 0} className={`mono ${s.cash < 0 ? 'down' : ''} ${pops.length ? 'bump' : ''}`}>{money(s.cash)}</strong>
      {pops.map((p) => <em key={p.id} className="cash-pop">+{money(p.v)}</em>)}
    </div>
  );
}

/** Confetti and a fanfare for the big moments: new era, achievements, daily prize. */
function Celebrations() {
  const s = useGame();
  const key = `${s.era}|${s.achievements.length}|${s.daily?.claimed ? s.daily.key : ''}`;
  const prev = useRef(key);
  const prevAch = useRef(s.achievements.length);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    const newAch = s.achievements.slice(prevAch.current);
    prevAch.current = s.achievements.length;
    for (const id of newAch) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) toast(`${a.icon} Achievement unlocked: ${a.name}`, 'ok');
    }
    sfx('celebrate');
    setBurst(Date.now());
  }, [key, s.achievements]);
  if (!burst) return null;
  return <Confetti key={burst} />;
}

function Confetti() {
  const [on, setOn] = useState(true);
  useEffect(() => { const t = setTimeout(() => setOn(false), 2600); return () => clearTimeout(t); }, []);
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  const colors = ['#f4b63f', '#6bb35a', '#d0603f', '#8ccbea', '#fff6dc', '#2f7a45'];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 70 }, (_, i) => (
        <i key={i} style={{ left: `${(i * 37) % 100}%`, background: colors[i % colors.length], animationDelay: `${(i % 10) * 0.05}s`, animationDuration: `${1.6 + ((i * 13) % 10) / 10}s`, transform: `rotate(${i * 47}deg)` }} />
      ))}
    </div>
  );
}

function TopBar({ onLog, onSettings, onHelp, onLedger, warnings, bare }: { onLog: () => void; onSettings: () => void; onHelp: () => void; onLedger: () => void; warnings: number; bare: boolean }) {
  const s = useGame();
  const speed = useStore(x => x.speed);
  const [time, setTime] = useState(false);
  const [menu, setMenu] = useState(false);
  const c = clock(s.tick);
  return <header className="topbar game-strip">
    <LogoMark size={28}/><div className="cash-wrap"><CashCounter /><HaulChip /></div>
    <button className="icon-btn" aria-label={speed ? 'Pause simulation' : 'Resume simulation'} onClick={()=>setSpeed(speed?0:1)}>{speed?'❚❚':'▶'}</button>
    <button className="btn time-toggle" data-coach="speed" aria-label="Time controls" aria-expanded={time} onClick={()=>{setTime(!time);setMenu(false);}}>{speed || 0}× ▾</button>
    {!bare && <button className="btn ledger-btn" aria-label="Ledger" data-coach="ledger" onClick={onLedger} title="All pages: fields, markets, finance and more">📚 Ledger</button>}
    <button className="icon-btn" aria-label="Farm menu" aria-expanded={menu} onClick={()=>{setMenu(!menu);setTime(false);}}>☰{warnings>0&&<span className="dot">{warnings}</span>}</button>
    {time && <div className="strip-popover">
      <div data-coach="clock">{c.season} {c.day} · Year {c.year} · {c.hour}</div>
      <div className="seg" role="radiogroup" aria-label="Simulation speed">{SPEEDS.filter(sp=>s.stats.sales>0||sp<=5).map(sp=><button key={sp} role="radio" aria-checked={speed===sp} className={speed===sp?'on':''} onClick={()=>{setSpeed(sp);setTime(false);}}>{sp===0?'❚❚':`${sp}×`}</button>)}</div>
    </div>}
    {menu && <div className="strip-popover menu-popover">
      {s.era>=2 && <span>Net worth {money(equity(s))}</span>}
      {s.log.length>0 && <button className="btn" onClick={()=>{setMenu(false);onLog();}}>Notifications {warnings>0?`(${warnings})`:''}</button>}
      {s.achievements.length>0 && <Trophies/>}
      <button className="btn" onClick={()=>{setMenu(false);onHelp();}}>Help</button>
      <button className="btn" onClick={()=>{setMenu(false);onSettings();}}>Save & settings</button>
    </div>}
  </header>;
}

// ---------------------------------------------------------------- notifications

function LogDrawer({ onClose }: { onClose: () => void }) {
  const s = useGame();
  const [filter, setFilter] = useState<'all' | 'important'>('all');
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  const rows = [...s.log].reverse().filter((l) => filter === 'all' || l.level !== 'info');
  return (
    <>
      <div className="modal-bg" style={{ background: 'rgb(0 0 0 / 0.15)' }} onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Notifications">
        <div className="row between">
          <h2>Notifications</h2>
          <div className="row">
            <div className="seg">
              <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'important' ? 'on' : ''} onClick={() => setFilter('important')}>Important</button>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <ol className="log">
          {rows.map((e) => {
            const target = e.page && PAGES.find((p) => p.id === e.page)?.unlocked(s) ? e.page : null;
            return (
              <li key={e.id} className={`${e.level}${target ? ' link' : ''}`} onClick={() => target && (go(target), onClose())}>
                <span className="mono">{stamp(e.tick)}</span>
                <span>{e.text}</span>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- modals

function Decisions() {
  const s = useGame();
  const speed = useStore(x => x.speed);
  const e = s.events.find((x) => x.choice && !x.choice.chosen && s.tick >= x.start);
  if (!e?.choice) return null;
  return (
    <Modal title={e.title}>
      <p>{e.text}</p>
      {e.kind === 'antitrust' && <div className="stack s">
        <strong className="mono">{money(Math.max(10000, sumBooks(s,120,['sale'])*0.03))} · {Math.max(0,Math.ceil((e.choice.deadline-s.tick)/24))} days to auto-settle</strong>
        <Bar value={Math.max(0,(e.choice.deadline-s.tick)/(e.choice.deadline-e.start))} label="Time remaining to decide" />
        <span className="muted">Keep regional crop market share below 35% to reduce probes.</span>
        <button className="btn primary" disabled={speed===0} onClick={()=>setSpeed(0)}>{speed===0?'Paused · take your time':'Pause to decide'}</button>
      </div>}
      <p className="muted small">Decide by {stamp(e.choice.deadline)} — otherwise the cautious option is taken for you.</p>
      <div className="stack s">
        {e.choice.options.map((o) => (
          <button key={o.id} className="btn ghost block" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', padding: 12 }} onClick={() => act({ type: 'chooseEvent', eventId: e.id, option: o.id })}>
            <span><b>{o.label}</b><br /><span className="muted">{o.detail}</span></span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function Bankrupt() {
  const s = useGame();
  if (!s.bankrupt) return null;
  const p = restructurePreview(s);
  return (
    <Modal title="Your business is insolvent">
      <p>{s.bankrupt.reason}</p>
      <div className="callout bad">
        <b>Restructure:</b> stock is sold, staff are cut to what your land needs, and only as many assets are fire-sold as the bank requires. All debt becomes one 360-day loan at a high rate, and your reputation falls sharply.
        <div className="small" style={{ marginTop: 6 }}>Owed: <b className="mono">{money(p.owed)}</b> · the bank will lend against your assets up to <b className="mono">{money(p.lendable)}</b></div>
      </div>
      <p className="muted">Or abandon the company and start a fresh homestead.</p>
      <div className="row end wrap">
        <button className="btn ghost" onClick={exportSave} title="Download this save as a file first — a backup before you decide">Export save</button>
        <button className="btn danger" onClick={() => confirm('Abandon this company and start a new game?') && newGame()}>Start over</button>
        <button className="btn primary" onClick={() => act({ type: 'restructure' })}>Restructure</button>
      </div>
    </Modal>
  );
}

function Away() {
  const away = useStore((x) => x.away);
  if (!away) return null;
  const [headline, ...rest] = away.summary;
  return (
    <Modal title="Welcome back! 👋" onClose={dismissAway} actions={<button className="btn gold lg" autoFocus onClick={dismissAway}>{away.earned > 0 ? `Collect ${money(away.earned)}` : 'Back to the farm'}</button>}>
      {away.earned > 0 && <div className="welcome-earned"><span>💰</span><div><b className="mono">{money(away.earned)}</b><span className="muted"> profit while you were away</span></div></div>}
      {away.earned < 0 && <div className="welcome-earned"><span>📉</span><div><b className="mono down">{money(-away.earned)}</b><span className="muted"> lost while you were away{getGame().advisor ? ' — your 📉 advisor on the farm explains why' : ' — a farm advisor (Workers page) can tell you why'}</span></div></div>}
      <p className="muted">{headline}</p>
      <ul>{rest.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </Modal>
  );
}

function CatchUp() {
  const c = useStore((x) => x.catchUp);
  if (!c) return null;
  return (
    <div className="splash">
      <div className="card">
        <h2>Catching up on lost time…</h2>
        <p className="muted">Simulating {Math.round(c.total / 24)} in-game days with the same rules as live play.</p>
        <div className="bar"><div style={{ width: `${(c.done / c.total) * 100}%` }} /></div>
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useStore((x) => x.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

function Settings({ onClose, theme, setTheme }: { onClose: () => void; theme: string; setTheme: (t: 'auto' | 'light' | 'dark') => void }) {
  const s = useGame();
  const file = useRef<HTMLInputElement>(null);
  const [slots, setSlots] = useState<Awaited<ReturnType<typeof slotInfo>> | null>(null);
  const refresh = () => void slotInfo().then(setSlots);
  useEffect(refresh, []);
  const row = (slot: Slot): ReactNode => {
    const i = slots?.[slot];
    return (
      <tr key={slot}>
        <td><b>{slotLabel(slot)}</b></td>
        <td className="muted small">{i ? `Year ${Math.ceil(i.day / 120)} · day ${((i.day - 1) % 120) + 1} · Era ${i.era} · ${money(i.cash)} · ${new Date(i.savedAt).toLocaleString()}` : 'Empty'}</td>
        <td className="r">
          <div className="row end">
            {slot !== 'auto' && <button className="btn ghost sm" onClick={() => void saveTo(slot).then(refresh)}>Save here</button>}
            <button className="btn ghost sm" disabled={!i} onClick={() => confirm('Load this save? Unsaved progress in the current game is lost.') && void loadFrom(slot).then(onClose)}>Load</button>
            {slot !== 'auto' && <button className="btn ghost sm" disabled={!i} onClick={() => confirm('Delete this save?') && void deleteSlot(slot).then(refresh)}>Delete</button>}
          </div>
        </td>
      </tr>
    );
  };
  return (
    <Modal title="Game menu" onClose={onClose} wide actions={<button className="btn primary" onClick={onClose}>Done</button>}>
      <section className="stack s">
        <h3>Saves</h3>
        <p className="muted small">The game autosaves every 15 seconds and whenever you leave the page. Saves live in this browser — export a file to back up or move your farm.</p>
        <div className="table-wrap"><table className="t"><tbody>{SLOTS.map(row)}</tbody></table></div>
        <div className="row wrap">
          <button className="btn ghost sm" onClick={exportSave}>Export save file</button>
          <button className="btn ghost sm" onClick={() => file.current?.click()}>Import save file</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importSave(e.target.files[0]).then(onClose)} />
          <button className="btn danger sm" onClick={() => confirm('Start a new game? Your autosave will be replaced. Save to a slot or export first to keep this farm.') && (newGame(), onClose())}>New game</button>
        </div>
      </section>
      <hr className="sep" />
      <section className="stack s">
        <h3>Display & guide</h3>
        <div className="row wrap">
          <span className="muted small" style={{ width: 80 }}>Theme</span>
          <div className="seg">{(['auto', 'light', 'dark'] as const).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        </div>
        <GraphicsSetting />
        <OfflineSetting />
        <SoundSetting />
        <div className="row wrap">
          <span className="muted small" style={{ width: 80 }}>Farm journal</span>
          {tipsOff(s) ? <button className="btn ghost sm" onClick={tipsOn}>Show the journal</button> : <button className="btn ghost sm" onClick={() => act({ type: 'seeTip', tip: '__off' }, 'Tips turned off.')}>Hide the journal</button>}
          <button className="btn ghost sm" onClick={resetTips}>Replay from the start</button>
        </div>
      </section>
    </Modal>
  );
}

function SoundSetting() {
  const [v, setV] = useState(volumes());
  const set = (k: 'sfx' | 'music', x: number) => { setVolume(k, x); setV(volumes()); if (k === 'sfx') sfx('click'); };
  return (
    <>
      {(['music', 'sfx'] as const).map((k) => (
        <div key={k} className="row wrap">
          <span className="muted small" style={{ width: 80 }}>{k === 'music' ? 'Music' : 'Sound effects'}</span>
          <input type="range" min={0} max={1} step={0.05} value={v[k]} aria-label={k === 'music' ? 'Music volume' : 'Sound effects volume'} onChange={(e) => set(k, Number(e.target.value))} style={{ width: 180 }} />
          <button className="btn ghost sm" onClick={() => set(k, v[k] > 0 ? 0 : k === 'music' ? 0.35 : 0.7)}>{v[k] > 0 ? 'Mute' : 'Unmute'}</button>
        </div>
      ))}
    </>
  );
}

function OfflineSetting() {
  const [on, setOn] = usePref<boolean>('offline', offlineOn());
  return (
    <div className="row wrap">
      <span className="muted small" style={{ width: 80 }}>While away</span>
      <div className="seg">{([true, false] as const).map((v) => <button key={String(v)} className={on === v ? 'on' : ''} onClick={() => setOn(v)}>{v ? 'Farm keeps working' : 'Time stops'}</button>)}</div>
      <span className="muted small">Leaving the game paused always stops time. Up to 6 hours count; time also stops if your cash runs out.</span>
    </div>
  );
}

function GraphicsSetting() {
  const [q, setQ] = usePref<'high' | 'low'>('graphics', 'high');
  return (
    <div className="row wrap">
      <span className="muted small" style={{ width: 80 }}>Graphics</span>
      <div className="seg">{(['high', 'low'] as const).map((v) => <button key={v} className={q === v ? 'on' : ''} onClick={() => setQ(v)}>{v === 'high' ? 'High' : 'Low (faster)'}</button>)}</div>
      {q !== graphicsQuality() && <button className="btn ghost sm" onClick={() => location.reload()}>Apply (reload)</button>}
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose} wide actions={<button className="btn primary" onClick={onClose}>Close</button>}>
      <p>Start with one hectare and grow it into a global agricultural company. Every system appears when you have a reason to use it — follow the <b>Objective</b> bar and the guide tips, and hover any <span className="ibtn" style={{ display: 'inline-grid' }}>i</span> to see the numbers behind a metric.</p>
      <div className="grid2">
        <div className="stack s">
          <h3>Keyboard</h3>
          <dl className="facts">
            <dt><kbd>Space</kbd></dt><dd>Pause / resume</dd>
            <dt><kbd>1</kbd>–<kbd>6</kbd></dt><dd>Speed: pause … 50×</dd>
            <dt><kbd>P</kbd></dt><dd>Plant the selected plot</dd>
            <dt><kbd>H</kbd></dt><dd>Harvest every ready plot</dd>
            <dt><kbd>B</kbd></dt><dd>Buy another plot</dd>
            <dt><kbd>N</kbd></dt><dd>Notifications</dd>
            <dt><kbd>?</kbd></dt><dd>This help</dd>
          </dl>
        </div>
        <div className="stack s">
          <h3>Good to know</h3>
          <ul className="small">
            <li>One real second is one in-game hour at 1×. Speed never changes the economics.</li>
            <li>Selling in bulk pushes prices down; the dip fades over about a day.</li>
            <li>Workers are paid every working hour, busy or idle.</li>
            <li>Repeating one crop drains the soil and breeds pests — rotate.</li>
            <li>The farm keeps running while you are away (up to 6 hours).</li>
            <li>On the farm: drag to look around, scroll or pinch to zoom, Q/E to rotate, click fields and buildings.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- keyboard

function useShortcuts(h: { help: () => void; log: () => void }) {
  const prev = useRef<Speed>(1);
  const speed = useStore((x) => x.speed);
  const sales = useGame().stats.sales;
  const live = useRef({ ...h, speed, sales });
  live.current = { ...h, speed, sales };
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey;
    // Space always means pause — even with a popup open — so it must never "press" the focused button (that fires on keyup).
    const onSpaceUp = (e: KeyboardEvent) => { if (e.key === ' ' && !typing(e)) e.preventDefault(); };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const L = live.current;
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat) return;
        if (L.speed === 0) setSpeed(prev.current);
        else (prev.current = L.speed), setSpeed(0);
      } else if ((e.target as HTMLElement).closest('[role=dialog]')) return;
      else if (/^[1-6]$/.test(e.key) && (L.sales > 0 || SPEEDS[+e.key - 1] <= 5)) setSpeed(SPEEDS[+e.key - 1]);
      else if (e.key === '?') L.help();
      else if (e.key === 'n') L.log();
    };
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onSpaceUp, true);
    return () => (removeEventListener('keydown', onKey, true), removeEventListener('keyup', onSpaceUp, true));
  }, []);
}

function SheetGrip() {
  const start=useRef<number|null>(null),dragged=useRef(false);
  const reset=(button:HTMLButtonElement)=>{const panel=button.closest<HTMLElement>('.page-drawer');if(panel)panel.style.transform='';};
  return <button className="sheet-grip" aria-label="Close panel" onClick={()=>{if(!dragged.current)go('farm');}}
    onPointerDown={e=>{start.current=e.clientY;dragged.current=false;e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(start.current===null)return;const y=Math.max(0,e.clientY-start.current);const panel=e.currentTarget.closest<HTMLElement>('.page-drawer');if(panel)panel.style.transform=`translateY(${Math.min(160,y)}px)`;}}
    onPointerUp={e=>{dragged.current=start.current!==null&&e.clientY-start.current>50;start.current=null;reset(e.currentTarget);if(dragged.current)go('farm');}}
    onPointerCancel={e=>{start.current=null;reset(e.currentTarget);}}><span /></button>;
}

/** A crash inside one page shows a notice in the drawer instead of blanking the whole game. */
class PageGuard extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Page crashed:', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <p>This page hit a problem. Your farm is safe and still running.</p>
        <p className="mono">{this.state.error.message}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
