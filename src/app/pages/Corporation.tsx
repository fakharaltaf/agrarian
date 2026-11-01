import { useState } from 'react';
import { CONFIG, WORK_END, WORK_START } from '../../simulation/config';
import { equity } from '../../simulation/core';
import { companyValue, DIVISIONS, netIncome, ownership, sharePrice } from '../../simulation/corporate';
import type { GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Card, Confirm, Info, Kpi, NumberInput, PageHead, Seg } from '../ui';

const HOURS = WORK_END - WORK_START;

export default function CorporationPage() {
  const s = useGame();
  return (
    <div className="stack l">
      <PageHead title="Corporation" sub="Capital markets, divisions and the executives who run them." />
      {s.corp.incorporated ? <>
        <Valuation s={s} />
        <div className="grid3">
          <Issue s={s} />
          <Buyback s={s} />
          <Dividend s={s} />
        </div>
        <Divisions s={s} />
      </> : <Incorporate s={s} />}
    </div>
  );
}

function Incorporate({ s }: { s: GameState }) {
  const cost = CONFIG.incorporateCost * s.macro.cpi;
  return (
    <Card title="Incorporate">
      <div className="stack">
        <p className="explain">Turn the farm into a company with {num(CONFIG.sharesOutstanding)} shares, all owned by you. Incorporation lets you hire division heads, raise money by selling shares, pay dividends and acquire rivals.</p>
        <div className="row end">
          <Confirm label={`Incorporate · ${money(cost)}`} className="btn primary" disabled={cost > s.cash} title="Incorporate your company?" confirmLabel="Incorporate"
            body={<>Legal and registration costs are <b>{money(cost)}</b>. You keep 100% of the shares.</>} onConfirm={() => act({ type: 'incorporate' }, 'Your company is incorporated.')} />
        </div>
      </div>
    </Card>
  );
}

function Valuation({ s }: { s: GameState }) {
  const v = companyValue(s);
  const net = netIncome(s, 120);
  return (
    <div className="kpis">
      <Kpi big label="Company value" value={money(v)} info="Book equity plus six years of trailing net profit — never below book equity." breakdown={[['Book equity', money(equity(s))], ['Net profit, last 120 days', money(net)], ['+ 6 × profit', money(Math.max(0, 6 * net))]]} />
      <Kpi label="Share price" value={price(sharePrice(s))} info="Company value ÷ shares outstanding." />
      <Kpi label="Your ownership" value={pct0(ownership(s))} tone={ownership(s) < 0.5 ? 'warn' : undefined} sub={`${num(s.corp.playerShares)} of ${num(s.corp.shares)} shares`} info="Issuing shares dilutes you; buybacks concentrate ownership again." />
      <Kpi label="Dividends paid" value={money(s.corp.dividends)} info="Total paid to shareholders since incorporation." />
      <Kpi label="Reputation" value={`${Math.round(s.corp.reputation)}/100`} info="Affects loan spreads, contract premiums, worker morale and antitrust scrutiny. See the Policy page." />
    </div>
  );
}

function Issue({ s }: { s: GameState }) {
  const [pct, setPct] = useState(0.05);
  const n = Math.round(s.corp.shares * pct);
  const proceeds = n * sharePrice(s) * 0.95;
  const after = s.corp.playerShares / (s.corp.shares + n);
  return (
    <Card title="Issue shares" info="Sell new shares to investors at today's price, less a 5% underwriting discount. Cash now, at the cost of owning less of the company.">
      <div className="stack s">
        <Seg label="Shares to issue" value={pct} onChange={setPct} options={[0.01, 0.05, 0.1, 0.25].map((v) => ({ v, label: pct0(v) }))} />
        <dl className="facts">
          <dt>New shares</dt><dd>{num(n)}</dd>
          <dt>Proceeds</dt><dd className="up">{money(proceeds)}</dd>
          <dt>Your stake after</dt><dd>{pct0(after)}</dd>
        </dl>
        <Confirm label={`Raise ${money(proceeds)}`} className="btn primary sm" disabled={equity(s) <= 0} title="Issue shares?" confirmLabel="Issue"
          body={<>Sell {num(n)} new shares for <b>{money(proceeds)}</b>. Your ownership falls from {pct0(ownership(s))} to {pct0(after)}.</>}
          onConfirm={() => act({ type: 'issueShares', pct })} />
      </div>
    </Card>
  );
}

function Buyback({ s }: { s: GameState }) {
  const [pct, setPct] = useState(0.05);
  const pub = s.corp.shares - s.corp.playerShares;
  const n = Math.min(pub, Math.round(s.corp.shares * pct));
  const cost = n * sharePrice(s) * 1.05;
  return (
    <Card title="Buy back shares" info="Buy shares back from investors at a 5% premium and cancel them. Raises your ownership; uses cash.">
      {pub > 0 ? (
        <div className="stack s">
          <Seg label="Shares to buy back" value={pct} onChange={setPct} options={[0.01, 0.05, 0.1].map((v) => ({ v, label: pct0(v) }))} />
          <dl className="facts">
            <dt>Public shares</dt><dd>{num(pub)}</dd>
            <dt>Shares bought</dt><dd>{num(n)}</dd>
            <dt>Cost</dt><dd>{money(cost)}</dd>
            <dt>Your stake after</dt><dd>{pct0(s.corp.playerShares / (s.corp.shares - n))}</dd>
          </dl>
          <Confirm label={`Buy back · ${money(cost)}`} disabled={!n || cost > s.cash} title="Buy back shares?" confirmLabel="Buy back"
            body={<>Spend <b>{money(cost)}</b> to buy and cancel {num(n)} shares.</>} onConfirm={() => act({ type: 'buyback', pct })} />
        </div>
      ) : <p className="explain">You own every share. Buybacks become possible after you issue shares.</p>}
    </Card>
  );
}

function Dividend({ s }: { s: GameState }) {
  const [amount, setAmount] = useState(Math.round(Math.max(0, s.cash) * 0.05));
  const rep = Math.min(5, (amount / Math.max(1, equity(s))) * 100);
  return (
    <Card title="Pay a dividend" info="Return cash to shareholders, including you. Steady payouts build investor and lender confidence (reputation).">
      <div className="stack s">
        <div className="row between small"><span className="muted">Amount</span><NumberInput label="Dividend amount" value={amount} onChange={(n) => setAmount(Math.round(n))} min={0} max={Math.max(0, s.cash)} step={1000} width={130} /></div>
        <div className="row wrap">{[0.02, 0.05, 0.1].map((f) => <button key={f} className="btn ghost sm" onClick={() => setAmount(Math.round(Math.max(0, s.cash) * f))}>{pct0(f)} of cash</button>)}</div>
        <dl className="facts">
          <dt>To you ({pct0(ownership(s))})</dt><dd>{money(amount * ownership(s))}</dd>
          <dt>Reputation <Info text="+1 point per 1% of equity paid out, at most +5 per dividend." /></dt><dd className="up">+{rep.toFixed(1)}</dd>
        </dl>
        <Confirm label={`Pay ${money(amount)}`} disabled={amount <= 0 || amount > s.cash} title="Pay a dividend?" confirmLabel="Pay"
          body={<>Pay <b>{money(amount)}</b> to shareholders. Reputation +{rep.toFixed(1)}.</>} onConfirm={() => act({ type: 'payDividend', amount }, 'Dividend paid.')} />
      </div>
    </Card>
  );
}

function Divisions({ s }: { s: GameState }) {
  const salary = CONFIG.execSalary * s.macro.cpi;
  const recent = s.books.slice(-30);
  return (
    <Card title="Divisions" info={`Every ledger entry is booked to a division. A division head costs ${money(salary)}/h during working hours (${money(salary * HOURS)}/day).`}>
      <div className="stack s">
        {DIVISIONS.map((d) => {
          const net = recent.reduce((a, b) => a + (b.divisions[d.id] ?? 0), 0);
          const head = s.corp.execs.includes(d.id);
          return (
            <div key={d.id} className="row between wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <b>{d.name}</b> {head && <span className="pill good">Head hired</span>}
                <p className="small muted">{d.blurb}</p>
              </div>
              <div className="row">
                <span className={`mono ${net < 0 ? 'down' : 'up'}`} title="Net cash booked to this division over the last 30 days">{money(net)}<span className="faint small"> 30d</span></span>
                {head
                  ? <Confirm label="Dismiss" title={`Dismiss the head of ${d.name}?`} body="The division loses its executive immediately." onConfirm={() => act({ type: 'fireExec', division: d.id })} confirmLabel="Dismiss" />
                  : <button className="btn ghost sm" onClick={() => act({ type: 'hireExec', division: d.id }, `Head of ${d.name} hired.`)}>Hire head · {money(salary * HOURS)}/day</button>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
