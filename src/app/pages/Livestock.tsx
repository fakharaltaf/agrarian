import { useState } from 'react';
import { ANIMALS, ANIMAL_IDS, BUILDINGS, COWS_PER_DAIRY_BATCH, GOODS, REGIONS, type AnimalId, type RegionId } from '../../simulation/config';
import { known, priceUsd } from '../../simulation/core';
import { animalPrice, factoryMerge, herdOf, housing, upgradeCost, anotherQuote } from '../../simulation/engine';
import { healthFactors, HEALTH_GAIN } from '../../simulation/livestock';
import { buildingsIn, has, levelMult, maxLevel, mergedName, sizeOutput } from '../../simulation/core';
import { buildingMargin } from '../../simulation/processing';
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
  // cows milked in a dairy show up on the Production page instead
  const inDairy = a === 'cows' ? Math.min(h?.count ?? 0, s.buildings.reduce((x, b) => x + (b.type === 'dairy' && b.region === r && b.active ? b.stats.out * COWS_PER_DAIRY_BATCH : 0), 0)) : 0;
  const shed = (h?.count ?? 0) - inDairy;
  const perDay = shed * def.perDay * (h?.health ?? 0) * (h?.fed ?? 0);
  const feedCost = shed * def.feedPerDay * priceUsd(s, r, 'feed');
  // cows milked in a dairy: the dairy's milk and margin are theirs too
  const dairies = a === 'cows' ? s.buildings.filter((b) => b.type === 'dairy' && b.region === r && b.active) : [];
  const dairyMilk = dairies.reduce((x, b) => x + b.stats.out * (BUILDINGS.dairy.recipe!.outputs.milk ?? 0) * (has(s, 'processEfficiency') ? 1.1 : 1) * 24, 0), dairyMargin = dairies.reduce((x, b) => x + buildingMargin(b) * 24, 0);
  const income = def.product ? perDay * priceUsd(s, r, def.product) : 0, margin = income - feedCost + dairyMargin;
  const bt = def.building;
  const hf = h ? healthFactors(s, h) : null, outbreak = s.events.find((e) => e.kind === 'livestockDisease' && e.region === r && e.end > s.tick);
  const healthWhy = !h || !hf ? '' : hf.disease > 0 ? `Disease in one ${BUILDINGS[bt].name.toLowerCase()}: −${pct0(hf.disease)} a day for ${Math.ceil((outbreak!.end - s.tick) / 24)} more days` : hf.hunger > 0 ? `Going hungry: −${pct0(hf.hunger)} a day until fed` : hf.crowd > 0 ? `Overcrowded: −${pct0(hf.crowd)} a day; build or upgrade housing` : h.health < 0.999 ? `Recovering: healthy in about ${Math.ceil((1 - h.health) / Math.max(0.001, hf.net || HEALTH_GAIN))} days` : 'Healthy';
  const houses = buildingsIn(s, r, bt);
  return (
    <Card title={<>{def.name} <span className="muted">{num(count)} / {num(cap)}</span></>}
      info={`Each ${def.one} costs ${money(animalPrice(s, a))}, eats ${def.feedPerDay} feed a day${product ? ` and gives ${def.perDay} ${product.name.toLowerCase()} a day` : ''} at full health. Healthy herds with space grow ${pct0(def.breedPerDay)} a day.`}>
      <div className="stack">
        {cap === 0 ? (
          <div className="callout">Build a {BUILDINGS[bt].name.toLowerCase()} first. {BUILDINGS[bt].blurb}</div>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi"><span>Health <Info text={`Rises ${pct0(HEALTH_GAIN)} a day when fed, falls with hunger, crowding and disease. An outbreak reaches only the animals in one house, so a herd spread over several houses loses less. Below 35% animals start dying.`} /></span><strong className={`mono ${h && h.health < 0.5 ? 'down' : ''}`}>{h ? pct0(h.health) : '—'}</strong>{healthWhy && <small className={`muted ${hf && hf.net < 0 ? 'down' : ''}`}>{healthWhy}</small>}</div>
              <div className="kpi"><span>Fed yesterday</span><strong className={`mono ${h && h.fed < 0.99 ? 'down' : ''}`}>{h ? pct0(h.fed) : '—'}</strong></div>
              <div className="kpi"><span>{product ? `${product.name} / day` : 'Output'}</span><strong className="mono">{num(perDay + dairyMilk, 1)}</strong>{dairyMilk > 0 && <small className="muted">{num(dairyMilk)} from your dairy</small>}</div>
              <div className="kpi"><span>Margin / day <Info text="Value of today's output at market price minus the cost of feed if it all had to be bought (and, for dairy cows, what your dairy makes from them after staff and power)." breakdown={[[product ? `${product.name} at market` : 'Output', money(income)], ['Feed, if bought', `−${money(feedCost)}`], ...(dairies.length ? [['Dairy, after costs', money(dairyMargin)] as [string, string]] : [])]} /></span><strong className={`mono ${margin < 0 ? 'down' : 'up'}`}>{money(margin)}</strong></div>
            </div>
            {inDairy >= 1 && <p className="small muted">🥛 {num(inDairy)} of these cows are milked in your dairy{outbreak ? ', quarantined while the disease lasts' : ''}; its milk and margin are counted above.</p>}
            {margin < 0 && count > 0 && <div className="callout warn small">{def.name} cost more to feed than {product ? `their ${product.name.toLowerCase()} fetches` : 'they make'}: {money(feedCost)} of feed against {money(income + dairyMargin)} a day. Feed from your own corn (a feed mill is cheapest), let them grow healthier, or keep fewer.</div>}
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
          {houses.map((b) => { const q = anotherQuote(s, `b:${b.id}`), m = factoryMerge(s, b.id), size = b.size ?? 1;
            return <div key={b.id} className="row between wrap small herd-house">
              <span>{size > 1 ? mergedName(b.type, BUILDINGS[b.type].name, size) : BUILDINGS[b.type].name} <span className="muted">· level {b.level} · room for {num(def.perBuilding * levelMult(b.level) * sizeOutput(b))}</span></span>
              <span className="row wrap">
                {b.level < maxLevel(b.type) && <button className="btn ghost xs" disabled={upgradeCost(s, b) > s.cash} onClick={() => act({ type: 'upgradeBuilding', buildingId: b.id })}>⬆ Level {b.level + 1} · {money(upgradeCost(s, b))}</button>}
                {m?.ready && <button className="btn ghost xs" disabled={m.price > s.cash} onClick={() => act({ type: 'mergeBuilding', buildingId: b.id })}>⧉ Merge · {money(m.price)}</button>}
                {q && <button className="btn ghost xs" disabled={!q.why && q.price > s.cash} title={q.why} onClick={() => act({ type: 'addAnother', key: `b:${b.id}` })}>＋ Another{q.why ? '' : ` · ${money(q.price)}`}</button>}
              </span>
            </div>; })}
          <span className="muted small">A new {BUILDINGS[bt].name.toLowerCase()} holds {def.perBuilding}; levels and merging hold far more.</span>
          <BuildMany s={s} r={r} t={bt} className="btn ghost sm" />
        </div>
      </div>
    </Card>
  );
}
