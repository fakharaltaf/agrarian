import { useState } from 'react';
import { ANIMALS, ANIMAL_IDS, BUILDINGS, GOODS, REGIONS, type AnimalId, type RegionId } from '../../simulation/config';
import { known, priceUsd } from '../../simulation/core';
import { animalPrice, herdOf, housing } from '../../simulation/engine';
import type { GameState } from '../../simulation/types';
import { act, useGame } from '../../stores/game';
import { money, num, pct0, price } from '../format';
import { Bar, Card, Confirm, Info, NumberInput, PageHead, Select } from '../ui';
import { BuildMany, unlockedRegions } from './shared';

const available = (s: GameState, a: AnimalId) => (a === 'chickens' ? known(s, 'chickens') : known(s, 'livestock') && (a !== 'cows' || s.era >= 3));

export default function LivestockPage() {
  const s = useGame();
  const regions = unlockedRegions(s);
  const [r, setR] = useState<RegionId>('heartland');
  const P = s.automation.policies;
  return (
    <div className="stack l">
      <PageHead title="Livestock" sub="Animals live in their housing, eat every day and produce in proportion to their health. Fed and uncrowded herds grow by themselves."
        actions={regions.length > 1 && <Select label="Region" value={r} onChange={setR} options={regions.map((x) => ({ v: x, label: REGIONS[x].name }))} />} />
      <Card title="Feeding" info="Animals eat livestock feed first, then corn, soybean meal and wheat from your storage, one unit for one unit. Hungry animals lose health, stop producing and eventually die.">
        <label className="check">
          <input type="checkbox" checked={P.autoFeed} onChange={(e) => act({ type: 'setPolicies', patch: { autoFeed: e.target.checked } })} />
          Buy feed automatically when the store runs short (at today's feed price of {price(priceUsd(s, r, 'feed'))})
        </label>
      </Card>
      <div className="grid2">
        {ANIMAL_IDS.filter((a) => available(s, a)).map((a) => <HerdCard key={a} s={s} r={r} a={a} />)}
      </div>
      {!known(s, 'livestock') && <p className="muted small">Pigs, sheep and dairy cows become available as your flock grows.</p>}
    </div>
  );
}

function HerdCard({ s, r, a }: { s: GameState; r: RegionId; a: AnimalId }) {
  const def = ANIMALS[a];
  const h = herdOf(s, r, a);
  const cap = housing(s, r, a);
  const count = Math.floor(h?.count ?? 0);
  const [n, setN] = useState(10);
  const room = Math.max(0, Math.floor(cap - (h?.count ?? 0)));
  const product = def.product ? GOODS[def.product] : null;
  const perDay = (h?.count ?? 0) * def.perDay * (h?.health ?? 0) * (h?.fed ?? 0);
  const feedCost = (h?.count ?? 0) * def.feedPerDay * priceUsd(s, r, 'feed');
  const income = def.product ? perDay * priceUsd(s, r, def.product) : 0;
  const bt = def.building;
  return (
    <Card title={<>{def.name} <span className="muted">{num(count)} / {num(cap)}</span></>}
      info={`Each ${def.one} costs ${money(animalPrice(s, a))}, eats ${def.feedPerDay} feed a day${product ? ` and gives ${def.perDay} ${product.name.toLowerCase()} a day` : ''} at full health. Healthy herds with space grow ${pct0(def.breedPerDay)} a day.`}>
      <div className="stack">
        {cap === 0 ? (
          <div className="callout">Build a {BUILDINGS[bt].name.toLowerCase()} first. {BUILDINGS[bt].blurb}</div>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi"><span>Health <Info text="Rises when fed, falls with hunger, crowding and disease. Below 35% animals start dying." /></span><strong className={`mono ${h && h.health < 0.5 ? 'down' : ''}`}>{h ? pct0(h.health) : '—'}</strong></div>
              <div className="kpi"><span>Fed yesterday</span><strong className={`mono ${h && h.fed < 0.99 ? 'down' : ''}`}>{h ? pct0(h.fed) : '—'}</strong></div>
              <div className="kpi"><span>{product ? `${product.name} / day` : 'Output'}</span><strong className="mono">{num(perDay, 1)}</strong></div>
              <div className="kpi"><span>Margin / day <Info text="Value of today's output at market price minus the cost of feed if it all had to be bought." /></span><strong className={`mono ${income - feedCost < 0 ? 'down' : 'up'}`}>{money(income - feedCost)}</strong></div>
            </div>
            <Bar value={cap ? (h?.count ?? 0) / cap : 0} label="Housing used" color={(h?.count ?? 0) > cap ? 'var(--down)' : undefined} />
            <div className="row wrap">
              <NumberInput label="Number of animals" value={n} min={1} max={9999} onChange={(v) => setN(Math.round(v))} width={80} />
              <button className="btn primary sm" disabled={room < 1 || n * animalPrice(s, a) > s.cash} onClick={() => act({ type: 'buyAnimals', region: r, animal: a, count: Math.min(n, room) })}>
                Buy {num(Math.min(n, room))} · {money(Math.min(n, room) * animalPrice(s, a))}
              </button>
              {count > 0 && <Confirm label={`Sell ${num(Math.min(n, count))} for meat`} className="btn ghost sm" title={`Send ${Math.min(n, count)} ${def.name.toLowerCase()} to market?`}
                body={`They are sold as about ${num(Math.min(n, count) * def.meat * (0.5 + 0.5 * (h?.health ?? 1)), 1)} units of meat at the market price (healthier animals give more).`}
                onConfirm={() => act({ type: 'sellAnimals', region: r, animal: a, count: Math.min(n, count) })} confirmLabel="Sell" />}
            </div>
          </>
        )}
        <div className="stack s">
          <span className="muted small">{BUILDINGS[bt].name}: room for {def.perBuilding} each (more after upgrades)</span>
          <BuildMany s={s} r={r} t={bt} className="btn ghost sm" />
        </div>
      </div>
    </Card>
  );
}
