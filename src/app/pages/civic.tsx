// Building blocks shared by the Community and Town panels: status tiles, the one next step, and build cards.
import type { ReactNode } from 'react';

export type Tone = 'good' | 'ok' | 'bad' | 'none';
/** Green from `good`, amber from `ok`, red below. */
export const toneOf = (v: number, good = 0.8, ok = 0.5): Tone => (v >= good ? 'good' : v >= ok ? 'ok' : 'bad');

export function StatTile({ icon, value, label, tone = 'none' }: { icon: ReactNode; value: ReactNode; label: string; tone?: Tone }) {
  return <div className={`civ-tile ${tone}`}><span className="civ-tile-icon" aria-hidden>{icon}</span><b>{value}</b><small>{label}</small></div>;
}

/** The single most useful thing to do now. */
export function NextStep({ icon, title, text, action, tone = 'ok' }: { icon: ReactNode; title: string; text: ReactNode; action?: ReactNode; tone?: Tone }) {
  return <div className={`civ-next ${tone}`} role="status"><span className="civ-next-icon" aria-hidden>{icon}</span><div><b>{title}</b><small>{text}</small></div>{action}</div>;
}

export function BuildCard({ img, fallback, name, lines, action, locked }: { img: string; fallback: string; name: ReactNode; lines: ReactNode[]; action: ReactNode; locked?: string }) {
  return <article className={`civ-build${locked ? ' locked' : ''}`}>
    <div className="civ-build-art">{img ? <img src={img} alt="" /> : <span>{fallback}</span>}</div>
    <div className="civ-build-body"><h3>{name}</h3>{lines.map((l, i) => <span key={i}>{l}</span>)}</div>
    <div className="civ-build-act">{locked ? <span className="civ-lock">🔒 {locked}</span> : action}</div>
  </article>;
}

/** A labelled setting row: name and its effect on the left, the control on the right. */
export function SettingRow({ name, effect, children }: { name: string; effect: ReactNode; children: ReactNode }) {
  return <div className="civ-setting"><div><b>{name}</b><small>{effect}</small></div>{children}</div>;
}
