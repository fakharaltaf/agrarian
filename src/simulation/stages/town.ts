import { regionActive } from '../region-state';
import { canPlaceNew, placeNew, SERVICE_FOOTPRINT } from '../world';
import { NUISANCE_WEIGHT, settlementExposure } from '../nuisance';
import { nationActive, nationOf } from '../nation-state';
import {allocateNeighbourJobs} from '../employment';
import { cityActive, cityOf } from '../city-state';
import type { StageModule } from './types';
import type { Action, ActionResult, DistrictId, GameState, SchoolCharter, ServiceType } from '../types';
import { DISTRICT_IDS } from '../types';
import { larderReserve } from './settlement';
import { GOODS, WORK_HOURS, type GoodId } from '../config';
import { clamp, electricityPrice, log, marketWage, nextId, post, priceUsd, random, reservedStock, round2 } from '../core';
import { communityOf, familiesHere, population, workingAdults, children, residentWorkers } from '../community-state';
import { createTownState, districtPopulation, factoryJobs, localEmployment, payHouseholds, schoolChangeCost, SERVICE_DEFS, SERVICE_GROUPS, servicePrice, serviceJobs, townOf, townWorkforce, UTILITY_OF, utilityFamilies, serviceRadius, heatAt, levelCapacity, canUpgradeService, levelOf, serviceUpgradePrice } from '../town-state';
import { HOME_DEFS } from '../community-state';
import { doorstep, footprintOf, hasAccess, netReach, NET_QUALITY, tileId, worldOf } from '../world';

export const canStartTown = (s: GameState) => communityOf(s).active && !townOf(s).active && familiesHere(s)>=6 && communityOf(s).happiness>=.6 && communityOf(s).fed>=.9;
export function serviceAvailable(s: GameState, type: ServiceType): boolean {
  const t=townOf(s);
  if(type==='sanitation'||type==='lighting'||type==='waterTower')return t.active||cityActive(s); // the town's own utilities
  if(type==='police')return cityActive(s);
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
/** What the town's shops order each day, per resident: bread, milk, cheese and butter from your production houses. */
export const TOWN_ORDER: Partial<Record<GoodId, number>> = { bread: 0.6, milk: 0.5, cheese: 0.06, butter: 0.05 };
/** The shops pay this much over the market for a steady local supply. */
export const TOWN_ORDER_PREMIUM = 1.2;
/** Each morning the town's shops buy what they need from your stores (above the settlement's larder) at a premium, as a supply contract. */
export function townOrders(s: GameState) {
  const t = townOf(s), people = population(s), inv = s.regions.heartland.inventory;
  t.orders = (Object.entries(TOWN_ORDER) as [GoodId, number][]).map(([good, per]) => {
    const want = Math.floor(people * per), spare = Math.max(0, inv[good] - larderReserve(s, good)), sold = Math.floor(Math.min(want, spare));
    const value = round2(sold * priceUsd(s, 'heartland', good) * TOWN_ORDER_PREMIUM);
    if (sold > 0) {
      inv[good] -= sold;
      post(s, 'contract', value, `Town shops bought ${sold} ${GOODS[good].name.toLowerCase()}`, 'heartland', good === 'milk' ? 'livestock' : 'processing');
      s.stats.sales++;
    }
    return { good, want, sold, value };
  });
}
/** Allocation is deterministic and shared by coverage/paid salaries/available hires. */
export function townDaily(s: GameState) {
  const t=townOf(s), c=communityOf(s), today=Math.floor(s.tick/24);
  if(!t.active || s.tick%24!==0 || t.lastDay===today) return;
  t.lastDay=today;
  townOrders(s);
  const tax=0; // no town treasury: services are paid by the farm and recovered through the settlement's housing tax and pay cut
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
    post(s,'civic',-cost,`${d.name} upkeep`,'heartland','corporate'); t.lastCost=round2(t.lastCost+cost);
    const wages=round2(jobs*WORK_HOURS*marketWage(s,'heartland'));
    if(wages>0) payHouseholds(s,wages);
    b.staffed=jobs; b.funded=true; adults-=jobs; t.publicJobs+=jobs;
    const cover=t.coverage[b.district], ratio=needed ? jobs/needed : 1;
    const capacity=d.capacity*b.count*ratio*levelCapacity(b);
    if(b.type==='school' && s.tick>=t.retrainingUntil) cover.school+=capacity;
    if(b.type==='well'||b.type==='waterworks') cover.water+=capacity;
    if(b.type==='clinic'||b.type==='hospital') cover.medical+=capacity;
    if(b.type==='road') cover.road=1;
  }
  // Coverage. School, clinic and well reach homes as a heat map round the building (full in its inner half, fading to its
  // edge; upgrades widen it). Power, water and sewage reach homes only along their lines, nearest homes first, up to the
  // families the building can serve; the weakest line tier on the way sets how well.
  const w=worldOf(s,'heartland');
  const homes=c.homes.map(h=>{const p=w.pos[`home:${h.id}`],fp=footprintOf(s,`home:${h.id}`);return p&&fp?{x:p[0]+fp.w/2,y:p[1]+fp.d/2,door:doorstep(p[0],p[1],fp).map(([x,y])=>tileId(x,y)),families:HOME_DEFS[h.tier].families*h.count}:null;}).filter(Boolean) as {x:number;y:number;door:number[];families:number}[];
  const total=homes.reduce((n,h)=>n+h.families,0);
  const working=(b:typeof t.services[number])=>b.active&&b.funded&&(SERVICE_DEFS[b.type].jobs===0||b.staffed>0)&&hasAccess(s,'heartland',`svc:${b.id}`);
  const heat=(types:readonly ServiceType[])=>{
    const live=t.services.filter(b=>types.includes(b.type)&&working(b)).map(b=>{const p=w.pos[`svc:${b.id}`];return p?{x:p[0]+1.5,y:p[1]+1.5,r:serviceRadius(b)}:null;}).filter(Boolean) as {x:number;y:number;r:number}[];
    return homes.map(h=>Math.max(0,...live.map(v=>heatAt(Math.hypot(v.x-h.x,v.y-h.y),v.r))));
  };
  const lines=(types:readonly ServiceType[])=>{
    const q=homes.map(()=>0);
    for(const b of t.services){
      const kind=UTILITY_OF[b.type];
      if(!kind||!types.includes(b.type))continue;
      const cap=utilityFamilies(b)*(serviceJobs(s,b.type)?Math.min(1,b.staffed/(serviceJobs(s,b.type)*b.count)):1),p=w.pos[`svc:${b.id}`],fp=footprintOf(s,`svc:${b.id}`);
      b.serving=[0,Math.round(utilityFamilies(b))];
      if(!working(b)||!p||!fp)continue;
      const net=netReach(w,kind,doorstep(p[0],p[1],fp));
      const reached=homes.map((h,i)=>{let tier=0,dist=Infinity;for(const id of h.door){const t2=net.tier.get(id);if(t2){tier=Math.max(tier,t2);dist=Math.min(dist,net.dist.get(id)??Infinity);}}return {i,tier,dist};}).filter(x=>x.tier&&!q[x.i]).sort((x,y)=>x.dist-y.dist);
      let used=0;
      for(const {i,tier} of reached){const take=Math.min(homes[i].families,cap-used);if(take<=0)break;q[i]=NET_QUALITY[kind][tier]*take/homes[i].families;used+=take;}
      b.serving=[Math.round(used),Math.round(cap)];
    }
    return q;
  };
  const share=(q:number[])=>total?homes.reduce((n,h,i)=>n+h.families*q[i],0)/total:0;
  const wellQ=heat(['well']),pipedQ=lines(['waterTower','waterworks']);
  const cover={school:share(heat(SERVICE_GROUPS.school)),water:share(wellQ.map((v,i)=>Math.max(v,pipedQ[i]))),medical:share(heat(SERVICE_GROUPS.medical)),sanitation:share(lines(SERVICE_GROUPS.sanitation)),power:share(lines(SERVICE_GROUPS.power))};
  for(const id of DISTRICT_IDS){const v=t.coverage[id];v.school=cover.school;v.water=cover.water;v.medical=cover.medical;v.road=1;}
  t.sanitation=cover.sanitation;t.power=cover.power;t.medical=cover.medical;
  const people=population(s);
  let school=0,water=0,medical=0,roads=0;
  school=cover.school;water=cover.water;medical=cover.medical;roads=1;
  t.education=school;t.water=water;t.roads=roads;
  const sanitation=cityActive(s)?cityOf(s).sanitation:(t.sanitation??0);
  const wellbeing=clamp(c.fed*.45+t.water*.3+medical*.25-.1*(1-sanitation)-NUISANCE_WEIGHT.smoke*settlementExposure(s).smoke,0,1); // smoke and fumes over the homes
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
  // council petitions drew on the old treasury; they return with the City rework
}
function action(s: GameState,a:Action):ActionResult|null {
  const t=townOf(s),fail=(error:string):ActionResult=>({ok:false,error});
  if(((a.type==='startTown'&&a.charter!==undefined)||a.type==='changeSchools')&&a.charter!=='public'&&a.charter!=='trade')return fail('Choose Public or Trade schools.');
  if(a.type==='startTown') {
    if(!canStartTown(s)) return fail('Settle 6 families, well fed and at least 60% happy, first.');
    t.active=true;t.enteredAt=s.tick;t.nextPetition=Math.floor(s.tick/24)+7;setCharter(s,a.charter??'public');
    s.stageId='town';if(!s.legacyProgression)s.era=6;s.eraReady=false;
    log(s,'opportunity','Newcomers want to settle here too. Homes inside the reach of a school, a clinic and a water tower keep them healthy and happy.','town');
    return {ok:true};
  }
  if(!['fundTown','setTownTax','buildService','upgradeService','toggleService','changeSchools','answerPetition'].includes(a.type))return null;
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
  if(a.type==='upgradeService') {
    const b=t.services.find(x=>x.id===a.serviceId);if(!b)return fail('Service not found.');
    if(!canUpgradeService(b.type))return fail('This service has no upgrades.');
    if(levelOf(b)>=3)return fail('Already at the top level.');
    const cost=serviceUpgradePrice(s,b);if(s.cash<cost)return fail(`Upgrading costs $${cost.toLocaleString()}.`);
    post(s,'building',-cost,`${SERVICE_DEFS[b.type].name} to level ${levelOf(b)+1}`,'heartland','corporate');
    b.level=levelOf(b)+1;b.cost=round2(b.cost+cost);
    return {ok:true,note:UTILITY_OF[b.type]?`It can now serve ${Math.round(utilityFamilies(b))} families along its lines.`:`It now reaches ${Math.round(serviceRadius(b))} tiles.`};
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
    const cost=round2(servicePrice(s,a.service)*count);if(s.cash<cost)return fail(`That costs $${cost.toLocaleString()}.`);
    // Roads are part of the street plan; other services stand on the map. A chosen spot always starts a new building.
    const group=a.at||a.service==='road'?undefined:t.services.find(b=>b.type===a.service&&b.district===a.district);
    if(!group&&a.service!=='road'){const room=canPlaceNew(s,'heartland',SERVICE_FOOTPRINT,a.at,undefined,a.rot);if(room)return fail(room);}
    post(s,'building',-cost,`${count} ${SERVICE_DEFS[a.service].name}`,'heartland','corporate');
    if(group){group.count+=count;group.cost=round2(group.cost+cost);}
    else{const svc={id:nextId(s),type:a.service,district:a.district,count,cost,active:true,staffed:0,funded:false};t.services.push(svc);if(a.service!=='road')placeNew(s,'heartland',`svc:${svc.id}`,a.at,a.rot);}
    return {ok:true};
  }
  return null;
}
export const town:StageModule={id:'town',title:'Town',legacyEras:[],eraUnlocks:{},
  actionTypes:['startTown','fundTown','setTownTax','buildService','upgradeService','toggleService','changeSchools','answerPetition'],
  tips:['town-budget','town-services'],discoveries:['townSchool','townClinic','townCrime'],
  tick:townDaily,handleAction:action,createState:()=>createTownState() as unknown as Record<string,unknown>};
