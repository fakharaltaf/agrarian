// Reporting only: this module never posts money, consumes goods or draws randomness.
import { ANIMALS, BUILDINGS, COWS_PER_DAIRY_BATCH, MANURE, type GoodId, type RegionId } from './config';
import { has, levelMult, priceUsd } from './core';
import { townIndustryFactor } from './town-state';
import type { Building, GameState, ProductionDay, ProductionReport } from './types';
export const emptyProductionReport = (): ProductionReport => ({ open: null, days: [], lastBatches: 0, lastTick: -1 });
const emptyDay = (day:number):ProductionDay => ({day,hours:0,batches:0,capacity:0,earn:0,inputs:0,staff:0,power:0,alternative:0,qty:{},values:{},reasons:{}});

/** Daily alternative output of these cows, including feed they would consume anyway. */
export function cowshedAlternative(s:GameState,r:RegionId,cows:number,p:(g:GoodId)=>number=(g)=>priceUsd(s,r,g)) {
  const herd=s.herds.find(h=>h.region===r&&h.animal==='cows'),k=herd?herd.health*herd.fed:1;
  const qty:Partial<Record<GoodId,number>>={milk:cows*ANIMALS.cows.perDay*k,manure:cows*MANURE.cows,feed:-cows*ANIMALS.cows.feedPerDay};
  return {qty,value:Object.entries(qty).reduce((n,[g,q])=>n+q*p(g as GoodId),0)};
}
function reportDay(report:ProductionReport,today:number) {
  if(report.open?.day!==today) {
    if(report.open)report.days.push(report.open);
    report.days=report.days.filter(d=>d.day>=today-7).slice(-7);
    report.open=emptyDay(today);
  }
  return report.open!;
}
/** Count an actual operating hour. Completed days publish only when the next one starts. */
export function recordProductionHour(s:GameState,b:Building,batches:number,earn:number,inputs:number,staff:number,power:number) {
  const definition=BUILDINGS[b.type],recipe=definition.recipe,report=b.productionReport;
  if(!recipe&&definition.category!=='energy'&&definition.category!=='commerce')return;
  if(report.lastTick===s.tick)return;
  const d=reportDay(report,Math.floor(s.tick/24));
  report.lastTick=s.tick;report.lastBatches=batches;
  d.hours++;d.batches+=batches;
  d.capacity+=recipe?recipe.batchesPerHour*levelMult(b.level)*townIndustryFactor(s,b.region):1;
  d.earn+=earn;d.inputs+=inputs;d.staff+=staff;d.power+=power;
  d.reasons[b.reason]=(d.reasons[b.reason]??0)+1;
  if(!recipe)return;
  const add=(g:GoodId,q:number)=>{d.qty[g]=(d.qty[g]??0)+q;d.values[g]=(d.values[g]??0)+q*priceUsd(s,b.region,g);};
  for(const [g,q]of Object.entries(recipe.inputs))add(g as GoodId,-q!*batches);
  const outputMult=has(s,'processEfficiency')?1.1:1;
  for(const [g,q]of Object.entries(recipe.outputs))add(g as GoodId,q!*batches*outputMult);
  if(b.type==='dairy'&&batches>0) {
    const alt=cowshedAlternative(s,b.region,batches*COWS_PER_DAIRY_BATCH);
    d.alternative+=alt.value/24;
    for(const [g,q]of Object.entries(alt.qty))add(g as GoodId,-q!/24);
  }
}
/** Attribute the existing retail premium; this adds no cash and never duplicates the sale. */
export function recordRetailPremium(s:GameState,r:RegionId,amount:number) {
  const centres=s.buildings.filter(b=>b.region===r&&b.type==='distribution'&&b.active);
  for(const b of centres)reportDay(b.productionReport,Math.floor(s.tick/24)).earn+=amount/centres.length;
}
export function productionReport(list:Building[]) {
  const completed=list.flatMap(b=>b.productionReport.days.filter(d=>d.hours===24));
  const dates=[...new Set(completed.map(d=>d.day))].sort((a,b)=>a-b).slice(-7),start=dates[0]??Infinity;
  const rows=completed.filter(d=>d.day>=start),period=dates.length;
  const sum=(key:'earn'|'inputs'|'staff'|'power'|'alternative'|'batches'|'capacity')=>rows.reduce((n,d)=>n+d[key],0);
  const earn=sum('earn')/Math.max(1,period),inputs=sum('inputs')/Math.max(1,period),staff=sum('staff')/Math.max(1,period),power=sum('power')/Math.max(1,period),alt=sum('alternative')/Math.max(1,period);
  const worth=earn-inputs-staff-power-alt;
  const recent=rows.filter(d=>d.day===dates[dates.length-1]);
  const reasons:Record<string,number>={};for(const d of recent)for(const[r,n]of Object.entries(d.reasons))if(r&&r!=='Paused')reasons[r]=(reasons[r]??0)+n;
  const qty:Partial<Record<GoodId,number>>={},values:Partial<Record<GoodId,number>>={};
  for(const d of rows)for(const[g,q]of Object.entries(d.qty)){qty[g as GoodId]=(qty[g as GoodId]??0)+q!;values[g as GoodId]=(values[g as GoodId]??0)+(d.values[g as GoodId]??0);}
  const prices:Partial<Record<GoodId,number>>={};for(const[g,q]of Object.entries(qty)){if(Math.abs(q!)>1e-6)prices[g as GoodId]=(values[g as GoodId]??0)/q!;qty[g as GoodId]=q!/Math.max(1,period);}
  const utilisation=recent.reduce((n,d)=>n+d.batches,0)/Math.max(1,recent.reduce((n,d)=>n+d.capacity,0));
  const margin=worth/Math.max(1,earn);
  const tone:'up'|'down'|'neutral'=period<3||Math.abs(margin)<.03?'neutral':margin>0?'up':'down';
  return {days:period,earn,inputs,staff,power,alt,worth,qty,prices,utilisation,reason:Object.entries(reasons).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??'',tone,lastDay:dates[dates.length-1]??-1};
}

/** Fixed recipe order: the output floor and input ceiling never exchange positions. */
export function productionPriceRails(type:Building['type'],report:ReturnType<typeof productionReport>) {
  const recipe=BUILDINGS[type].recipe;if(!recipe)return [];
  const output=(Object.keys(recipe.outputs) as GoodId[]).find(g=>g!=='manure'),input=(Object.keys(recipe.inputs) as GoodId[])[0];
  return [...new Set([output,input].filter((g):g is GoodId=>!!g))].map(good=>{
    const q=report.qty[good]??0,now=report.prices[good]??0;
    return {good,side:q>=0?'sell' as const:'buy' as const,now,need:Math.abs(q)>1e-6?now-report.worth/q:null};
  });
}
