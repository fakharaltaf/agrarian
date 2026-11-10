import { regionActive } from '../region-state';
import { canPlaceNew, placeNew, SERVICE_FOOTPRINT } from '../world';
import { nationActive, nationOf } from '../nation-state';
import {allocateNeighbourJobs} from '../employment';
import { cityActive, cityOf } from '../city-state';
import type { StageModule } from './types';
import type { Action, ActionResult, DistrictId, GameState, SchoolCharter, ServiceType } from '../types';
import { DISTRICT_IDS } from '../types';
import { GOODS, WORK_HOURS } from '../config';
import { clamp, electricityPrice, log, marketWage, nextId, post, priceUsd, random, reservedStock, round2 } from '../core';
import { communityOf, familiesHere, population, workingAdults, children, residentWorkers } from '../community-state';
import { createTownState, districtPopulation, factoryJobs, localEmployment, payHouseholds, schoolChangeCost, SERVICE_DEFS, servicePrice, serviceJobs, townOf, townWorkforce } from '../town-state';

export const canStartTown = (s: GameState) => communityOf(s).active && !townOf(s).active && familiesHere(s)>=6 && communityOf(s).happiness>=.6 && communityOf(s).fed>=.9;
export function serviceAvailable(s: GameState, type: ServiceType): boolean {
  const t=townOf(s);
  if(type==='sanitation'||type==='lighting'||type==='police')return cityActive(s);
  if(type==='watchtower')return regionActive(s);
  if(type==='barracks')return nationActive(s)&&nationOf(s).path==='army';
  if(type==='school'||type==='well') return true;
  if(type==='clinic'||type==='road') return t.services.some(b=>b.type==='school'||b.type==='well');
  if(type==='hospital') return population(s)>=400 && t.services.some(b=>b.type==='clinic');
  if(type==='waterworks') return population(s)>=400 && t.services.some(b=>b.type==='well');
  return false; // parks are a council petition, not an unexplained first-day system
}
/** Taxes/maintenance never borrow automatically: the town cannot spend company cash. */
export function serviceDailyCost(s: GameState, type: ServiceType, jobs=serviceJobs(s,type)) {
  const d=SERVICE_DEFS[type];
  return round2(jobs*WORK_HOURS*marketWage(s,'heartland') + d.cost*.0005*s.macro.cpi + d.kwh*electricityPrice(s,'heartland') + (type==='park'?20*s.macro.cpi:0));
}
export const plannedServiceCost = (s: GameState) => townOf(s).services.filter(b=>b.active).reduce((n,b)=>n+serviceDailyCost(s,b.type)*b.count,0);
export type TownDecision = {kind:'homes';staff:boolean} | {kind:'fund';amount:number;upkeep:boolean} | {kind:'resume';serviceId:number;service:ServiceType} | {kind:'build';service:ServiceType;cost:number};
/** Diagnose existing capacity before suggesting more construction. */
export function townNextStep(s:GameState,district:DistrictId):TownDecision {
  const t=townOf(s),runningCost=plannedServiceCost(s);
  if(runningCost>0&&t.cash<runningCost*7)return {kind:'fund',amount:Math.ceil((runningCost*7-t.cash)/100)*100,upkeep:true};
  const unfilled=t.services.reduce((n,b)=>n+(b.active?Math.max(0,serviceJobs(s,b.type)*b.count-b.staffed):0),0);
  if(unfilled>townWorkforce(s)-t.publicJobs)return {kind:'homes',staff:true};
  const pop=districtPopulation(s)[district],students=children(s)*pop/Math.max(1,population(s));
  for(const type of ['school','well','clinic','road'] as const) {
    if(!serviceAvailable(s,type))continue;
    const uses=(b:{type:ServiceType})=>b.type===type||(type==='well'&&b.type==='waterworks')||(type==='clinic'&&b.type==='hospital');
    const capacity=t.services.filter(b=>b.district===district&&b.active&&uses(b)).reduce((n,b)=>n+SERVICE_DEFS[b.type].capacity*b.count,0);
    if(capacity>=(type==='school'?students:type==='road'?1:pop))continue;
    const paused=t.services.find(b=>b.district===district&&!b.active&&uses(b));
    if(paused)return {kind:'resume',serviceId:paused.id,service:paused.type};
    const cost=servicePrice(s,type),need=cost+(runningCost+serviceDailyCost(s,type))*7;
    if(t.cash<need)return {kind:'fund',amount:Math.ceil((need-t.cash)/100)*100,upkeep:false};
    return {kind:'build',service:type,cost};
  }
  return {kind:'homes',staff:false};
}
function setCharter(s: GameState, charter: SchoolCharter) {
  const t=townOf(s); t.charter=charter;
  s.values.traditionProgress=clamp(s.values.traditionProgress+(charter==='public'?8:4),0,100);
  s.values.prosperityFairness=clamp(s.values.prosperityFairness+(charter==='public'?6:-6),0,100);
}
/** Allocation is deterministic and shared by coverage/paid salaries/available hires. */
export function townDaily(s: GameState) {
  const t=townOf(s), c=communityOf(s), today=Math.floor(s.tick/24);
  if(!t.active || s.tick%24!==0 || t.lastDay===today) return;
  t.lastDay=today;
  const tax=Math.floor(Math.min(c.householdCash, t.taxableIncome*t.taxRate)*100)/100;
  t.taxableIncome=0; t.lastTax=tax;
  if(tax>0) { c.householdCash=Math.max(0,round2(c.householdCash-tax)); post(s,'residentTax',tax,'Household income tax','heartland','corporate','town'); }
  // Illness mortality is aggregate expected loss, not a per-person hourly loop.
  t.mortalityCarry+=population(s)*.00002*(1-t.health);
  const peopleAtRisk=population(s),deaths=Math.min(peopleAtRisk,Math.floor(t.mortalityCarry));
  if(deaths>0) {
    let expected=0,assigned=0;
    const offset=random(s);
    for(const group of c.cohorts) {
      const n=group.adults+group.children;expected+=deaths*n/peopleAtRisk;
      const lost=Math.min(n,Math.floor(expected+offset)-assigned);assigned+=lost;
      if(!lost)continue;
      const adultLoss=Math.min(group.adults,Math.max(lost-group.children,Math.floor(lost*group.adults/n+random(s))));
      group.adults-=adultLoss;group.children-=lost-adultLoss;
      group.households=Math.min(group.households,group.adults+group.children);
    }
    c.cohorts=c.cohorts.filter(group=>group.households>0);
    t.mortalityCarry-=deaths;t.illnessDeaths+=deaths;
  }
  if(deaths)log(s,'warning',`${deaths} resident${deaths===1?'':'s'} lost to illness. Clean water and healthcare prevent avoidable deaths.`,'town');
  while(residentWorkers(s)>workingAdults(s)) {
    const worker=[...s.workers].reverse().find(w=>w.resident&&w.region==='heartland')!;
    s.workers.splice(s.workers.indexOf(worker),1);
    for(const machine of s.machines)if(machine.driver===worker.id)machine.driver=null;
  }
  let adults=townWorkforce(s); t.publicJobs=0; t.lastCost=0;
  const pop=districtPopulation(s);
  for(const id of DISTRICT_IDS) t.coverage[id]={people:pop[id],school:0,water:0,medical:0,road:0};
  // Public buildings retain construction order; priority is explicit and stable.
  for(const b of t.services) {
    b.staffed=0; b.funded=false;
    if(!b.active) continue;
    const d=SERVICE_DEFS[b.type], needed=serviceJobs(s,b.type)*b.count, jobs=Math.min(adults,needed);
    if(needed>0 && jobs===0) continue;
    const cost=round2(serviceDailyCost(s,b.type,jobs/b.count)*b.count);
    if(t.cash+1e-6<cost) continue;
    post(s,'civic',-cost,`${d.name} services`,'heartland','corporate','town'); t.lastCost=round2(t.lastCost+cost);
    const wages=round2(jobs*WORK_HOURS*marketWage(s,'heartland'));
    if(wages>0) payHouseholds(s,wages);
    b.staffed=jobs; b.funded=true; adults-=jobs; t.publicJobs+=jobs;
    const cover=t.coverage[b.district], ratio=needed ? jobs/needed : 1;
    const capacity=d.capacity*b.count*ratio;
    if(b.type==='school' && s.tick>=t.retrainingUntil) cover.school+=capacity;
    if(b.type==='well'||b.type==='waterworks') cover.water+=capacity;
    if(b.type==='clinic'||b.type==='hospital') cover.medical+=capacity;
    if(b.type==='road') cover.road=1;
  }
  const people=population(s);
  let school=0,water=0,medical=0,roads=0;
  for(const id of DISTRICT_IDS) {
    const v=t.coverage[id];
    v.school=v.people?clamp(v.school/Math.max(1,children(s)*v.people/Math.max(1,population(s))),0,1):0;
    v.water=v.people?clamp(v.water/v.people,0,1):0;
    v.medical=v.people?clamp(v.medical/v.people,0,1):0;
    school+=v.school*v.people;water+=v.water*v.people;medical+=v.medical*v.people;roads+=v.road*v.people;
  }
  t.education=people?school/people:0;t.water=people?water/people:0;t.roads=people?roads/people:0;
  const sanitation=cityActive(s)?cityOf(s).sanitation:1;
  const wellbeing=clamp(c.fed*.45+t.water*.3+(people?medical/people:1)*.25-.1*(1-sanitation),0,1);
  t.health=clamp(t.health+(wellbeing-t.health)*.15,0,1);
  const requested=factoryJobs(s);
  t.industrialJobs=Math.min(adults,requested);t.factoryShare=requested?t.industrialJobs/requested:0;
  allocateNeighbourJobs(s,adults-t.industrialJobs);
  // Actual local hands retain their identity and gain skills; contractor backfill is unchanged.
  const training=t.charter==='trade'?.006:.002;
  for(const w of s.workers) if(w.resident && w.region==='heartland') w.skill=Math.min(1.6,w.skill+training*t.education);
  const parks=t.services.some(b=>b.type==='park'&&b.funded);
  const goodwill=(t.goodwillUntil>=today||parks)?.04:0;
  c.happiness=clamp(c.happiness+(.02*t.education*(t.charter==='public'?1:.5)+.015*t.roads+goodwill*.1-.04*t.taxRate-.03*(1-t.health)),0,1);
  const unemployment=people?Math.max(0,1-localEmployment(s)/Math.max(1,workingAdults(s))):0;
  const target=people>=400?clamp(.05+.3*unemployment+.25*(1-c.happiness)+.15*(1-t.roads)+.1*(1-t.education)-.15*c.happiness,0,.8):0;
  if(!cityActive(s))t.crime=clamp(t.crime+(target-t.crime)*.1,0,1);
  if(!cityActive(s)&&people>=400 && random(s)<t.crime*.2) {
    const inv=s.regions.heartland.inventory;
    const goods=Object.keys(inv) as (keyof typeof inv)[];
    const good=goods.reduce((best,g)=>inv[g]*priceUsd(s,'heartland',g)>inv[best]*priceUsd(s,'heartland',best)?g:best,'wheat' as keyof typeof inv);
    const take=Math.min(Math.max(0,inv[good]-reservedStock(s,'heartland',good)-(c.larderHold[good]??0)),Math.max(1,inv[good]*.002));
    if(take>0) {inv[good]-=take;t.thefts++;log(s,'warning',`Warehouse theft: ${Math.ceil(take)} ${GOODS[good].name.toLowerCase()}. Better jobs, schools and roads lower the risk.`,'town');}
  }
  const book=t.books[t.books.length-1];
  if(book&&book.day===today){book.cash=t.cash;book.debt=t.companyAdvance;book.equity=round2(t.cash+t.services.reduce((n,b)=>n+b.cost,0)-t.companyAdvance);}
  if(!t.petition && today>=t.nextPetition) {t.petition={id:nextId(s),kind:random(s)<.5&&!t.services.some(b=>b.type==='park')?'park':'bread',opened:today};t.nextPetition=today+14;}
}
function action(s: GameState,a:Action):ActionResult|null {
  const t=townOf(s),fail=(error:string):ActionResult=>({ok:false,error});
  if((a.type==='startTown'||a.type==='changeSchools')&&a.charter!=='public'&&a.charter!=='trade')return fail('Choose Public or Trade schools.');
  if(a.type==='startTown') {
    if(!canStartTown(s)) return fail('Welcome 80 well-fed residents at 65% happiness first.');
    t.active=true;t.enteredAt=s.tick;t.nextPetition=Math.floor(s.tick/24)+7;setCharter(s,a.charter);
    s.stageId='town';if(!s.legacyProgression)s.era=6;s.eraReady=false;
    log(s,'opportunity','A school and clean water are the first civic projects. Fund the treasury when you are ready.','town');
    return {ok:true};
  }
  if(!['fundTown','setTownTax','buildService','toggleService','changeSchools','answerPetition'].includes(a.type))return null;
  if(!t.active)return fail('Begin the Town chapter first.');
  if(a.type==='fundTown') {
    if(!Number.isFinite(a.amount)||a.amount<=0||a.amount!==round2(a.amount))return fail('Use a positive amount in whole cents.');
    if(a.direction==='toTown') {
      if(a.amount>s.cash)return fail('Your company cannot afford this advance.');
      post(s,'townTransfer',-a.amount,'Advance to town treasury','heartland','corporate');
      post(s,'townTransfer',a.amount,'Company advance','heartland','corporate','town');
      t.companyAdvance=round2(t.companyAdvance+a.amount);
    } else {
      if(a.amount>t.cash||a.amount>t.companyAdvance)return fail('Repayment cannot exceed public cash or the outstanding company advance.');
      post(s,'townTransfer',-a.amount,'Repay company advance','heartland','corporate','town');
      post(s,'townTransfer',a.amount,'Town advance repaid','heartland','corporate');
      t.companyAdvance=round2(t.companyAdvance-a.amount);
    }
    return {ok:true};
  }
  if(a.type==='setTownTax') {
    if(![0,.05,.1,.15,.2,.25].includes(a.rate))return fail('Choose a tax rate from 0% to 25% in 5-point steps.');
    t.taxRate=a.rate;return {ok:true};
  }
  if(a.type==='toggleService') {const b=t.services.find(b=>b.id===a.serviceId);if(!b)return fail('Service not found.');b.active=!b.active;return {ok:true};}
  if(a.type==='changeSchools') {
    if(a.charter===t.charter)return fail('These schools already follow that charter.');
    if(s.tick<t.retrainingUntil)return fail('Finish the current seven-day retraining first.');
    const cost=schoolChangeCost(s);if(t.cash<cost)return fail('The treasury cannot afford retraining.');
    post(s,'civic',-cost,'School charter retraining','heartland','corporate','town');setCharter(s,a.charter);t.retrainingUntil=s.tick+7*24;t.education=0;
    return {ok:true};
  }
  if(a.type==='answerPetition') {
    if(!t.petition)return fail('There is no pending petition.');
    if(a.accept) {
      if(t.petition.kind==='park') {
        const cost=servicePrice(s,'park');if(t.cash<cost)return fail('The treasury cannot afford a park yet.');
        const group=t.services.find(b=>b.type==='park'&&b.district==='farmgate');
        if(!group){const room=canPlaceNew(s,'heartland',SERVICE_FOOTPRINT);if(room)return fail(room);}
        post(s,'building',-cost,'Council park','heartland','corporate','town');
        if(group){group.count++;group.cost+=cost;}else{const svc={id:nextId(s),type:'park' as const,district:'farmgate' as const,count:1,cost,active:true,staffed:0,funded:false};t.services.push(svc);placeNew(s,'heartland',`svc:${svc.id}`);}
      } else {
        // Council buys a real bread delivery from the company; it is eaten, not duplicated.
        const qty=Math.ceil(population(s)*2000/GOODS.bread.kcal), inv=s.regions.heartland.inventory;
        const cost=round2(qty*priceUsd(s,'heartland','bread'));
        if(inv.bread-reservedStock(s,'heartland','bread')<qty)return fail(`The bakery must supply ${qty} bread first.`);
        if(t.cash<cost)return fail('The treasury cannot afford the bread delivery.');
        post(s,'purchases',-cost,'Council bread delivery','heartland','corporate','town');
        post(s,'sale',cost,'Council bread delivery','heartland','corporate');inv.bread-=qty;
        s.stats.peopleFed+=population(s)/365;
      }
      t.goodwillUntil=Math.floor(s.tick/24)+14;
      s.values.prosperityFairness=clamp(s.values.prosperityFairness+2,0,100);
    }
    t.petition=null;return {ok:true};
  }
  if(a.type==='buildService') {
    if(!SERVICE_DEFS[a.service]||!DISTRICT_IDS.includes(a.district)||!serviceAvailable(s,a.service))return fail('This service is not available yet.');
    const count=a.count??1;if(!Number.isInteger(count)||count<1||count>50)return fail('Build 1–50 service units.');
    const cost=round2(servicePrice(s,a.service)*count);if(t.cash<cost)return fail('Fund the town treasury before building.');
    // Roads are part of the street plan; other services stand on the map. A chosen spot always starts a new building.
    const group=a.at||a.service==='road'?undefined:t.services.find(b=>b.type===a.service&&b.district===a.district);
    if(!group&&a.service!=='road'){const room=canPlaceNew(s,'heartland',SERVICE_FOOTPRINT,a.at);if(room)return fail(room);}
    post(s,'building',-cost,`${count} ${SERVICE_DEFS[a.service].name}`,'heartland','corporate','town');
    if(group){group.count+=count;group.cost=round2(group.cost+cost);}
    else{const svc={id:nextId(s),type:a.service,district:a.district,count,cost,active:true,staffed:0,funded:false};t.services.push(svc);if(a.service!=='road')placeNew(s,'heartland',`svc:${svc.id}`,a.at);}
    return {ok:true};
  }
  return null;
}
export const town:StageModule={id:'town',title:'Town',legacyEras:[],eraUnlocks:{},
  actionTypes:['startTown','fundTown','setTownTax','buildService','toggleService','changeSchools','answerPetition'],
  tips:['town-budget','town-services'],discoveries:['townSchool','townClinic','townCrime'],
  tick:townDaily,handleAction:action,createState:()=>createTownState() as unknown as Record<string,unknown>};
