import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { GOOD_IDS, GOODS } from '../config';
import { clamp, log, nextId, post, priceUsd, random, reservedStock, round2 } from '../core';
import { communityOf, population, workingAdults } from '../community-state';
import { localEmployment, townOf, SHOP_GOODS, SHOP_TYPES } from '../town-state';
import { TOWN_ORDER_PREMIUM } from './town';
import { larderReserve } from './settlement';
import { cityActive, cityOf, createCityState, POLICE_CHARTERS, shopReach, type HomeCover, type JusticePolicy } from '../city-state';
import { lifetimeSales, totalHa } from './shared';

// The City is paid for by the farm, like the Town: no separate treasury to keep topped up.
export const canStartCity=(s:GameState)=>townOf(s).active&&!cityActive(s)&&population(s)>=400&&townOf(s).education>=.6&&townOf(s).health>=.7&&communityOf(s).fed>=.9;
export const cityTrainingCost=(s:GameState)=>round2((cityOf(s).training<1.25?15000:35000)*s.macro.cpi);
export const policeReformCost=(s:GameState)=>round2(20000*s.macro.cpi);
export const caseCost=(s:GameState,answer:JusticePolicy)=>round2((answer==='rehabilitate'?250:100)*s.macro.cpi);
/** Gang activity sours the neighbourhood each day its case stays open. */
export const GANG_UNHAPPINESS=.004;

/** What drives crime across the whole city: crowding, idle adults, unhappiness, unfairness and too little schooling. Prevention (rehabilitation) eases it. */
function cityPressure(s:GameState){
  const t=townOf(s),c=communityOf(s),v=cityOf(s),pop=population(s);
  const unemployed=1-clamp(localEmployment(s)/Math.max(1,workingAdults(s)),0,1);
  const inequality=(100-s.values.prosperityFairness)/100;
  return .08+.08*Math.log2(Math.max(1,pop/400))+.28*unemployed+.22*(1-c.happiness)+.12*inequality+.1*(1-t.education)+.08*(1-t.roads)-.24*c.happiness-.1*t.education-v.prevention;
}
/** How much a watchhouse in full reach takes off a street's crime, by charter and training (none during a reform). A community watch works best in a happy, schooled town. */
export function watchStrength(s:GameState){
  const t=townOf(s),c=communityOf(s),v=cityOf(s),charter=POLICE_CHARTERS[v.charter??'watch'];
  return s.tick<v.reformUntil?0:charter.suppression*v.training*(v.charter==='watch'?(c.happiness+t.education)/2:1);
}
/** A street's crime: the city's pressure, more where no power line lights it, less inside a watchhouse's reach. */
export const homeCrimeTarget=(s:GameState,h:Pick<HomeCover,'power'|'watch'>,pressure=cityPressure(s),watch=watchStrength(s))=>clamp(pressure+.1*(1-h.power)-watch*h.watch,0,.85);
/** The city-wide crime the streets are heading to (families weighted). With no homes mapped, it uses the city's pressure and its share of police. */
export function cityCrimeTarget(s:GameState){
  const v=cityOf(s),homes=v.homes??[],total=homes.reduce((n,h)=>n+h.families,0),p=cityPressure(s),w=watchStrength(s);
  if(!total)return clamp(p+.1*(1-(townOf(s).power??0))-w*v.police,0,.85);
  return homes.reduce((n,h)=>n+homeCrimeTarget(s,h,p,w)*h.families,0)/total;
}
export function resolveCase(s:GameState,answer:JusticePolicy):ActionResult {
  const v=cityOf(s),c=communityOf(s);
  if(!v.case)return {ok:false,error:'There is no open case.'};
  if(answer!=='rehabilitate'&&answer!=='punish')return {ok:false,error:'Choose rehabilitation or punishment.'};
  const cost=caseCost(s,answer);
  if(s.cash<cost)return {ok:false,error:`It costs $${cost.toLocaleString()}.`};
  post(s,'civic',-cost,answer==='rehabilitate'?'Community rehabilitation':'Court enforcement','heartland','corporate');
  if(answer==='rehabilitate'){v.prevention=Math.min(.2,v.prevention+.025);v.rehabilitated++;s.values.orderFreedom=clamp(s.values.orderFreedom-1,0,100);}
  else {v.crime=Math.max(0,v.crime-.05);for(const k in v.homeCrime??{})v.homeCrime![k]=Math.max(0,v.homeCrime![k]-.05);c.happiness=Math.max(0,c.happiness-.01);v.punished++;s.values.orderFreedom=clamp(s.values.orderFreedom+1,0,100);}
  v.caseHistory.push({day:Math.floor(s.tick/24),kind:v.case.kind,answer});v.caseHistory=v.caseHistory.slice(-12);v.case=null;v.nextCaseDay=Math.max(v.nextCaseDay,Math.floor(s.tick/24)+7);v.solved++;return {ok:true};
}
export const GST_RATES=[0,.05,.1];
/** Families may spend this share of their savings in a day, so spending settles where it matches wages. */
export const SPEND_SHARE=.05;
/** A day at the shops: families in each shop's reach buy its goods out of their savings, your stock first (at the local premium) and imports for the rest; GST on all of it comes to the farm. */
export function cityTrade(s:GameState){
  const v=cityOf(s),c=communityOf(s),inv=s.regions.heartland.inventory,people=population(s),smug=v.case?.kind==='smuggling'?.7:1;
  let budget=c.householdCash*SPEND_SHARE/(1+v.gst),ours=0,imports=0;const gaps:{good:typeof GOOD_IDS[number];value:number}[]=[];
  for(const kind of SHOP_TYPES){
    const reach=shopReach(s,kind);if(!reach)continue;
    for(const [good,per] of Object.entries(SHOP_GOODS[kind]) as [typeof GOOD_IDS[number],number][]){
      const price=priceUsd(s,'heartland',good)*TOWN_ORDER_PREMIUM,want=Math.min(Math.floor(people*reach*per*smug),Math.floor(budget/price));
      if(want<=0)continue;
      const spare=Math.max(0,inv[good]-reservedStock(s,'heartland',good)-larderReserve(s,good)),sold=Math.floor(Math.min(want,spare)),value=round2(sold*price),rest=round2((want-sold)*price);
      if(sold>0){inv[good]-=sold;post(s,'contract',value,`City shops bought ${sold} ${GOODS[good].name.toLowerCase()}`,'heartland',good==='milk'||good==='meat'?'livestock':'processing');s.stats.sales++;}
      if(rest>0)gaps.push({good,value:rest});
      ours+=value;imports+=rest;budget-=value+rest;
    }
  }
  const spend=round2(ours+imports),gst=round2(spend*v.gst);
  c.householdCash=Math.max(0,round2(c.householdCash-spend-gst));
  if(gst>0)post(s,'gst',gst,'GST from city shops','heartland','corporate');
  v.trade={spend,ours:round2(ours),imports:round2(imports),gst,gaps:gaps.sort((a,b)=>b.value-a.value).slice(0,5)};
}
/** One bounded daily civic pass, after Town's: per-street crime from what reaches each home, then cases. */
export function cityDaily(s:GameState) {
  if(!cityActive(s)||s.tick%24!==0)return;
  const v=cityOf(s),c=communityOf(s),day=Math.floor(s.tick/24),people=population(s);
  if(v.lastDay===day)return;v.lastDay=day;
  if(v.trainingUntil>=0&&s.tick>=v.trainingUntil){v.training=v.trainingTarget;v.trainingUntil=-1;log(s,'opportunity','Officer training completed: your watchhouses now cut more crime in their reach.','city');}
  const homes=v.homes??[],total=homes.reduce((n,h)=>n+h.families,0);
  v.police=total?homes.reduce((n,h)=>n+h.watch*h.families,0)/total:0;
  c.happiness=clamp(c.happiness+POLICE_CHARTERS[v.charter??'watch'].happiness*v.police,0,1);
  if(v.case?.kind==='gang')c.happiness=clamp(c.happiness-GANG_UNHAPPINESS,0,1);
  v.prevention*=.97;
  cityTrade(s);
  // each street drifts a tenth of the way to its target a day; the city's crime is the families' average
  const p=cityPressure(s),w=watchStrength(s),before=v.homeCrime??{},next:Record<number,number>={};
  for(const h of homes){const now=before[h.id]??v.crime;next[h.id]=clamp(now+(homeCrimeTarget(s,h,p,w)-now)*.1,0,1);}
  v.homeCrime=next;
  v.crime=total?homes.reduce((n,h)=>n+next[h.id]*h.families,0)/total:clamp(v.crime+(cityCrimeTarget(s)-v.crime)*.1,0,1);
  townOf(s).crime=v.crime;
  v.crimeHistory.push(v.crime);v.crimeHistory=v.crimeHistory.slice(-7);
  if(v.case&&s.tick>=v.case.deadline){
    const result=resolveCase(s,v.justice);
    if(!result.ok){v.caseHistory.push({day,kind:v.case.kind,answer:'unfunded'});v.caseHistory=v.caseHistory.slice(-12);v.case=null;v.nextCaseDay=day+7;log(s,'warning','A case went unanswered: the farm could not pay for it.','city');}
  }
  if(!v.case&&day>=v.nextCaseDay&&random(s)<v.crime*.3)openCase(s,day);
  if(people>=1200&&c.fed>=.9&&(townOf(s).sanitation??0)>=.7&&v.crime<=.2){v.safeDays++;if(v.threatAt<0){v.threatAt=s.tick;log(s,'opportunity','Your growing city attracts caravans from neighbouring settlements. The next chapter will concern their safety.','city');}}else v.safeDays=0;
}
/** A case opens on the street with the most crime: a theft takes goods; worse crime brings smuggling, then a gang. */
function openCase(s:GameState,day:number){
  const v=cityOf(s),c=communityOf(s),inv=s.regions.heartland.inventory;
  const goods=GOOD_IDS.filter(g=>GOODS[g].kind!=='input'&&inv[g]-reservedStock(s,'heartland',g)-(c.larderHold[g]??0)>1);
  goods.sort((a,b)=>inv[b]*priceUsd(s,'heartland',b)-inv[a]*priceUsd(s,'heartland',a));
  const good=goods[0];if(!good)return;
  const lost=Math.min(Math.max(0,inv[good]-reservedStock(s,'heartland',good)-(c.larderHold[good]??0)),inv[good]*.002);inv[good]-=lost;townOf(s).thefts++;
  const worst=Object.entries(v.homeCrime??{}).sort((a,b)=>b[1]-a[1])[0];
  const kind=v.crime>.45?'gang':v.crime>.2?'smuggling':'theft';
  v.case={id:nextId(s),kind,opened:s.tick,deadline:s.tick+7*24,good,lost,home:worst?Number(worst[0]):undefined};v.nextCaseDay=day+7;
  const what=kind==='gang'?'A gang has moved in: families grow unhappier each day until you answer.':kind==='smuggling'?'Smugglers are selling to the town shops, which buy less from you until you answer.':'Choose a response at the City watch.';
  log(s,'warning',`${Math.ceil(lost)} ${GOODS[good].name.toLowerCase()} stolen. ${what}`,'city');
}
function setCharter(s:GameState,charter:NonNullable<ReturnType<typeof cityOf>['charter']>){
  cityOf(s).charter=charter;s.values.orderFreedom=clamp(s.values.orderFreedom+(charter==='strict'?8:charter==='watch'?-8:0),0,100);
}
function action(s:GameState,a:Action):ActionResult|null {
  const types=['startCity','changePolice','trainPolice','setJustice','resolveCityCase','setGst'];
  if(!types.includes(a.type))return null;
  const v=cityOf(s),t=townOf(s),fail=(error:string):ActionResult=>({ok:false,error});
  if(a.type==='startCity'||a.type==='changePolice') {
    if(!Object.prototype.hasOwnProperty.call(POLICE_CHARTERS,a.charter))return fail('Choose a police charter.');
    if(a.type==='startCity'){
      if(!canStartCity(s))return fail('Welcome 400 residents with 60% schooling, 70% health and 90% fed first.');
      v.active=true;v.enteredAt=s.tick;v.crime=t.crime;v.nextCaseDay=Math.floor(s.tick/24)+7;setCharter(s,a.charter);s.stageId='city';if(!s.legacyProgression)s.era=7;s.eraReady=false;
      log(s,'opportunity','Light the streets with power lines and place a watchhouse where crime is worst. Jobs, schools and happy homes prevent crime too.','city');return {ok:true};
    }
    if(!v.active)return fail('Begin City first.');
    if(v.charter===a.charter)return fail('Your watch already follows that charter.');
    if(s.tick<v.reformUntil)return fail('Finish the current police reform first.');
    const cost=policeReformCost(s);if(s.cash<cost)return fail(`A reform costs $${cost.toLocaleString()}.`);
    post(s,'civic',-cost,'Police charter reform','heartland','corporate');setCharter(s,a.charter);v.reformUntil=s.tick+7*24;return {ok:true};
  }
  if(!v.active)return fail('Begin the City chapter first.');
  if(a.type==='setJustice'){if(!['rehabilitate','punish'].includes(a.policy))return fail('Choose a justice policy.');v.justice=a.policy;return {ok:true};}
  if(a.type==='resolveCityCase')return resolveCase(s,a.answer);
  if(a.type==='setGst'){if(!GST_RATES.includes(a.rate))return fail('Choose 0%, 5% or 10%.');v.gst=a.rate;return {ok:true};}
  if(a.type==='trainPolice'){
    if(v.training>=1.5||v.trainingUntil>=0)return fail('Training is complete or already in progress.');
    if(!t.services.some(b=>b.type==='police'&&b.active))return fail('Build a watchhouse first.');
    const cost=cityTrainingCost(s);if(s.cash<cost)return fail(`Training costs $${cost.toLocaleString()}.`);
    post(s,'research',-cost,'Officer training','heartland','corporate');v.trainingTarget=v.training<1.25?1.25:1.5;v.trainingUntil=s.tick+30*24;return {ok:true};
  }
  return null;
}
export const city:StageModule={id:'city',title:'City',legacyEras:[7],eraUnlocks:{7:s=>lifetimeSales(s)>=60_000_000||totalHa(s)>=3000},
  actionTypes:['incorporate','issueShares','buyback','payDividend','acquire','diligence','startCity','changePolice','trainPolice','setJustice','resolveCityCase','setGst'],
  tips:['city-utilities','city-safety','city-case'],discoveries:['cityReady','cityCase','cityCaravans'],
  tick:cityDaily,handleAction:action,createState:()=>createCityState() as unknown as Record<string,unknown>};
