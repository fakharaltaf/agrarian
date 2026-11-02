import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { ERAS } from '../simulation/config';
import { equity } from '../simulation/core';
import { ACHIEVEMENTS, PAGES } from '../simulation/engine';
import {
  act, deleteSlot, getGame, offlineOn, dismissAway, toast, exportSave, go, importSave, loadFrom, newGame, saveTo, setSpeed, slotInfo, slotLabel, SLOTS, SPEEDS, useGame, useStore, type Slot, type Speed,
} from '../stores/game';
import { Coach, resetTips, tipsOff, tipsOn } from './Coach';
import { clock, money, stamp } from './format';
import { Icon } from './icons';
import { LogoMark, Wordmark } from './Logo';
import { Modal, usePref } from './ui';
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
};

export function App() {
  const s = useGame();
  const page = useStore((x) => x.page);
  const ready = useStore((x) => x.ready);
  const [theme, setTheme] = usePref<'auto' | 'light' | 'dark'>('theme', 'auto');
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
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
      {!bare && <Sidebar current={current} />}
      <div className="main">
        <TopBar onLog={() => setDrawer(true)} onSettings={() => setSettings(true)} onHelp={() => setHelp(true)} warnings={warnings} bare={bare} />
        <div className="stage">
          <Hud />
          {Page && (
            <section className="page-drawer" role="dialog" aria-label={PAGES.find((p) => p.id === current)?.label}>
              <button className="icon-btn page-close" onClick={() => go('farm')} aria-label="Back to the farm (Esc)" title="Back to the farm (Esc)">✕</button>
              <Suspense fallback={<div className="empty">Loading…</div>}>
                <Page key={current} />
              </Suspense>
            </section>
          )}
        </div>
      </div>
      {!bare && (
        <nav className="mobile-nav" aria-label="Pages">
          <button className={current === 'farm' ? 'on' : ''} onClick={() => go('farm')}>Farm</button>
          {unlocked.map((p) => <button key={p.id} className={p.id === current ? 'on' : ''} onClick={() => go(p.id)}>{p.label}</button>)}
        </nav>
      )}
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

function Sidebar({ current }: { current: string }) {
  const s = useGame();
  const era = ERAS[s.era - 1];
  const next = ERAS[s.era];
  const decisions = s.events.filter((e) => e.choice && !e.choice.chosen && s.tick >= e.start).length;
  return (
    <aside className="side" aria-label="Navigation">
      <div className="brand" title="Agrarian"><LogoMark size={40} title="Agrarian" /></div>
      <nav className="nav" data-coach="nav">
        <button className={current === 'farm' ? 'on' : ''} onClick={() => go('farm')} aria-current={current === 'farm' ? 'page' : undefined} title="Your farm">
          <Icon name="fields" className="ico" />Farm
        </button>
        {PAGES.filter((p) => p.unlocked(s) && p.id !== 'fields').map((p) => (
          <button key={p.id} className={p.id === current ? 'on' : ''} onClick={() => go(p.id)} data-coach={`nav-${p.id}`} aria-current={p.id === current ? 'page' : undefined} title={p.purpose}>
            <Icon name={p.id} className="ico" />
            {p.label}
            {p.id === 'world' && decisions > 0 ? <span className="count">{decisions}</span> : !s.seenTips.includes(`page:${p.id}`) && <span className="new" aria-label="new" />}
          </button>
        ))}
      </nav>
      <div className="side-foot" title={`${era.name}: ${era.theme}${next ? ` · Next: ${next.name} — ${next.requirement}` : ''}`}>
        <div className="era-chip"><span>Era</span><b>{s.era}</b></div>
      </div>
    </aside>
  );
}

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

function TopBar({ onLog, onSettings, onHelp, warnings, bare }: { onLog: () => void; onSettings: () => void; onHelp: () => void; warnings: number; bare: boolean }) {
  const s = useGame();
  const speed = useStore((x) => x.speed);
  const c = clock(s.tick);
  return (
    <header className="topbar">
      {bare && <Wordmark size={19} />}
      <div className="clock" data-coach="clock" aria-label="Game date">
        <span className="mono">{c.hour}</span>
        <span>{c.season} {c.day}</span>
        <span className="muted">Year {c.year}</span>
      </div>
      {s.stats.sales > 0 && (
        <div className="seg" role="radiogroup" aria-label="Simulation speed" data-coach="speed">
          {SPEEDS.map((sp, i) => (
            <button key={sp} role="radio" aria-checked={speed === sp} className={speed === sp ? 'on' : ''} onClick={() => setSpeed(sp)} title={`Key ${i + 1}${sp === 0 ? ' or Space' : ''}`}>{sp === 0 ? '❚❚' : `${sp}×`}</button>
          ))}
        </div>
      )}
      <div className="top-stats">
        {s.era >= 2 && <div className="top-stat" title="Assets minus debt, with stock at market value"><span>Net worth</span><strong className="mono">{money(equity(s))}</strong></div>}
        <CashCounter />
        <button className="icon-btn" onClick={onLog} aria-label="Notifications" title="Notifications (N)">
          <Icon name="bell" />
          {warnings > 0 && <span className="dot">{warnings}</span>}
        </button>
        <Trophies />
        <button className="icon-btn" onClick={onHelp} aria-label="Help" title="Help (?)"><Icon name="help" /></button>
        <button className="icon-btn" onClick={onSettings} aria-label="Game menu" title="Save, load and settings"><Icon name="settings" /></button>
      </div>
    </header>
  );
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
  const e = s.events.find((x) => x.choice && !x.choice.chosen && s.tick >= x.start);
  if (!e?.choice) return null;
  return (
    <Modal title={e.title}>
      <p>{e.text}</p>
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
        if (e.repeat || L.sales === 0) return;
        if (L.speed === 0) setSpeed(prev.current);
        else (prev.current = L.speed), setSpeed(0);
      } else if ((e.target as HTMLElement).closest('[role=dialog]')) return;
      else if (/^[1-6]$/.test(e.key) && L.sales > 0) setSpeed(SPEEDS[+e.key - 1]);
      else if (e.key === '?') L.help();
      else if (e.key === 'n') L.log();
    };
    addEventListener('keydown', onKey, true);
    addEventListener('keyup', onSpaceUp, true);
    return () => (removeEventListener('keydown', onKey, true), removeEventListener('keyup', onSpaceUp, true));
  }, []);
}
