import {plannedServiceCost,town} from './town';
import type { StageModule } from './types';
import type { Action, ActionResult, GameState } from '../types';
import { DISTRICT_IDS } from '../types';
import { GOOD_IDS, GOODS } from '../config';
import { clamp, log, nextId, post, priceUsd, random, reservedStock, round2 } from '../core';
import { communityOf, population, workingAdults } from '../community-state';
import { districtPopulation, localEmployment, SERVICE_DEFS, townOf } from '../town-state';
import { cityActive, cityOf, createCityState, POLICE_CHARTERS, type JusticePolicy } from '../city-state';
import { lifetimeSales, totalHa } from './shared';

export const canStartCity=(s:GameState)=>townOf(s).active&&!cityActive(s)&&population(s)>=400&&townOf(s).education>=.6&&townOf(s).health>=.7&&communityOf(s).fed>=.9;
export const cityTrainingCost=(s:GameState)=>round2((cityOf(s).training<1.25?15000:35000)*s.macro.cpi);
export const policeReformCost=(s:GameState)=>round2(20000*s.macro.cpi);
export const zoneCost=(s:GameState)=>round2(5000*s.macro.cpi);
export function cityCrimeTarget(s:GameState) {
  const t=townOf(s),c=communityOf(s),v=cityOf(s),pop=population(s);
  const unemployed=1-clamp(localEmployment(s)/Math.max(1,workingAdults(s)),0,1);
  const inequality=(100-s.values.prosperityFairness)/100;
  const pressure=.08+.08*Math.log2(Math.max(1,pop/400))+.28*unemployed+.22*(1-c.happiness)+.12*inequality+.1*(1-t.education)+.08*(1-t.roads)+.08*(1-v.lighting)-.24*c.happiness-.1*t.education;
  const charter=POLICE_CHARTERS[v.charter??'watch'];
  const training=s.tick<v.reformUntil?0:charter.suppression*v.police*v.training*(v.charter==='watch'?(c.happiness+t.education)/2:1);
  return clamp(pressure-training-v.prevention,0,.85);
}
export function resolveCase(s:GameState,answer:JusticePolicy):ActionResult {
  const v=cityOf(s),t=townOf(s),c=communityOf(s);
  if(!v.case)return {ok:false,error:'There is no open case.'};
  if(answer!=='rehabilitate'&&answer!=='punish')return {ok:false,error:'Choose rehabilitation or punishment.'};
  const cost=round2((answer==='rehabilitate'?250:100)*s.macro.cpi);
  if(t.cash<cost)return {ok:false,error:'Fund the public treasury before answering this case.'};
  post(s,'civic',-cost,answer==='rehabilitate'?'Community rehabilitation':'Court enforcement','heartland','corporate','town');
  if(answer==='rehabilitate'){v.prevention=Math.min(.2,v.prevention+.025);v.rehabilitated++;s.values.orderFreedom=clamp(s.values.orderFreedom-1,0,100);}
  else {v.crime=Math.max(0,v.crime-.05);c.happiness=Math.max(0,c.happiness-.01);v.punished++;s.values.orderFreedom=clamp(s.values.orderFreedom+1,0,100);}
  v.caseHistory.push({day:Math.floor(s.tick/24),kind:v.case.kind,answer});v.caseHistory=v.caseHistory.slice(-12);v.case=null;v.nextCaseDay=Math.max(v.nextCaseDay,Math.floor(s.tick/24)+7);v.solved++;return {ok:true};
}
/** One bounded daily civic pass. Coverage consumes only Town's actually staffed, paid buildings. */
export function cityDaily(s:GameState) {
  if(!cityActive(s)||s.tick%24!==0)return;
  const v=cityOf(s),t=townOf(s),c=communityOf(s),day=Math.floor(s.tick/24);
  if(v.lastDay===day)return;v.lastDay=day;
  if(v.autoFund){
    const need=Math.max(0,plannedServiceCost(s)*14-t.cash),spare=Math.max(0,s.cash-s.automation.policies.cashReserve);
    const amount=Math.floor(Math.min(need,spare,Math.max(0,s.cash)*.2)*100)/100;
    if(amount>0)town.handleAction(s,{type:'fundTown',amount,direction:'toTown'},s.stageState.town!);
  }
  if(v.trainingUntil>=0&&s.tick>=v.trainingUntil){v.training=v.trainingTarget;v.trainingUntil=-1;log(s,'opportunity','Watch training completed. Existing officers now use the new methods.','city');}
  const pop=districtPopulation(s),people=population(s);v.sanitation=0;v.lighting=0;v.police=0;
  for(const id of DISTRICT_IDS) {
    const d=v.districts[id];d.sanitation=0;d.lighting=0;d.police=0;
    for(const b of t.services)if(b.district===id&&b.active&&b.funded&&(b.type==='sanitation'||b.type==='lighting'||b.type==='police')){
      const jobs=SERVICE_DEFS[b.type].jobs*(b.type==='police'?POLICE_CHARTERS[v.charter??'watch'].staff:1)*b.count;
      const capacity=SERVICE_DEFS[b.type].capacity*b.count*(jobs?b.staffed/jobs:1);
      d[b.type]=clamp(d[b.type]+capacity/Math.max(1,pop[id]),0,1);
    }
    if(!pop[id])d.sanitation=d.lighting=d.police=0;
    v.sanitation+=d.sanitation*pop[id]/Math.max(1,people);v.lighting+=d.lighting*pop[id]/Math.max(1,people);v.police+=d.police*pop[id]/Math.max(1,people);
    c.happiness=clamp(c.happiness+(d.zone==='residential'?.004:d.zone==='industrial'?-.004:0)*pop[id]/Math.max(1,people),0,1);
  }
  c.happiness=clamp(c.happiness+POLICE_CHARTERS[v.charter??'watch'].happiness*v.police,0,1);
  v.prevention*=.97;v.crime=clamp(v.crime+(cityCrimeTarget(s)-v.crime)*.1,0,1);t.crime=v.crime;
  v.crimeHistory.push(v.crime);v.crimeHistory=v.crimeHistory.slice(-7);
  if(v.case&&s.tick>=v.case.deadline){
    const result=resolveCase(s,v.justice);
    if(!result.ok){v.caseHistory.push({day,kind:v.case.kind,answer:'unfunded'});v.caseHistory=v.caseHistory.slice(-12);v.case=null;v.nextCaseDay=day+7;log(s,'warning','A civic case expired without funding. Keep a small public reserve for the next one.','city');}
  }
  if(!v.case&&day>=v.nextCaseDay&&random(s)<v.crime*.3){
    const inv=s.regions.heartland.inventory;
    const goods=GOOD_IDS.filter(g=>GOODS[g].kind!=='input'&&inv[g]-reservedStock(s,'heartland',g)-(c.larderHold[g]??0)>1);
    goods.sort((a,b)=>inv[b]*priceUsd(s,'heartland',b)-inv[a]*priceUsd(s,'heartland',a));
    const good=goods[0];
    if(good){const lost=Math.min(Math.max(0,inv[good]-reservedStock(s,'heartland',good)-(c.larderHold[good]??0)),inv[good]*.002);inv[good]-=lost;t.thefts++;
      v.case={id:nextId(s),district:DISTRICT_IDS[Math.floor(random(s)*3)],kind:v.crime>.45?'gang':v.crime>.2?'smuggling':'theft',opened:s.tick,deadline:s.tick+7*24,good,lost};v.nextCaseDay=day+7;
      log(s,'warning',`${Math.ceil(lost)} ${GOODS[good].name.toLowerCase()} stolen. Choose a response at the City watch; jobs and schools lower the risk.`,'city');}
  }
  if(people>=1200&&c.fed>=.9&&v.sanitation>=.7&&v.crime<=.2){v.safeDays++;if(v.threatAt<0){v.threatAt=s.tick;log(s,'opportunity','Your growing city attracts caravans from neighbouring settlements. The next chapter will concern their safety.','city');}}else v.safeDays=0;
}
function setCharter(s:GameState,charter:NonNullable<ReturnType<typeof cityOf>['charter']>){
  cityOf(s).charter=charter;s.values.orderFreedom=clamp(s.values.orderFreedom+(charter==='strict'?8:charter==='watch'?-8:0),0,100);
}
function action(s:GameState,a:Action):ActionResult|null {
  const types=['setCityFunding','startCity','changePolice','setZone','trainPolice','setJustice','resolveCityCase'];
  if(!types.includes(a.type))return null;
  const v=cityOf(s),t=townOf(s),fail=(error:string):ActionResult=>({ok:false,error});
  if(a.type==='startCity'||a.type==='changePolice') {
    if(!Object.prototype.hasOwnProperty.call(POLICE_CHARTERS,a.charter))return fail('Choose a police charter.');
    if(a.type==='startCity'){
      if(!canStartCity(s))return fail('Welcome 400 residents with 60% education, 70% health and 90% food first.');
      v.active=true;v.enteredAt=s.tick;v.crime=t.crime;v.nextCaseDay=Math.floor(s.tick/24)+7;setCharter(s,a.charter);s.stageId='city';if(!s.legacyProgression)s.era=7;s.eraReady=false;
      log(s,'opportunity','Begin with sanitation and lighting. Funded civic jobs improve everyday safety; policing is one part of the response.','city');return {ok:true};
    }
    if(!v.active)return fail('Begin City first.');
    if(v.charter===a.charter||s.tick<v.reformUntil)return fail('Finish the current police reform first.');
    const cost=policeReformCost(s);if(t.cash<cost)return fail('The treasury cannot afford this reform.');
    post(s,'civic',-cost,'Police charter reform','heartland','corporate','town');setCharter(s,a.charter);v.reformUntil=s.tick+7*24;return {ok:true};
  }
  if(!v.active)return fail('Begin the City chapter first.');
  if(a.type==='setCityFunding'){if(typeof a.enabled!=='boolean')return fail('Choose manual or automatic public funding.');v.autoFund=a.enabled;return {ok:true};}
  if(a.type==='setZone'){
    if(!DISTRICT_IDS.includes(a.district)||!['farm','residential','industrial'].includes(a.zone))return fail('Choose a district and a zone.');
    const d=v.districts[a.district];if(d.zone===a.zone)return fail('This district already has that zone.');
    const cost=zoneCost(s);if(t.cash<cost)return fail('The treasury cannot afford the district works.');
    post(s,'civic',-cost,'District rezoning','heartland','corporate','town');d.zone=a.zone;d.rezonedAt=s.tick;return {ok:true};
  }
  if(a.type==='setJustice'){if(!['rehabilitate','punish'].includes(a.policy))return fail('Choose a justice policy.');v.justice=a.policy;return {ok:true};}
  if(a.type==='resolveCityCase')return resolveCase(s,a.answer);
  if(a.type==='trainPolice'){
    if(v.training>=1.5||v.trainingUntil>=0)return fail('Training is complete or already in progress.');
    if(!t.services.some(b=>b.type==='police'&&b.active))return fail('Build an active watchhouse first.');
    const cost=cityTrainingCost(s);if(t.cash<cost)return fail('Fund the treasury before training.');
    post(s,'research',-cost,'Civic officer training','heartland','corporate','town');v.trainingTarget=v.training<1.25?1.25:1.5;v.trainingUntil=s.tick+30*24;return {ok:true};
  }
  return null;
}
export const city:StageModule={id:'city',title:'City',legacyEras:[7],eraUnlocks:{7:s=>lifetimeSales(s)>=60_000_000||totalHa(s)>=3000},
  actionTypes:['incorporate','issueShares','buyback','payDividend','acquire','diligence','setCityFunding','startCity','changePolice','setZone','trainPolice','setJustice','resolveCityCase'],
  tips:['city-utilities','city-safety','city-case'],discoveries:['cityReady','cityCase','cityCaravans'],
  tick:cityDaily,handleAction:action,createState:()=>createCityState() as unknown as Record<string,unknown>};
