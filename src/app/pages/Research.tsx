import { BUILDINGS, TECH, TECHS, type TechDef } from '../../simulation/config';
import { has } from '../../simulation/core';
import { buildingPrice } from '../../simulation/engine';
import { canResearch, labLevel, researchSpeed } from '../../simulation/research';
import type { GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0 } from '../format';
import { Bar, Card, Confirm, Info, Kpi, PageHead } from '../ui';

const CATEGORIES = [...new Set(TECHS.map((t) => t.category))];
const depth = (t: TechDef): number => (t.requires.length ? 1 + Math.max(...t.requires.map((r) => depth(TECH[r]))) : 0);
const COLUMNS = CATEGORIES.map((c) => ({ c, techs: TECHS.filter((t) => t.category === c).sort((a, b) => depth(a) - depth(b) || a.cost - b.cost) }));

export default function ResearchPage() {
  const s = useGame();
  const lvl = labLevel(s);
  const a = s.research.active;
  const at = a ? TECH[a.id] : null;
  const left = a && at ? ((1 - a.progress) * at.days) / researchSpeed(s) : 0;
  const spent = -(s.lifetime.research ?? 0);
  return (
    <div className="stack l">
      <PageHead title="Research" sub="Pay once, benefit forever. One project runs at a time; an advanced laboratory unlocks the hardest projects and doubles research speed." />
      <div className="kpis">
        <Kpi label="Laboratory" value={lvl === 2 ? 'Advanced' : lvl === 1 ? 'Research station' : 'None'} tone={lvl ? undefined : 'warn'} info="A paused or demolished lab stalls the running project." />
        <Kpi label="Technologies" value={`${s.research.done.length} / ${TECHS.length}`} sub={s.research.licensed.length ? `+ ${s.research.licensed.length} licensed` : undefined} />
        <Kpi label="Spent on research" value={money(spent)} />
        <Kpi label="Research speed" value={lvl ? `${researchSpeed(s)}×` : '—'} info="Strongest active lab leads. Station levels: 1× / 1.5× / 2×. Advanced levels: 2× / 3× / 4×. Extra labs do not stack." />
      </div>
      <div className="grid2">
        <LabCard s={s} lvl={lvl} />
        <Card title="Active project">
          {a && at ? (
            <div className="stack">
              <div className="row between"><b>{at.name}</b><span className="pill accent">{at.category}</span></div>
              <Bar value={a.progress} label="Research progress" />
              <div className="row between small">
                <span className="mono">{pct0(a.progress)}</span>
                <span className={lvl ? 'muted' : 'warn'}>{lvl ? `${num(left, 1)} days remaining` : 'Stalled — no running lab'}</span>
              </div>
              <p className="explain">{at.benefit}</p>
            </div>
          ) : <p className="explain">{lvl ? 'No project running. Pick an available technology below.' : 'Build a research station to start a project.'}</p>}
        </Card>
      </div>
      {s.research.licensed.includes('droughtLicense') && (
        <div className="callout good"><b>Licensed: drought-tolerant seed.</b> Dry soil never cuts yields below 70% and yields are 3% higher; you pay a 5% royalty on the market value of every harvest. Researching Drought-resistant varieties yourself avoids the royalty.</div>
      )}
      <Card title="Technology tree" info="Columns are research categories; requirement chips show what each project needs, including links across categories. Highlighted cards are done.">
        <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(230px, 1fr)', gap: 14 }}>
            {COLUMNS.map(({ c, techs }) => (
              <div key={c} className="stack s" style={{ alignContent: 'start' }}>
                <h3 className="small" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', margin: '0 0 4px' }}>{c}</h3>
                {techs.map((t) => <TechCard key={t.id} s={s} t={t} />)}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function LabCard({ s, lvl }: { s: GameState; lvl: number }) {
  const paused = s.buildings.filter((b) => (b.type === 'lab' || b.type === 'lab2') && !b.active);
  const redundant = s.buildings.filter((b) => b.type === 'lab' && b.active);
  const labCost = buildingPrice(s, 'lab', 'heartland');
  const lab2Cost = buildingPrice(s, 'lab2', 'heartland');
  return (
    <Card title="Laboratory" info="Labs are built in Heartland Valley and pay staff every hour they run.">
      <div className="stack">
        {lvl === 0 ? <p className="explain">You need a research station to run projects. Staff cost {money(BUILDINGS.lab.staffPerHour * s.macro.cpi)}/h.</p>
          : <p className="explain">{lvl === 2 ? 'Advanced laboratory: runs every project.' : 'Research station: runs standard projects.'} Staff {money(BUILDINGS[lvl === 2 ? 'lab2' : 'lab'].staffPerHour * s.macro.cpi)}/h.</p>}
        {paused.length > 0 && (
          <div className="callout warn row between wrap">
            <span>{paused.length} lab{paused.length > 1 ? 's are' : ' is'} paused.</span>
            <button className="btn ghost sm" onClick={() => paused.forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id }))}>Resume</button>
          </div>
        )}
        {lvl === 0 && (
          <Confirm className="btn primary" disabled={labCost > s.cash} label={`Build a research station · ${money(labCost)}`} title="Build a research station?" confirmLabel={`Pay ${money(labCost)}`}
            body={<>A research station in Heartland Valley costs {money(labCost)} plus {money(BUILDINGS.lab.staffPerHour * s.macro.cpi)}/h in staff.</>}
            onConfirm={() => act({ type: 'build', region: 'heartland', building: 'lab' }, 'Research station built.')} />
        )}
        {lvl < 2 && s.era >= 5 && has(s, 'advancedLab') && (
          <Confirm className="btn ghost" disabled={lab2Cost > s.cash} label={`Build advanced laboratory · ${money(lab2Cost)}`} title="Build an advanced laboratory?" confirmLabel={`Pay ${money(lab2Cost)}`}
            body={<>Costs {money(lab2Cost)} plus {money(BUILDINGS.lab2.staffPerHour * s.macro.cpi)}/h in staff. Unlocks advanced projects and doubles research speed. Your research station keeps running alongside it; pause it here afterwards to save its staff cost.</>}
            onConfirm={() => act({ type: 'build', region: 'heartland', building: 'lab2' }, 'Advanced laboratory built.')} />
        )}
        {lvl === 2 && redundant.length > 0 && (
          <div className="row between wrap small">
            <span className="muted">Your research station is redundant next to the advanced lab.</span>
            <button className="btn ghost sm" onClick={() => redundant.forEach((b) => act({ type: 'toggleBuilding', buildingId: b.id }))}>Pause it · save {money(redundant.length * BUILDINGS.lab.staffPerHour * s.macro.cpi)}/h</button>
          </div>
        )}
        {lvl < 2 && !has(s, 'advancedLab') && <p className="faint small">Research “Advanced laboratory” to build one{s.era < 5 ? ' (from Era 5)' : ''}.</p>}
        {lvl < 2 && has(s, 'advancedLab') && s.era < 5 && <p className="faint small">The advanced laboratory can be built from Era 5.</p>}
      </div>
    </Card>
  );
}

function TechCard({ s, t }: { s: GameState; t: TechDef }) {
  const done = has(s, t.id);
  const active = s.research.active?.id === t.id;
  const why = done || active ? null : canResearch(s, t.id);
  const missing = t.requires.filter((r) => !has(s, r));
  const locked = !done && (missing.length > 0 || (t.advanced && labLevel(s) < 2));
  const state = done ? 'Done' : active ? 'Researching' : locked ? 'Locked' : 'Available';
  const cost = t.cost * s.macro.cpi;
  const days = t.days / (researchSpeed(s) || 1);
  return (
    <article className="card" style={{ padding: 12, borderColor: done ? 'var(--up)' : active ? 'var(--gold)' : undefined, background: done ? 'color-mix(in srgb, var(--up) 7%, var(--surface))' : undefined, opacity: locked ? 0.72 : 1, borderLeftWidth: 1 + depth(t) * 2 }}>
      <div className="stack s">
        <div className="row between" style={{ alignItems: 'start' }}>
          <b>{t.name}</b>
          <span className={`pill ${done ? 'good' : active ? 'gold' : locked ? '' : 'accent'}`}>{state}</span>
        </div>
        {(t.requires.length > 0 || t.advanced) && (
          <div className="row wrap" style={{ gap: 4 }}>
            {t.requires.map((r) => <span key={r} className={`pill ${has(s, r) ? 'good' : 'bad'}`} title={TECH[r].category}>{has(s, r) ? '✓' : '✗'} {TECH[r].name}</span>)}
            {t.advanced && <span className={`pill ${labLevel(s) === 2 ? 'good' : 'warn'}`}>Advanced lab</span>}
          </div>
        )}
        <p className="small">{t.benefit}</p>
        <p className="small muted">Trade-off: {t.tradeoff}</p>
        {!done && (
          <div className="row between wrap">
            <span className="mono small">{money(cost)} · {num(days, days % 1 ? 1 : 0)} days</span>
            {!active && (
              <Info text={why ?? 'Ready to start. The cost is paid up front.'} breakdown={[['Cost', money(cost)], ['Base days', String(t.days)], ['Lab speed', `${researchSpeed(s)}×`]]} />
            )}
          </div>
        )}
        {!done && !active && (
          <button className="btn primary sm" disabled={!!why} title={why ?? undefined} onClick={() => act({ type: 'research', tech: t.id }, `Started: ${t.name}.`)}>
            {why ? why.replace(/\.$/, '') : `Research · ${money(cost)}`}
          </button>
        )}
      </div>
    </article>
  );
}
