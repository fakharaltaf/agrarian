import { ARCHETYPES, GOODS, REGIONS, type CropId } from '../../simulation/config';
import { acquisitionPrice, askingPrice, diligenceCost, valuation } from '../../simulation/competitors';
import type { Competitor, GameState } from '../../simulation/types';
import { act, go, useGame } from '../../stores/game';
import { money, num, pct0, stamp } from '../format';
import { Card, Confirm, Info, PageHead, Table, Tip, type Col } from '../ui';

const STATUS: Record<Competitor['status'], string> = { active: 'good', distressed: 'warn', bankrupt: 'bad', acquired: 'accent' };

/** Share of farmland in the competitor's region (yours plus every rival still farming there). */
function landShare(s: GameState, c: Competitor) {
  const rivals = s.competitors.reduce((a, x) => a + (x.region === c.region && (x.status === 'active' || x.status === 'distressed') ? x.ha : 0), 0);
  const mine = s.fields.reduce((a, f) => a + (f.region === c.region ? f.ha : 0), 0);
  return c.ha / Math.max(1, rivals + mine);
}

const mixText = (c: Competitor) => (Object.entries(c.mix) as [CropId, number][]).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${GOODS[k].name} ${pct0(v)}`).join(' · ');

export default function CompetitorsPage() {
  const s = useGame();
  const cols: Col<Competitor>[] = [
    { key: 'name', label: 'Company', render: (c) => <b>{c.name}</b>, sort: (c) => c.name },
    { key: 'arch', label: 'Type', render: (c) => <Tip text={ARCHETYPES[c.archetype].blurb}><span className="muted" tabIndex={0}>{ARCHETYPES[c.archetype].label}</span></Tip>, sort: (c) => c.archetype },
    { key: 'region', label: 'Region', render: (c) => REGIONS[c.region].name, sort: (c) => c.region },
    { key: 'ha', label: 'Land', align: 'r', render: (c) => `${num(c.ha)} ha`, sort: (c) => c.ha },
    { key: 'share', label: <>Land share <Info text="Their hectares as a share of all farmland in the region (theirs, other rivals' and yours). A rough gauge of how much of the local crop they supply." /></>, align: 'r',
      render: (c) => (c.status === 'acquired' ? '—' : pct0(landShare(s, c))), sort: (c) => landShare(s, c) },
    { key: 'status', label: 'Status', render: (c) => <span className={`pill ${STATUS[c.status]}`}>{c.status}</span>, sort: (c) => c.status },
    { key: 'rev', label: 'Revenue 30d', align: 'r', render: (c) => money(c.revenue30), sort: (c) => c.revenue30 },
    { key: 'profit', label: 'Profit 30d', align: 'r', render: (c) => <span className={c.profit30 < 0 ? 'down' : ''}>{money(c.profit30)}</span>, sort: (c) => c.profit30 },
    { key: 'debt', label: 'Debt', align: 'r', render: (c) => money(c.debt), sort: (c) => c.debt },
    { key: 'mix', label: 'Crop mix', render: (c) => <span className="small muted">{mixText(c) || '—'}</span> },
  ];
  const reports = s.log.filter((l) => l.page === 'competitors').slice(-12).reverse();
  const live = s.competitors.filter((c) => c.status === 'active' || c.status === 'distressed');
  return (
    <div className="stack l">
      <PageHead title="Competitors" sub="Rival farms sell into the same markets you do. Their harvests set competing supply; their stress is your opportunity." />
      <Card title="Market players" info="Rivals shift land toward whatever crop pays best, expand when profitable and sell land when over-indebted. 30-day figures are smoothed.">
        <Table rows={s.competitors} cols={cols} rowKey={(c) => c.id} initialSort={{ key: 'ha', dir: -1 }} />
      </Card>
      {s.era >= 7 ? <Acquisitions s={s} rows={live} /> : <p className="faint small">Acquisitions open in Era 7.</p>}
      <Card title="Market report" info="News about rivals: distress, bankruptcies and opportunities.">
        {reports.length ? (
          <ol className="log">{reports.map((e) => <li key={e.id} className={e.level}><span className="mono">{stamp(e.tick).slice(3)}</span><span>{e.text}</span></li>)}</ol>
        ) : <p className="explain">No news yet. When a rival hits financial trouble or goes under, it is reported here.</p>}
      </Card>
    </div>
  );
}

function Acquisitions({ s, rows }: { s: GameState; rows: Competitor[] }) {
  return (
    <Card title="Acquisitions" info="Buying a rival brings its land (as new fields needing staff and a crop plan), its stock, and its debts.">
      <div className="stack">
        {!s.corp.incorporated && (
          <div className="callout warn small row between wrap">
            <span>Incorporate your company before making acquisitions.</span>
            <button className="btn ghost sm" onClick={() => go('corporation')}>Corporation</button>
          </div>
        )}
        <p className="callout warn small">Sellers know about liabilities they don't disclose. Buying without due diligence means inheriting whatever is hidden.</p>
        {rows.length ? rows.map((c) => <Target key={c.id} s={s} c={c} />) : <p className="explain">No rivals are left to buy.</p>}
      </div>
    </Card>
  );
}

function Target({ s, c }: { s: GameState; c: Competitor }) {
  const val = valuation(s, c);
  const ask = askingPrice(s, c);
  const done = c.diligence === 'done';
  const price = acquisitionPrice(s, c);
  const integration = Math.max(5000, ask * 0.05);
  const loan = c.debt + c.hiddenDebt;
  const dd = diligenceCost(s, c);
  return (
    <div className="stack s" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="row between wrap">
        <span><b>{c.name}</b> <span className="muted small">· {num(c.ha)} ha · {REGIONS[c.region].name}</span> <span className={`pill ${STATUS[c.status]}`}>{c.status}</span></span>
        <div className="row wrap">
          {!done && <Confirm label={`Due diligence · ${money(dd)}`} disabled={dd > s.cash} title={`Due diligence on ${c.name}?`}
            body={<>Lawyers and accountants examine the books for <b>{money(dd)}</b>. Any undisclosed liabilities are revealed and deducted from the price.</>}
            onConfirm={() => act({ type: 'diligence', competitorId: c.id }, 'Due diligence complete.')} />}
          <Confirm label={`Acquire · ${money(price * 1.05)}`} className="btn primary sm" disabled={!s.corp.incorporated || price * 1.05 > s.cash} title={`Acquire ${c.name}?`} confirmLabel="Acquire"
            body={<div className="stack s">
              <p>Purchase price <b>{money(price)}</b> plus <b>{money(integration)}</b> integration costs (5%).</p>
              <p>Their debt{done ? ' and the hidden liabilities' : ''} — <b>{money(done ? loan : c.debt)}</b>{done ? '' : ' disclosed'} — becomes a 240-day loan on your books.</p>
              {!done && <p className="warn">You have not run due diligence. Undisclosed liabilities will be added to that loan.</p>}
              <p>You gain about {num(Math.max(5, Math.round(c.ha)))} ha in {REGIONS[c.region].name} as three fields. They need workers, machines and a crop plan before they produce.</p>
            </div>}
            onConfirm={() => act({ type: 'acquire', competitorId: c.id }, `${c.name} acquired.`)} />
        </div>
      </div>
      <dl className="facts">
        <dt>Valuation <Info text="Assets (land at market, cash, stock) minus debt, plus four times annualised earnings. Discounted 25% when distressed." /></dt><dd>{money(val)}</dd>
        <dt>Asking price</dt><dd>{money(ask)}{c.status === 'active' ? ' (incl. 25% control premium)' : ''}</dd>
        <dt>Disclosed debt</dt><dd>{money(c.debt)}</dd>
        <dt>Hidden liabilities</dt><dd className={done && c.hiddenDebt > 0 ? 'down' : ''}>{done ? money(c.hiddenDebt) : 'unknown'}</dd>
        {done && <><dt>Price after diligence</dt><dd>{money(price)}</dd></>}
      </dl>
    </div>
  );
}
