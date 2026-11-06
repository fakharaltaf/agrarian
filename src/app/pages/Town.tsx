import { useState } from 'react';
import { act, go, useGame } from '../../stores/game';
import { money, num, pct0 } from '../format';
import { Bar, Card, Info, Modal, PageHead, Seg } from '../ui';
import { communityOf, availableResidents, population } from '../../simulation/community-state';
import { districtPopulation, DISTRICT_NAMES, schoolChangeCost, SERVICE_DEFS, servicePrice, townOf } from '../../simulation/town-state';
import { plannedServiceCost, serviceAvailable, serviceDailyCost, townNextStep } from '../../simulation/stages/town';
import { DISTRICT_IDS, type DistrictId, type SchoolCharter, type ServiceType } from '../../simulation/types';
import { portrait } from '../world/portrait';

export default function TownPage() {
  const s=useGame(), t=townOf(s);
  const [district,setDistrict]=useState<DistrictId>('farmgate'),[count,setCount]=useState(1),[changing,setChanging]=useState(false);
  const change=(charter:SchoolCharter)=>{ if(act({type:'changeSchools',charter}))setChanging(false); };
  const charterTiles=(switching=false)=><div className="charter-grid">{(['public','trade'] as const).map(charter=><article className="charter-tile" key={charter}>
    <div className="charter-crest">{charter==='public'?'📖':'🛠'}</div><h3>{charter==='public'?'Public schools':'Trade schools'}</h3>
    <strong>{charter==='public'?'+15% research · happier families':'Faster skill training · +8% local industry'}</strong>
    <span>{charter==='public'?'Full coverage · steady worker training':'Full coverage · +5% research'}</span>
    <button className="btn primary" disabled={switching&&(t.charter===charter||t.cash<schoolChangeCost(s))} onClick={()=>switching?change(charter):act({type:'startTown',charter})}>{switching?'Retrain':'Choose'} {charter==='public'?'Public':'Trade'}</button>
  </article>)}</div>;
  if(!t.active)return <div className="town-page"><Modal title="A town worth growing up in" onClose={()=>go('farm')} actions={<button className="btn ghost" onClick={()=>go('farm')}>Not yet</button>}>
    <div className="charter-heading"><b>Choose your school charter</b><span>Reversible · {money(schoolChangeCost(s))} + 7 days retraining</span></div>{charterTiles()}
    <p className="muted">Company cash stays separate. Fund services when you are ready.</p>
  </Modal></div>;
  const pop=districtPopulation(s),cover=t.coverage[district];
  const next=townNextStep(s,district);
  const nextLabel=next.kind==='homes'?(next.staff?'🏘️ Homes for new staff':'🏘️ Grow the neighbourhood'):next.kind==='fund'?next.upkeep?'🪙 Fund existing services':'🪙 Fund next project':next.kind==='resume'?`Resume ${SERVICE_DEFS[next.service].name}`:`Build ${SERVICE_DEFS[next.service].name}`;
  const nextCost=next.kind==='fund'?money(next.amount):next.kind==='build'?money(next.cost):next.kind==='resume'?'Opens next morning':'Homes & jobs';
  const nextAction=()=>{if(next.kind==='homes')go('community');else if(next.kind==='fund')act({type:'fundTown',amount:next.amount,direction:'toTown'});else if(next.kind==='resume')act({type:'toggleService',serviceId:next.serviceId});else act({type:'buildService',service:next.service,district});};
  const net=t.lastTax-t.lastCost,repayment=Math.max(0,Math.min(t.companyAdvance,Math.floor((t.cash-plannedServiceCost(s)*14)*100)/100));
  return <div className="stack town-page">
    <PageHead title="Town hall" />
    <div className="town-purse"><b>🪙 {money(t.cash)}</b><span>{net>=0?'+':''}{money(net)} / day</span><Info text="Public money is separate. Households pay tax on real wages. Company funding is a repayable advance, not free income. Suggested funding includes seven days of service costs; surplus repayment keeps fourteen days. Daily flow excludes construction and advances." /></div>
    <button className="btn primary community-next" data-coach="town-fund" disabled={next.kind==='fund'&&next.amount>s.cash} onClick={nextAction}><span>{nextLabel}</span><b>{nextCost}</b></button>
    <div className="town-districts" aria-label="Service neighbourhood">{DISTRICT_IDS.filter(id=>id==='farmgate'||pop[id]>0).map(id=><button className={`btn ${id===district?'gold':'ghost'}`} aria-pressed={id===district} key={id} onClick={()=>setDistrict(id)}><span>{id==='farmgate'?'🏠':id==='orchard'?'🏘️':'🏢'}</span>{DISTRICT_NAMES[id]}<small>{num(pop[id])}</small></button>)}</div>
    <div className="community-strip"><span><b>📚 {pct0(cover.school)}</b><small>schooling</small></span><span><b>💧 {pct0(cover.water)}</b><small>water</small></span><span><b>♥ {pct0(t.health)}</b><small>town health</small></span></div>
    <details className="town-budget"><summary>🪙 Budget & treasury <span>{pct0(t.taxRate)} tax</span></summary><div className="stack">
      <Seg label="Household income tax" value={t.taxRate} onChange={rate=>act({type:'setTownTax',rate})} options={[0,.05,.1,.15,.2,.25].map(v=>({v,label:pct0(v)}))}/>
      <div className="town-cash-flow"><span>Wages → treasury<b>+{money(t.lastTax)}/day</b></span><span>Services → people<b>−{money(t.lastCost)}/day</b></span></div>
      <div className="row wrap">{[10000,50000,250000].map(amount=><button className="btn" key={amount} disabled={amount>s.cash} onClick={()=>act({type:'fundTown',amount,direction:'toTown'})}>+{money(amount)}</button>)}</div>
      <small>Company advance: {money(t.companyAdvance)}</small><button className="btn ghost" disabled={repayment<=0} onClick={()=>act({type:'fundTown',direction:'repay',amount:repayment})}>Repay surplus · {money(repayment)}</button>
      <details className="town-postings"><summary>Public ledger</summary>{t.ledger.slice(-20).reverse().map((entry,index)=><div key={`${entry.tick}-${index}`}><span>{entry.memo}</span><b>{money(entry.amount)}</b></div>)}</details>
      <Info text={`Taxes are collected on the previous day's wages, capped by household funds. ${num(availableResidents(s))} adults are available; ${num(t.publicJobs)} work in services and ${num(t.industrialJobs)} in industry. Coverage updates daily. Empty or paused services cost nothing.`}/>
    </div></details>
    <Seg label="Service units" value={count} onChange={setCount} options={[1,5,10].map(v=>({v,label:`×${v}`}))}/>
    <div className="town-services" data-coach="town-services">{(['school','well','clinic','road','hospital','waterworks','park'] as ServiceType[]).filter(type=>serviceAvailable(s,type)||(type==='park'&&t.services.some(b=>b.type==='park'&&b.district===district))).map(type=>{
      const portraitImage=portrait(`civic:${type}`);
      const d=SERVICE_DEFS[type], built=t.services.find(b=>b.type===type&&b.district===district),price=servicePrice(s,type)*count;
      const coverValue=type==='park'?(built?.funded?1:0):type==='school'?cover.school:type==='well'||type==='waterworks'?cover.water:type==='road'?cover.road:cover.medical;
      const payoff=type==='park'?'A gathering place · happier families':type==='school'?`${d.capacity*count} pupils · skills & research`:type==='road'?'Faster workers · lower haulage':`${d.capacity*count} residents · ${type==='well'||type==='waterworks'?'clean water':'healthcare'}`;
      return <article className="town-service" key={type}><div className="town-portrait">{portraitImage?<img src={portraitImage} alt=""/>:null}<b>{d.icon}</b></div><div className="town-service-body"><h3>{d.name} {built&&<small>×{built.count}</small>}</h3><strong>{payoff}</strong><span>👥 {d.jobs*count} · ⚡ {d.kwh*count} kWh/day</span><Bar value={coverValue} label={`${d.name} coverage`}/><span>{money(price)} → {money(serviceDailyCost(s,type)*count)}/day</span>{type!=='park'&&<button className="btn primary" disabled={price>t.cash} onClick={()=>act({type:'buildService',service:type,district,count})}>Build {count>1?count:''}</button>}</div>
        {built&&<div className="town-service-status"><span>{!built.active?'Paused':built.funded?`${built.staffed}/${d.jobs*built.count} staff · working`:t.cash<serviceDailyCost(s,type)*built.count?'Treasury needs funding':availableResidents(s)<d.jobs*built.count?'Needs more resident staff':'Opens next morning'}</span><button className="btn ghost" onClick={()=>act({type:'toggleService',serviceId:built.id})}>{built.active?'Pause':'Resume'}</button></div>}
      </article>;
    })}</div>
    {t.petition&&<Card title="Council petition"><div className="town-petition"><span>{t.petition.kind==='park'?'🌳':'🍞'}</span><div><b>{t.petition.kind==='park'?'A place to gather':'A bread delivery for everyone'}</b><p>{t.petition.kind==='park'?`${money(servicePrice(s,'park'))} + upkeep`:'Uses real bread from your bakery'}</p></div></div><div className="row"><button className="btn primary" onClick={()=>act({type:'answerPetition',accept:true})}>Support</button><button className="btn ghost" onClick={()=>act({type:'answerPetition',accept:false})}>Decline</button></div></Card>}
    <details className="town-budget"><summary>Character & school charter</summary><div className="stack"><span>{num(population(s))} people · ☺ {pct0(communityOf(s).happiness)}</span><span>Industry: {pct0(t.factoryShare)} local staff</span><span>Illness losses: {num(t.illnessDeaths)} <Info text="Poor nutrition, unsafe water and missing healthcare lower health. Illness reduces productivity and causes avoidable deaths. Funded water and medical coverage prevent them." /></span><span>Retraining: {Math.max(0,Math.ceil((t.retrainingUntil-s.tick)/24))} days left</span><button className="btn" disabled={s.tick<t.retrainingUntil} onClick={()=>setChanging(true)}>Change school charter</button></div></details>
    {changing&&<Modal title="Retrain the schools" onClose={()=>setChanging(false)}><p>{money(schoolChangeCost(s))} from the treasury · 7 days without education benefits.</p>{charterTiles(true)}</Modal>}
  </div>;
}
