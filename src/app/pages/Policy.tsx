import { CONFIG, CROP_IDS, GOODS, REGIONS, type CropId, type RegionId } from '../../simulation/config';
import { activeEvents } from '../../simulation/core';
import { marketShare } from '../../simulation/corporate';
import { MILESTONES } from '../../simulation/engine';
import type { GameState } from '../../simulation/types';
import { useGame } from '../../stores/game';
import { duration, num, pct, pct0 } from '../format';
import { Bar, Card, Info, Kpi, PageHead, Table, type Col } from '../ui';
import { GoodName, unlockedRegions } from './shared';

export default function PolicyPage() {
  const s = useGame();
  return (
    <div className="stack l">
      <PageHead title="Policy" sub="Reputation, regulation and your long-term legacy." />
      <div className="grid2">
        <Reputation s={s} />
        <Environment s={s} />
      </div>
      <MarketPower s={s} />
      <Milestones s={s} />
    </div>
  );
}

function Reputation({ s }: { s: GameState }) {
  const rep = s.corp.reputation;
  const d = rep - 50;
  return (
    <Card title="Reputation" info="How lenders, buyers, workers and regulators see you, from 0 to 100. Everyone starts at 50.">
      <div className="stack">
        <div className="stack s">
          <div className="row between"><span className="muted small">Score</span><b className={`mono ${rep < 40 ? 'down' : rep > 60 ? 'up' : ''}`}>{Math.round(rep)}/100</b></div>
          <Bar value={rep / 100} color={rep < 40 ? 'var(--down)' : 'var(--accent)'} label="Reputation" />
        </div>
        <div>
          <h3>What it changes</h3>
          <dl className="facts" style={{ marginTop: 6 }}>
            <dt>Loan spread</dt><dd className={d < 0 ? 'down' : 'up'}>{pct(-d * 0.0004, 2)}</dd>
            <dt>Contract premiums</dt><dd className={d < 0 ? 'down' : 'up'}>{pct(d / 1000, 1)}</dd>
            <dt>Worker morale target</dt><dd className={d < 0 ? 'down' : 'up'}>{pct((0.15 * d) / 50, 1)}</dd>
            <dt>Antitrust probe odds</dt><dd className={d < 0 ? 'down' : 'up'}>×{(1 - d / 50).toFixed(2)}</dd>
          </dl>
        </div>
        <div>
          <h3>What moves it</h3>
          <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li><span className="up">Up:</span> dividends (up to +5), fulfilled contracts (+0.5), divesting in an antitrust case (+2).</li>
            <li><span className="down">Down:</span> missed loan payments (−1), contract shortfalls (−2), fertiliser runoff (−0.3), settling antitrust (−3), restructuring (−25).</li>
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Environment({ s }: { s: GameState }) {
  return (
    <Card title="Environmental record" info="Regulators, buyers and the climate keep score.">
      <div className="stack">
        <div className="kpis">
          <Kpi label="Runoff incidents" value={num(s.corp.runoff)} tone={s.corp.runoff > 0 ? 'warn' : undefined}
            info="Times fertiliser pushed a field's nutrients past safe levels. Each one washes nitrates into waterways, damages soil organic matter and costs 0.3 reputation. Precision fertilisation prevents it." />
          <Kpi label="Emissions" value={`${num(s.macro.emissions / 1000, 1)} t`}
            info="Recent CO₂ from fuel your machines burn (decays about 1% a day as it disperses into the global total). It adds to the pace of warming on the World page." />
          <Kpi label="Warming" value={`+${s.macro.climate.toFixed(2)}°C`} info="Global temperature anomaly since the game began." />
        </div>
      </div>
    </Card>
  );
}

interface ShareRow { r: RegionId; c: CropId; share: number; probe: boolean }

function MarketPower({ s }: { s: GameState }) {
  const rows: ShareRow[] = [];
  for (const r of unlockedRegions(s)) for (const c of CROP_IDS) {
    const share = marketShare(s, r, c);
    if (share >= 0.005) rows.push({ r, c, share, probe: activeEvents(s, 'antitrust', r, c).length > 0 });
  }
  const T = CONFIG.antitrustShare;
  const cols: Col<ShareRow>[] = [
    { key: 'r', label: 'Region', render: (x) => REGIONS[x.r].name, sort: (x) => x.r },
    { key: 'c', label: 'Crop', render: (x) => <GoodName g={x.c} />, sort: (x) => GOODS[x.c].name },
    { key: 'share', label: 'Your share', align: 'r', render: (x) => <span className={`mono ${x.share >= T ? 'down' : x.share >= T * 0.8 ? 'warn' : ''}`}>{pct0(x.share)}</span>, sort: (x) => x.share },
    { key: 'bar', label: '', render: (x) => <div style={{ minWidth: 100 }}><Bar thin value={x.share} color={x.share >= T ? 'var(--down)' : undefined} label="Share" /></div> },
    { key: 'st', label: 'Status', render: (x) => (x.probe ? <span className="pill bad">Under investigation</span> : x.share >= T ? <span className="pill warn">Above threshold</span> : <span className="faint small">—</span>), sort: (x) => (x.probe ? 2 : x.share >= T ? 1 : 0) },
  ];
  const probes = s.events.filter((e) => e.kind === 'antitrust' && e.start <= s.tick && e.end > s.tick);
  return (
    <Card title="Market power" info={`Your share of each regional crop market's consumption over roughly 30 days. From Era 7, holding ${pct0(T)} or more risks an antitrust probe — more likely when your reputation is low.`}>
      <div className="stack">
        {probes.map((e) => (
          <div key={e.id} className="callout bad small">
            <b>{e.title}</b> <span className="muted">· {duration(e.end - s.tick)} left</span>
            <p>{e.text} {e.choice && !e.choice.chosen ? 'Choose to settle or divest in the decision dialog; if you do nothing, you settle at the deadline.' : ''}</p>
          </div>
        ))}
        <Table rows={rows} cols={cols} rowKey={(x) => `${x.r}${x.c}`} initialSort={{ key: 'share', dir: -1 }} empty="You have not sold enough to hold a measurable share of any market." />
      </div>
    </Card>
  );
}

function Milestones({ s }: { s: GameState }) {
  return (
    <Card title="Milestones" info="Long-term goals for a global food company. Progress is tracked now; they can only be achieved in Era 8.">
      <div className="stack">
        {s.era < 8 && <p className="callout small">Milestones become achievable in Era 8 (Global Food System). Progress shown is where you stand today.</p>}
        <div className="grid2">
          {MILESTONES.map((m) => {
            const done = s.milestones.includes(m.id);
            const p = Math.min(1, m.progress(s));
            return (
              <div key={m.id} className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <div className="row between"><b>{m.name}</b>{done ? <span className="pill gold">Achieved</span> : <span className="mono small">{pct0(p)}</span>}</div>
                <p className="small muted">{m.text}</p>
                <Bar thin value={done ? 1 : p} color={done ? 'var(--gold)' : undefined} label={m.name} />
              </div>
            );
          })}
        </div>
        <p className="small muted">{MILESTONES.filter(m => s.milestones.includes(m.id)).length} of {MILESTONES.length} achieved.<Info text="Achieved milestones are permanent. Frontier marks have their own count on Overview." /></p>
      </div>
    </Card>
  );
}
