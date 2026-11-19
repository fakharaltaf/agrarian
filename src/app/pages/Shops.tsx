import { act, go, startZoning, useGame } from '../../stores/game';
import { cityActive, cityOf, shopReach } from '../../simulation/city-state';
import { GST_RATES } from '../../simulation/stages/city';
import { ROAD_REACH, MARKET_NAME, SERVICE_DEFS, SHOP_GOODS, SHOP_TYPES, mergeGroup, servicePrice, serviceRadius, svcSize, townOf } from '../../simulation/town-state';
import { serviceDailyCost } from '../../simulation/stages/town';
import type { GameState, ServiceType, ShopType } from '../../simulation/types';
import { worldOf } from '../../simulation/world';
import { GOODS } from '../../simulation/config';
import { Bar, Seg } from '../ui';
import { money, num, pct0 } from '../format';
import { portrait } from '../world/portrait';
import { BuildCard, NextStep, SettingRow, StatTile, toneOf } from './civic';

/** What families bought at the shops yesterday, product by product: how much, how much of it was yours, and the money. `only` limits it to one shop's trade. */
export function ShopDemand({ s, only }: { s: GameState; only?: ShopType[] }) {
  const tr = cityOf(s).trade, rows = (tr?.goods ?? []).filter((g) => !only || only.includes(g.shop));
  const extras = !only || only.includes('mall' as never) ? tr?.mallExtras ?? 0 : 0;
  if (!rows.length && !extras) return <p className="small muted">No sales counted yet: shops report each morning.</p>;
  const top = Math.max(1, ...rows.map((g) => g.value), extras);
  return <div className="demand-list">
    {rows.map((g) => { const mine = g.want ? g.sold / g.want : 0;
      return <div key={`${g.shop}:${g.good}`} className="demand-row" title={`${g.sold} of ${g.want} from your stores · the rest imported`}>
        <span className="demand-name"><span className="ln-ball" style={{ background: GOODS[g.good].color }} />{GOODS[g.good].name}<small>{SERVICE_DEFS[g.shop].icon}</small></span>
        <span className="demand-bar"><i className="mine" style={{ width: `${(g.value / top) * mine * 100}%` }} /><i className="bought" style={{ width: `${(g.value / top) * (1 - mine) * 100}%` }} /></span>
        <span className="demand-num"><b>{num(g.want)}</b>/day · {money(g.value)}</span>
        <small className={`demand-own ${mine >= 0.99 ? 'up' : mine < 0.5 ? 'down' : ''}`}>{pct0(mine)} yours</small>
      </div>; })}
    {extras > 0 && <div className="demand-row"><span className="demand-name">🛍 Clothes, tools & treats<small>mall</small></span><span className="demand-bar"><i className="bought" style={{ width: `${(extras / top) * 100}%` }} /></span><span className="demand-num">{money(extras)}/day</span><small className="demand-own down">all imported</small></div>}
    <p className="small muted"><span className="demand-key mine" /> from your stores · <span className="demand-key bought" /> imported by the shops, money that leaves the city</p>
  </div>;
}

/** Shops, their sales and (in the City) merging and GST: shown on the Town page from the first shop, and on the City page. */
export function ShopsSection() {
  const s = useGame(), v = cityOf(s), t = townOf(s), city = cityActive(s);
  const build = (service: ServiceType) => act({ type: 'buildService', service, district: 'farmgate' });
  const trade = v.trade, shops = t.services.filter((b) => SHOP_TYPES.includes(b.type as never)), mall = t.services.find((b) => b.type === 'mall'), gap = trade?.gaps[0];
  // the square of four closest to merging: the next thing worth building towards
  const groups = shops.map((b) => ({ b, g: mergeGroup(s, b.id) })).filter((x) => x.g && x.g.members.length > 1).sort((x, y) => y.g!.members.length - x.g!.members.length), near = groups[0];
  const zoned = Object.values(worldOf(s, 'heartland').zones).includes('com');
  const shopNext = !zoned ? <NextStep icon="🏘" title="Zone commercial land for shops" text="Shops and offices stand on commercial land. Mark some of your cleared land near the homes." action={<button className="btn primary" onClick={() => startZoning('heartland', 'com')}>🏪 Zone land</button>} />
    : !shops.length && !mall ? <NextStep icon="🏪" title="Open your first shop" text="Families have savings and nowhere to spend them. A shop sells your goods to the homes within its reach, at 20% over the market." />
    : [...shops, ...(mall ? [mall] : [])].some((b) => b.active && b.staffed < SERVICE_DEFS[b.type].jobs * b.count) ? <NextStep icon="👥" tone="bad" title="Shops are short of staff" text="Shopkeepers come from your own families. Build homes so more adults move in." action={<button className="btn primary" onClick={() => go('community')}>Build homes</button>} />
    : near?.g!.complete && !city ? <NextStep icon="⧉" title="Four shops stand together" text="Once your town is a City, four of a kind in a square merge into a market." />
    : near?.g!.complete ? <NextStep icon="🎉" tone="good" title={`Four ${svcSize(near.b) === 2 ? 'markets' : `${SERVICE_DEFS[near.b.type].name.toLowerCase()}s`} stand together`} text={`Merge them into ${near.g!.into === 'Mall' ? 'the Mall: it reaches the whole city and sells far more than food' : `a ${near.g!.into}: it reaches more than twice as far, draws half again as much custom and needs fewer staff`}.`} action={<button className="btn primary" disabled={near.g!.price > s.cash} onClick={() => act({ type: 'mergeService', serviceId: near.b.id })}>⧉ Merge · {money(near.g!.price)}</button>} />
    : near && city ? <NextStep icon="⧉" title={`${near.g!.members.length} of 4 for ${near.g!.into === 'Mall' ? 'the Mall' : `a ${near.g!.into}`}`} text={svcSize(near.b) === 2 ? 'Four markets in a square, a lane apart, merge into the Mall. Tap a market on the map to see the square.' : `Place ${4 - near.g!.members.length} more ${SERVICE_DEFS[near.b.type].name.toLowerCase()}${near.g!.members.length === 3 ? '' : 's'} to complete the square (a lane apart). Tap one on the map to see where.`} action={svcSize(near.b) === 1 ? <button className="btn primary" disabled={servicePrice(s, near.b.type) > s.cash} onClick={() => build(near.b.type)}>Place · {money(servicePrice(s, near.b.type))}</button> : undefined} />
    : gap && trade!.imports > trade!.ours * 0.25 ? <NextStep icon="🚚" title={`Families import ${GOODS[gap.good].name.toLowerCase()}: ${money(gap.value)} a day leaves the city`} text="The shops buy your stock first. Make or store more of it and that money comes to you instead." action={<button className="btn ghost" onClick={() => go('production')}>Production</button>} />
    : trade && trade.spend > 0 ? <NextStep icon="✓" tone="good" title={`Shops sold ${money(trade.spend)} yesterday`} text={`${pct0(trade.spend ? trade.ours / trade.spend : 0)} of it was your own goods. More kinds of shop and more homes in reach grow it.`} />
    : <NextStep icon="🏪" title="No sales yet" text="Shops need a road, staff and homes within reach. Sales are counted each morning." />;
  return <>
    <h2 className="civ-h">Shops</h2>
    <div className="civ-tiles three" data-coach="city-shops">
      <StatTile icon="🛍" value={money(trade?.spend ?? 0)} label="spent at shops / day" />
      <StatTile icon="🌾" value={pct0(trade?.spend ? trade.ours / trade.spend : 0)} label="was your goods" tone={!trade?.spend ? 'none' : toneOf(trade.ours / trade.spend, 0.7, 0.4)} />
      {city ? <StatTile icon="🧾" value={money(trade?.gst ?? 0)} label={`GST / day at ${pct0(v.gst)}`} /> : <StatTile icon="🚚" value={money(trade?.imports ?? 0)} label="imported / day" />}
    </div>
    {shopNext}
    <details className="card demand-card" open><summary><b>Demand by product</b> <span className="small muted">yesterday at your shops</span></summary><ShopDemand s={s} /></details>
    <div className="civ-builds">{SHOP_TYPES.map((type) => {
      const d = SERVICE_DEFS[type], n = shops.filter((b) => b.type === type && svcSize(b) === 1).length, halls = shops.filter((b) => b.type === type && svcSize(b) === 2).length, cost = servicePrice(s, type), reach = Math.min(1, shopReach(s, type));
      return <BuildCard key={type} img={portrait(`civic:${type}`)} fallback={d.icon} name={<>{d.name}{n > 0 && <small> ×{n}</small>}{halls > 0 && <small> · {halls > 1 ? `${halls} × ` : ''}{MARKET_NAME[type]}</small>}{mall?.kinds?.includes(type) && <small> · in the Mall</small>}</>}
        lines={[`Sells ${Object.keys(SHOP_GOODS[type]).map((g) => GOODS[g as keyof typeof GOODS].name.toLowerCase()).join(', ')}`, `Reaches ${Math.round(serviceRadius({ type }) * ROAD_REACH)} tiles by road · ${d.jobs} staff · ${money(Math.round(serviceDailyCost(s, type)))}/day`, <Bar thin key="b" value={reach} label={`Families within a ${d.name.toLowerCase()}'s reach`} color={reach >= 0.7 ? 'var(--up)' : 'var(--gold)'} />]}
        action={<div className="row wrap civ-case-acts"><button className="btn primary" disabled={cost > s.cash} onClick={() => build(type)}>Place · {money(cost)}</button><button className="btn ghost" disabled={cost * 4 > s.cash} title="Four in a square, a lane apart: ready to merge into a market in the City" onClick={() => act({ type: 'buildService', service: type, district: 'farmgate', block: true })}>Place 4 · {money(cost * 4)}</button></div>} />;
    })}</div>
    <p className="small muted civ-foot">{city ? <>Four shops of one kind in a square, a lane apart, merge into a market. Four markets merge into the Mall{mall ? `: yours holds ${mall.kinds?.length ?? 0} trades` : ''}. Tap a shop on the map to see its square.</> : 'In the City, four shops of one kind in a square merge into a market, and the shops pay GST to the farm.'}</p>
{city && <section className="card stack s">
      <SettingRow name="GST on shop sales" effect={v.gst === 0 ? 'No tax: families keep it all' : v.gst >= 0.1 ? 'More income for the farm · families a little less happy' : 'A modest tax on everything the shops sell'}>
        <Seg label="GST rate" value={v.gst} onChange={(rate) => act({ type: 'setGst', rate })} options={GST_RATES.map((r) => ({ v: r, label: pct0(r) }))} />
      </SettingRow>
    </section>}
  </>;
}
