import { GOODS, type GoodId, type RegionId } from '../simulation/config';
import { retailAllowance, retailChannel } from '../simulation/facility-levels';
import type { GameState } from '../simulation/types';
import { num, pct0 } from './format';
import { Info } from './ui';
/** A quote explains exactly which units receive the finite retail service. */
export function RetailQuote({s,region,good,qty,retailQty=0}:{s:GameState;region:RegionId;good:GoodId;qty:number;retailQty?:number}) {
  const rate=retailChannel(s,region);
  if(!rate||GOODS[good].kind!=='processed'||qty<=0)return null;
  const allowance=retailAllowance(s,region,good);
  return <div className="row between wrap retail-quote"><span>🪙 {num(retailQty)} retail · {num(Math.max(0,qty-retailQty))} wholesale</span><Info text={`The strongest centre adds ${pct0(rate)} on a finite daily retail allowance for this good. Extra stock still sells at the ordinary wholesale price. Buying and reselling uses the same allowance; loading a save preserves it.`} breakdown={[["Retail slots left today",num(allowance.left)],["Daily regional allowance",num(allowance.limit)]]}/></div>;
}
