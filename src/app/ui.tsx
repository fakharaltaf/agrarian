import { tooltipPlacement } from './tooltip';
// Shared UI primitives. Pages compose these; nothing here knows about the simulation.
import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------- tooltip

/**
 * Hover/focus tooltip. `breakdown` renders label/value rows under the text — used to show the
 * actual numbers from the simulation behind a metric.
 */
export function Tip({ text, breakdown, children, block, tap=false }: { text: ReactNode; breakdown?: [string, string][]; children: ReactNode; block?: boolean; tap?: boolean }) {
  const ref=useRef<HTMLSpanElement>(null), pop=useRef<HTMLDivElement>(null);
  const [pos,setPos]=useState<ReturnType<typeof tooltipPlacement>|null>(null),[pinned,setPinned]=useState(false);
  const id=useId();
  const close=()=>{setPos(null);setPinned(false);};
  const show=()=>{
    const r=ref.current?.getBoundingClientRect();if(!r)return;
    if(r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth){close();return;}
    const next=tooltipPlacement(r,{width:innerWidth,height:innerHeight});
    setPos(old=>old&&Object.keys(next).every(k=>old[k as keyof typeof next]===next[k as keyof typeof next])?old:next);
  };
  // Follow a selected metric without a render loop when its numbers or position change.
  useLayoutEffect(()=>{if(pos)show();});
  useEffect(()=>{
    if(!pos)return;
    const outside=(event:PointerEvent)=>{const node=event.target as Node;
      if(node instanceof Element&&node.closest('button[aria-label="Pause simulation"],button[aria-label="Resume simulation"]'))return;
      if(!ref.current?.contains(node)&&!pop.current?.contains(node))close();};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){close();event.stopPropagation();}else if(event.key==='Tab')close();};
    const move=(event:Event)=>{if(pop.current?.contains(event.target as Node))return;if(pinned)show();else close();};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',key,true);
    window.addEventListener('resize',move);document.addEventListener('scroll',move,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',key,true);window.removeEventListener('resize',move);document.removeEventListener('scroll',move,true);};
  },[!!pos,pinned]);
  const trigger=isValidElement(children)&&typeof children.type==='string'?cloneElement(children as ReactElement<Record<string,unknown>>,{'aria-describedby':pos?id:undefined}):children;
  return <span ref={ref} className="tip-anchor" style={block?{display:'flex'}:undefined}
    onMouseEnter={()=>{if(!pinned)show();}} onMouseLeave={()=>{if(!pinned)setPos(null);}} onFocus={show} onBlur={()=>{if(!pinned)close();}}
    onClick={tap?event=>{event.stopPropagation();if(!ref.current?.contains(event.target as Node))return;if(pinned)close();else{setPinned(true);show();}}:undefined}>
    {trigger}
    {pos&&createPortal(<div ref={pop} id={id} role="tooltip" data-pinned={pinned} className="tip-pop" style={{left:pos.x,top:pos.y,width:pos.width,maxHeight:pos.maxHeight,transform:pos.below?undefined:'translateY(-100%)'}}>
      {text}{breakdown&&breakdown.length>0&&<div className="tip-break">{breakdown.map(([k,v],i)=>[<span key={`k${i}`}>{k}</span>,<span key={`v${i}`}>{v}</span>])}</div>}
    </div>,document.body)}
  </span>;
}

/** A small visual marker with a full touch target; tap again or outside to close. */
export const Info=({text,breakdown}:{text:ReactNode;breakdown?:[string,string][]})=>(
  <Tip text={text} breakdown={breakdown} tap><button type="button" className="ibtn" aria-label="Explain">i</button></Tip>
);

// ---------------------------------------------------------------- layout bits

export function Card({ title, info, actions, children, className = '', id, coach }: { title?: ReactNode; info?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string; coach?: string }) {
  return (
    <section className={`card ${className}`} id={id} data-coach={coach}>
      {(title || actions) && (
        <header className="card-head">
          <h2>{title}{info && <Info text={info} />}</h2>
          {actions && <div className="row wrap">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}

export function Kpi({ label, value, sub, info, breakdown, tone, big, coach }: { label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; breakdown?: [string, string][]; tone?: 'up' | 'down' | 'warn'; big?: boolean; coach?: string }) {
  return (
    <div className={`kpi${big ? ' big' : ''}`} data-coach={coach}>
      <span>{label}{info && <Info text={info} breakdown={breakdown} />}</span>
      <strong className={`mono ${tone ?? ''}`}>{value}</strong>
      {sub && <em className="muted">{sub}</em>}
    </div>
  );
}

export const Bar = ({ value, color, thin, label }: { value: number; color?: string; thin?: boolean; label?: string }) => (
  <div className={`bar${thin ? ' thin' : ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
    <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
  </div>
);

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; label: ReactNode; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} className={value === o.v ? 'on' : ''} disabled={o.disabled} title={o.title} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { v: T; label: ReactNode; hidden?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.filter((t) => !t.hidden).map((t) => (
        <button key={t.v} role="tab" aria-selected={value === t.v} className={value === t.v ? 'on' : ''} onClick={() => onChange(t.v)}>{t.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose, wide, actions }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean; actions?: ReactNode }) {
  const id = useId();
  useEffect(() => {
    if (!onClose) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} onClick={(e) => e.stopPropagation()}>
        <h2 id={id}>{title}</h2>
        {children}
        {actions && <div className="row end wrap">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A button that asks before doing something destructive or expensive. */
export function Confirm({ label, title, body, onConfirm, className = 'btn ghost sm', disabled, confirmLabel = 'Confirm' }: { label: ReactNode; title: string; body: ReactNode; onConfirm: () => void; className?: string; disabled?: boolean; confirmLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} disabled={disabled} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)} actions={<>
          <button className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn primary" autoFocus onClick={() => (setOpen(false), onConfirm())}>{confirmLabel}</button>
        </>}>
          <div className="explain" style={{ color: 'var(--text)' }}>{body}</div>
        </Modal>
      )}
    </>
  );
}

export function NumberInput({ value, onChange, min = 0, max, step = 1, label, width }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; label: string; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input className="input num" style={width ? { width } : undefined} inputMode="decimal" aria-label={label} value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value.replace(/[,$\s]/g, ''));
        if (Number.isFinite(n)) onChange(Math.max(min, max !== undefined ? Math.min(max, n) : n));
      }}
      onBlur={() => setText(String(value))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onChange(Math.min(max ?? Infinity, value + step));
        if (e.key === 'ArrowDown') onChange(Math.max(min, value - step));
      }}
    />
  );
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.v} value={o.v} disabled={o.disabled}>{o.label}</option>)}
    </select>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Swatch = ({ color }: { color: string }) => <i className="swatch" style={{ background: color }} />;

// ---------------------------------------------------------------- table

export interface Col<T> { key: string; label: ReactNode; render: (r: T) => ReactNode; sort?: (r: T) => number | string; align?: 'r'; width?: number }

/** Sortable, searchable table. Renders in pages of 100 rows so thousands of assets stay fast. */
export function Table<T>({ rows, cols, rowKey, search, onRow, selected, initialSort, empty = 'Nothing here yet.', scroll = true }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string | number; search?: (r: T) => string; onRow?: (r: T) => void; selected?: (r: T) => boolean;
  initialSort?: { key: string; dir: 1 | -1 }; empty?: ReactNode; scroll?: boolean;
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [limit, setLimit] = useState(100);
  const shown = useMemo(() => {
    let out = q && search ? rows.filter((r) => search(r).toLowerCase().includes(q.toLowerCase())) : rows;
    const col = sort && cols.find((c) => c.key === sort.key);
    if (col?.sort) {
      const f = col.sort;
      out = [...out].sort((a, b) => {
        const x = f(a), y = f(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort!.dir;
      });
    }
    return out;
  }, [rows, q, sort, cols, search]);
  return (
    <div className="stack s">
      {search && rows.length > 8 && <input className="input" placeholder="Search…" aria-label="Search table" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />}
      <div className={`table-wrap${scroll ? ' scroll' : ''}`}>
        <table className="t">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={`${c.align ?? ''} ${c.sort ? 'sortable' : ''}`} style={c.width ? { width: c.width } : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}
                  onClick={() => c.sort && setSort((s) => ({ key: c.key, dir: s?.key === c.key ? ((-s.dir) as 1 | -1) : -1 }))}>
                  {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r) => (
              <tr key={rowKey(r)} className={selected?.(r) ? 'sel' : ''} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
                {cols.map((c) => <td key={c.key} className={c.align ?? ''}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <Empty>{q ? 'No matches.' : empty}</Empty>}
      </div>
      {shown.length > limit && <button className="btn ghost sm" onClick={() => setLimit((l) => l + 200)}>Show more ({shown.length - limit} hidden)</button>}
    </div>
  );
}

// ---------------------------------------------------------------- misc hooks

/** Remembers a UI choice per browser (not part of the game save). */
export function usePref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`agrarian.ui.${key}`);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  const save = (x: T) => {
    setV(x);
    try { localStorage.setItem(`agrarian.ui.${key}`, JSON.stringify(x)); } catch { /* private mode */ }
  };
  return [v, save];
}

export function useElementRect(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) return setRect(null);
    let frame = 0;
    const tick = () => {
      const el = document.querySelector(selector);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) => (old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height ? old : r));
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [selector]);
  return rect;
}
